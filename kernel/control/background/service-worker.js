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
    onToolCall: ({ tool, args, timeoutMs }) =>
      Promise.race([
        router.execute(tool, args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`tool ${tool} timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]),
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

  function setPanelBehavior() {
    chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
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

  async function handleMessage(message = {}, sender) {
    switch (message.type) {
      case MESSAGE_TYPES.GET_STATUS:
        return { ok: true, ...bridge.getStatus() };

      case MESSAGE_TYPES.PAIRING_RESPONSE:
        return bridge.respondPairing(message.request_id, message.ok !== false, message.name);

      case MESSAGE_TYPES.CHAT_SEND: {
        const result = await bridge.sendUserMessage(message.text);
        if (result.ok) {
          // Local receipt so the panel can render immediately.
          chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.NOTIFY_CHAT,
            message: { from: 'user', text: message.text, at: new Date().toISOString() },
          }).catch(() => {});
        }
        return result;
      }

      case MESSAGE_TYPES.QUICK_ACTION: {
        // Direct local control from the panel (no agent in the loop).
        const tool = message.tool;
        const args = message.args || {};
        const result = await router.execute(tool, args);
        return { ok: true, result };
      }

      case MESSAGE_TYPES.DISCONNECT_CLIENT:
        return bridge.disconnectClient(message.clientId);

      case MESSAGE_TYPES.STOP_AGENT: {
        router.stopAllDriving();
        await bridge.stopAgent();
        return { ok: true };
      }

      default:
        return { ok: false, error: `unknown message: ${message.type || '(empty)'}` };
    }
  }

  console.info('[AgentLimb] service worker bootstrapped', { version: chrome.runtime.getManifest().version });
  return runtime;
}

bootstrap();
