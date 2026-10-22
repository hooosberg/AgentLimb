/**
 * AgentLimb bridge client (extension side)
 *
 * Transport: the local bridge (embedded in the MCP host process) exposes
 *   GET  /health        — liveness + port discovery
 *   GET  /events        — SSE stream, host → extension push
 *   POST /api/message   — extension → host frames
 *
 * Why SSE+POST instead of a WebSocket client: identical push latency over
 * loopback, zero protocol risk (Node's http module is battle-tested), and the
 * browser handles SSE reconnection for us. A cloud-bridge reference design
 * uses a WebSocket; on loopback the SSE channel is strictly simpler.
 *
 * Lifecycle:
 *   discover port → open SSE → hello → pairing_request (first time only)
 *   → tool_call / tool_result frames → (SW suspend) → alarm wakes us → retry
 */

import { BRIDGE_PORTS, STORAGE_KEYS, WIRE } from '../../shared/constants.js';

const TOOL_TIMEOUT_MS = 65000;

export function createBridgeClient({ onStatus, onToolCall, onPairingRequest, onAgentMessage }) {
  let port = null;
  let eventSource = null;
  let status = 'disconnected'; // disconnected | connecting | connected
  // Per-SW-session browser token so the host can attribute POST frames to the
  // right SSE connection (survives EventSource auto-reconnects).
  const browserId = `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  /** @type {Map<string, {id:string,name:string,kind:string,paired:boolean}>} */
  const clients = new Map();
  /** @type {Map<string, {client:object, receivedAt:string}>} */
  const pending = new Map();
  /** @type {Map<string, Array<{text:string,at:string}>>} */
  const userMessageQueues = new Map();
  const openPairingTabs = new Map(); // request_id -> tabId
  let toolChain = Promise.resolve();
  /**
   * Panel chat transcript: {from:'user'|'agent'|'activity', text, at}.
   * Persisted so closing/reopening the panel keeps the conversation.
   */
  const chatLog = [];
  /**
   * Timestamp of a panel message that has not been answered yet. Drives the
   * "正在思考…" bubble — the only liveness signal the user gets when the agent
   * is silent.
   */
  let pendingReplyAt = null;

  function persistChat() {
    const durable = chatLog.filter((m) => m.from !== 'activity').slice(-60);
    chrome.storage.local.set({ [STORAGE_KEYS.chatLog]: durable }).catch(() => {});
  }

  function pushChat(entry) {
    chatLog.push(entry);
    if (chatLog.length > 120) chatLog.splice(0, chatLog.length - 120);
    if (entry.from !== 'activity') persistChat();
    chrome.runtime.sendMessage({ type: 'AGENTLIMB_NOTIFY_CHAT', message: entry }).catch(() => {});
  }

  /** Wipe the transcript (disconnect, or a different agent took over). */
  function clearChat() {
    pendingReplyAt = null;
    if (!chatLog.length) return;
    chatLog.length = 0;
    persistChat();
    chrome.runtime.sendMessage({ type: 'AGENTLIMB_NOTIFY_CHAT' }).catch(() => {});
  }

  async function loadChatLog() {
    try {
      const store = await chrome.storage.local.get(STORAGE_KEYS.chatLog);
      const saved = store[STORAGE_KEYS.chatLog];
      if (Array.isArray(saved) && saved.length) {
        chatLog.splice(0, chatLog.length, ...saved.slice(-60));
      }
    } catch (_) { /* storage unavailable */ }
  }

  /** Human-readable one-liner for the panel's activity feed. */
  const ACTIVITY_LABELS = {
    tabs_context: '查看标签列表',
    tab_new: '新建标签',
    tab_close: '关闭标签',
    tab_activate: '切换标签',
    read_page: '读取页面结构',
    find: '查找页面元素',
    computer: '操作页面',
    form_input: '填写表单',
    navigate: '导航',
    javascript_eval: '执行页面脚本',
    wait: '等待页面条件',
    read_console_messages: '读取控制台',
    read_network_requests: '读取网络请求',
    browser_batch: '批量操作',
    ping: '检查连接',
  };

  function pushActivity(tool, args = {}) {
    const label = ACTIVITY_LABELS[tool] || tool;
    let detail = '';
    if (tool === 'navigate' && args.url) detail = ` → ${String(args.url).slice(0, 60)}`;
    else if (tool === 'tab_new' && args.url) detail = ` → ${String(args.url).slice(0, 60)}`;
    else if (tool === 'computer' && args.action) detail = ` · ${args.action}`;
    pushChat({ from: 'activity', text: `${label}${detail}`, at: new Date().toISOString() });
  }

  // ── status ─────────────────────────────────────────────────────────────────
  function getStatus() {
    return {
      status,
      port,
      clients: [...clients.values()],
      pending: [...pending.entries()].map(([request_id, p]) => ({
        request_id,
        name: p.client.name,
        kind: p.client.kind,
      })),
      chat: chatLog.slice(-60),
      pendingReplyAt,
    };
  }

  function broadcast() {
    const snapshot = getStatus();
    onStatus?.(snapshot);
    chrome.runtime.sendMessage({ type: 'AGENTLIMB_NOTIFY_STATUS', ...snapshot }).catch(() => {});
  }

  function setStatus(next) {
    if (status !== next) {
      status = next;
      broadcast();
    }
  }

  // ── storage: paired clients ────────────────────────────────────────────────
  // Single-tenant by design: one browser is driven by one AI client. A new
  // pairing replaces the previous one, so switching from software A to B leaves
  // a clean panel instead of a growing stack of "正在与 … 驱动浏览器" chips.
  async function loadPaired() {
    try {
      const store = await chrome.storage.local.get(STORAGE_KEYS.pairedClients);
      const map = store[STORAGE_KEYS.pairedClients] || {};
      // Load everything we remember: pruning happens when a client actually
      // shows up (HELLO) or when a new pairing is confirmed, never on load —
      // dropping a trusted id here would force a needless re-pair.
      for (const [id, info] of Object.entries(map)) {
        clients.set(id, { ...info, id, paired: true });
      }
    } catch (_) { /* storage unavailable */ }
  }

  async function persistPaired() {
    const map = {};
    for (const c of clients.values()) if (c.paired) map[c.id] = c;
    await chrome.storage.local.set({ [STORAGE_KEYS.pairedClients]: map });
  }

  /** Forget every trusted client except `keepId`. */
  async function keepOnlyPaired(keepId) {
    let changed = false;
    for (const [id, c] of [...clients.entries()]) {
      if (id !== keepId && c.paired) {
        clients.delete(id);
        changed = true;
      }
    }
    if (changed) {
      await persistPaired();
      clearChat(); // a different agent took over — don't mix transcripts
    }
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────
  async function probePort(candidate) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 600);
      const res = await fetch(`http://127.0.0.1:${candidate}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return false;
      const body = await res.json();
      return body && body.service === 'agentlimb-bridge';
    } catch (_) {
      return false;
    }
  }

  async function discoverPort() {
    for (const candidate of BRIDGE_PORTS) {
      if (await probePort(candidate)) return candidate;
    }
    return null;
  }

  async function post(frame) {
    if (!port) throw new Error('bridge not connected');
    const res = await fetch(`http://127.0.0.1:${port}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b: browserId, ...frame }),
    });
    if (!res.ok) throw new Error(`bridge POST ${res.status}`);
    return res.json().catch(() => ({}));
  }

  // ── SSE ────────────────────────────────────────────────────────────────────
  function openStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    setStatus('connecting');
    const source = new EventSource(`http://127.0.0.1:${port}/events?b=${encodeURIComponent(browserId)}`);
    eventSource = source;

    source.onopen = () => {
      setStatus('connected');
    };

    source.onmessage = (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      handleFrame(frame).catch((error) => console.warn('[bridge] frame error', error));
    };

    source.onerror = () => {
      // EventSource auto-reconnects on transport errors; if the bridge process
      // died the reconnect will fail and we fall back to discovery.
      if (status === 'connected') setStatus('connecting');
      setTimeout(() => {
        if (status !== 'connected') {
          source.close();
          if (eventSource === source) eventSource = null;
          void reconnect();
        }
      }, 2000);
    };
  }

  async function reconnect() {
    const found = await discoverPort();
    if (found) {
      if (found !== port) {
        port = found;
      }
      // The bridge (MCP host) restarts with the agent software. Trusted clients
      // live in chrome.storage, so restore them BEFORE the stream opens —
      // otherwise the HELLO/PAIRING_REQUEST handshake sees an empty map and the
      // user is asked to pair again on every restart.
      await loadPaired();
      openStream();
    } else {
      port = null;
      setStatus('disconnected');
      pending.clear();
      broadcast();
    }
  }

  // ── frame handling ─────────────────────────────────────────────────────────
  async function handleFrame(frame) {
    switch (frame.t) {
      case WIRE.HELLO: {
        const client = frame.client || {};
        const known = clients.get(client.id);
        clients.set(client.id, {
          id: client.id,
          name: client.name || 'AI Agent',
          kind: client.kind || 'generic',
          paired: known ? known.paired : false,
          pairedAt: known?.pairedAt,
        });
        // Whoever is actually connected and trusted wins; stale pairings from
        // earlier software get dropped here.
        if (clients.get(client.id).paired) await keepOnlyPaired(client.id);
        broadcast();
        // Report our paired-client view so the host can auto-confirm.
        const pairedIds = [...clients.values()].filter((c) => c.paired).map((c) => c.id);
        post({
          t: WIRE.STATUS,
          paired: pairedIds,
        }).catch(() => {});
        break;
      }

      case WIRE.PAIRING_REQUEST: {
        const client = frame.client || {};
        clients.set(client.id, {
          id: client.id,
          name: client.name || 'AI Agent',
          kind: client.kind || 'generic',
          paired: clients.get(client.id)?.paired === true,
        });
        const knownPaired = clients.get(client.id)?.paired === true;
        if (knownPaired) {
          // Previously trusted client — auto-confirm, no UI interruption.
          await post({
            t: WIRE.PAIRING_RESPONSE,
            request_id: frame.request_id,
            ok: true,
            name: clients.get(client.id).name,
          });
        } else {
          pending.set(frame.request_id, { client, receivedAt: new Date().toISOString() });
          await openPairingTab(frame.request_id, client);
        }
        broadcast();
        break;
      }

      case WIRE.TOOL_CALL: {
        const { tool_use_id, tool, args, tabId, client_id } = frame;
        if (tool !== 'ping' && tool !== 'say') pushActivity(tool, args || {});
        // Serialize tool execution — agent calls are sequential by nature.
        toolChain = toolChain.then(async () => {
          let result = null;
          let error = null;
          try {
            result = await onToolCall({ tool, args: args || {}, tabId, timeoutMs: TOOL_TIMEOUT_MS });
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }
          const userMessages = drainUserMessages(client_id);
          await post({
            t: WIRE.TOOL_RESULT,
            tool_use_id,
            ok: !error,
            result,
            error,
            userMessages,
          }).catch((e) => console.warn('[bridge] tool_result post failed', e));
        });
        await toolChain;
        break;
      }

      case WIRE.AGENT_MESSAGE: {
        // The agent replied via the `say` tool — show it in the panel chat.
        pendingReplyAt = null;
        pushChat({ from: 'agent', text: frame.text, at: frame.at || new Date().toISOString() });
        break;
      }

      case WIRE.USER_MESSAGE: {
        // Panel chat → queued and attached to the agent's next tool result.
        const clientId = [...clients.values()].find((c) => c.paired)?.id || frame.client_id;
        if (clientId) queueUserMessage(clientId, { text: frame.text, at: frame.at, page: frame.page });
        onAgentMessage?.(frame);
        break;
      }

      case WIRE.PING:
        await post({ t: WIRE.PONG, at: new Date().toISOString() }).catch(() => {});
        break;

      case WIRE.PAIRING_REVOKED: {
        const c = clients.get(frame.client_id);
        if (c) c.paired = false;
        await persistPaired();
        broadcast();
        break;
      }

      default:
        break;
    }
  }

  // ── pairing UI ─────────────────────────────────────────────────────────────
  async function openPairingTab(requestId, client) {
    // Reuse an already-open pairing tab for this request.
    const existing = openPairingTabs.get(requestId);
    if (existing != null) return;
    const params = new URLSearchParams({
      request_id: requestId,
      client_type: client.kind || 'generic',
      client_name: client.name || 'AI Agent',
    });
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL(`ui/pairing/pairing.html?${params.toString()}`),
      active: true,
    });
    if (tab?.id != null) openPairingTabs.set(requestId, tab.id);
  }

  async function closePairingTabs(requestId) {
    const tabId = openPairingTabs.get(requestId);
    if (tabId != null) {
      chrome.tabs.remove(tabId).catch(() => {});
      openPairingTabs.delete(requestId);
    }
  }

  /** Called from the pairing page via runtime message. */
  async function respondPairing(requestId, ok, name) {
    const entry = pending.get(requestId);
    if (!entry) return { ok: false, error: 'unknown or expired pairing request' };
    pending.delete(requestId);
    await closePairingTabs(requestId);

    const client = clients.get(entry.client.id) || entry.client;
    if (ok) {
      client.paired = true;
      client.pairedAt = new Date().toISOString();
      if (name && name.trim()) client.name = name.trim();
      clients.set(client.id, client);
      await persistPaired();
      // A newly confirmed client takes the browser over — drop the previous one.
      await keepOnlyPaired(client.id);
    }
    await post({
      t: WIRE.PAIRING_RESPONSE,
      request_id: requestId,
      ok,
      name: client.name,
    }).catch(() => {});
    broadcast();
    return { ok: true };
  }

  // ── panel chat ─────────────────────────────────────────────────────────────
  async function sendUserMessage(text, page) {
    if (!text || !text.trim()) return { ok: false, error: 'empty message' };
    if (!port) return { ok: false, error: 'bridge not connected' };
    const clientId = [...clients.values()].find((c) => c.paired)?.id;
    if (!clientId) return { ok: false, error: 'no paired AI client' };
    const message = { text: text.trim(), at: new Date().toISOString() };
    if (page) message.page = page;
    pushChat({ from: 'user', ...message });
    pendingReplyAt = Date.now();
    // Queue locally too: the host echoes the frame back, but if the SSE hiccups
    // the message still rides on the agent's next tool result.
    queueUserMessage(clientId, message);
    await post({ t: WIRE.USER_MESSAGE, ...message });
    return { ok: true };
  }

  function queueUserMessage(clientId, message) {
    const queue = userMessageQueues.get(clientId) || [];
    const entry = typeof message === 'string'
      ? { text: message, at: new Date().toISOString() }
      : message;
    // The host echoes our own USER_MESSAGE back over SSE; dedupe on (at, text)
    // so the agent doesn't receive the same message twice.
    if (!queue.some((m) => m.at === entry.at && m.text === entry.text)) queue.push(entry);
    userMessageQueues.set(clientId, queue);
  }

  function drainUserMessages(clientId) {
    const queue = userMessageQueues.get(clientId);
    if (!queue || !queue.length) return [];
    userMessageQueues.delete(clientId);
    return queue;
  }

  async function stopAgent() {
    if (!port) return;
    await post({ t: WIRE.STOP_AGENT }).catch(() => {});
    userMessageQueues.clear();
  }

  async function disconnectClient(clientId) {
    const c = clients.get(clientId);
    if (c) c.paired = false;
    await persistPaired();
    await post({ t: WIRE.PAIRING_REVOKED, client_id: clientId }).catch(() => {});
    clearChat(); // 断开 = 结束这段关系，聊天记录一并清掉
    broadcast();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  async function start() {
    await loadChatLog();
    await loadPaired();
    await reconnect();
  }

  /** Alarm-driven wakeup: MV3 suspends the SW; this re-opens the stream. */
  function ensure() {
    if (status === 'connected' && eventSource) return;
    void reconnect();
  }

  return {
    start,
    ensure,
    getStatus,
    respondPairing,
    sendUserMessage,
    stopAgent,
    disconnectClient,
    queueUserMessage,
    keepOnlyPaired, // exposed for the single-tenant invariant test
  };
}
