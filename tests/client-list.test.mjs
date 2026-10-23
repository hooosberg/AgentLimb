/**
 * The paired-AI list must show one row per software, not per reinstall.
 *
 * A client's id lives in a file under ~/.agentlimb. Reset that folder (reinstall,
 * moved to Trash, a second machine) and the id changes while the software name
 * and kind stay the same — so every reinstall used to add another row. Real
 * report: three rows all reading "WorkBuddy AI", all offline, which is one AI
 * to the user and three to the panel.
 *
 * These tests pin the rule: one visible row per name+kind, a live identity wins
 * over a newer saved one, identities are never deleted (each still holds trust
 * for a process that may be running), and the stored list stays bounded.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeClient } from '../kernel/control/background/bridge-client.js';
import { STORAGE_KEYS, WIRE } from '../kernel/shared/constants.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const flush = async () => { for (let i = 0; i < 4; i += 1) await tick(); };

/** Seed storage and boot the real client. `sources` collects the fake streams. */
async function setup(t, pairedClients) {
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch, EventSource: globalThis.EventSource };
  t.after(() => Object.assign(globalThis, saved));
  const store = { [STORAGE_KEYS.pairedClients]: pairedClients };
  const sources = new Map();
  globalThis.chrome = {
    runtime: { id: 'test-extension', sendMessage: async () => ({ ok: true }), getURL: (p) => p },
    storage: {
      local: {
        get: async (key) => (typeof key === 'string' ? { [key]: store[key] } : {}),
        set: async (patch) => { Object.assign(store, patch); },
      },
    },
  };
  globalThis.EventSource = class {
    constructor(url) { this.port = Number(new URL(url).port); sources.set(this.port, this); }
    close() {}
  };
  globalThis.fetch = async (url, options) => {
    const port = Number(new URL(url).port);
    const index = [28765, 28766].indexOf(port);
    if (index < 0) throw new Error('no bridge');
    if (!options?.body) return { ok: true, json: async () => ({ service: 'agentlimb-bridge', client: { id: index === 0 ? 'a' : 'b' } }) };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const bridge = createBridgeClient({ ports: [28765, 28766], onToolCall: async () => ({ ok: true }) });
  await bridge.start();
  return { bridge, store, sources };
}

test('the same software paired three times shows as one row', async (t) => {
  // Exactly the reported situation: ~/.agentlimb was reset, so each reinstall
  // produced a new id while name+kind stayed identical.
  const { bridge, store } = await setup(t, {
    'id-oldest': { id: 'id-oldest', name: 'WorkBuddy AI', kind: 'workbuddy', pairedAt: '2026-10-20T10:00:00.000Z' },
    'id-middle': { id: 'id-middle', name: 'WorkBuddy AI', kind: 'workbuddy', pairedAt: '2026-10-21T10:00:00.000Z' },
    'id-newest': { id: 'id-newest', name: 'WorkBuddy AI', kind: 'workbuddy', pairedAt: '2026-10-22T19:15:20.825Z' },
  });
  const paired = bridge.getStatus().clients.filter((c) => c.paired);
  assert.equal(paired.length, 1, 'three identities of one software must collapse to one row');
  assert.equal(paired[0].id, 'id-newest', 'the newest identity represents the software');
  assert.equal(paired[0].name, 'WorkBuddy AI');
  // The others are hidden, not destroyed: each still holds saved trust for a
  // process that may be running. Deleting them would force a re-pairing.
  const stored = store[STORAGE_KEYS.pairedClients];
  assert.ok(stored['id-newest'], 'the representative identity is persisted');
  assert.ok(stored['id-oldest'] && stored['id-middle'], 'the other identities keep their trust');
});

test('different software that shares a display name stays separate', async (t) => {
  // Name alone is not identity: two products can both call themselves "Agent".
  const { bridge } = await setup(t, {
    'one': { id: 'one', name: 'Agent', kind: 'workbuddy', pairedAt: '2026-10-22T10:00:00.000Z' },
    'two': { id: 'two', name: 'Agent', kind: 'claude-code', pairedAt: '2026-10-22T11:00:00.000Z' },
  });
  assert.equal(bridge.getStatus().clients.filter((c) => c.paired).length, 2);
});

test('the stored list stays bounded at ten, newest first', async (t) => {
  const many = {};
  for (let i = 0; i < 14; i += 1) {
    many[`id-${i}`] = { id: `id-${i}`, name: `AI ${i}`, kind: 'generic', pairedAt: `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00.000Z` };
  }
  const { bridge, store } = await setup(t, many);
  // Nothing has been saved yet in this session, so trigger a save the way a real
  // pairing does.
  await bridge.disconnectClient('id-0').catch(() => {});
  const saved = store[STORAGE_KEYS.pairedClients];
  assert.ok(Object.keys(saved).length <= 10, `the list is capped, got ${Object.keys(saved).length}`);
  const newest = Object.values(saved).sort((a, b) => Date.parse(b.pairedAt) - Date.parse(a.pairedAt));
  assert.equal(newest[0].name, 'AI 13', 'the most recently paired survives');
});

test('a live identity wins over a newer saved one, and is never evicted', async (t) => {
  const { bridge, sources, store } = await setup(t, {
    'live-old': { id: 'live-old', name: 'WorkBuddy AI', kind: 'workbuddy', pairedAt: '2026-10-20T10:00:00.000Z' },
    'offline-new': { id: 'offline-new', name: 'WorkBuddy AI', kind: 'workbuddy', pairedAt: '2026-10-22T10:00:00.000Z' },
  });
  // The older identity is the one actually running.
  const source = sources.get(28765);
  source.onopen();
  source.onmessage({ data: JSON.stringify({ t: WIRE.HELLO, client: { id: 'live-old', name: 'WorkBuddy AI', kind: 'workbuddy' } }) });
  await flush();
  const paired = bridge.getStatus().clients.filter((c) => c.paired);
  assert.equal(paired.length, 1, 'still one row');
  assert.equal(paired[0].id, 'live-old', 'the connected identity represents the software, not the newer saved one');
  assert.equal(paired[0].online, true);
  // Both keep their trust in storage.
  assert.ok(store[STORAGE_KEYS.pairedClients]['live-old']);
  assert.ok(store[STORAGE_KEYS.pairedClients]['offline-new']);
});

test('removing an AI removes every identity of that software', async (t) => {
  const { bridge, store } = await setup(t, {
    'a1': { id: 'a1', name: 'WorkBuddy AI', kind: 'workbuddy', pairedAt: '2026-10-20T10:00:00.000Z' },
    'a2': { id: 'a2', name: 'WorkBuddy AI', kind: 'workbuddy', pairedAt: '2026-10-22T10:00:00.000Z' },
    'b1': { id: 'b1', name: 'Other AI', kind: 'generic', pairedAt: '2026-10-22T10:00:00.000Z' },
  });
  assert.equal(bridge.getStatus().clients.filter((c) => c.paired).length, 2);
  assert.equal((await bridge.disconnectClient('a2')).ok, true);
  const left = bridge.getStatus().clients.filter((c) => c.paired);
  assert.deepEqual(left.map((c) => c.name), ['Other AI'], 'removing one row must not leave a duplicate behind');
  assert.ok(!store[STORAGE_KEYS.pairedClients]['a1'], 'and the hidden identity is revoked too');
  assert.ok(store[STORAGE_KEYS.pairedClients]['b1'], 'other software is untouched');
});

test('an expired pairing note reads as routine, not as a failure', () => {
  // The panel distinguishes "never paired" (needs setup) from "the AI software
  // closed its MCP process" (routine, recovers by itself).
  const html = readFileSync(join(root, 'ui/sidepanel/sidepanel.html'), 'utf8');
  assert.match(html, /id="bridge-idle"/, 'the idle note must exist');
  assert.match(html, /id="bridge-idle"[^>]*data-i18n="bridgeIdle"/);
  const js = readFileSync(join(root, 'ui/sidepanel/sidepanel.js'), 'utf8');
  assert.match(js, /bridgeIdle:/, 'and have a translation in both languages');
  const zh = /bridgeIdle: english \? '[^']*' : '([^']*)'/.exec(js);
  assert.ok(zh && zh[1].length > 10, 'the Chinese copy must be a real sentence');
});

test('topbar identity directly shows the connected AI without a dropdown menu on click', () => {
  const html = readFileSync(join(root, 'ui/sidepanel/sidepanel.html'), 'utf8');
  assert.doesNotMatch(html, /topbar-caret/, 'topbar identity has no dropdown chevron');
  assert.doesNotMatch(html, /id="btn-manager"[^>]*aria-haspopup="dialog"/, 'topbar identity does not open a dialog menu');
  const js = readFileSync(join(root, 'ui/sidepanel/sidepanel.js'), 'utf8');
  assert.doesNotMatch(js, /function openManager\(/, 'clicking topbar never opens the manager popover');
});

test('once paired, chat history and outbox survive per-turn MCP process exits until explicit removal', async (t) => {
  const { bridge, sources } = await setup(t, {
    'wb-1': { id: 'wb-1', name: 'WorkBuddy AI', kind: 'workbuddy', pairedAt: '2026-10-23T03:15:00.000Z' },
  });
  // Connect WorkBuddy AI and simulate opening Baidu + saying done.
  const source = sources.get(28765);
  source.onopen();
  source.onmessage({ data: JSON.stringify({ t: WIRE.HELLO, client: { id: 'wb-1', name: 'WorkBuddy AI', kind: 'workbuddy' } }) });
  await flush();
  source.onmessage({ data: JSON.stringify({ t: WIRE.AGENT_MESSAGE, text: 'Connected. 已为你打开百度 ✅' }) });
  await flush();
  assert.equal(bridge.getStatus().chat.at(-1)?.text, 'Connected. 已为你打开百度 ✅');

  // WorkBuddy finishes its turn and terminates its per-turn MCP stdio worker.
  source.onerror();
  await flush();

  // Even with the MCP process stopped, the pairing and chat remain intact, and
  // messages typed in the side panel queue for the next turn instead of failing.
  const afterDrop = bridge.getStatus();
  assert.equal(afterDrop.clients.filter((c) => c.paired).length, 1);
  assert.equal(afterDrop.chat.at(-1)?.text, 'Connected. 已为你打开百度 ✅');
  const queued = await bridge.sendUserMessage('在百度里搜一下天气', { title: '百度一下，你就知道', url: 'https://www.baidu.com/' });
  assert.equal(queued.ok, true, 'side-panel message queues while MCP process is between turns');
  assert.equal(bridge.getStatus().chat.at(-1)?.text, '在百度里搜一下天气');

  // Only an explicit remove clears the pairing and chat.
  assert.equal((await bridge.disconnectClient('wb-1')).ok, true);
  assert.equal(bridge.getStatus().clients.filter((c) => c.paired).length, 0);
  assert.equal(bridge.getStatus().chat.length, 0);
});

test('paired side panel simplifies UI by hiding the non-equivalent chat form and Stop button', () => {
  const html = readFileSync(join(root, 'ui/sidepanel/sidepanel.html'), 'utf8');
  assert.match(html, /id="chat-form"[^>]*\bhidden\b/, 'chat form is hidden so the side panel does not mislead with an idle input/Stop button');
  const css = readFileSync(join(root, 'ui/sidepanel/sidepanel.css'), 'utf8');
  assert.match(css, /\.chat-form\[hidden\][^{]*\{[^}]*display:\s*none/, 'CSS hides the flex chat-form when [hidden] is set');
  const js = readFileSync(join(root, 'ui/sidepanel/sidepanel.js'), 'utf8');
  assert.match(js, /els\.chatForm\.hidden = true;/, 'renderComposer keeps chatForm hidden');
  assert.match(js, /m\.from !== 'user'/, 'syncChat filters out stale user/timeout bubbles and displays AI replies cleanly');
});
