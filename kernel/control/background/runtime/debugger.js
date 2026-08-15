const DEBUGGER_PROTOCOL_VERSION = '1.3';

// Per-tab lock to prevent concurrent debugger sessions
const tabLocks = new Map();

export async function withDebuggerSession(tabId, callback) {
  // Wait for any existing session on this tab to finish
  while (tabLocks.has(tabId)) {
    await tabLocks.get(tabId);
  }

  let resolveLock;
  const lockPromise = new Promise((resolve) => { resolveLock = resolve; });
  tabLocks.set(tabId, lockPromise);

  const target = { tabId };
  let attached = false;

  try {
    try {
      await chrome.debugger.attach(target, DEBUGGER_PROTOCOL_VERSION);
      attached = true;
    } catch (error) {
      const message = error?.message || 'Failed to attach Chrome debugger';

      if (/Another debugger/i.test(message)) {
        throw new Error(
          'Another debugger is already attached to this tab. Close DevTools or the competing debugger and retry.',
        );
      }

      throw new Error(message);
    }

    return await callback({
      sendCommand(method, params = {}) {
        return chrome.debugger.sendCommand(target, method, params);
      },
    });
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch {
        // Ignore detach failures because the session work already completed.
      }
    }
    tabLocks.delete(tabId);
    resolveLock();
  }
}
