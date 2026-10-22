/**
 * AgentLimb local bridge (host side)
 *
 * A tiny zero-dependency HTTP+SSE server that lives INSIDE the MCP host
 * process (spawned by the AI agent over stdio). It is the meeting point
 * between the agent and the browser extension:
 *
 *   AI agent ──stdio── MCP server ──this bridge── SSE/POST ── extension
 *
 * Responsibilities:
 *   - port discovery (first free port in BRIDGE_PORTS)
 *   - SSE fan-out to browser extension(s), one "active" paired browser
 *   - pairing registry, persisted at ~/.agentlimb/paired-clients.json
 *   - tool_call / tool_result correlation with timeouts
 *   - user-message relay (panel chat → agent) and stop signals
 */

import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { BRIDGE_PORTS, BRIDGE_HOST, HOME_DIR_NAME, APP_VERSION, WIRE } from '../kernel/shared/constants.js';

export function agentlimbHome() {
  return join(homedir(), HOME_DIR_NAME);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  mkdirSync(agentlimbHome(), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Stable identity of this MCP host process (survives restarts). */
export function loadOrCreateClientId() {
  const file = join(agentlimbHome(), 'client-id.json');
  const existing = readJson(file, null);
  if (existing?.id) return existing.id;
  const id = randomUUID();
  writeJson(file, { id, createdAt: new Date().toISOString() });
  return id;
}

export function createBridge({ clientId, clientName = 'AI Agent', clientKind = 'generic', onLog, onUserMessage, onStop } = {}) {
  const pairedFile = join(agentlimbHome(), 'paired-clients.json');
  /** @type {Map<string, {res:any, id:string, token:string, paired:boolean}>} */
  const sseClients = new Map();
  /** token -> connection id (extension identifies itself on every POST) */
  const tokenIndex = new Map();
  const pendingToolCalls = new Map(); // tool_use_id -> {resolve, reject, timer}
  let activeBrowserId = null;
  let pendingPairing = null; // {request_id, timer}
  let pendingPairingResolve = null;
  let everConnected = false;
  let server = null;
  let port = null;
  let heartbeat = null;

  function log(level, message) {
    onLog?.(level, message);
  }

  function pairedClients() {
    return readJson(pairedFile, {});
  }

  function isPaired() {
    return Object.prototype.hasOwnProperty.call(pairedClients(), clientId);
  }

  function markPaired(name) {
    const clients = pairedClients();
    clients[clientId] = {
      id: clientId,
      name: name || clientName,
      kind: clientKind,
      pairedAt: new Date().toISOString(),
    };
    writeJson(pairedFile, clients);
  }

  function revokePairing() {
    const clients = pairedClients();
    delete clients[clientId];
    writeJson(pairedFile, clients);
  }

  // ── SSE ─────────────────────────────────────────────────────────────────────
  function sendTo(connection, frame) {
    try {
      connection.res.write(`data: ${JSON.stringify(frame)}\n\n`);
      return true;
    } catch (_) {
      return false;
    }
  }

  function broadcast(frame) {
    for (const conn of sseClients.values()) sendTo(conn, frame);
  }

  function activeConnection() {
    return activeBrowserId ? sseClients.get(activeBrowserId) : null;
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────
  async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        service: 'agentlimb-bridge',
        version: APP_VERSION,
        port,
        browsers: sseClients.size,
        paired: isPaired(),
        client: { id: clientId, name: clientName, kind: clientKind },
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        ...cors,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      const id = randomUUID();
      const token = url.searchParams.get('b') || randomUUID();
      const conn = { res, id, token, paired: false };
      sseClients.set(id, conn);
      tokenIndex.set(token, id);
      everConnected = true;
      log('info', `browser connected (${sseClients.size} total)`);

      sendTo(conn, { t: WIRE.HELLO, client: { id: clientId, name: clientName, kind: clientKind } });
      // Always request pairing; the extension auto-confirms trusted clients.
      requestPairing(conn);

      req.on('close', () => {
        sseClients.delete(id);
        tokenIndex.delete(token);
        if (activeBrowserId === id) {
          activeBrowserId = null;
          // Fail any in-flight tool call — the browser vanished mid-call.
          for (const [useId, pending] of pendingToolCalls) {
            clearTimeout(pending.timer);
            pending.reject(new Error('browser disconnected during tool call'));
            pendingToolCalls.delete(useId);
          }
          log('warn', 'active browser disconnected');
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/message') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let frame;
      try {
        frame = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (_) {
        res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
        return;
      }
      try {
        await handleFrame(frame);
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  }

  // ── pairing ────────────────────────────────────────────────────────────────
  function requestPairing(conn) {
    const requestId = randomUUID();
    if (pendingPairing) {
      clearTimeout(pendingPairing.timer);
      pendingPairing = null;
    }
    pendingPairing = {
      request_id: requestId,
      timer: setTimeout(() => {
        if (pendingPairing?.request_id === requestId) pendingPairing = null;
      }, 180000),
    };
    sendTo(conn, {
      t: WIRE.PAIRING_REQUEST,
      request_id: requestId,
      client: { id: clientId, name: clientName, kind: clientKind },
    });
    log('info', `pairing requested from browser (already paired: ${isPaired()})`);
  }

  /** Wait until the user confirms pairing in the browser. */
  function waitForPairing(timeoutMs = 180000) {
    if (isPaired()) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingPairingResolve) {
          pendingPairingResolve = null;
          reject(new Error('pairing timed out — confirm in the browser pairing tab'));
        }
      }, timeoutMs);
      pendingPairingResolve = (ok, name) => {
        clearTimeout(timer);
        pendingPairingResolve = null;
        if (ok) {
          markPaired(name);
          resolve(true);
        } else {
          reject(new Error('pairing dismissed by user'));
        }
      };
    });
  }

  // ── frames from the extension ───────────────────────────────────────────────
  async function handleFrame(frame) {
    const browserConn = frame.b ? sseClients.get(tokenIndex.get(frame.b) || '') : null;

    switch (frame.t) {
      case WIRE.PAIRING_RESPONSE: {
        if (frame.ok) {
          markPaired(frame.name);
          log('info', `paired as "${frame.name || clientName}"`);
        }
        // Whoever answered becomes the active browser.
        if (browserConn && frame.ok) {
          activeBrowserId = browserConn.id;
          browserConn.paired = true;
        }
        if (pendingPairingResolve) pendingPairingResolve(frame.ok !== false, frame.name);
        break;
      }

      case WIRE.TOOL_RESULT: {
        const pending = pendingToolCalls.get(frame.tool_use_id);
        if (!pending) break;
        clearTimeout(pending.timer);
        pendingToolCalls.delete(frame.tool_use_id);
        if (frame.ok) pending.resolve({ result: frame.result, userMessages: frame.userMessages || [] });
        else pending.reject(new Error(frame.error || 'tool failed'));
        break;
      }

      case WIRE.PONG:
        break;

      case WIRE.USER_MESSAGE: {
        log('info', `user message: ${frame.text}`);
        onUserMessage?.(frame.text);
        // Relay to every browser so the panel chat and tool-result queues see it.
        broadcast({ t: WIRE.USER_MESSAGE, text: frame.text, at: frame.at || new Date().toISOString() });
        break;
      }

      case WIRE.STOP_AGENT: {
        log('info', 'user pressed STOP');
        onStop?.();
        break;
      }

      case WIRE.PAIRING_REVOKED: {
        revokePairing();
        log('info', 'pairing revoked by user');
        break;
      }

      case WIRE.STATUS:
        // Extension reports which clients it trusts; informational only.
        break;

      default:
        break;
    }
  }

  // ── tool calls ──────────────────────────────────────────────────────────────
  async function callTool(tool, args = {}, timeoutMs = 65000) {
    if (!activeConnection()) {
      // No active browser. Two very different situations:
      //  (a) the extension never connected — fail fast, nothing will happen
      //  (b) it connected but pairing is pending — wait for the user
      if (!everConnected) {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline && !everConnected) {
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!everConnected) {
          throw new Error(
            'no browser extension connected. Install/enable the AgentLimb extension and keep Chrome running.',
          );
        }
      }
      if (!activeConnection()) {
        try {
          await waitForPairing(Math.min(timeoutMs, 150000));
        } catch (error) {
          throw new Error(`no paired browser: ${error.message}`);
        }
      }
      if (!activeConnection()) {
        throw new Error('pairing finished but no active browser — reload the extension and retry');
      }
    }
    const toolUseId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingToolCalls.delete(toolUseId);
        reject(new Error(`tool ${tool} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pendingToolCalls.set(toolUseId, { resolve, reject, timer });
      const sent = sendTo(activeConnection(), { t: WIRE.TOOL_CALL, tool_use_id: toolUseId, tool, args, client_id: clientId });
      if (!sent) {
        clearTimeout(timer);
        pendingToolCalls.delete(toolUseId);
        reject(new Error('failed to send tool call to browser'));
      }
    });
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────
  async function start() {
    server = createServer((req, res) => {
      handleRequest(req, res).catch((error) => {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      });
    });

    for (const candidate of BRIDGE_PORTS) {
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(candidate, BRIDGE_HOST, () => {
            server.off('error', reject);
            resolve();
          });
        });
        port = candidate;
        break;
      } catch (_) {
        // port taken — try the next one
      }
    }
    if (port == null) throw new Error(`no free port in ${BRIDGE_PORTS.join(', ')}`);

    // Heartbeat keeps the extension SW awake and detects dead browsers.
    heartbeat = setInterval(() => {
      for (const conn of sseClients.values()) {
        if (!sendTo(conn, { t: WIRE.PING })) sseClients.delete(conn.id);
      }
    }, 25000);

    log('info', `bridge listening on http://${BRIDGE_HOST}:${port} (paired: ${isPaired()})`);
    return port;
  }

  function stop() {
    if (heartbeat) clearInterval(heartbeat);
    for (const conn of sseClients.values()) {
      try { conn.res.end(); } catch (_) { /* ignore */ }
    }
    sseClients.clear();
    tokenIndex.clear();
    if (server) server.close();
  }

  return {
    start,
    stop,
    callTool,
    waitForPairing,
    isPaired,
    getPort: () => port,
    getActiveBrowser: () => activeBrowserId != null,
    revokePairing,
  };
}
