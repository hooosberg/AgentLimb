/**
 * End-to-end protocol test.
 *
 * Spawns the real MCP server (stdio) as a child process and plays the role of
 * the browser extension over SSE/POST, exercising the full loop:
 *
 *   initialize → tools/list → (waiting) tools/call → grant
 *   → tool_call → tool_result → tools/call resolves → user_message relay
 *   → second MCP process reuses its saved trust without any user action
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createHash } from 'node:crypto';

import { TEST_BRIDGE_PORTS, WIRE } from '../kernel/shared/constants.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const MCP_ENTRY = join(root, 'bin', 'agentlimb.mjs');

/** Poll until `predicate()` is truthy. Notifications arrive asynchronously. */
async function waitUntil(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
    await sleep(50);
  }
}

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
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        AGENTLIMB_CLIENT_NAME: name,
        AGENTLIMB_CLIENT_KIND: kind,
        // Private range: a real Chrome with the extension loaded scans the
        // default range and would otherwise attach to this test bridge and
        // answer "not authorized".
        AGENTLIMB_BRIDGE_PORTS: TEST_BRIDGE_PORTS.join(','),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = '';
    this.received = [];
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
        this.received.push(message);
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

  /** Every MCP notification the host pushed, in arrival order. */
  get notifications() {
    return this.received.filter((m) => m.method);
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
    for (const port of TEST_BRIDGE_PORTS) {
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
test('full authorized tool-call loop over the local bridge', { timeout: 60000 }, async (t) => {
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
  // HELLO is the whole request: there is no approval handshake after it.
  await sleep(300);
  assert.equal(sse.frames.some((f) => f.t === 'pairing_request'), false, 'no approval handshake may exist');
  const waiting = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(waiting.stage, 'awaiting_authorization');

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

  // 3. A tool call that lands before the grant waits for it instead of failing
  let callSettled = false;
  const blockedCall = mcp.request('tools/call', { name: 'ping', arguments: {} })
    .then((r) => { callSettled = true; return r; });
  await sleep(800);
  assert.equal(callSettled, false, 'tool call must wait for the browser grant');

  // 4. The extension grants (remembered trust, or the 30-minute Copy window)
  const grantRes = await post(port, { b: 'tok-1', t: WIRE.GRANT, ok: true, name: 'My Agent' });
  assert.equal(grantRes.ok, true);

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

  // 8. Trust is persisted for this identity
  clearInterval(collectUserMessages);
  const pairedFile = join(home, '.agentlimb', 'paired-clients.json');
  assert.ok(existsSync(pairedFile), 'paired-clients.json written');
  const paired = JSON.parse(readFileSync(pairedFile, 'utf8'));
  const clientId = Object.keys(paired)[0];
  assert.equal(paired[clientId].name, 'My Agent');

  await sse.close();
});

test('an unauthorized client fails fast with an actionable message', { timeout: 30000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-denied-'));
  const mcp = new McpProcess(home, 'Denied Agent', 'test');
  await mcp.ready;
  t.after(() => { mcp.stop(); rmSync(home, { recursive: true, force: true }); });
  await mcp.request('initialize', {});
  const { port } = await discoverPort('Denied Agent');
  const sse = new SseClient(`http://127.0.0.1:${port}/events?b=denied-1`);
  try {
    await sse.waitFor((f) => f.t === WIRE.HELLO);
    // The extension refuses in place: no page, no popup, nothing to click.
    await post(port, { b: 'denied-1', t: WIRE.GRANT, ok: false, reason: 'not_authorized' });
    const call = await mcp.request('tools/call', { name: 'ping', arguments: {} });
    assert.equal(call.result.isError, true);
    assert.match(call.result.content[0].text, /not authorized/i);
    assert.match(call.result.content[0].text, /copy-prompt button/i);
    assert.match(call.result.content[0].text, /No MCP config change or restart/i);
    // The health report says exactly where the connection stopped.
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.stage, 'awaiting_authorization');
    assert.equal(health.denied, 'not_authorized');
  } finally {
    await sse.close();
  }
});

test('second MCP process with same identity reuses saved trust (no user interaction)', { timeout: 60000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-test2-'));
  // Pre-seed the pairing file exactly like a previous session would have.
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(join(home, '.agentlimb'), { recursive: true });
  const identityKey = createHash('sha256').update(JSON.stringify(['My Agent', 'test'])).digest('hex');
  writeFileSync(join(home, '.agentlimb', `client-${identityKey}.json`), JSON.stringify({ id: 'stable-client-id' }));
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
    // A real extension grants saved trust here without asking the user anything.
    await post(port, { b: 'tok-2', t: WIRE.GRANT, ok: true, name: 'My Agent' });

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
    await sse.waitFor((f) => f.t === WIRE.HELLO);
    await post(port, { b: 'tok-3', t: WIRE.GRANT, ok: true, name: 'X' });

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


test('a different AI client cannot reuse another client or legacy saved trust', { timeout: 30000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-identity-'));
  const processes = [];
  t.after(() => { for (const mcp of processes) mcp.stop(); rmSync(home, { recursive: true, force: true }); });
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(join(home, '.agentlimb'), { recursive: true });
  writeFileSync(join(home, '.agentlimb', 'client-id.json'), JSON.stringify({ id: 'legacy-shared' }));
  writeFileSync(join(home, '.agentlimb', 'paired-clients.json'), JSON.stringify({
    'legacy-shared': { id: 'legacy-shared', name: 'Development' },
  }));
  const one = new McpProcess(home, 'Development', 'development');
  processes.push(one);
  await one.request('initialize', {});
  const first = await discoverPort('Development');
  assert.equal(first.body.paired, false, 'legacy global ID must not authorize the named client');
  const sse = new SseClient(`http://127.0.0.1:${first.port}/events?b=identity-test`);
  try {
    await sse.waitFor((f) => f.t === WIRE.HELLO);
    // No saved trust yet: the browser would answer "not authorized" here.
    const waiting = await (await fetch(`http://127.0.0.1:${first.port}/health`)).json();
    assert.equal(waiting.stage, 'awaiting_authorization');
    await post(first.port, { b: 'identity-test', t: WIRE.GRANT, ok: true });
    const firstHealth = await (await fetch(`http://127.0.0.1:${first.port}/health`)).json();
    assert.equal(firstHealth.activeBrowser, true);
    assert.equal(firstHealth.stage, 'ready');
    const two = new McpProcess(home, 'WorkBuddy', 'workbuddy');
    processes.push(two);
    await two.request('initialize', {});
    const second = await discoverPort('WorkBuddy');
    assert.notEqual(first.body.client.id, second.body.client.id);
    assert.equal(second.body.paired, false, 'WorkBuddy needs its own browser authorization');
    assert.equal(second.body.activeBrowser, false);
    assert.equal(second.body.stage, 'awaiting_extension');
  } finally { await sse.close(); }
});

test('initialize identifies clients without env labels before the first browser handshake', { timeout: 30000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-init-'));
  const mcp = new McpProcess(home, '', 'generic');
  t.after(() => { mcp.stop(); rmSync(home, { recursive: true, force: true }); });
  await mcp.request('initialize', { clientInfo: { name: 'Fresh Software' } });
  const { port, body } = await discoverPort('Fresh Software');
  assert.equal(body.paired, false);
  const sse = new SseClient(`http://127.0.0.1:${port}/events?b=init-test`);
  try {
    const hello = await sse.waitFor((f) => f.t === WIRE.HELLO);
    assert.equal(hello.client.name, 'Fresh Software');
    assert.equal(hello.client.id, body.client.id);
  } finally { await sse.close(); }
});

test('concurrent first tools all resume after a single browser grant', { timeout: 15000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-parallel-grant-'));
  const mcp = new McpProcess(home, 'Parallel Grant', 'test');
  t.after(() => { mcp.stop(); rmSync(home, { recursive: true, force: true }); });
  await mcp.request('initialize', {});
  const { port } = await discoverPort('Parallel Grant');
  const sse = new SseClient(`http://127.0.0.1:${port}/events?b=parallel-grant`);
  try {
    await sse.waitFor((f) => f.t === WIRE.HELLO);
    const calls = [mcp.request('tools/call', { name: 'ping' }), mcp.request('tools/call', { name: 'tabs_context' })];
    await sleep(100);
    await post(port, { b: 'parallel-grant', t: WIRE.GRANT, ok: true });
    const completed = new Set();
    const responded = await (async () => {
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline && completed.size < 2) {
        for (const frame of sse.frames.filter((f) => f.t === WIRE.TOOL_CALL)) {
          if (completed.has(frame.tool_use_id)) continue;
          completed.add(frame.tool_use_id);
          await post(port, { b: 'parallel-grant', t: WIRE.TOOL_RESULT, tool_use_id: frame.tool_use_id,
            ok: true, result: frame.tool === 'ping' ? { pong: true } : { tabs: [] } });
        }
        await sleep(25);
      }
      return completed.size;
    })();
    assert.equal(responded, 2, 'every concurrent waiter must resume, not only the last one');
    const responses = await Promise.all(calls);
    assert.ok(responses.every((r) => !r.result.isError));
  } finally { await sse.close(); }
});

test('two client processes keep independent trust across restart and selective revocation', { timeout: 30000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-two-clients-'));
  const processes = []; const streams = [];
  t.after(async () => {
    for (const s of streams) await s.close();
    for (const process of processes) process.stop();
    rmSync(home, { recursive: true, force: true });
  });
  const names = ['First Trust', 'Second Trust'];
  const initial = [];
  for (const name of names) {
    const mcp = new McpProcess(home, name, 'multi'); processes.push(mcp); initial.push(mcp);
    await mcp.request('initialize', {});
  }
  await Promise.all(names.map(async (name, index) => {
    const { port } = await discoverPort(name);
    const sse = new SseClient(`http://127.0.0.1:${port}/events?b=multi-${index}`); streams.push(sse);
    await sse.waitFor((frame) => frame.t === WIRE.HELLO);
    await post(port, { b: `multi-${index}`, t: WIRE.GRANT, ok: true, name });
  }));
  for (const stream of streams) await stream.close(); streams.length = 0;
  await Promise.all(initial.map((process) => new Promise((resolve) => { process.child.once('exit', resolve); process.stop(); })));
  const restarted = [];
  for (const name of names) {
    const mcp = new McpProcess(home, name, 'multi'); processes.push(mcp);
    await mcp.request('initialize', {});
    const record = await discoverPort(name); restarted.push(record);
    assert.equal(record.body.paired, true, `${name} must retain its own trust`);
  }
  await post(restarted[0].port, { t: WIRE.REVOKED, client_id: restarted[0].body.client.id });
  assert.equal((await (await fetch(`http://127.0.0.1:${restarted[0].port}/health`)).json()).paired, false);
  assert.equal((await (await fetch(`http://127.0.0.1:${restarted[1].port}/health`)).json()).paired, true);
});

// ── the agent must be able to tell that it is connected ──────────────────────
/**
 * After a restart the extension restores trust silently, so the agent never
 * learns it is connected unless something tells it. It used to re-run the whole
 * install flow instead. Three things now carry that signal, and all three are
 * asserted here: an instructions block that names `ping` as the first move, a
 * notification at the moment of the grant, and a `ping` result that proves the
 * pairing on its own.
 */
test('the agent is told it is connected instead of having to guess', { timeout: 60000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-test-'));
  const mcp = new McpProcess(home, 'Status Agent', 'test');
  await mcp.ready;
  t.after(() => { mcp.stop(); rmSync(home, { recursive: true, force: true }); });

  // 1. The instructions the agent receives at initialize.
  const init = await mcp.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'status-client', version: '0' },
  });
  const instructions = init.result.instructions;
  assert.match(instructions, /Trust is PERSISTENT/, 'the agent must be told trust survives restarts');
  assert.match(instructions, /call the `ping` tool FIRST/, 'ping must be named as the first move');
  assert.match(instructions, /do not re-do configuration/i, 'it must be told not to redo setup');
  assert.match(instructions, /"Connected\. You can now ask me directly/, 'it must know the exact success sentence');
  // A fresh identity must not be told it is already paired.
  assert.ok(!/Saved pairing found/.test(instructions));

  // 2. `ping` is discoverable as the status check, not as a generic health probe.
  const tools = await mcp.request('tools/list');
  const ping = tools.result.tools.find((tool) => tool.name === 'ping');
  assert.match(ping.description, /unsure whether you are connected/i, 'the description must say when to use it');
  assert.match(ping.description, /Trust persists across restarts/i);

  // 3. The grant pushes a notification the agent can act on.
  const { port } = await discoverPort('Status Agent');
  const sse = new SseClient(`http://127.0.0.1:${port}/events?b=tok-9`);
  await sse.waitFor((f) => f.t === WIRE.HELLO);
  await sleep(300);
  assert.equal((await post(port, { b: 'tok-9', t: WIRE.GRANT, ok: true, name: 'My Agent' })).ok, true);

  const grantNotice = await waitUntil(() => mcp.notifications
    .find((n) => n.method === 'notifications/message' && n.params?.logger === 'agentlimb-status'
      && /^CONNECTED/.test(n.params.data || '')));
  assert.match(grantNotice.params.data, /authorized this AI as "My Agent"/);
  assert.match(grantNotice.params.data, /Trust is saved and will be reused automatically/);
  assert.match(grantNotice.params.data, /Call the ping tool once/);

  // 4. A pong alone answers "am I connected?" — it carries the pairing proof.
  const call = mcp.request('tools/call', { name: 'ping', arguments: {} });
  const toolCall = await sse.waitFor((f) => f.t === WIRE.TOOL_CALL && f.tool === 'ping');
  await post(port, {
    b: 'tok-9',
    t: WIRE.TOOL_RESULT,
    tool_use_id: toolCall.tool_use_id,
    ok: true,
    result: { ok: true, pong: true, at: 'test-now' },
  });
  const response = await call;
  const text = response.result.content.map((c) => c.text || '').join('\n');
  const payload = JSON.parse(text);
  assert.equal(payload.pong, true);
  assert.equal(payload.connection.authorized, true);
  assert.equal(payload.connection.paired, true);
  assert.equal(payload.connection.client, 'Status Agent');
  assert.match(payload.connection.extensionVersion, /^\d+\.\d+\.\d+-[a-z]\d+$/, 'the agent can report the build it is talking to');
  assert.match(payload.connection.note, /Tell the user "Connected"/, 'the result must state the next action');

  // 5. A restart reports the saved pairing instead of asking for a new one.
  const restarted = new McpProcess(home, 'Status Agent', 'test');
  await restarted.ready;
  t.after(() => restarted.stop());
  const secondInit = await restarted.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'status-client', version: '0' },
  });
  assert.match(secondInit.result.instructions, /Trust is PERSISTENT/);
  await waitUntil(() => restarted.notifications
    .find((n) => n.method === 'notifications/message' && n.params?.logger === 'agentlimb-status'
      && /Saved pairing found/.test(n.params.data || '')));
});
