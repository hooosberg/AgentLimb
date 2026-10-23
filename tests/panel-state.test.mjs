import test from 'node:test';
import assert from 'node:assert/strict';
import { panelState } from '../kernel/shared/panel-state.js';
import { createBridgeClient } from '../kernel/control/background/bridge-client.js';
import { STORAGE_KEYS, WIRE, USER_STOP_MESSAGE } from '../kernel/shared/constants.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

/** Advance the clock without waiting: the deadlines are read on every snapshot. */
function travel(ms) {
  const real = Date.now;
  Date.now = () => real() + ms;
  return () => { Date.now = real; };
}

async function setup(t, onToolCall = async () => ({ ok: true })) {
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch, EventSource: globalThis.EventSource };
  t.after(() => Object.assign(globalThis, saved));
  const ports = [18765, 18766];
  const sources = new Map();
  const posts = [];
  let rejectMessage = false;
  const clients = { driver: { name: 'Test Driver', pairedAt: 'now' }, other: { name: 'Second Driver', pairedAt: 'now' } };
  globalThis.chrome = {
    runtime: { sendMessage: async () => {}, getURL: (p) => p },
    storage: { local: {
      get: async () => ({ [STORAGE_KEYS.pairedClients]: clients }),
      set: async () => {},
    } },
  };
  globalThis.EventSource = class {
    constructor(url) { sources.set(Number(new URL(url).port), this); }
    close() {}
  };
  globalThis.fetch = async (url, opts) => {
    const port = Number(new URL(url).port);
    const index = ports.indexOf(port);
    if (index < 0) throw new Error('no bridge');
    if (!opts?.body) return { ok: true, json: async () => ({ service: 'agentlimb-bridge', client: { id: index === 0 ? 'driver' : 'other' } }) };
    const frame = JSON.parse(opts.body);
    posts.push(frame);
    return { ok: true, json: async () => rejectMessage && frame.t === WIRE.USER_MESSAGE
      ? { ok: false, error: 'message rejected' } : { ok: true } };
  };
  const bridge = createBridgeClient({ onToolCall, ports });
  await bridge.start();
  const emit = async (index, frame) => {
    sources.get(ports[index]).onmessage({ data: JSON.stringify(frame) });
    await tick();
  };
  for (const index of [0, 1]) {
    sources.get(ports[index]).onopen();
    await emit(index, { t: WIRE.HELLO, client: index === 0 ? { id: 'driver', name: 'Test Driver' } : { id: 'other', name: 'Second Driver' } });
  }
  return { bridge, posts, emit, rejectMessage: () => { rejectMessage = true; } };
}

test('panel requires a live matching client, independently of saved trust', () => {
  const snapshot = { status: 'disconnected', clients: [{ id: 'old', paired: true }] };
  assert.equal(panelState(snapshot).connected, false);
  snapshot.status = 'connected';
  snapshot.connectedClientId = 'new';
  assert.equal(panelState(snapshot).connected, false, 'SSE to another unpaired client is insufficient');
  snapshot.connectedClientId = 'old';
  assert.equal(panelState(snapshot).locked, false);
  // The composer is an outbox: the agent software owns the turn, so the only
  // thing that may block typing is a message currently on the wire.
  assert.equal(panelState({ ...snapshot, sending: 1 }).locked, true, 'a message in flight blocks a second one');
  // A missing reply is a hint with a deadline, never a lock — the agent may
  // never answer, and a disabled input is indistinguishable from a hung panel.
  assert.equal(panelState({ ...snapshot, pendingReplyAt: Date.now() }).locked, false,
    'waiting for a reply must never lock the composer');
  assert.equal(panelState({ ...snapshot, pendingReplyAt: Date.now() }).mode, 'replying');
  assert.equal(panelState({ ...snapshot, pendingReplyAt: Date.now() }).canStop, true,
    'a reply that is owed can still be asked to stop');
  assert.equal(panelState({ ...snapshot, sending: true }).canStop, false, 'do not send stop ahead of the original message');
});

test('send reserves before snapshot collection and rejects a duplicate while one is in flight', async (t) => {
  const { bridge, posts, emit } = await setup(t);
  const capture = deferred();
  const send = bridge.sendUserMessage('first', () => capture.promise);
  assert.equal(bridge.getStatus().sending, true);
  let extraCaptures = 0;
  assert.equal((await bridge.sendUserMessage('second', () => { extraCaptures++; })).ok, false);
  assert.equal(extraCaptures, 0, 'rejected send must not collect another screenshot');
  capture.resolve({ title: 'Test page', text: 'body', image: 'image-data', url: 'https://example.com' });
  assert.equal((await send).ok, true);
  // Not locked: the agent owns the turn, and typing again is always allowed.
  assert.equal(panelState(bridge.getStatus()).locked, false);
  const message = posts.find((f) => f.t === WIRE.USER_MESSAGE);
  assert.equal(message.page.image, 'image-data', 'delivery still includes the screenshot');
  assert.equal(bridge.getStatus().chat[0].page.image, undefined, 'status/transcript never retransmits screenshot payload');
  await emit(0, { t: WIRE.AGENT_MESSAGE, text: 'Reply' });
  assert.equal(bridge.getStatus().pendingReplyAt, null);
  await emit(0, { t: WIRE.TOOL_CALL, tool_use_id: 'after-reply', tool: 'ping', client_id: 'driver' });
  assert.deepEqual(posts.find((f) => f.tool_use_id === 'after-reply').userMessages, [], 'answered message never leaks into next task');
});

test('messages typed while the agent works are queued, not refused', async (t) => {
  const first = deferred();
  const second = deferred();
  const { bridge, emit, posts } = await setup(t, async ({ args }) => {
    if (args.fail) throw new Error('page failed');
    return args.n === 1 ? first.promise : second.promise;
  });
  await emit(0, { t: WIRE.TOOL_CALL, tool_use_id: 'one', tool: 'read_page', args: { n: 1 }, client_id: 'driver' });
  await emit(0, { t: WIRE.TOOL_CALL, tool_use_id: 'two', tool: 'read_page', args: { n: 2 }, client_id: 'driver' });
  // In the agent's own chat box this is exactly what happens: it queues.
  assert.equal((await bridge.sendUserMessage('while busy')).ok, true, 'typing during a tool must queue, not fail');
  first.resolve({ ok: true });
  await tick();
  assert.equal(bridge.getStatus().busy, true, 'second queued call still owns the lock');
  assert.equal(panelState(bridge.getStatus()).mode, 'operating', 'tool gaps keep the operating state');
  second.resolve({ ok: true });
  await tick();
  assert.equal(bridge.getStatus().busy, false);
  assert.equal(posts.filter((f) => f.t === WIRE.TOOL_RESULT).length, 2);
  const delivered = posts.filter((f) => f.t === WIRE.TOOL_RESULT).flatMap((f) => f.userMessages || []);
  assert.deepEqual(delivered.map((m) => m.text), ['while busy'], 'the queued message rides on the next result');
  await emit(0, { t: WIRE.AGENT_MESSAGE, text: 'Task complete' });
  assert.equal(panelState(bridge.getStatus()).mode, 'ready');

  await emit(0, { t: WIRE.TOOL_CALL, tool_use_id: 'error', tool: 'read_page', args: { fail: true }, client_id: 'driver' });
  assert.equal(bridge.getStatus().busy, false, 'tool errors release the lock');
  assert.equal(posts.find((f) => f.tool_use_id === 'error').ok, false);
  assert.equal(panelState(bridge.getStatus()).mode, 'operating', 'the AI may recover from a tool error');
  await emit(0, { t: WIRE.AGENT_MESSAGE, text: 'Task failed' });
  assert.equal(panelState(bridge.getStatus()).mode, 'ready');
});

test('an unanswered message expires instead of locking the panel', async (t) => {
  const { bridge, emit } = await setup(t);
  await bridge.sendUserMessage('question', { title: 'Page' });
  assert.equal(panelState(bridge.getStatus()).mode, 'replying');
  // The agent never replies — the exact case that used to freeze the panel.
  const restore = travel(61_000);
  try {
    const status = bridge.getStatus();
    assert.equal(status.pendingReplyAt, null, 'a reply owed for over a minute stops being owed');
    assert.equal(panelState(status).locked, false);
    assert.equal(panelState(status).mode, 'ready');
    assert.ok(status.chat.some((r) => r.from === 'system' && /还没有回复/.test(r.text)),
      'the user must be told why the panel unblocked');
  } finally { restore(); }
  // And the message is still there for the agent to read later.
  await emit(0, { t: WIRE.TOOL_CALL, tool_use_id: 'late', tool: 'ping', client_id: 'driver' });
});

test('an owed reply no longer blocks switching to another AI', async (t) => {
  const { bridge, emit } = await setup(t);
  // A second AI is online on its own port (see setup).
  await bridge.sendUserMessage('waiting for A', { title: 'Page' });
  assert.equal(bridge.getStatus().connectedClientId, 'driver');
  assert.equal(panelState(bridge.getStatus()).mode, 'replying');
  assert.equal(bridge.selectClient('other').ok, true,
    'an unpaid reply must not freeze control on the previous AI');
  assert.equal(bridge.getStatus().connectedClientId, 'other');
});

test('a stop that is never acknowledged expires', async (t) => {
  const tool = deferred();
  const { bridge, emit } = await setup(t, () => tool.promise);
  await emit(0, { t: WIRE.TOOL_CALL, tool_use_id: 'running', tool: 'read_page', client_id: 'driver' });
  assert.equal((await bridge.requestStop()).ok, true);
  assert.equal(bridge.getStatus().stopRequested, true);
  tool.resolve({ ok: true });
  await tick();
  // The agent ignores the stop: no `say`, no acknowledgement.
  const restore = travel(21_000);
  try {
    const status = bridge.getStatus();
    assert.equal(status.stopRequested, false, 'a stop owed for over 20 seconds stops being owed');
    assert.ok(status.chat.some((r) => r.from === 'system' && /停止请求已发出/.test(r.text)));
    assert.equal(panelState(status).canStop, true, 'the user can ask again');
  } finally { restore(); }
});

test('four panel states have stable priority; health checks do not start a task', async (t) => {
  const { bridge, emit } = await setup(t);
  await emit(0, { t: WIRE.TOOL_CALL, tool_use_id: 'ping', tool: 'ping', client_id: 'driver' });
  const status = bridge.getStatus();
  assert.equal(panelState(status).mode, 'ready');
  assert.equal(panelState({ ...status, pendingReplyAt: 1 }).mode, 'replying');
  assert.equal(panelState({ ...status, operating: true, pendingReplyAt: 1, sending: true }).mode, 'operating');
  assert.equal(panelState({ ...status, status: 'disconnected', operating: true, pendingReplyAt: 1 }).mode, 'offline');
  assert.equal(panelState({ ...status, operating: true }).placeholder, 'AI 正在操作浏览器，消息会排到它下一次操作后送达…');
  assert.equal(panelState({ ...status, operating: true }).canStop, true);
  assert.equal(panelState({ ...status, operating: true, stopRequested: true }).canStop, false);
  assert.equal(panelState({ ...status, operating: true, stopRequested: true }).placeholder, '已请求停止，未收到确认也可以继续…');
  assert.equal(panelState({ ...status, pendingReplyAt: 1 }).placeholder, 'AI 还没回复，你可以继续发送…');
});

test('stop is one plain message during a tool, without unpairing or pretending cancellation', async (t) => {
  const tool = deferred();
  const { bridge, emit, posts } = await setup(t, () => tool.promise);
  await emit(0, { t: WIRE.TOOL_CALL, tool_use_id: 'running', tool: 'read_page', client_id: 'driver' });
  const first = bridge.requestStop();
  assert.equal(bridge.getStatus().stopRequested, true);
  assert.equal((await bridge.requestStop()).alreadyRequested, true);
  assert.equal((await first).ok, true);
  const sent = posts.filter((frame) => frame.t === WIRE.USER_MESSAGE);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, USER_STOP_MESSAGE);
  assert.equal(sent[0].page, undefined);
  assert.equal(bridge.getStatus().clients[0].paired, true);
  assert.equal(bridge.getStatus().busy, true, 'requesting a stop does not cancel an in-flight tool');
  tool.resolve({ ok: true });
  await tick();
  const result = posts.find((frame) => frame.tool_use_id === 'running');
  assert.equal(result.userMessages[0].text, USER_STOP_MESSAGE);
  await emit(0, { t: WIRE.AGENT_MESSAGE, text: '已停止后续操作。' });
  assert.equal(bridge.getStatus().stopRequested, false);
  assert.equal(panelState(bridge.getStatus()).mode, 'ready');
  assert.equal((await bridge.requestStop()).ok, false, 'idle button cannot manufacture a stop task');
});

test('stop while awaiting a reply keeps the original message; failed request can retry', async (t) => {
  const { bridge, emit, posts, rejectMessage } = await setup(t);
  await bridge.sendUserMessage('original question', { title: 'Page' });
  const pendingAt = bridge.getStatus().pendingReplyAt;
  rejectMessage();
  assert.equal((await bridge.requestStop()).ok, false);
  assert.equal(bridge.getStatus().stopRequested, false);
  assert.equal(bridge.getStatus().pendingReplyAt, pendingAt);
  assert.equal(bridge.getStatus().chat.length, 1, 'failed stop has no phantom transcript record');
  assert.equal(panelState(bridge.getStatus()).canStop, true);
  await emit(0, { t: WIRE.TOOL_CALL, tool_use_id: 'delivery', tool: 'ping', client_id: 'driver' });
  assert.deepEqual(posts.find((frame) => frame.tool_use_id === 'delivery').userMessages.map((m) => m.text), ['original question']);
  await bridge.disconnectClient('driver');
  assert.equal(bridge.getStatus().stopRequested, false);
  assert.equal((await bridge.requestStop()).ok, false);
});

test('failed post rolls back pending reply and transcript, allowing a retry', async (t) => {
  const { bridge, rejectMessage } = await setup(t);
  rejectMessage();
  assert.equal((await bridge.sendUserMessage('draft')).ok, false);
  assert.equal(bridge.getStatus().pendingReplyAt, null);
  assert.equal(bridge.getStatus().chat.length, 0);
  assert.equal(panelState(bridge.getStatus()).locked, false);
});

test('disconnect during page collection prevents stale send or transcript resurrection', async (t) => {
  const { bridge, posts } = await setup(t);
  const capture = deferred();
  const send = bridge.sendUserMessage('old draft', () => capture.promise);
  await bridge.disconnectClient('driver');
  capture.resolve({ title: 'Old page' });
  assert.equal((await send).ok, false);
  assert.equal(posts.some((f) => f.t === WIRE.USER_MESSAGE), false);
  assert.equal(bridge.getStatus().chat.length, 0);
  assert.equal(panelState(bridge.getStatus()).connected, false);
});

test('a tool arriving during page collection no longer discards the message', async (t) => {
  const tool = deferred();
  const capture = deferred();
  const { bridge, emit, posts } = await setup(t, () => tool.promise);
  const send = bridge.sendUserMessage('draft', () => capture.promise);
  await emit(0, { t: WIRE.TOOL_CALL, tool_use_id: 'drive', tool: 'read_page', client_id: 'driver' });
  capture.resolve({ title: 'Page' });
  // The message queues; it is not thrown away just because the agent started
  // working at the same moment.
  assert.equal((await send).ok, true);
  assert.equal(posts.some((f) => f.t === WIRE.USER_MESSAGE), true);
  tool.resolve({ ok: true });
  await tick();
  await emit(0, { t: WIRE.AGENT_MESSAGE, text: 'Done' });
  assert.equal(panelState(bridge.getStatus()).locked, false);
});
