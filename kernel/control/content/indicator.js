/**
 * AgentLimb agent-indicator content script (top frame only)
 *
 * When an AI agent is driving this tab, the user sees a glow border and a
 * phantom cursor that tracks the agent's pointer. Nothing to click: the page
 * shows "it is working here", the side panel is where you talk to it.
 */
(function () {
  if (window.__agentlimbIndicator) return;

  const state = { active: false, tabId: null };
  window.__agentlimbIndicator = state;

  let root = null;
  let cursor = null;

  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.createElement('div');
    root.id = 'agentlimb-indicator';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="agentlimb-glow"></div>
      <div class="agentlimb-cursor" hidden>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M0 0 L0 18 L4.5 14 L7.5 21.5 L11 20 L8 13 L14 13 Z" transform="translate(1.5,0) scale(0.82)"
                fill="#D97757" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>
        </svg>
      </div>`;
    (document.body || document.documentElement).appendChild(root);
    cursor = root.querySelector('.agentlimb-cursor');
    return root;
  }

  function show(tabId) {
    state.active = true;
    state.tabId = tabId ?? null;
    ensureRoot().classList.add('agentlimb-active');
  }

  function hide() {
    state.active = false;
    if (root) root.classList.remove('agentlimb-active');
    if (cursor) cursor.hidden = true;
  }

  function moveCursor(x, y) {
    if (!state.active) return;
    ensureRoot();
    cursor.hidden = false;
    cursor.style.transform = `translate(${x}px, ${y}px)`;
  }

  // ── styles (injected once) ─────────────────────────────────────────────────
  if (!document.getElementById('agentlimb-indicator-style')) {
    const style = document.createElement('style');
    style.id = 'agentlimb-indicator-style';
    style.textContent = `
#agentlimb-indicator { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; display: none; }
#agentlimb-indicator.agentlimb-active { display: block; }
#agentlimb-indicator .agentlimb-glow {
  position: fixed; inset: 0; pointer-events: none;
  box-shadow: inset 0 0 0 2px rgba(217, 119, 87, 0.9), inset 0 0 18px rgba(217, 119, 87, 0.35);
  border-radius: 4px;
}
#agentlimb-indicator .agentlimb-cursor {
  position: fixed; left: 0; top: 0; pointer-events: none;
  transition: transform 60ms linear;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35));
}
@media (prefers-color-scheme: dark) {
  #agentlimb-indicator .agentlimb-glow {
    box-shadow: inset 0 0 0 2px rgba(217, 119, 87, 0.95), inset 0 0 22px rgba(217, 119, 87, 0.45);
  }
}`;
    (document.head || document.documentElement).appendChild(style);
  }

  // ── SW messages ────────────────────────────────────────────────────────────
  let handler = null;
  if (window.__agentlimbIndicatorHandler) {
    chrome.runtime.onMessage.removeListener(window.__agentlimbIndicatorHandler);
  }
  handler = function (message, _sender, sendResponse) {
    switch (message && message.type) {
      case 'AGENTLIMB_SHOW_INDICATOR':
        show(message.tabId);
        break;
      case 'AGENTLIMB_HIDE_INDICATOR':
        hide();
        break;
      case 'AGENTLIMB_MOVE_CURSOR':
        moveCursor(message.x, message.y);
        break;
      default:
        return undefined;
    }
    if (sendResponse) sendResponse({ ok: true });
    return undefined;
  };
  window.__agentlimbIndicatorHandler = handler;
  chrome.runtime.onMessage.addListener(handler);
})();
