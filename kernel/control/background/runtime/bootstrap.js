import {
  APP_ID,
  APP_NAME,
  APP_VERSION,
  CAPABILITIES,
  MESSAGE_TYPES,
} from '../../../shared/constants.js';
import { MVP_HOST_BASE_URL } from '../../../shared/mvp-config.js';
import { setPreferredWindowId, getPreferredWindowId as getPreferredWindowIdSafe } from './browser.js';
import { createComputerController } from '../computer/controller.js';
import { createSnapshotController } from '../snapshot/controller.js';
import { createPermissionsController } from '../permissions/controller.js';
import { createHostController } from '../../host/controller.js';
import { startBridgeRelay } from '../../../../kernel/bridge/relay/poll.js';

// Activity log — ring buffer shared with sidepanel via GET_ACTIVITY_LOG
const MAX_ACTIVITY = 100;
const activityLog = [];

function pushActivity(entry) {
  activityLog.push({ ...entry, ts: new Date().toISOString() });
  if (activityLog.length > MAX_ACTIVITY) activityLog.shift();
  chrome.runtime.sendMessage({ type: MESSAGE_TYPES.NOTIFY_TOOL_CALLED, entry }).catch(() => {});
  // Broadcast plan data when task_plan succeeds so the sidepanel can render it
  if (entry.kind === 'result' && entry.tool === 'task_plan' && entry.ok && entry.result?.result) {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.NOTIFY_TASK_PLAN,
      plan: entry.result.result,
    }).catch(() => {});
  }
  // Broadcast lifecycle events for task_step_done / task_complete / task_fail
  if (entry.kind === 'result' && entry.ok) {
    const tool = entry.tool;
    const r = entry.result?.result;
    if (tool === 'task_step_done' && r) {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.NOTIFY_TASK_LIFECYCLE,
        event: { kind: 'step_done', index: r.index, ok: r.stepOk, note: r.note },
      }).catch(() => {});
    } else if (tool === 'task_complete' && r) {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.NOTIFY_TASK_LIFECYCLE,
        event: { kind: 'complete', summary: r.summary },
      }).catch(() => {});
    } else if (tool === 'task_fail' && r) {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.NOTIFY_TASK_LIFECYCLE,
        event: { kind: 'fail', reason: r.reason, stepIndex: r.stepIndex },
      }).catch(() => {});
    }
  }
}

let runtimeInstance = null;
let relay = null;
let extensionIdentity = null;
let extensionIdentityPromise = null;

export function bootstrapRuntime() {
  if (runtimeInstance) return runtimeInstance;

  const startedAt = new Date().toISOString();
  const permissions = createPermissionsController();
  const snapshot = createSnapshotController();
  const computer = createComputerController({ permissions, snapshot });
  const app = {
    id: APP_ID,
    name: APP_NAME,
    version: APP_VERSION,
    startedAt,
  };
  const strategy = {
    pageOperationsReference: 'reference-claude-chrome-ext',
    productShellReference: '.',
    workspaceRoot: '.',
  };
  const host = createHostController({
    app,
    capabilities: CAPABILITIES,
    strategy,
    permissions,
    snapshot,
    computer,
  });

  runtimeInstance = {
    appId: APP_ID,
    appName: APP_NAME,
    version: APP_VERSION,
    startedAt,
    modules: { permissions, snapshot, computer, host },
    app,
    strategy,
  };

  // ── Bridge relay: poll Host for queued browser tool calls ──────────────────
  // Identity is resolved async (chrome.storage + identity); relay starts once ready.
  void (async () => {
    const identity = await getExtensionIdentity();
    relay = startBridgeRelay({
      hostBaseUrl: MVP_HOST_BASE_URL,
      extensionId: identity.extensionId,
      label: identity.label,
      callTool: ({ requestId, tool, params }) =>
        host.callTool({ requestId, tool, params }),
      onActivity: (entry) => pushActivity(entry),
    });
    relay.start();
  })();

  // ── MV3 keep-alive: Chrome suspends SW after ~30s idle, killing setTimeout ──
  // Alarm fires every ~25s to wake the SW and restart the relay if needed.
  // In unpacked dev mode Chrome allows sub-minute periods; production clamps to 1 min.
  chrome.alarms.create('agentlimb-relay-keepalive', { periodInMinutes: 0.4 });

  // ── Chrome extension event listeners ──────────────────────────────────────
  chrome.runtime.onInstalled.addListener(() => {
    setupSidePanelBehavior();
  });

  chrome.runtime.onStartup.addListener(() => {
    setupSidePanelBehavior();
  });

  chrome.action.onClicked.addListener(async (tab) => {
    await openSidePanel(tab?.id);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleRuntimeMessage(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  chrome.windows?.onRemoved?.addListener?.((windowId) => {
    // Drop the panel-window lock when its host window closes so subsequent calls
    // fall back to the global active-tab scan instead of targeting a dead window.
    // Safe to call unconditionally — the setter ignores mismatches via null check.
    const current = getPreferredWindowIdSafe();
    if (current === windowId) setPreferredWindowId(null);
  });

  setupSidePanelBehavior();
  console.info('[AgentLimb] runtime bootstrapped', {
    appId: APP_ID,
    version: APP_VERSION,
    startedAt,
  });

  return runtimeInstance;
}

async function handleRuntimeMessage(message = {}, sender) {
  switch (message.type) {
    case MESSAGE_TYPES.GET_RUNTIME_STATUS:
      return getRuntimeStatus();
    case MESSAGE_TYPES.GET_ACTIVITY_LOG:
      return { ok: true, log: activityLog.slice() };
    case MESSAGE_TYPES.GET_EXTENSION_IDENTITY: {
      const identity = await getExtensionIdentity();
      return { ok: true, extensionId: identity.extensionId, label: identity.label };
    }
    case MESSAGE_TYPES.GET_ACTIVE_TAB_CONTEXT:
      return runtimeInstance.modules.snapshot.getActiveTabContext({
        tabId: message.tabId ?? sender?.tab?.id ?? null,
      });
    case MESSAGE_TYPES.GET_PAGE_SNAPSHOT:
      return runtimeInstance.modules.snapshot.capturePageSnapshot({
        tabId: message.tabId ?? sender?.tab?.id ?? null,
        filterMode: message.filterMode,
        limit: message.limit,
      });
    case MESSAGE_TYPES.EXECUTE_COMPUTER_ACTION:
      return runtimeInstance.modules.computer.executeAction({
        ...(message.action || {}),
        tabId: message.tabId ?? message.action?.tabId ?? sender?.tab?.id ?? null,
      });
    case MESSAGE_TYPES.LIST_HOST_TOOLS:
      return runtimeInstance.modules.host.listTools();
    case MESSAGE_TYPES.CALL_HOST_TOOL:
      return runtimeInstance.modules.host.callTool({
        requestId: message.requestId ?? null,
        tool: message.tool,
        params: message.params || {},
      });
    case MESSAGE_TYPES.PING:
      return {
        ok: true,
        pong: true,
        senderTabId: sender?.tab?.id ?? null,
        at: new Date().toISOString(),
      };
    case MESSAGE_TYPES.OPEN_SIDE_PANEL:
      await openSidePanel(message.tabId ?? sender?.tab?.id);
      return { ok: true };
    case MESSAGE_TYPES.REGISTER_PANEL_WINDOW:
      setPreferredWindowId(message.windowId);
      return { ok: true, windowId: message.windowId ?? null };
    default:
      return {
        ok: false,
        error: `Unknown runtime message: ${message.type || '(empty)'}`,
      };
  }
}

async function setupSidePanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn('[AgentLimb] failed to set side panel behavior', error);
  }
}

async function openSidePanel(tabId) {
  if (!chrome.sidePanel?.open || !tabId) return;
  try {
    await chrome.sidePanel.open({ tabId });
  } catch (error) {
    console.warn('[AgentLimb] failed to open side panel', { tabId, error });
  }
}

/**
 * Called from the alarm handler in service-worker.js.
 * Stops and restarts the relay in case SW suspension cleared its setTimeout.
 */
export function ensureRelayRunning() {
  bootstrapRuntime();
  // Relay may not yet be constructed (identity resolution is async on first boot).
  // If so, the IIFE in bootstrapRuntime() will start it; nothing to do here.
  if (relay) {
    relay.stop();
    relay.start();
  }
}

const STORAGE_KEY = 'agentlimb.extensionId';

async function getExtensionIdentity() {
  if (extensionIdentity) return extensionIdentity;
  if (extensionIdentityPromise) return extensionIdentityPromise;
  extensionIdentityPromise = (async () => {
    const extensionId = await getOrCreateExtensionId();
    const email = await getProfileLabel();
    // Prefer signed-in email; fall back to short tag from the id so each profile
    // gets a human-distinguishable label without needing the `identity` permission.
    const label = email || `Profile-${extensionId.slice(4, 10)}`;
    extensionIdentity = { extensionId, label };
    return extensionIdentity;
  })();
  return extensionIdentityPromise;
}

async function getOrCreateExtensionId() {
  try {
    const existing = await chrome.storage.local.get(STORAGE_KEY);
    if (existing?.[STORAGE_KEY]) return existing[STORAGE_KEY];
  } catch {
    // storage unavailable — fall through
  }

  const id = `ext_${generateUuid()}`;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: id });
  } catch {
    // best-effort persistence
  }
  return id;
}

async function getProfileLabel() {
  try {
    if (chrome.identity?.getProfileUserInfo) {
      const info = await new Promise((resolve) =>
        chrome.identity.getProfileUserInfo((u) => resolve(u || {})),
      );
      if (info?.email) return info.email;
    }
  } catch {
    // identity permission missing — fall through
  }
  return '';
}

function generateUuid() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getRuntimeStatus() {
  const { permissions, snapshot, computer, host } = runtimeInstance.modules;
  return {
    ok: true,
    app: runtimeInstance.app,
    capabilities: CAPABILITIES,
    modules: {
      permissions: permissions.getStatus(),
      snapshot: await snapshot.getStatus(),
      computer: await computer.getStatus(),
      host: await host.getStatus(),
    },
    strategy: runtimeInstance.strategy,
    relay: { running: relay != null },
  };
}
