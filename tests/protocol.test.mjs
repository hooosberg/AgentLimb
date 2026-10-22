/**
 * End-to-end protocol test.
 *
 * Spawns the real MCP server (stdio) as a child process and plays the role of
 * the browser extension over SSE/POST, exercising the full loop:
 *
 *   initialize → tools/list → (blocked) tools/call → pairing_response
 *   → tool_call → tool_result → tools/call resolves → user_message relay
 *   → second MCP process auto-pairs with the same identity
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { WIRE } from '../kernel/shared/constants.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const MCP_ENTRY = join(root, 'bin', 'agentlimb.mjs');

// ── helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class McpProcess {
  constructor(home, name = 'Test Agent', kind = 'test') {
    this.home = home;
    this.nextId = 1;
    this.pending = new Map();
    this.child = spawn(process.execPath, [MCP_ENTRY, 'mcp'], {
      env: { ...process.env, HOME: home, AGENTLIMB_CLIENT_NAME: name, AGENTLIMB_CLIENT_KIND: kind },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = '';
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch (_) {
          continue;
        }
        if (message.id != null && this.pending.has(message.id)) {
          this.pending.get(message.id)(message);
          this.pending.delete(message.id);
        }
      }
    });
    this.ready = new Promise((resolve, reject) => {
      this.child.on('error', reject);
      this.child.on('spawn', resolve);
    });
  }

  async request(method, params = {}) {
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => reject(new Error(`MCP timeout waiting for ${method}`)), 20000);
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return response;
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  stop() {
    this.child.kill('SIGTERM');
  }
}

/** Minimal SSE client: collects frames, offers waitFor(predicate). */
class SseClient {
  constructor(url) {
    this.frames = [];
    this.controller = new AbortController();
    this.closed = new Promise((resolve) => { this._resolveClosed = resolve; });
    this.stream = fetch(url, { signal: this.controller.signal })
      .then(async (res) => {
        assert.equal(res.status, 200);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of raw.split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  this.frames.push(JSON.parse(line.slice(6)));
                } catch (_) { /* ignore */ }
              }
            }
          }
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError') throw error;
      })
      .finally(() => this._resolveClosed());
  }

  async waitFor(predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.frames.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(`SSE timeout. frames so far: ${JSON.stringify(this.frames.map((f) => f.t))}`);
      }
      await sleep(50);
    }
  }

  async close() {
    this.controller.abort();
    await this.closed;
  }
}

async function post(port, frame) {
  const res = await fetch(`http://127.0.0.1:${port}/api/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(frame),
  });
  return res.json();
}

async function discoverPort(expectedName, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const port of [8765, 8766, 8767, 8768, 8769, 8770]) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 500);
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          const body = await res.json();
          if (body.service === 'agentlimb-bridge' && body.client?.name === expectedName) {
            return { port, body };
          }
        }
      } catch (_) { /* next */ }
    }
    if (Date.now() > deadline) throw new Error(`bridge "${expectedName}" not discovered`);
    await sleep(300);
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────
test('full pairing + tool-call loop over the local bridge', { timeout: 60000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-test-'));
  const mcp = new McpProcess(home, 'Agent One', 'test');
  await mcp.ready;
  t.after(() => { mcp.stop(); rmSync(home, { recursive: true, force: true }); });

  // 1. MCP handshake
  const init = await mcp.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0' },
  });
  assert.equal(init.result.serverInfo.name, 'agentlimb');
  mcp.notify('notifications/initialized');

  const list = await mcp.request('tools/list');
  assert.equal(list.result.tools.length, 16);

  // 2. Bridge comes up; a "browser" connects over SSE
  const { port, body } = await discoverPort('Agent One');
  assert.equal(body.paired, false, 'fresh identity must be unpaired');
  const sse = new SseClient(`http://127.0.0.1:${port}/events?b=tok-1`);
  const hello = await sse.waitFor((f) => f.t === WIRE.HELLO);
  assert.equal(hello.client.name, 'Agent One');
  const pairingReq = await sse.waitFor((f) => f.t === WIRE.PAIRING_REQUEST);
  assert.ok(pairingReq.request_id);

  // The fake extension mirrors the real one: user messages received over SSE
  // are queued and attached to the NEXT tool_result.
  let queuedUserMessages = [];
  const collectUserMessages = setInterval(() => {
    for (const frame of sse.frames) {
      if (frame.t === WIRE.USER_MESSAGE && !queuedUserMessages.some((m) => m.text === frame.text)) {
        queuedUserMessages.push({ text: frame.text, at: frame.at });
      }
    }
  }, 50);

  // 3. A tool call BEFORE pairing must block (no auto-execute)
  let callSettled = false;
  const blockedCall = mcp.request('tools/call', { name: 'ping', arguments: {} })
    .then((r) => { callSettled = true; return r; });
  await sleep(1200);
  assert.equal(callSettled, false, 'tool call must wait for pairing');

  // 4. User confirms pairing
  const pairingRes = await post(port, {
    b: 'tok-1',
    t: WIRE.PAIRING_RESPONSE,
    request_id: pairingReq.request_id,
    ok: true,
    name: 'My Agent',
  });
  assert.equal(pairingRes.ok, true);

  // 5. The blocked call now reaches the browser as tool_call
  const toolCall = await sse.waitFor((f) => f.t === WIRE.TOOL_CALL);
  assert.equal(toolCall.tool, 'ping');

  // 6. Panel chat message: host relays it to the browser over SSE
  await post(port, {
    b: 'tok-1',
    t: WIRE.USER_MESSAGE,
    text: '顺便把页面往下滚一点',
    at: new Date().toISOString(),
  });
  await sse.waitFor((f) => f.t === WIRE.USER_MESSAGE);
  await sleep(200); // let the collector pick it up

  await post(port, {
    b: 'tok-1',
    t: WIRE.TOOL_RESULT,
    tool_use_id: toolCall.tool_use_id,
    ok: true,
    result: { ok: true, pong: true, at: 'test-now' },
    userMessages: queuedUserMessages,
  });
  queuedUserMessages = [];

  const callResponse = await blockedCall;
  const allText = callResponse.result.content.map((c) => c.text || '').join('\n');
  assert.match(allText, /pong/);
  assert.match(allText, /User message.*顺便把页面往下滚一点/, 'user message must ride on the tool result');

  // 7. A follow-up call works without re-pairing
  const second = mcp.request('tools/call', { name: 'tabs_context', arguments: {} });
  const secondCall = await sse.waitFor((f) => f.t === WIRE.TOOL_CALL && f.tool === 'tabs_context');
  await post(port, {
    b: 'tok-1',
    t: WIRE.TOOL_RESULT,
    tool_use_id: secondCall.tool_use_id,
    ok: true,
    result: { ok: true, tabs: [] },
  });
  const secondResponse = await second;
  assert.match(secondResponse.result.content[0].text, /tabs/);

  // 8. Pairing is persisted for this identity
  clearInterval(collectUserMessages);
  const pairedFile = join(home, '.agentlimb', 'paired-clients.json');
  assert.ok(existsSync(pairedFile), 'paired-clients.json written');
  const paired = JSON.parse(readFileSync(pairedFile, 'utf8'));
  const clientId = Object.keys(paired)[0];
  assert.equal(paired[clientId].name, 'My Agent');

  await sse.close();
});

test('second MCP process with same identity auto-pairs (no user interaction)', { timeout: 60000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-test2-'));
  // Pre-seed the pairing file exactly like a previous session would have.
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(join(home, '.agentlimb'), { recursive: true });
  writeFileSync(join(home, '.agentlimb', 'client-id.json'), JSON.stringify({ id: 'stable-client-id' }));
  writeFileSync(join(home, '.agentlimb', 'paired-clients.json'), JSON.stringify({
    'stable-client-id': { id: 'stable-client-id', name: 'My Agent', kind: 'test', pairedAt: 'x' },
  }));

  const mcp = new McpProcess(home, 'My Agent', 'test');
  await mcp.ready;
  t.after(() => { mcp.stop(); rmSync(home, { recursive: true, force: true }); });

  await mcp.request('initialize', {});
  const { port, body } = await discoverPort('My Agent');
  assert.equal(body.paired, true, 'identity already paired');

  const sse = new SseClient(`http://127.0.0.1:${port}/events?b=tok-2`);
  try {
    await sse.waitFor((f) => f.t === WIRE.HELLO);
    const pairingReq = await sse.waitFor((f) => f.t === WIRE.PAIRING_REQUEST);
    // A real extension auto-confirms trusted clients here (no UI). We simulate that.
    await post(port, { b: 'tok-2', t: WIRE.PAIRING_RESPONSE, request_id: pairingReq.request_id, ok: true, name: 'My Agent' });

    const call = mcp.request('tools/call', { name: 'ping', arguments: {} });
    const toolCall = await sse.waitFor((f) => f.t === WIRE.TOOL_CALL);
    await post(port, {
      b: 'tok-2',
      t: WIRE.TOOL_RESULT,
      tool_use_id: toolCall.tool_use_id,
      ok: true,
      result: { ok: true, pong: true },
    });
    const response = await call;
    assert.match(response.result.content[0].text, /pong/);
  } finally {
    await sse.close();
  }
});

test('tool failure surfaces as MCP error content', { timeout: 60000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-test3-'));
  const mcp = new McpProcess(home, 'Agent Three', 'test');
  await mcp.ready;
  t.after(() => { mcp.stop(); rmSync(home, { recursive: true, force: true }); });

  await mcp.request('initialize', {});
  const { port } = await discoverPort('Agent Three');
  const sse = new SseClient(`http://127.0.0.1:${port}/events?b=tok-3`);
  try {
    const pairingReq = await sse.waitFor((f) => f.t === WIRE.PAIRING_REQUEST);
    await post(port, { b: 'tok-3', t: WIRE.PAIRING_RESPONSE, request_id: pairingReq.request_id, ok: true, name: 'X' });

    const call = mcp.request('tools/call', { name: 'navigate', arguments: { url: 'https://example.com' } });
    const toolCall = await sse.waitFor((f) => f.t === WIRE.TOOL_CALL);
    assert.equal(toolCall.tool, 'navigate');
    await post(port, {
      b: 'tok-3',
      t: WIRE.TOOL_RESULT,
      tool_use_id: toolCall.tool_use_id,
      ok: false,
      error: 'tab is not an http(s) page: chrome://newtab',
    });
    const response = await call;
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /chrome:\/\/newtab/);
  } finally {
    await sse.close();
  }
});
