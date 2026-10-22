/**
 * Extension module smoke tests.
 *
 * These import the real extension modules under a chrome API stub. Their job:
 * catch import-time failures (syntax errors, bad top-level code) that make
 * Chrome refuse to register the service worker — a class of bug that unit
 * tests of the host side never see, and that node --check misses when piped.
 *
 * Also covers the toolbar-icon toggle behavior end to end at the SW level.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

function createChromeStub() {
  const listeners = { actionClicked: [], command: [], message: [], alarm: [] };
  const calls = {
    panelOpen: [], panelClose: [], panelBehavior: [], alarms: [], storageSet: [],
  };
  let sidePanelContexts = [];

  const chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      onInstalled: { addListener: () => {} },
      sendMessage: () => Promise.resolve(),
      getManifest: () => ({ version: '0.5.0' }),
      getURL: (p) => `chrome-extension://stub/${p}`,
      getContexts: async (filter) =>
        (filter?.contextTypes?.includes('SIDE_PANEL') ? sidePanelContexts : []),
      lastError: null,
    },
    alarms: {
      create: (name, opts) => calls.alarms.push({ name, ...opts }),
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
    sidePanel: {
      setPanelBehavior: async (opts) => { calls.panelBehavior.push(opts); },
      open: async (opts) => { calls.panelOpen.push(opts); },
      close: async (opts) => { calls.panelClose.push(opts); },
    },
    action: { onClicked: { addListener: (fn) => listeners.actionClicked.push(fn) } },
    commands: { onCommand: { addListener: (fn) => listeners.command.push(fn) } },
    storage: {
      local: {
        get: async () => ({}),
        set: async (items) => { calls.storageSet.push(items); },
      },
    },
    tabs: {
      query: async () => [{ id: 1, windowId: 10, active: true, url: 'https://example.com', status: 'complete' }],
      get: async (id) => ({ id, windowId: 10, active: true, url: 'https://example.com', status: 'complete' }),
      sendMessage: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      remove: async () => ({}),
      goBack: async () => {},
      goForward: async () => {},
      onUpdated: { addListener: () => {} },
    },
    windows: { update: async () => ({}) },
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async () => ({}),
      onDetach: { addListener: () => {} },
      onEvent: { addListener: () => {} },
      getTargets: async () => [],
    },
    i18n: { getUILanguage: () => 'zh-CN', getMessage: (k) => k },
  };

  return {
    chrome,
    listeners,
    calls,
    setSidePanelContexts: (v) => { sidePanelContexts = v; },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 30));

let stub;

test('extension modules import cleanly under a chrome stub', async () => {
  stub = createChromeStub();
  globalThis.chrome = stub.chrome;

  // Hermetic: the SW bootstrap kicks off bridge discovery. On a dev machine a
  // real AgentLimb host may well be listening on 8765 (and Node has no
  // EventSource), which would turn this unit test into a flaky integration one.
  globalThis.fetch = async () => { throw new Error('no bridge in tests'); };
  globalThis.EventSource = class { close() {} addEventListener() {} removeEventListener() {} };

  // Pure modules first (no chrome usage at import time).
  await import('../kernel/shared/constants.js');
  await import('../kernel/control/host/tools.js');
  await import('../kernel/prompt/build-prompt.js');
  await import('../kernel/control/background/bridge-client.js');
  await import('../kernel/control/background/debugger.js');
  await import('../kernel/control/background/router.js');

  // The service worker runs bootstrap() at import time — this is exactly where
  // a syntax/import error becomes "Service worker registration failed".
  await import('../kernel/control/background/service-worker.js');

  assert.equal(stub.listeners.actionClicked.length, 1, 'action click listener registered');
  assert.equal(stub.listeners.message.length, 1, 'runtime message listener registered');
  assert.equal(stub.listeners.alarm.length, 1, 'alarm listener registered');
  assert.ok(
    stub.calls.alarms.some((a) => a.name === 'agentlimb-bridge-keepalive'),
    'keep-alive alarm created',
  );
});

test('toolbar icon click toggles the side panel', async () => {
  const click = stub.listeners.actionClicked[0];
  const tab = { id: 1, windowId: 10 };

  // Closed → click opens
  await click(tab);
  await tick();
  assert.deepEqual(stub.calls.panelOpen.at(-1), { tabId: 1 });

  // Open → click closes
  stub.setSidePanelContexts([{ contextTypes: ['SIDE_PANEL'], windowId: 10 }]);
  await click(tab);
  await tick();
  assert.deepEqual(stub.calls.panelClose.at(-1), { tabId: 1 });

  // Keyboard shortcut goes through the same toggle (panel is closed again now)
  stub.setSidePanelContexts([]);
  const cmd = stub.listeners.command[0];
  await cmd('toggle-side-panel');
  await tick();
  assert.equal(stub.calls.panelOpen.length, 2, 'shortcut re-opened the panel');
});

test('panel behavior does not consume the action click', async () => {
  // openPanelOnActionClick must be false, otherwise onClicked never fires
  // and the toggle is impossible.
  const last = stub.calls.panelBehavior.at(-1);
  assert.ok(last, 'setPanelBehavior called');
  assert.equal(last.openPanelOnActionClick, false);
});

test('a bridge outage must not forget trusted (paired) clients', async () => {
  // Regression: reconnect() used to call clients.clear() when the bridge was
  // down, so the next HELLO saw an empty map and the user was asked to pair
  // again on EVERY agent restart — the opposite of "pair once".
  const { createBridgeClient } = await import('../kernel/control/background/bridge-client.js');
  const { STORAGE_KEYS } = await import('../kernel/shared/constants.js');
  const savedGet = stub.chrome.storage.local.get;
  const savedFetch = globalThis.fetch;
  stub.chrome.storage.local.get = async (key) => (
    key === STORAGE_KEYS.pairedClients
      ? { [STORAGE_KEYS.pairedClients]: { 'client-1': { id: 'client-1', name: 'WorkBuddy AI', kind: 'generic' } } }
      : {}
  );
  // Pretend no MCP host is running — otherwise this test would pick up a real
  // bridge (other test files run in parallel and do bind 8765..8770).
  globalThis.fetch = async () => { throw new Error('no bridge'); };
  try {
    const bridge = createBridgeClient({});
    await bridge.start();
    const status = bridge.getStatus();
    assert.equal(status.status, 'disconnected');
    assert.equal(status.clients.length, 1, 'trusted client must survive a bridge outage');
    assert.equal(status.clients[0].paired, true);
    assert.equal(status.clients[0].name, 'WorkBuddy AI');
  } finally {
    stub.chrome.storage.local.get = savedGet;
    globalThis.fetch = savedFetch;
  }
});

test('only the most recent pairing survives (single tenant)', async () => {
  // Regression: paired clients accumulated, so the panel showed a growing stack
  // of "正在与 X 驱动浏览器" chips after switching agent software.
  const { createBridgeClient } = await import('../kernel/control/background/bridge-client.js');
  const { STORAGE_KEYS } = await import('../kernel/shared/constants.js');
  const savedGet = stub.chrome.storage.local.get;
  const savedSet = stub.chrome.storage.local.set;
  const savedFetch = globalThis.fetch;
  const writes = [];
  stub.chrome.storage.local.get = async (key) => (
    key === STORAGE_KEYS.pairedClients
      ? {
        [STORAGE_KEYS.pairedClients]: {
          'old-client': { id: 'old-client', name: 'Old AI', kind: 'x', pairedAt: '2026-10-22T08:00:00.000Z' },
          'new-client': { id: 'new-client', name: 'New AI', kind: 'x', pairedAt: '2026-10-22T09:00:00.000Z' },
        },
      }
      : {}
  );
  stub.chrome.storage.local.set = async (items) => { writes.push(items); };
  globalThis.fetch = async () => { throw new Error('no bridge'); };
  try {
    const bridge = createBridgeClient({});
    await bridge.start();
    // Both trusted clients load (never drop trust on load — that would force a
    // needless re-pair), but once one of them actually shows up it owns the
    // browser and the rest are forgotten.
    assert.equal(bridge.getStatus().clients.length, 2, 'both remembered clients load');
    await bridge.keepOnlyPaired('new-client');
    const status = bridge.getStatus();
    assert.equal(status.clients.length, 1, 'only one paired client may remain');
    assert.equal(status.clients[0].id, 'new-client', 'the connected client wins');
    const persisted = writes.at(-1)?.[STORAGE_KEYS.pairedClients];
    assert.deepEqual(Object.keys(persisted || {}), ['new-client'], 'stale pairing erased from storage');
  } finally {
    stub.chrome.storage.local.get = savedGet;
    stub.chrome.storage.local.set = savedSet;
    globalThis.fetch = savedFetch;
  }
});

test('tab_new returns only after the new tab commits a URL', async () => {
  // Real Chrome reports url:'' for a freshly created background tab. Returning
  // that immediately made the next tool call fail with
  // "tab is not an http(s)/file page: (empty)".
  const { createRouter } = await import('../kernel/control/background/router.js');
  const saved = { create: stub.chrome.tabs.create, get: stub.chrome.tabs.get };
  let reads = 0;
  stub.chrome.tabs.create = async () => ({ id: 42, windowId: 10, active: false, url: '', status: 'loading' });
  stub.chrome.tabs.get = async (id) => {
    reads += 1;
    const committed = reads > 2;
    return {
      id, windowId: 10, active: false, title: committed ? 'Example Domain' : '',
      url: committed ? 'https://example.com/' : '',
      status: committed ? 'complete' : 'loading',
    };
  };
  try {
    const router = createRouter({ debugger: { status: () => ({}) }, indicator: null });
    const res = await router.execute('tab_new', { url: 'https://example.com' });
    assert.equal(res.ok, true);
    assert.equal(res.tab.url, 'https://example.com/', 'tab_new must not hand back an empty url');
    assert.ok(reads >= 3, 'waited for the URL to commit');
  } finally {
    stub.chrome.tabs.create = saved.create;
    stub.chrome.tabs.get = saved.get;
  }
});
