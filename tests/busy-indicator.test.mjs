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

test('tab-marker maintains orange group during overall multi-step task and only ungroups on final completion', async () => {
  const { createTabMarker } = await import('../kernel/control/background/tab-marker.js');

  const groups = new Map();
  const ungroupCalls = [];

  globalThis.chrome = {
    tabs: {
      group: async ({ tabIds, groupId }) => {
        const gid = groupId || 88;
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
        const existing = groups.get(id) || { id };
        Object.assign(existing, patch);
        groups.set(id, existing);
        return existing;
      },
    },
  };

  const marker = createTabMarker({ ungroupDelayMs: 0, taskIdleDelayMs: 25 });
  const tab = { id: 201, windowId: 1, active: false };
  await marker.mark(tab);

  // 1. Tool 1 starts: active in flight
  await marker.updateState({ busy: true, operating: true });
  assert.equal(groups.get(88).title, '⏳ AgentLimb');
  assert.equal(ungroupCalls.length, 0);

  // 2. Tool 1 finishes: inter-tool gap while AI thinks / next tool is coming
  // Must NOT ungroup, must keep group stable without flickering
  await marker.updateState({ busy: false, operating: true });
  assert.equal(ungroupCalls.length, 0, 'inter-tool thinking must not ungroup tab');
  assert.equal(groups.get(88).title, '⏳ AgentLimb');

  // 3. Tool 2 starts: next action executes
  await marker.updateState({ busy: true, operating: true });
  assert.equal(ungroupCalls.length, 0, 'group remains stable into step 2');

  // 4. Overall task completes (agent called say): now ungroups smoothly
  await marker.updateState({ busy: false, operating: false });
  assert.equal(ungroupCalls.length, 1, 'tab ungroups upon overall task completion');
  assert.deepEqual(ungroupCalls[0], [201]);

  // 5. Test fallback idle timeout when agent finishes tools but never calls say
  await marker.mark({ id: 202, windowId: 1, active: false });
  await marker.updateState({ busy: false, operating: true });
  assert.equal(ungroupCalls.length, 1, 'not yet ungrouped');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ungroupCalls.length, 2, 'fallback idle timeout ungroups abandoned task');
  assert.deepEqual(ungroupCalls[1], [202]);
});


