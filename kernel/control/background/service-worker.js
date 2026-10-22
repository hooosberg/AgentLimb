/**
 * AgentLimb service worker
 *
 * The SW is the control plane. It is completely independent from the side
 * panel: pairing, tool execution and the in-page indicator work whether or
 * not the panel is open (the panel is only a status/chat surface).
 */

import { MESSAGE_TYPES } from '../../shared/constants.js';
import { createDebuggerManager } from './debugger.js';
import { createRouter } from './router.js';
import { createBridgeClient } from './bridge-client.js';

const runtime = { ready: false };

function bootstrap() {
  if (runtime.ready) return runtime;
  runtime.ready = true;

  const debuggerManager = createDebuggerManager();
  const router = createRouter({ debugger: debuggerManager, indicator: null });
  const bridge = createBridgeClient({
    onStatus: (snapshot) => {
      runtime.lastStatus = snapshot;
    },
    onToolCall: async ({ tool, args, timeoutMs }) => {
      setBusy(true);
      try {
        return await Promise.race([
          router.execute(tool, args),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`tool ${tool} timed out after ${timeoutMs}ms`)), timeoutMs),
          ),
        ]);
      } finally {
        setBusy(false);
      }
    },
    onPairingRequest: () => {},
  });

  runtime.debugger = debuggerManager;
  runtime.router = router;
  runtime.bridge = bridge;
  runtime.lastStatus = bridge.getStatus();

  void bridge.start();

  // MV3 keep-alive: the SW suspends when idle; the alarm re-opens the SSE
  // stream and keeps the pairing/tool loop alive. (Chrome clamps to ≥1min in
  // packed extensions; unpacked dev builds honor sub-minute periods.)
  chrome.alarms.create('agentlimb-bridge-keepalive', { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'agentlimb-bridge-keepalive') {
      bridge.ensure();
    }
  });

  // ── side panel: click toggles (open ↔ close) ───────────────────────────────
  // openPanelOnActionClick must be false, otherwise Chrome consumes the click
  // to open the panel and onClicked never fires (no toggle possible).
  setPanelBehavior();

  chrome.action.onClicked.addListener((tab) => {
    void toggleSidePanel(tab);
  });

  chrome.commands?.onCommand?.addListener((command) => {
    if (command !== 'toggle-side-panel') return;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) void toggleSidePanel(tab);
    });
  });

  /** Toolbar badge = "the agent is doing something right now". */
  function setBusy(on) {
    try {
      if (!chrome.action?.setBadgeText) return;
      Promise.resolve(chrome.action.setBadgeText({ text: on ? '…' : '' })).catch(() => {});
      if (on && chrome.action.setBadgeBackgroundColor) {
        Promise.resolve(chrome.action.setBadgeBackgroundColor({ color: '#d97757' })).catch(() => {});
      }
    } catch (_) { /* badge unavailable */ }
  }

  function setPanelBehavior() {    chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
  }

  async function toggleSidePanel(tab) {
    if (tab?.id == null) return;
    try {
      // One side panel per window: if a SIDE_PANEL context exists in this
      // window the panel is open → close it; otherwise open it.
      let isOpen = false;
      try {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: ['SIDE_PANEL'],
          windowId: tab.windowId,
        });
        isOpen = Array.isArray(contexts) && contexts.length > 0;
      } catch (_) {
        isOpen = false; // getContexts unavailable (pre-116) → open
      }
      if (isOpen) {
        await chrome.sidePanel.close({ tabId: tab.id });
      } else {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    } catch (error) {
      console.warn('[AgentLimb] side panel toggle failed', error);
    }
  }

  // ── runtime messages (panel / pairing page / content scripts) ──────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  /**
   * The page the user is looking at, attached to every panel chat message.
   * Text + interactive refs let the agent answer immediately ("translate this",
   * "what is this page") without calling tabs_context/read_page first.
   */
  async function collectPageContext() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return null;
      const base = { tabId: tab.id, url: tab.url || '', title: tab.title || '' };
      // chrome:// pages, the Web Store, PDF viewers: Chrome forbids reading or
      // driving them. Say so instead of pretending the page is empty.
      if (!/^https?:/i.test(base.url)) return { ...base, restricted: true };
      const snap = await chrome.tabs.sendMessage(
        tab.id,
        { type: 'AGENTLIMB_PAGE_SNAPSHOT', options: { maxText: 2500, maxElements: 30 } },
        { frameId: 0 },
      );
      let page = snap?.ok ? { ...base, text: snap.text, interactive: snap.interactive } : base;
      const image = await capturePageImage(tab.id);
      if (image) page = { ...page, image: image.data, imageMime: image.mimeType };
      return page;
    } catch (_) {
      return null; // no content script (chrome:// page, PDF, etc.)
    }
  }

  /**
   * Same as above plus a screenshot of that tab — "what am I looking at" beats
   * any text description. Attached to every panel chat message so the agent can
   * answer without spending a tool call on it.
   */
  async function capturePageImage(tabId) {
    try {
      const shot = await runtime.debugger.screenshot(tabId, { quality: 45, maxBase64: 220000 });
      if (shot?.data) return { data: shot.data, mimeType: 'image/jpeg' };
    } catch (_) { /* screenshot failed — text context is still useful */ }
    return null;
  }

  async function handleMessage(message = {}, sender) {    switch (message.type) {
      case MESSAGE_TYPES.GET_STATUS:
        return { ok: true, ...bridge.getStatus() };

      case MESSAGE_TYPES.PAIRING_RESPONSE:
        return bridge.respondPairing(message.request_id, message.ok !== false, message.name);

      case MESSAGE_TYPES.CHAT_SEND: {
        // The panel is a chat window ON the agent, and every message carries the
        // page the user is looking at — "translate this" needs no round trip.
        const page = await collectPageContext();
        return bridge.sendUserMessage(message.text, page);
      }

      case MESSAGE_TYPES.DISCONNECT_CLIENT: {
        // Disconnect is not a "flow": revoke the trust, tell the agent in plain
        // words, and drop the in-page indicators. Nothing else to unwind.
        router.stopAllDriving();
        return bridge.disconnectClient(message.clientId);
      }

      default:
        return { ok: false, error: `unknown message: ${message.type || '(empty)'}` };
    }
  }

  console.info('[AgentLimb] service worker bootstrapped', { version: chrome.runtime.getManifest().version });
  return runtime;
}

bootstrap();
