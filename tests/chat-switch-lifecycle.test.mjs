/**
 * Tests for chat switch lifecycle and cross-platform multi-session reliability.
 *
 * Covers:
 * 1. Same-client fast takeover in WIRE.HELLO when a new chat starts without calling `say` in old chat.
 * 2. Same-client lock inheritance in WIRE.TOOL_CALL so subsequent tool calls are not stuck in waitingTools.
 * 3. Expanded port range (up to 8780) to handle TIME_WAIT port exhaustion on Windows.
 * 4. Router sticky agentTabId reset in stopAllDriving so a new session doesn't leak into old tabs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeClient } from '../kernel/control/background/bridge-client.js';
import { createRouter } from '../kernel/control/background/router.js';
import { BRIDGE_PORTS, STORAGE_KEYS, WIRE } from '../kernel/shared/constants.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function setupChatSwitch(t, execute = async ({ tool }) => ({ tool })) {
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch, EventSource: globalThis.EventSource };
  const ports = BRIDGE_PORTS.slice(0, 3);
  const sources = new Map();
  const posts = [];
  const executed = [];
  const records = {
    [STORAGE_KEYS.pairedClients]: {
      workbuddy: { id: 'workbuddy', name: 'WorkBuddy', kind: 'workbuddy', paired: true },
      cursor: { id: 'cursor', name: 'Cursor', kind: 'cursor', paired: true },
    },
    [STORAGE_KEYS.lastClient]: 'workbuddy',
  };

  globalThis.chrome = {
    runtime: { sendMessage: async () => {}, getURL: (p) => p },
    storage: {
      local: {
        get: async (key) => ({ [key]: records[key] }),
        set: async (patch) => { Object.assign(records, patch); },
      },
    },
    tabs: { create: async () => ({}), remove: async () => {} },
  };

  globalThis.EventSource = class {
    constructor(url) {
      this.port = Number(new URL(url).port);
      sources.set(this.port, this);
    }
    close() {
      sources.delete(this.port);
    }
  };

  globalThis.fetch = async (url, options) => {
    const port = Number(new URL(url).port);
    const index = ports.indexOf(port);
    if (index < 0) throw new Error('no bridge');
    if (options?.body) posts.push({ port, ...JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => (options?.body ? { ok: true } : {
        service: 'agentlimb-bridge',
        client: { id: index === 0 ? 'workbuddy' : index === 1 ? 'workbuddy' : 'cursor' },
      }),
    };
  };

  const bridge = createBridgeClient({
    ports,
    onToolCall: async (call) => {
      executed.push(call);
      return execute(call);
    },
  });

  t.after(() => {
    bridge.stop();
    Object.assign(globalThis, saved);
  });

  await bridge.start();

  const emit = async (portIndex, frame) => {
    const src = sources.get(ports[portIndex]);
    if (src?.onmessage) src.onmessage({ data: JSON.stringify(frame) });
    await tick();
  };

  const openPort = (portIndex) => {
    const src = sources.get(ports[portIndex]);
    if (src?.onopen) src.onopen();
  };

  const call = (portIndex, id, tool = 'read_page', deadline) =>
    emit(portIndex, {
      t: WIRE.TOOL_CALL,
      tool_use_id: id,
      tool,
      args: { id },
      client_id: portIndex <= 1 ? 'workbuddy' : 'cursor',
      ...(deadline ? { deadline } : {}),
    });

  const say = (portIndex, text) => emit(portIndex, { t: WIRE.AGENT_MESSAGE, text });

  return { bridge, posts, executed, records, emit, openPort, call, say, sources, ports };
}

test('same-client new chat on new port takes over immediately without say call in old chat', async (t) => {
  const { bridge, openPort, emit, call, executed, ports } = await setupChatSwitch(t);

  // 1. Initial chat session on port 0 connects
  openPort(0);
  await emit(0, { t: WIRE.HELLO, client: { id: 'workbuddy', name: 'WorkBuddy' } });
  assert.equal(bridge.getStatus().connectedClientId, 'workbuddy');
  assert.equal(bridge.getStatus().port, ports[0]);

  // 2. Chat 1 runs a tool, but finishes turn WITHOUT calling say (e.g. user interrupted or model omitted say)
  await call(0, 'tool-turn-1');
  assert.deepEqual(executed.map((c) => c.args.id), ['tool-turn-1']);
  assert.equal(bridge.getStatus().operating, true, 'operating task lock is still held because say was not called');

  // 3. User clicks "New Chat" in WorkBuddy. WorkBuddy spawns a new MCP process on port 1 with same clientId
  openPort(1);
  await emit(1, { t: WIRE.HELLO, client: { id: 'workbuddy', name: 'WorkBuddy' } });

  // 4. Verification: New chat on port 1 takes over immediately!
  assert.equal(bridge.getStatus().port, ports[1], 'port 1 must take over active channel immediately');
  assert.equal(bridge.getStatus().connectedClientId, 'workbuddy');

  // 5. New chat immediately executes tool call without waiting for 30s TASK_IDLE_MS
  await call(1, 'tool-turn-2-new-chat');
  assert.deepEqual(executed.map((c) => c.args.id), ['tool-turn-1', 'tool-turn-2-new-chat']);
});

test('same-client tool call inherits task lock even if activeChannel was not switched prior', async (t) => {
  const { bridge, openPort, emit, call, executed, ports } = await setupChatSwitch(t);

  // 1. Initial chat session on port 0 connects and runs a tool without say
  openPort(0);
  await emit(0, { t: WIRE.HELLO, client: { id: 'workbuddy', name: 'WorkBuddy' } });
  await call(0, 'tool-turn-1');
  assert.equal(bridge.getStatus().operating, true);

  // 2. Port 1 opens and sends a tool call directly for the same client
  openPort(1);
  await emit(1, { t: WIRE.HELLO, client: { id: 'workbuddy', name: 'WorkBuddy' } });
  await call(1, 'tool-turn-2-direct');

  // Must execute immediately rather than queue in waitingTools
  assert.deepEqual(executed.map((c) => c.args.id), ['tool-turn-1', 'tool-turn-2-direct']);
  assert.equal(bridge.getStatus().port, ports[1]);
});

test('constants BRIDGE_PORTS includes 16 ports up to 8780 to mitigate TIME_WAIT exhaustion', () => {
  assert.ok(BRIDGE_PORTS.length >= 16, 'BRIDGE_PORTS should contain at least 16 candidate ports');
  assert.equal(BRIDGE_PORTS[0], 8765);
  assert.equal(BRIDGE_PORTS[BRIDGE_PORTS.length - 1], 8780);
  for (let p = 8765; p <= 8780; p++) {
    assert.ok(BRIDGE_PORTS.includes(p), `BRIDGE_PORTS should include ${p}`);
  }
});

test('router sticky agentTabId resets on stopAllDriving so subsequent chats start fresh', async () => {
  const marked = [];
  let cleared = false;
  const fakeMarker = {
    mark: async (tab) => { marked.push(tab.id); },
    setBusy: async () => {},
    clear: async () => { cleared = true; },
  };

  const tabs = new Map([
    [101, { id: 101, windowId: 1, active: false, url: 'https://site-chat1.com', status: 'complete' }],
    [102, { id: 102, windowId: 1, active: true, url: 'https://site-chat2.com', status: 'complete' }],
  ]);

  globalThis.chrome = {
    tabs: {
      get: async (id) => tabs.get(id) || null,
      query: async ({ active }) => (active ? [tabs.get(102)] : [...tabs.values()]),
      update: async (id, patch) => {
        const tab = tabs.get(id);
        if (tab) Object.assign(tab, patch);
        return tab;
      },
      sendMessage: async () => ({}),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
  };

  const router = createRouter({
    debugger: { setFocusEmulation: () => {}, muteForControl: () => {}, restoreMute: () => {} },
    indicator: null,
    marker: fakeMarker,
  });

  // 1. Chat 1 operates on tab 101
  await router.execute('tabs_context', { tabId: 101 });
  assert.equal(router.agentTabId, 101);

  // 2. Chat 1 ends / task settles -> SW calls stopAllDriving()
  router.stopAllDriving();
  assert.equal(router.agentTabId, null, 'router agentTabId must be reset to null on stopAllDriving');
  assert.equal(cleared, true, 'marker must be cleared');

  // 3. Chat 2 arrives without tabId -> router should claim current active tab 102, not stale tab 101
  const res = await router.execute('navigate', { url: 'https://new-session.com' });
  assert.equal(res.ok, true);
  assert.equal(router.agentTabId, 102, 'agent claims current user tab 102 for new session');
  assert.equal(tabs.get(102).url, 'https://new-session.com');
  assert.equal(tabs.get(101).url, 'https://site-chat1.com', 'old tab from previous chat untouched');
});

test('same-client multi-session switching does not drop peer channels and allows both sessions to call tools', async (t) => {
  const { bridge, openPort, emit, call, executed, ports, sources } = await setupChatSwitch(t);

  // 1. Session A on port 0 connects and runs a tool without calling say
  openPort(0);
  await emit(0, { t: WIRE.HELLO, client: { id: 'workbuddy', name: 'WorkBuddy' } });
  await call(0, 'tool-turn-1-port-0');
  assert.equal(bridge.getStatus().port, ports[0]);

  // 2. Session B on port 1 connects (e.g. user opens second chat tab in WorkBuddy)
  openPort(1);
  await emit(1, { t: WIRE.HELLO, client: { id: 'workbuddy', name: 'WorkBuddy' } });
  assert.equal(bridge.getStatus().port, ports[1]);

  // Session B runs a tool
  await call(1, 'tool-turn-2-port-1');
  assert.deepEqual(executed.map((c) => c.args.id), ['tool-turn-1-port-0', 'tool-turn-2-port-1']);

  // 3. Verification: Port 0 must NOT have been dropped (its EventSource remains open)
  assert.equal(sources.has(ports[0]), true, 'port 0 must remain connected, not dropped');

  // 4. User switches back to Session A on port 0 and executes a tool
  await call(0, 'tool-turn-3-port-0-resumed');
  assert.equal(bridge.getStatus().port, ports[0], 'port 0 takes over back as active');
  assert.deepEqual(executed.map((c) => c.args.id), [
    'tool-turn-1-port-0',
    'tool-turn-2-port-1',
    'tool-turn-3-port-0-resumed',
  ]);
});

