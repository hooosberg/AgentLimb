import {
  describeTab,
  getTargetTab,
  injectScriptIfNeeded,
  isInjectableUrl,
  sendToTab,
} from '../runtime/browser.js';

const CONTENT_SCRIPT_PATH = 'kernel/control/content/injector.js';

export function createSnapshotController() {
  let lastSnapshot = null;

  return {
    async getStatus() {
      const activeTab = await getTargetTab();

      return {
        ready: true,
        model: 'page-snapshot-v1',
        referencePriority: 'reference-claude-chrome-ext',
        activeTab: describeTab(activeTab),
        lastSnapshot,
        nextActions: [
          'add accessibility tree extraction',
          'add stable ref regeneration across DOM mutations',
          'align snapshot schema with browser-host protocol',
        ],
      };
    },

    async getActiveTabContext(options = {}) {
      const tab = await getTargetTab(normalizeTabId(options.tabId));
      if (!tab?.id) {
        return { ok: false, error: 'No active tab available' };
      }

      if (!isInjectableUrl(tab.url)) {
        return {
          ok: true,
          tab: describeTab(tab),
          injectable: false,
          page: null,
          note: 'Current tab is not an http/https page.',
        };
      }

      const injection = await injectScriptIfNeeded(tab.id, CONTENT_SCRIPT_PATH);
      if (!injection.ok) {
        return {
          ok: false,
          tab: describeTab(tab),
          error: injection.message,
          errorType: injection.reason,
        };
      }

      const response = await sendToTab(
        tab.id,
        { type: 'AGENTLIMB_GET_PAGE_CONTEXT' },
        5000,
      );

      if (!response) {
        return {
          ok: false,
          tab: describeTab(tab),
          error: 'Content script injected but did not respond to context request.',
          errorType: 'script_unresponsive',
        };
      }

      return {
        ok: true,
        tab: describeTab(tab),
        injectable: true,
        page: response.page,
      };
    },

    async capturePageSnapshot(options = {}) {
      const tab = await getTargetTab(normalizeTabId(options.tabId));
      if (!tab?.id) {
        return { ok: false, error: 'No active tab available' };
      }

      if (!isInjectableUrl(tab.url)) {
        return {
          ok: false,
          tab: describeTab(tab),
          error: 'Current tab is not injectable. Navigate to an http/https page first.',
          errorType: 'restricted_page',
        };
      }

      const injection = await injectScriptIfNeeded(tab.id, CONTENT_SCRIPT_PATH);
      if (!injection.ok) {
        return {
          ok: false,
          tab: describeTab(tab),
          error: injection.message,
          errorType: injection.reason,
        };
      }

      const filterMode = options.filterMode === 'all' ? 'all' : 'interactive';
      const limit = clampLimit(options.limit);
      const response = await sendToTab(
        tab.id,
        {
          type: 'AGENTLIMB_GET_PAGE_SNAPSHOT',
          filterMode,
          limit,
        },
        8000,
      );

      if (!response) {
        return {
          ok: false,
          tab: describeTab(tab),
          error: 'Content script injected but did not respond to snapshot request.',
          errorType: 'script_unresponsive',
        };
      }

      const capturedAt = new Date().toISOString();
      lastSnapshot = {
        tabId: tab.id,
        pageUrl: tab.url ?? '',
        count: response.count ?? 0,
        capturedAt,
      };

      return {
        ok: true,
        tab: describeTab(tab),
        filterMode,
        capturedAt,
        page: response.page,
        count: response.count ?? 0,
        tree: response.tree ?? '',
        nodes: response.nodes ?? [],
      };
    },

    async resolveActionTarget(target = {}) {
      const tab = await getTargetTab(normalizeTabId(target.tabId));
      if (!tab?.id) {
        return { ok: false, error: 'No active tab available' };
      }

      if (!isInjectableUrl(tab.url)) {
        return {
          ok: false,
          tab: describeTab(tab),
          error: 'Current tab is not injectable. Navigate to an http/https page first.',
          errorType: 'restricted_page',
        };
      }

      const injection = await injectScriptIfNeeded(tab.id, CONTENT_SCRIPT_PATH);
      if (!injection.ok) {
        return {
          ok: false,
          tab: describeTab(tab),
          error: injection.message,
          errorType: injection.reason,
        };
      }

      const response = await sendToTab(
        tab.id,
        {
          type: 'AGENTLIMB_RESOLVE_TARGET',
          target,
        },
        5000,
      );

      if (!response) {
        return {
          ok: false,
          tab: describeTab(tab),
          error: 'Content script injected but did not respond to target resolution.',
          errorType: 'script_unresponsive',
        };
      }

      return {
        ...response,
        tab: describeTab(tab),
      };
    },
  };
}

function clampLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return 60;
  return Math.max(10, Math.min(120, Math.round(parsed)));
}

function normalizeTabId(tabId) {
  if (tabId == null) return null;
  const parsed = Number(tabId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
