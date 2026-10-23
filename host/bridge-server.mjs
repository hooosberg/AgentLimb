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
 *   - SSE fan-out to browser extension(s), one "active" authorized browser
 *   - trust registry, persisted at ~/.agentlimb/trust-<hash>.json
 *   - tool_call / tool_result correlation with timeouts
 *   - user-message relay (panel chat → agent) and stop signals
 */

import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';

import { BRIDGE_HOST, HOME_DIR_NAME, APP_VERSION, APP_BUILD, WIRE, resolveBridgePorts } from '../kernel/shared/constants.js';

export function agentlimbHome() {
  return join(process.env.HOME || process.env.USERPROFILE || homedir(), HOME_DIR_NAME);
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
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, payload);
  try {
    renameSync(temp, file);
  } catch (_) {
    // Windows may throw EPERM/EACCES on renameSync when the target file is
    // briefly held open by an indexer or concurrent reader. Fall back safely.
    try { writeFileSync(file, payload); } finally {
      try { rmSync(temp, { force: true }); } catch { /* ignore */ }
    }
  }
}

export function clientTrustPath(clientId) {
  const key = createHash('sha256').update(String(clientId)).digest('hex');
  return join(agentlimbHome(), `trust-${key}.json`);
}

export function persistedTrust(clientId) {
  const own = readJson(clientTrustPath(clientId), null);
  if (own) return own.id === clientId && own.revoked !== true;
  return Object.prototype.hasOwnProperty.call(readJson(join(agentlimbHome(), 'paired-clients.json'), {}), clientId);
}

/** Stable per-client identity. Legacy shared IDs must not grant a new client trust. */
export function clientIdentityPath(clientName, clientKind = 'generic') {
  const key = createHash('sha256').update(JSON.stringify([clientName, clientKind])).digest('hex');
  return join(agentlimbHome(), `client-${key}.json`);
}

export function loadOrCreateClientId(clientName = 'AI Agent', clientKind = 'generic') {
  const file = clientIdentityPath(clientName, clientKind);
  const existing = readJson(file, null);
  if (existing?.id) return existing.id;
  const id = randomUUID();
  writeJson(file, { id, name: clientName, kind: clientKind, createdAt: new Date().toISOString() });
  return id;
}

export function createBridge({ clientId, clientName = 'AI Agent', clientKind = 'generic', ports, onLog, onUserMessage, onAuthorized } = {}) {
  const pairedFile = join(agentlimbHome(), 'paired-clients.json');
  const candidates = ports?.length ? ports : resolveBridgePorts();
  /** @type {Map<string, {res:any, id:string, token:string, granted:boolean}>} */
  const sseClients = new Map();
  /** token -> connection id (extension identifies itself on every POST) */
  const tokenIndex = new Map();
  const pendingToolCalls = new Map(); // tool_use_id -> {resolve, reject, timer}
  let activeBrowserId = null;
  // Set when the browser answered HELLO with "not authorized"; cleared as soon
  // as one connection is granted. Only used to fail fast with a useful message.
  let deniedReason = null;
  let everConnected = false;
  let server = null;
  let port = null;
  let heartbeat = null;
  // /health is polled several times per second by every browser tab's discovery
  // loop. Reading the trust files on each probe blocked the event loop for tens
  // of milliseconds and delayed the very handshake it was reporting on, so the
  // answer is cached: only this process writes this identity's trust file.
  let pairedCache = null;
  let pairedAtCache = null;
  // Set from MCP initialize.params.clientInfo.name — the agent software tells
  // us who it is, so the user never has to type a name to authorize it.
  let effectiveClientName = clientName;

  function log(level, message) {
    onLog?.(level, message);
  }

  function pairedClients() {
    return readJson(pairedFile, {});
  }

  function isPaired() {
    if (pairedCache === null) {
      pairedCache = persistedTrust(clientId);
      if (pairedCache) {
        const record = readJson(clientTrustPath(clientId), null);
        pairedAtCache = record?.pairedAt || null;
      }
    }
    return pairedCache;
  }

  /**
   * What the host knows about the connection right now. `ping` attaches this to
   * its pong so one tool call answers "am I connected?" completely — the agent
   * should never have to guess, re-read install docs, or re-run setup for this.
   */
  function connectionStatus() {
    const connection = activeConnection();
    const authorized = connection?.granted === true;
    return {
      connected: connection != null,
      authorized,
      browser: connection ? 'Chrome (AgentLimb extension)' : null,
      extensionVersion: `${APP_VERSION}-${APP_BUILD}`,
      client: effectiveClientName,
      paired: isPaired(),
      pairedAt: pairedAtCache,
      bridgePort: port,
      note: authorized
        ? 'You are connected and authorized. Trust persists across restarts, so nothing needs to be re-paired, restarted or approved. Tell the user "Connected" and start the task.'
        : connection
          ? 'A browser is connected but has not authorized this AI yet. Ask the user to click the copy-prompt button in the AgentLimb side panel, then retry. Do not change the MCP config or restart.'
          : 'No browser is connected. Keep Chrome running with the AgentLimb extension enabled and open its side panel once, then retry.',
    };
  }

  function markPaired(name) {
    // Each process writes its own authoritative trust record. Concurrent MCP
    // clients cannot erase each other's trust through a shared JSON overwrite.
    const entry = {
      id: clientId,
      name: name || effectiveClientName,
      kind: clientKind,
      pairedAt: new Date().toISOString(),
    };
    pairedAtCache = entry.pairedAt;
    writeJson(clientTrustPath(clientId), entry);
    writeJson(pairedFile, { ...pairedClients(), [clientId]: entry });
    pairedCache = true;
  }

  function revokePairing() {
    writeJson(clientTrustPath(clientId), { id: clientId, revoked: true });
    const clients = pairedClients();
    delete clients[clientId];
    writeJson(pairedFile, clients);
    pairedCache = false;
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
        authorized: activeConnection() != null,
        activeBrowser: activeConnection() != null,
        denied: deniedReason,
        stage: activeConnection() ? 'ready' : sseClients.size ? 'awaiting_authorization' : 'awaiting_extension',
        client: { id: clientId, name: effectiveClientName, kind: clientKind },
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
      const conn = { res, id, token, granted: false };
      sseClients.set(id, conn);
      tokenIndex.set(token, id);
      everConnected = true;
      log('info', `browser connected (${sseClients.size} total)`);

      // The extension answers GRANT after HELLO — no browser page is involved.
      sendTo(conn, { t: WIRE.HELLO, client: { id: clientId, name: effectiveClientName, kind: clientKind } });

      req.on('close', () => {
        sseClients.delete(id);
        tokenIndex.delete(token);
        // No browser left: the last denial no longer describes anything.
        if (sseClients.size === 0) deniedReason = null;
        if (activeBrowserId === id) {
          activeBrowserId = null;
          // Fail any in-flight tool call — the browser vanished mid-call.
          for (const [useId, pending] of pendingToolCalls) {
            clearTimeout(pending.timer);
            pending.reject(new Error('browser disconnected during tool call'));
            pendingToolCalls.delete(useId);
          }
          // Another already-authorized browser keeps working without a re-grant.
          const survivor = [...sseClients.values()].find((other) => other.granted);
          if (survivor) activeBrowserId = survivor.id;
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

  // ── handshake ──────────────────────────────────────────────────────────────
  /** The extension decides; the host only records the answer. */
  function handleGrant(frame, browserConn) {
    if (!browserConn) return;
    if (frame.ok) {
      markPaired(frame.name || effectiveClientName);
      browserConn.granted = true;
      deniedReason = null;
      if (!activeBrowserId) activeBrowserId = browserConn.id;
      const name = frame.name || effectiveClientName;
      log('info', `browser authorized this client as "${name}"`);
      // The agent has no other way to learn this. The extension knows it is
      // paired; the side panel shows it; but the agent only finds out if it
      // happens to call a tool — which is why it kept re-running setup after a
      // restart even though trust had been restored automatically.
      //
      // Reported off to the side and never allowed to throw: the grant itself
      // is already recorded, and a status-reporting bug must not be able to
      // fail the authorization.
      try {
        const status = connectionStatus();
        setImmediate(() => { try { onAuthorized?.({ client: name, at: new Date().toISOString(), status }); } catch (_) { /* ignore */ } });
      } catch (_) { /* ignore */ }
      return;
    }
    deniedReason = frame.reason || 'not_authorized';
    log('warning',
      '浏览器还没有授权这个 AI 接入。请让用户在 AgentLimb 侧栏点「复制连接提示词」（打开 30 分钟接入窗口）后重试，不需要改配置或重启。');
  }

  // ── frames from the extension ───────────────────────────────────────────────
  async function handleFrame(frame) {
    const browserConn = frame.b ? sseClients.get(tokenIndex.get(frame.b) || '') : null;

    switch (frame.t) {
      case WIRE.GRANT: {
        handleGrant(frame, browserConn);
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
        log('info', `user message: ${frame.text}${frame.page ? ` (page: ${frame.page.url})` : ''}`);
        onUserMessage?.(frame.text, frame.page);
        // Relay to every browser so the panel chat and tool-result queues see it.
        broadcast({
          t: WIRE.USER_MESSAGE,
          text: frame.text,
          at: frame.at || new Date().toISOString(),
          page: frame.page,
        });
        break;
      }

      case WIRE.REVOKED: {
        revokePairing();
        // The channel stays open but is no longer usable: the next tool call must
        // fail with the actionable "not authorized" message instead of reaching
        // a browser that just removed this AI.
        if (browserConn) browserConn.granted = false;
        if (browserConn && activeBrowserId === browserConn.id) activeBrowserId = null;
        deniedReason = 'revoked';
        log('warning', '用户已在浏览器侧移除这个 AI（侧栏点了「移除」）——你不再能控制这个浏览器。需要时请让用户重新点「复制连接提示词」。');
        break;
      }

      default:
        break;
    }
  }

  /** Wait for the extension to answer HELLO with a grant. */
  async function waitForGrant(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (activeConnection()) return true;
      if (deniedReason) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return activeConnection() != null;
  }

  const NOT_AUTHORIZED = 'This AI is not authorized by the browser yet. Ask the user to click the copy-prompt button in the AgentLimb side panel — that authorizes the next AI for 30 minutes. No MCP config change or restart is needed; just retry after the user clicks.';

  // ── tool calls ──────────────────────────────────────────────────────────────
  async function callTool(tool, args = {}, timeoutMs = 65000) {
    if (!activeConnection()) {
      // No authorized browser. Three different situations:
      //  (a) the extension never connected — fail fast, nothing will happen
      //  (b) it connected and said "not authorized" — one Copy click fixes it
      //  (c) it connected and the grant is still in flight — wait a beat
      if (deniedReason) throw new Error(NOT_AUTHORIZED);
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
      // A browser was here and dropped: most likely the MV3 worker was
      // suspended, and it cannot answer until Chrome revives it (30 s alarm
      // floor). Wait for that revival instead of reporting a failure the user
      // has no way to act on.
      await waitForGrant(35000);
      if (deniedReason) throw new Error(NOT_AUTHORIZED);
      if (!activeConnection()) {
        throw new Error(
          'the browser has not taken control yet — open the AgentLimb side panel in Chrome (its discovery loop wakes the extension), then retry',
        );
      }
    }
    const toolUseId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingToolCalls.delete(toolUseId);
        reject(new Error(`tool ${tool} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pendingToolCalls.set(toolUseId, { resolve, reject, timer });
      const sent = sendTo(activeConnection(), { t: WIRE.TOOL_CALL, tool_use_id: toolUseId, tool, args, client_id: clientId, deadline: Date.now() + timeoutMs });
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
      // The handshake is three tiny frames on two connections. With Nagle on,
      // the delayed-ACK timer adds a flat ~40 ms to every pairing; turning it
      // off makes HELLO → GRANT effectively free.
      try { req.socket.setNoDelay(true); } catch (_) { /* ignore */ }
      handleRequest(req, res).catch((error) => {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      });
    });

    for (const candidate of candidates) {
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
    if (port == null) throw new Error(`no free port in ${candidates.join(', ')}`);

    // Heartbeat: keeps a live extension worker from idling out (well under the
    // 30 s limit) and detects dead browsers. The extension answers each PING
    // with a POST, and that outbound request is itself an event the MV3 worker
    // registers — this is what keeps the connection alive with the panel closed.
    heartbeat = setInterval(() => {
      for (const conn of sseClients.values()) {
        if (!sendTo(conn, { t: WIRE.PING })) sseClients.delete(conn.id);
      }
    }, 10000);

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

  /**
   * Agent → panel chat. Called by the `say` tool: the reply shows up in the
   * side panel as a normal assistant message, so the panel really is a chat
   * window on the agent, not a one-way command box.
   */
  function sayToUser(text) {
    const clean = String(text || '').trim();
    if (!clean) return false;
    const at = new Date().toISOString();
    broadcast({ t: WIRE.AGENT_MESSAGE, text: clean, at });
    log('info', `agent → panel: ${clean.slice(0, 120)}`);
    return true;
  }

  return {
    start,
    setClientName(name) {
      const next = String(name || '').trim();
      if (!next || next === effectiveClientName) return false;
      effectiveClientName = next;
      log('info', `client identified itself as "${next}"`);
      return true;
    },
    stop,
    callTool,
    sayToUser,
    isPaired,
    getPort: () => port,
    getActiveBrowser: () => activeBrowserId != null,
    connectionStatus,
    getDeniedReason: () => deniedReason,
    revokePairing,
  };
}
