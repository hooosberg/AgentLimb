/**
 * Minimal busy indicator: only the orange AgentLimb tab-group chip shows "⏳ AgentLimb"
 * while the AI is operating. The extension toolbar icon does not change, the page
 * title is untouched, and the side panel simply shows "正在操作" / "Working".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('only the tab-group chip carries the hourglass while busy', () => {
  const markerSrc = read('kernel/control/background/tab-marker.js');
  assert.match(markerSrc, /'⏳ AgentLimb'/, 'tab group gets the hourglass while busy');

  const sw = read('kernel/control/background/service-worker.js');
  assert.doesNotMatch(sw, /setBadgeText/, 'extension toolbar icon must not change when busy');

  const router = read('kernel/control/background/router.js');
  assert.match(router, /\(⏳ \)\?AgentLimb/, 'a busy group must still be matched, not duplicated');

  const indicator = read('kernel/control/content/indicator.js');
  assert.doesNotMatch(indicator, /⏳/, 'in-page indicator and document.title stay clean');

  const css = read('ui/sidepanel/sidepanel.css');
  assert.doesNotMatch(css, /hourglass-flip/, 'side panel uses simple text + dot, no hourglass animation');
});

test('tab-marker groups both new and existing tabs into orange group with hourglass without focus stealing', async () => {
  const { createTabMarker } = await import('../kernel/control/background/tab-marker.js');

  const groups = new Map();
  const groupCalls = [];
  const updateCalls = [];
  const ungroupCalls = [];

  globalThis.chrome = {
    tabs: {
      group: async ({ tabIds, groupId, createProperties }) => {
        groupCalls.push({ tabIds, groupId, createProperties });
        const gid = groupId || 77;
        groups.set(gid, { id: gid, title: '', color: '' });
        return gid;
      },
      ungroup: async (tabIds) => {
        ungroupCalls.push(tabIds);
      },
      query: async () => [],
    },
    tabGroups: {
      get: async (id) => groups.get(id),
      query: async () => [...groups.values()],
      update: async (id, patch) => {
        updateCalls.push({ id, patch });
        const existing = groups.get(id) || { id };
        Object.assign(existing, patch);
        groups.set(id, existing);
        return existing;
      },
    },
  };

  const marker = createTabMarker({ ungroupDelayMs: 0 });
  // 1. Mark an existing tab (not created by tab_new)
  const existingTab = { id: 101, windowId: 1, active: false };
  await marker.mark(existingTab);

  assert.equal(groupCalls.length, 1);
  assert.deepEqual(groupCalls[0].tabIds, [101]);
  assert.equal(groups.get(77).color, 'orange');
  assert.equal(groups.get(77).title, 'AgentLimb');

  // 2. Set busy state
  await marker.setBusy(true);
  assert.equal(groups.get(77).title, '⏳ AgentLimb');

  // 3. Set idle state: automatically ungroups the tab (dissolves the orange group)
  await marker.setBusy(false);
  assert.equal(ungroupCalls.length, 1, 'tab is automatically ungrouped when operation completes');
  assert.deepEqual(ungroupCalls[0], [101]);
});

test('router sticky agentTabId keeps working tab without focus stealing while user watches movie', async () => {
  const { createRouter } = await import('../kernel/control/background/router.js');
  const marked = [];
  const fakeMarker = {
    mark: async (tab) => { marked.push(tab.id); },
    setBusy: async () => {},
    clear: async () => {},
  };
  const tabs = new Map([
    [101, { id: 101, windowId: 1, active: false, url: 'https://example.com', status: 'complete' }],
    [102, { id: 102, windowId: 1, active: true, url: 'https://movie.com', status: 'complete' }], // user watching movie
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
      onUpdated: {
        addListener: () => {},
        removeListener: () => {},
      },
    },
  };
  const router = createRouter({
    debugger: { setFocusEmulation: () => {}, muteForControl: () => {} },
    indicator: null,
    marker: fakeMarker,
  });

  // 1. First operation targets tab 101 explicitly
  await router.execute('tabs_context', { tabId: 101 });
  assert.equal(router.agentTabId, 101);
  assert.ok(marked.includes(101), 'tab 101 marked into agent group');

  // 2. Next operation arrives without tabId while user is on tab 102 watching a movie:
  // Router sticks to tab 101 and does not redirect or steal focus from movie tab 102
  const res = await router.execute('navigate', { url: 'https://test.com' });
  assert.equal(res.ok, true);
  assert.equal(router.agentTabId, 101, 'agent sticks to working tab 101 instead of movie tab 102');
  assert.equal(tabs.get(101).url, 'https://test.com');
  assert.equal(tabs.get(102).url, 'https://movie.com', 'movie tab remains untouched');
});

