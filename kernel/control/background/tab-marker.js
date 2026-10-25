/**
 * AgentLimb Tab Marker
 *
 * Manages the visual grouping and busy indicator (hourglass) for tabs
 * driven by AI agents.
 *
 * Invariants:
 *  - Both new tabs (tab_new) and existing targeted tabs are marked into the orange 'AgentLimb' group during operations
 *  - Grouping never activates the tab, preserving focus emulation for background operation (e.g. watching movies)
 *  - While the agent works, the group title is "⏳ AgentLimb"
 *  - Once the operation completes, the orange group is automatically dissolved (tabs ungrouped),
 *    treating the grouping purely as a temporary visual status behavior during active operation.
 */

export function createTabMarker({ ungroupDelayMs = 600 } = {}) {
  const markedTabIds = new Set();
  let isBusy = false;
  let ungroupTimer = null;

  async function ensureGroup(tab) {
    if (!chrome.tabGroups?.query || !chrome.tabs?.group) return null;
    try {
      // Check if the tab is already in an orange AgentLimb group
      if (tab.groupId && tab.groupId !== -1) {
        try {
          const group = await chrome.tabGroups.get(tab.groupId);
          if (group && group.color === 'orange' && /^(⏳ )?AgentLimb$/.test(group.title || '')) {
            return group.id;
          }
        } catch (_) { /* continue */ }
      }

      // Find an existing orange AgentLimb group in the same window
      const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
      const existing = groups.find((g) => groupColorMatch(g) && /^(⏳ )?AgentLimb$/.test(g.title || ''));

      const groupId = await chrome.tabs.group({
        tabIds: [tab.id],
        ...(existing ? { groupId: existing.id } : { createProperties: { windowId: tab.windowId } }),
      });

      const title = isBusy ? '⏳ AgentLimb' : 'AgentLimb';
      await chrome.tabGroups.update(groupId, { title, color: 'orange', collapsed: false });
      return groupId;
    } catch (_) {
      return null;
    }
  }

  function groupColorMatch(group) {
    return group && group.color === 'orange';
  }

  function cancelUngroupTimer() {
    if (ungroupTimer != null) {
      clearTimeout(ungroupTimer);
      ungroupTimer = null;
    }
  }

  async function ungroupAll() {
    cancelUngroupTimer();
    const tabIds = [...markedTabIds];
    markedTabIds.clear();

    if (chrome.tabs?.ungroup) {
      if (tabIds.length) {
        await chrome.tabs.ungroup(tabIds).catch(() => {});
      }
      // Also cleanup any remaining AgentLimb groups that might have been left behind
      if (chrome.tabGroups?.query) {
        try {
          const groups = await chrome.tabGroups.query({});
          for (const group of groups) {
            if (!groupColorMatch(group) || !/^(⏳ )?AgentLimb$/.test(group.title || '')) continue;
            if (chrome.tabs?.query) {
              const inGroup = await chrome.tabs.query({ groupId: group.id }).catch(() => []);
              const ids = inGroup.map((t) => t.id).filter(Boolean);
              if (ids.length) {
                await chrome.tabs.ungroup(ids).catch(() => {});
              }
            }
          }
        } catch (_) { /* cosmetic */ }
      }
    }
  }

  async function mark(tab) {
    if (!tab?.id) return;
    cancelUngroupTimer();
    markedTabIds.add(tab.id);
    await ensureGroup(tab);
  }

  async function setBusy(busy) {
    isBusy = Boolean(busy);
    if (isBusy) {
      cancelUngroupTimer();
      if (!chrome.tabGroups?.query) return;
      try {
        const groups = await chrome.tabGroups.query({});
        for (const group of groups) {
          if (!groupColorMatch(group) || !/^(⏳ )?AgentLimb$/.test(group.title || '')) continue;
          if (group.title !== '⏳ AgentLimb') {
            await chrome.tabGroups.update(group.id, { title: '⏳ AgentLimb' });
          }
        }
      } catch (_) { /* grouping is cosmetic */ }
    } else {
      // Operation finished: schedule automatic ungrouping so the orange group dissolves
      cancelUngroupTimer();
      if (ungroupDelayMs > 0) {
        ungroupTimer = setTimeout(() => {
          ungroupTimer = null;
          void ungroupAll();
        }, ungroupDelayMs);
      } else {
        await ungroupAll();
      }
    }
  }

  async function clear() {
    cancelUngroupTimer();
    await ungroupAll();
  }

  async function recover() {
    cancelUngroupTimer();
    await ungroupAll();
  }

  return {
    mark,
    setBusy,
    clear,
    recover,
    ungroupAll,
    get isBusy() { return isBusy; },
  };
}
