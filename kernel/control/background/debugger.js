/**
 * AgentLimb debugger manager
 *
 * Key difference vs. a naive implementation (and the main efficiency win):
 * the CDP debugger is attached ONCE per tab and REUSED across tool calls,
 * with in-flight de-duplication. Attach/detach per action costs ~10-50ms each
 * and races with DevTools; the reference design keeps a persistent session and
 * re-attaches only when Chrome tears it down.
 *
 * Also provides:
 *   - Emulation.setFocusEmulationEnabled so the agent can drive a BACKGROUND
 *     tab (user watches a video in another tab) without stealing focus
 *   - console + network capture (Runtime.enable / Network.enable once)
 *   - adaptive-quality screenshots that fit a base64 budget
 */

const PROTOCOL_VERSION = '1.3';
const DEFAULT_COMMAND_TIMEOUT_MS = 10000;
const MAX_BUFFER = 200;
const MAX_BASE64_CHARS = 1_200_000; // ~900KB binary

export function createDebuggerManager() {
  /** @type {Map<number, {attached: boolean, attaching: Promise<void>|null, enabled: Set<string>, muted: boolean|null}>} */
  const tabs = new Map();
  const consoleBuffers = new Map(); // tabId -> ring array
  const networkBuffers = new Map(); // tabId -> ring array

  function entry(tabId) {
    let e = tabs.get(tabId);
    if (!e) {
      e = { attached: false, attaching: null, enabled: new Set(), muted: null };
      tabs.set(tabId, e);
    }
    return e;
  }

  function pushBuffer(map, tabId, item) {
    let buf = map.get(tabId);
    if (!buf) {
      buf = [];
      map.set(tabId, buf);
    }
    buf.push(item);
    if (buf.length > MAX_BUFFER) buf.shift();
  }

  // ── attach lifecycle ───────────────────────────────────────────────────────
  async function rawAttach(tabId) {
    await new Promise((resolve, reject) => {
      let timer = setTimeout(() => reject(new Error(`debugger attach timed out on tab ${tabId} (DevTools open?)`)), 8000);
      try {
        chrome.debugger.attach({ tabId }, PROTOCOL_VERSION, () => {
          clearTimeout(timer);
          const err = chrome.runtime.lastError;
          if (err) {
            if (/Another debugger/i.test(err.message || '')) {
              reject(new Error('Another debugger is attached to this tab (DevTools?). Close it and retry.'));
            } else {
              reject(new Error(err.message));
            }
          } else {
            resolve();
          }
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async function attach(tabId) {
    const e = entry(tabId);
    if (e.attached) return;
    if (e.attaching) return e.attaching;

    const promise = (async () => {
      await rawAttach(tabId);
      e.attached = true;
      registerEventsOnce();
      // Enable domains once per attach (cheap afterwards).
      await send(tabId, 'Page.enable').catch(() => {});
      await send(tabId, 'Runtime.enable').catch(() => {});
      await send(tabId, 'Network.enable', { maxPostDataSize: 65536 }).catch(() => {});
    })().finally(() => {
      e.attaching = null;
    });

    e.attaching = promise;
    return promise;
  }

  function isAttached(tabId) {
    return tabs.get(tabId)?.attached === true;
  }

  function detach(tabId) {
    const e = tabs.get(tabId);
    if (!e?.attached) return Promise.resolve();
    e.attached = false;
    restoreMute(tabId);
    return new Promise((resolve) => {
      try {
        chrome.debugger.detach({ tabId }, () => resolve());
      } catch (_) {
        resolve();
      }
    });
  }

  // Chrome may detach us (user opens DevTools, renderer crash). Mark stale.
  let eventsRegistered = false;
  function registerEventsOnce() {
    if (eventsRegistered) return;
    eventsRegistered = true;
    chrome.debugger.onDetach.addListener((source, reason) => {
      const e = tabs.get(source.tabId);
      if (e) {
        e.attached = false;
        e.enabled.clear();
      }
    });
    chrome.debugger.onEvent.addListener((source, method, params) => {
      const tabId = source.tabId;
      if (method === 'Runtime.consoleAPICalled') {
        const args = (params.args || []).map((a) =>
          a.value !== undefined ? String(a.value).slice(0, 500)
            : a.description !== undefined ? a.description
              : a.type);
        pushBuffer(consoleBuffers, tabId, {
          level: params.type || 'log',
          text: args.join(' '),
          ts: params.timestamp ? new Date(params.timestamp).toISOString() : new Date().toISOString(),
        });
      } else if (method === 'Runtime.exceptionThrown') {
        const d = params.exceptionDetails || {};
        pushBuffer(consoleBuffers, tabId, {
          level: 'error',
          text: (d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception',
          ts: new Date().toISOString(),
        });
      } else if (method === 'Network.requestWillBeSent') {
        pushBuffer(networkBuffers, tabId, {
          requestId: params.requestId,
          url: (params.request && params.request.url) || '',
          method: (params.request && params.request.method) || 'GET',
          type: params.type || '',
          ts: new Date().toISOString(),
        });
      } else if (method === 'Network.responseReceived') {
        // annotate the matching entry
        const buf = networkBuffers.get(tabId);
        if (buf) {
          for (let i = buf.length - 1; i >= 0; i--) {
            if (buf[i].requestId === params.requestId) {
              buf[i].status = params.response && params.response.status;
              buf[i].mimeType = params.response && params.response.mimeType;
              break;
            }
          }
        }
      } else if (method === 'Network.loadingFailed') {
        const buf = networkBuffers.get(tabId);
        if (buf) {
          for (let i = buf.length - 1; i >= 0; i--) {
            if (buf[i].requestId === params.requestId) {
              buf[i].failed = params.errorText || 'failed';
              break;
            }
          }
        }
      }
    });
  }

  // ── command ────────────────────────────────────────────────────────────────
  async function send(tabId, method, params = {}, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    await attach(tabId);
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      try {
        chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(`${method}: ${err.message}`));
          else resolve(result);
        });
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  // ── focus emulation (background-tab control) ───────────────────────────────
  async function setFocusEmulation(tabId, on) {
    await send(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: on }).catch(() => {});
  }

  /** Mute the controlled tab so the user's audio isn't hijacked. */
  async function muteForControl(tabId) {
    const e = entry(tabId);
    if (e.muted !== null) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      e.muted = tab.mutedInfo?.muted === true;
      if (!e.muted) await chrome.tabs.update(tabId, { muted: true });
    } catch (_) {
      e.muted = null;
    }
  }

  function restoreMute(tabId) {
    const e = tabs.get(tabId);
    if (e && e.muted === false) {
      chrome.tabs.update(tabId, { muted: false }).catch(() => {});
    }
    if (e) e.muted = null;
  }

  // ── screenshot with adaptive quality ───────────────────────────────────────
  async function screenshot(tabId, { format = 'jpeg', fullPage = false, quality = 75 } = {}) {
    await attach(tabId);
    let q = quality;
    let shot = await send(tabId, 'Page.captureScreenshot', {
      format,
      quality: format === 'jpeg' ? q : undefined,
      captureBeyondViewport: fullPage === true,
    });

    // Shrink until the payload fits the budget (JPEG only).
    if (format === 'jpeg') {
      let guard = 0;
      while (shot.data && shot.data.length > MAX_BASE64_CHARS && q > 10 && guard++ < 12) {
        q = Math.max(10, q - 15);
        shot = await send(tabId, 'Page.captureScreenshot', {
          format,
          quality: q,
          captureBeyondViewport: fullPage === true,
        });
      }
    }
    return { data: shot.data, format, quality: q };
  }

  // ── buffers ────────────────────────────────────────────────────────────────
  function readConsole(tabId, { limit = 50, level = 'all' } = {}) {
    let items = consoleBuffers.get(tabId) || [];
    if (level !== 'all') items = items.filter((i) => i.level === level);
    return items.slice(-limit);
  }

  function readNetwork(tabId, { limit = 50, urlFilter } = {}) {
    let items = networkBuffers.get(tabId) || [];
    if (urlFilter) items = items.filter((i) => i.url.includes(urlFilter));
    return items.slice(-limit);
  }

  function status() {
    const attached = [];
    for (const [tabId, e] of tabs) if (e.attached) attached.push(tabId);
    return { attachedTabs: attached };
  }

  return {
    attach,
    detach,
    send,
    isAttached,
    setFocusEmulation,
    muteForControl,
    restoreMute,
    screenshot,
    readConsole,
    readNetwork,
    status,
  };
}
