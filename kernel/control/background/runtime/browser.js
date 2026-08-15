const DEFAULT_MESSAGE_TIMEOUT_MS = 5000;
const PING_TIMEOUT_MS = 300;

// Panel window lock — set by sidepanel on boot / visibilitychange. Confines
// default tab targeting to the window that hosts the side panel so multi-window
// profiles don't navigate a tab in the wrong window.
let preferredWindowId = null;

export function setPreferredWindowId(windowId) {
  preferredWindowId = Number.isInteger(windowId) && windowId > 0 ? windowId : null;
}

export function getPreferredWindowId() {
  return preferredWindowId;
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function getTargetTab(tabId = null) {
  if (Number.isInteger(tabId) && tabId > 0) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  // Prefer the panel-hosting window when it's still alive — prevents navigation
  // from landing on an active tab in a different window of the same profile.
  if (preferredWindowId != null) {
    try {
      await chrome.windows.get(preferredWindowId);
      const scoped = await chrome.tabs.query({ active: true, windowId: preferredWindowId });
      const hit =
        scoped.find((t) => /^https?:\/\//i.test(t.url || '')) ??
        scoped[0] ??
        null;
      if (hit) return hit;
    } catch {
      // Window was closed — drop the stale lock and fall through to global query.
      preferredWindowId = null;
    }
  }

  // Query active tabs across ALL windows — DevTools / extension pages can steal
  // currentWindow focus, leaving chrome.tabs.query({currentWindow:true}) empty.
  // Prefer the first active tab with an http/https URL (a real page).
  const tabs = await chrome.tabs.query({ active: true });
  return (
    tabs.find((t) => /^https?:\/\//i.test(t.url || '')) ??
    tabs[0] ??
    null
  );
}

export function isInjectableUrl(url = '') {
  return /^https?:\/\//i.test(url);
}

export function describeTab(tab) {
  if (!tab) return null;

  return {
    id: tab.id ?? null,
    windowId: tab.windowId ?? null,
    url: tab.url ?? '',
    title: tab.title ?? '',
    status: tab.status ?? 'unknown',
    active: Boolean(tab.active),
  };
}

/**
 * Inject a content script only if it is not already alive in the tab.
 * Uses a PING message to check for an existing listener before calling
 * executeScript — avoids re-injection that can orphan MV3 message listeners.
 */
export async function injectScriptIfNeeded(tabId, file) {
  const ping = await sendToTab(tabId, { type: 'AGENTLIMB_PING' }, PING_TIMEOUT_MS);
  if (ping?.pong) {
    return { ok: true };
  }
  return injectScript(tabId, file);
}

export async function injectScript(tabId, file) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [file],
    });
    return { ok: true };
  } catch (error) {
    const message = error?.message || 'Failed to inject content script';
    const tab = await getTargetTab(tabId);

    if (/Cannot access|missing host permission/i.test(message)) {
      if (tab?.url && (await ensureHostPermission(tab.url))) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: [file],
          });
          return { ok: true };
        } catch (retryError) {
          return {
            ok: false,
            reason: 'permission_denied',
            message: retryError?.message || 'Permission granted but injection still failed',
          };
        }
      }

      if (/^chrome(-extension)?:\/\//i.test(tab?.url || '')) {
        return {
          ok: false,
          reason: 'restricted_page',
          message: `Cannot inject into ${tab.url}. Navigate to an http/https page first.`,
        };
      }

      return {
        ok: false,
        reason: 'permission_denied',
        message: 'Host permission denied for this page.',
      };
    }

    if (/chrome:\/\/|chrome-extension:\/\//i.test(message)) {
      return {
        ok: false,
        reason: 'restricted_page',
        message,
      };
    }

    return {
      ok: false,
      reason: 'unknown',
      message,
    };
  }
}

export function sendToTab(tabId, message, timeout = DEFAULT_MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

async function ensureHostPermission(url) {
  if (!isInjectableUrl(url)) return false;

  const originPattern = `${new URL(url).origin}/*`;
  const hasPermission = await chrome.permissions.contains({
    origins: [originPattern],
  });

  if (hasPermission) return true;

  try {
    return await chrome.permissions.request({ origins: [originPattern] });
  } catch {
    return false;
  }
}
