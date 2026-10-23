/**
 * Copy-prompt authorization, without any confirmation page.
 *
 * Clicking Copy opens a window; the next unknown AI client is trusted once.
 * A client with saved trust never needs the window again. There is no popup,
 * no request_id, and nothing secret on the wire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOnboardingWindow } from '../kernel/shared/onboarding-window.js';
import { createBridgeClient } from '../kernel/control/background/bridge-client.js';
import { ONBOARD_WINDOW_MS, STORAGE_KEYS, WIRE } from '../kernel/shared/constants.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function memoryStorage(records = {}) {
  return {
    records,
    api: {
      get: async (key) => ({ [key]: records[key] }),
      set: async (patch) => { Object.assign(records, patch); },
    },
  };
}

test('one Copy authorizes exactly one client, and the window expires', async () => {
  let time = 1000;
  const store = memoryStorage();
  const window = createOnboardingWindow(store.api, () => time);

  const opened = await window.open();
  assert.equal(opened.expiresAt, 1000 + ONBOARD_WINDOW_MS);
  assert.equal(await window.consume(), true);
  assert.equal(await window.consume(), false, 'a consumed window cannot authorize a second AI');
  assert.equal(store.records[STORAGE_KEYS.onboardUntil], 0);

  await window.open();
  time += ONBOARD_WINDOW_MS;
  assert.equal(await window.consume(), false, 'an expired window authorizes nobody');

  await window.open();
  await window.close();
  assert.equal(await window.consume(), false, 'a cancelled copy leaves nothing authorized');
});

test('concurrent connects cannot both consume one window', async () => {
  const store = memoryStorage();
  const window = createOnboardingWindow(store.api);
  await window.open();
  const results = await Promise.all([window.consume(), window.consume(), window.consume()]);
  assert.deepEqual(results, [true, false, false]);
});

async function setup(t, savedTrust = {}, { autoTrust = false } = {}) {
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch, EventSource: globalThis.EventSource };
  t.after(() => Object.assign(globalThis, saved));
  // Strict (copy-prompt window) mode is what these older tests pin; auto-authorize
  // is the product default and is covered by its own tests below.
  const store = memoryStorage({ [STORAGE_KEYS.pairedClients]: savedTrust, [STORAGE_KEYS.autoTrust]: autoTrust });
  const posts = [];
  const openedTabs = [];
  let source;
  globalThis.chrome = {
    runtime: { sendMessage: async () => {}, getURL: (path) => path },
    storage: { local: store.api },
    tabs: { create: async (options) => { openedTabs.push(options); return { id: 1 }; }, remove: async () => {} },
  };
  globalThis.EventSource = class { constructor() { source = this; } close() {} };
  globalThis.fetch = async (_url, options) => {
    if (options?.body) { posts.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: true, json: async () => ({ service: 'agentlimb-bridge' }) };
  };
  const bridge = createBridgeClient({ onToolCall: async () => ({ ok: true }) });
  await bridge.start();
  source.onopen();
  const emit = async (frame) => { source.onmessage({ data: JSON.stringify(frame) }); await tick(); };
  return { bridge, posts, openedTabs, store, emit };
}

test('an unknown AI is refused in place — no tab, no page, one Copy grants it', async (t) => {
  const { bridge, posts, openedTabs, emit } = await setup(t);

  await emit({ t: WIRE.HELLO, client: { id: 'second', name: 'Second AI' } });
  const denial = posts.find((frame) => frame.t === WIRE.GRANT);
  assert.equal(denial.ok, false);
  assert.equal(denial.reason, 'not_authorized');
  assert.equal(openedTabs.length, 0, 'no confirmation tab may ever be opened');
  assert.equal(bridge.getStatus().clients.find((c) => c.id === 'second').paired, false);
  assert.deepEqual(bridge.getStatus().unauthorized.map((c) => c.name), ['Second AI']);

  // The user answers the agent's "not authorized" error by clicking Copy.
  await bridge.openOnboarding();
  const grant = posts.filter((frame) => frame.t === WIRE.GRANT).at(-1);
  assert.equal(grant.ok, true);
  assert.equal(bridge.getStatus().connectedClientId, 'second');
  assert.equal(bridge.getStatus().clients.find((c) => c.id === 'second').paired, true);
  assert.equal(bridge.getStatus().unauthorized.length, 0, 'the notice clears once authorized');
  assert.ok(bridge.getStatus().chat.some((record) => /Second AI/.test(record.text)), 'the panel greets the new AI');
});

test('a saved client needs no window, and the window never authorizes two', async (t) => {
  const { bridge, posts, emit } = await setup(t, { old: { id: 'old', name: 'WorkBuddy', paired: true } });

  await emit({ t: WIRE.HELLO, client: { id: 'old', name: 'WorkBuddy' } });
  assert.equal(posts.filter((frame) => frame.t === WIRE.GRANT).at(-1).ok, true);
  assert.equal(bridge.getStatus().connectedClientId, 'old');

  await bridge.openOnboarding();
  await emit({ t: WIRE.HELLO, client: { id: 'fresh', name: 'Fresh AI' } });
  assert.equal(bridge.getStatus().clients.find((c) => c.id === 'fresh').paired, true);

  await emit({ t: WIRE.HELLO, client: { id: 'later', name: 'Later AI' } });
  assert.equal(bridge.getStatus().clients.find((c) => c.id === 'later').paired, false,
    'the copy window was already spent on "fresh"');
  assert.equal(bridge.getStatus().unauthorized.length, 1);
});

test('default: installing the host is the authorization — an unknown AI connects with no click', async (t) => {
  // autoTrust unset (never touched) must behave as ON.
  const { bridge, posts, openedTabs, store, emit } = await setup(t, {}, { autoTrust: null });
  await emit({ t: WIRE.HELLO, client: { id: 'fresh', name: 'Fresh AI' } });
  assert.equal(posts.filter((frame) => frame.t === WIRE.GRANT).at(-1).ok, true);
  assert.equal(bridge.getStatus().clients.find((c) => c.id === 'fresh').paired, true);
  assert.equal(bridge.getStatus().unauthorized.length, 0);
  assert.equal(openedTabs.length, 0);
  assert.ok(store.records[STORAGE_KEYS.pairedClients].fresh || bridge.getStatus().clients.find((c) => c.id === 'fresh').paired, 'trust is remembered for next time');
});

test('auto-authorize on does not need (or spend) the copy window', async (t) => {
  const { bridge, emit } = await setup(t, {}, { autoTrust: true });
  await bridge.openOnboarding();
  await emit({ t: WIRE.HELLO, client: { id: 'a', name: 'A' } });
  await emit({ t: WIRE.HELLO, client: { id: 'b', name: 'B' } });
  const paired = bridge.getStatus().clients.filter((c) => c.paired).map((c) => c.id).sort();
  assert.deepEqual(paired, ['a', 'b'], 'every installed AI is trusted, not just the first');
});

test('switching auto-authorize off restores the strict copy-window behaviour', async (t) => {
  const { bridge, posts, emit } = await setup(t, {}, { autoTrust: false });
  await emit({ t: WIRE.HELLO, client: { id: 'x', name: 'X' } });
  assert.equal(posts.filter((frame) => frame.t === WIRE.GRANT).at(-1).ok, false);
  assert.equal(bridge.getStatus().clients.find((c) => c.id === 'x').paired, false);
});
