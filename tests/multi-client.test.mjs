import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeClient } from '../kernel/control/background/bridge-client.js';
import { BRIDGE_PORTS, STORAGE_KEYS, WIRE } from '../kernel/shared/constants.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
async function setup(t, execute = async ({ tool }) => ({ tool })) {
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch, EventSource: globalThis.EventSource };
  const ports = BRIDGE_PORTS.slice(0, 2); const sources = new Map(); const posts = []; const executed = [];
  const records = { [STORAGE_KEYS.pairedClients]: { a: { id: 'a', name: 'WorkBuddy', paired: true }, b: { id: 'b', name: 'Second AI', paired: true } }, [STORAGE_KEYS.lastClient]: 'a' };
  globalThis.chrome = { runtime: { sendMessage: async () => {}, getURL: (p) => p }, storage: { local: {
    get: async (key) => ({ [key]: records[key] }), set: async (patch) => { Object.assign(records, patch); },
  } }, tabs: { create: async () => ({}), remove: async () => {} } };
  globalThis.EventSource = class { constructor(url) { sources.set(Number(new URL(url).port), this); } close() {} };
  globalThis.fetch = async (url, options) => {
    const port = Number(new URL(url).port); const index = ports.indexOf(port);
    if (index < 0) throw new Error('no bridge');
    if (options?.body) posts.push({ port, ...JSON.parse(options.body) });
    return { ok: true, json: async () => options?.body ? { ok: true } : { service: 'agentlimb-bridge', client: { id: index === 0 ? 'a' : 'b' } } };
  };
  const bridge = createBridgeClient({ onToolCall: async (call) => { executed.push(call); return execute(call); } });
  t.after(() => { bridge.stop(); Object.assign(globalThis, saved); });
  await bridge.start();
  const emit = async (index, frame) => { sources.get(ports[index]).onmessage({ data: JSON.stringify(frame) }); await tick(); };
  for (const [index, id] of ['a', 'b'].entries()) {
    sources.get(ports[index]).onopen();
    await emit(index, { t: WIRE.HELLO, client: { id, name: id === 'a' ? 'WorkBuddy' : 'Second AI' } });
  }
  const call = (index, id, tool = 'read_page', deadline) => emit(index, { t: WIRE.TOOL_CALL, tool_use_id: id, tool, args: { id }, client_id: index === 0 ? 'a' : 'b', ...(deadline ? { deadline } : {}) });
  const say = (index, text) => emit(index, { t: WIRE.AGENT_MESSAGE, text });
  return { bridge, posts, executed, records, emit, call, say, sources, ports };
}

test('multiple online AIs retain trust; switching isolates transcripts and message routing', async (t) => {
  const { bridge, posts, records, say } = await setup(t);
  assert.equal(bridge.getStatus().clients.filter((c) => c.online && c.paired).length, 2);
  assert.equal(bridge.getStatus().connectedClientId, 'a');
  await say(0, 'reply from A');
  assert.equal(bridge.selectClient('b').ok, true);
  assert.equal(bridge.getStatus().chat.length, 0);
  await bridge.sendUserMessage('message for B', { title: 'B page' });
  assert.equal(posts.find((p) => p.t === WIRE.USER_MESSAGE).port, BRIDGE_PORTS[1]);
  await say(1, 'reply from B');
  assert.equal(bridge.selectClient('a').ok, true);
  assert.ok(bridge.getStatus().chat.some((r) => r.text === 'reply from A'));
  assert.ok(bridge.getStatus().chat.every((r) => !r.text.includes('from B')));
  assert.equal(bridge.getStatus().clients.filter((c) => c.paired).length, 2);
  assert.ok(records[STORAGE_KEYS.chatLogs].b.some((r) => r.text === 'reply from B'));
  await bridge.disconnectClient('b');
  assert.equal(bridge.getStatus().connectedClientId, 'a');
  assert.deepEqual(Object.keys(records[STORAGE_KEYS.pairedClients]), ['a']);
});

test('a second AI waits through both an in-flight tool and the gap until the owner says done', async (t) => {
  const tool = deferred();
  const { bridge, call, say, executed, posts } = await setup(t, ({ args }) => args.id === 'a-tool' ? tool.promise : { ok: true });
  await call(0, 'a-tool');
  await call(1, 'b-tool');
  assert.equal(bridge.selectClient('b').ok, false);
  assert.equal(bridge.getStatus().clients.find((c) => c.id === 'b').waiting, true);
  assert.deepEqual(executed.map((c) => c.args.id), ['a-tool']);
  tool.resolve({ ok: true }); await tick();
  assert.deepEqual(executed.map((c) => c.args.id), ['a-tool'], 'tool completion alone is not task completion');
  await say(0, 'A task complete'); await tick();
  assert.deepEqual(executed.map((c) => c.args.id), ['a-tool', 'b-tool']);
  assert.equal(bridge.getStatus().connectedClientId, 'b');
  assert.equal(posts.find((p) => p.tool_use_id === 'b-tool').port, BRIDGE_PORTS[1]);
});

test('expired queued actions never run after control becomes available', async (t) => {
  const { bridge, call, say, executed, posts } = await setup(t);
  await call(0, 'owner-tool');
  await call(1, 'expired-tool', 'computer', Date.now() + 25);
  await new Promise((r) => setTimeout(r, 70));
  await say(0, 'done'); await tick();
  assert.deepEqual(executed.map((c) => c.args.id), ['owner-tool']);
  assert.equal(posts.find((p) => p.tool_use_id === 'expired-tool').ok, false);
  assert.equal(bridge.getStatus().clients.find((c) => c.id === 'b').waiting, false);
});

test('standby replies cannot release another AI task, and disconnect preserves offline authorization', async (t) => {
  const { bridge, call, say, sources, ports } = await setup(t);
  await call(0, 'owner-task');
  await say(1, 'standby reply');
  assert.equal(bridge.getStatus().operating, true);
  assert.equal(bridge.getStatus().connectedClientId, 'a');
  sources.get(ports[1]).onerror(); await tick();
  const second = bridge.getStatus().clients.find((c) => c.id === 'b');
  assert.equal(second.online, false); assert.equal(second.paired, true);
  assert.equal(bridge.selectClient('b').ok, false);
  await say(0, 'done');
});

test('if an AI finishes a tool without calling say, the task lock expires after TASK_IDLE_MS so other AIs can switch', async (t) => {
  const { bridge, call, executed } = await setup(t);
  await call(0, 'a-tool-no-say');
  await tick();
  assert.equal(bridge.getStatus().operating, true, 'task is open immediately after tool finishes');
  assert.equal(bridge.selectClient('b').ok, false, 'within the 15s turn gap, another AI cannot steal mid-turn');

  // Advance clock past TASK_IDLE_MS (30s): AI A forgot to call say at end of turn.
  const realNow = Date.now;
  Date.now = () => realNow() + 31_000;
  try {
    assert.equal(bridge.getStatus().operating, false, 'idle task lock expires automatically after 30s');
    assert.equal(bridge.selectClient('b').ok, true, 'user or second AI can now switch freely');
    assert.equal(bridge.getStatus().connectedClientId, 'b');
    await call(1, 'b-tool-after-idle');
    await tick();
    assert.deepEqual(executed.map((c) => c.args.id), ['a-tool-no-say', 'b-tool-after-idle']);
  } finally {
    Date.now = realNow;
  }
});
