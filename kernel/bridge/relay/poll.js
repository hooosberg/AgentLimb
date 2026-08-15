/**
 * Bridge Relay — SW side
 *
 * Polls the Host bridge for pending browser tool calls, executes them via
 * the host controller, and posts results back.  Runs entirely inside the
 * Chrome extension Service Worker.
 *
 * API:
 *   startBridgeRelay({ callTool, onActivity, hostBaseUrl }) → { start, stop }
 */

const POLL_INTERVAL_MS   = 300;   // idle polling cadence
const BUSY_INTERVAL_MS   = 50;    // immediately re-poll when a call was found
const ERROR_INTERVAL_MS  = 3000;  // back-off when bridge is unreachable
const FETCH_TIMEOUT_MS   = 4000;

export function startBridgeRelay({ callTool, onActivity, hostBaseUrl, extensionId, label } = {}) {
  const base = (hostBaseUrl || 'http://127.0.0.1:7791').replace(/\/$/, '');
  let running = false;
  let timer   = null;

  // True iff at least one side-panel document is currently loaded in this
  // profile. Chrome tears down the SIDE_PANEL context as soon as the user
  // closes the panel UI, so this is the cleanest "is the user opted in"
  // signal we have. Tagged on every poll as X-Panel-Active for the Bridge.
  async function detectPanelActive() {
    try {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
      return Array.isArray(contexts) && contexts.length > 0;
    } catch (_) {
      // Older Chrome or permission quirk — fall through without a signal.
      return null;
    }
  }

  function buildHeaders(extra = {}, panelActive = null) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (extensionId) headers['X-Extension-Id'] = extensionId;
    if (label) headers['X-Extension-Label'] = label;
    if (panelActive === true) headers['X-Panel-Active'] = 'true';
    else if (panelActive === false) headers['X-Panel-Active'] = 'false';
    return headers;
  }

  async function poll() {
    if (!running) return;

    let nextDelay = POLL_INTERVAL_MS;
    try {
      // Claim the next queued browser tool call
      const panelActive = await detectPanelActive();
      const claimRes = await fetch(`${base}/api/mvp/extension/browser/next`, {
        method: 'POST',
        headers: buildHeaders({}, panelActive),
        body: '{}',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!claimRes.ok) throw new Error(`bridge claim HTTP ${claimRes.status}`);

      const { call } = await claimRes.json();

      if (call) {
        onActivity?.({ kind: 'call', tool: call.tool, params: call.params, callId: call.id });

        // Execute the tool via the host controller
        let ok = false;
        let result = null;
        let errorMsg = '';

        try {
          result = await callTool({
            requestId: call.id,
            tool: call.tool,
            params: call.params || {},
          });
          ok = true;
          onActivity?.({ kind: 'result', tool: call.tool, callId: call.id, ok: true, result });
        } catch (err) {
          errorMsg = err?.message ?? String(err);
          onActivity?.({ kind: 'result', tool: call.tool, callId: call.id, ok: false, error: errorMsg });
        }

        // Post result back to bridge
        await fetch(`${base}/api/mvp/extension/browser/result`, {
          method: 'POST',
          headers: buildHeaders(),
          body: JSON.stringify({
            callId: call.id,
            ok,
            result: ok ? result : null,
            error: ok ? undefined : errorMsg,
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }).catch((e) => console.warn('[relay] result post failed', e));

        // Immediately re-poll — there may be more calls queued
        nextDelay = BUSY_INTERVAL_MS;
      }
    } catch (_) {
      // Bridge offline or unreachable
      nextDelay = ERROR_INTERVAL_MS;
    }

    timer = setTimeout(poll, nextDelay);
  }

  return {
    start() {
      if (running) return;
      running = true;
      poll();
    },
    stop() {
      running = false;
      clearTimeout(timer);
      timer = null;
    },
  };
}
