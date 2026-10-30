/** Multi-client local MCP transport. Trust survives switching; one channel owns a task. */
import { BRIDGE_PORTS, DISCOVERY, STORAGE_KEYS, WIRE, USER_STOP_MESSAGE } from '../../shared/constants.js';
import { createOnboardingWindow } from '../../shared/onboarding-window.js';
import { panelState } from '../../shared/panel-state.js';
import { CHAT_RECORD_LIMIT, sanitizeChatRecord, sanitizeChatRecords } from '../../shared/chat-records.js';

const TOOL_TIMEOUT_MS = 65000;

/**
 * A reply that never comes must not leave the panel waiting forever. These are
 * deadlines, not locks: once they pass the state simply stops claiming that a
 * reply is owed, and a one-line system note explains it. Settling on read
 * (instead of with timers) matters because an MV3 worker loses its timers when
 * it sleeps — and a worker that is sleeping is exactly when this happens.
 */
const REPLY_TIMEOUT_MS = 60000;
const STOP_TIMEOUT_MS = 20000;
const TASK_IDLE_MS = 30000;

/** Exported so tests and the panel monkey can assert "nothing is owed past this". */
export const PANEL_WAIT_LIMITS = { replyMs: REPLY_TIMEOUT_MS, stopMs: STOP_TIMEOUT_MS, taskIdleMs: TASK_IDLE_MS };

/**
 * @param discoveryIntervalMs pin the scan cadence (tests / diagnostics).
 *        Omit it in production: the cadence adapts to whether anything is
 *        connected yet — see DISCOVERY in shared/constants.js.
 * @param ports override the scan range (tests use TEST_BRIDGE_PORTS so a real
 *        browser in the same machine cannot attach to a test host).
 */
export function createBridgeClient({ onStatus, onToolCall, onAgentMessage, discoveryIntervalMs, ports } = {}) {
  const candidates = ports?.length ? ports : BRIDGE_PORTS;
  const onboarding = createOnboardingWindow(chrome.storage.local);
  const clients = new Map();
  const channels = new Map(); // port -> {source, browserId, clientId, online}
  // Clients that connected but were not trusted: shown in the panel so the user
  // knows one Copy click is all that is missing. Never persisted.
  const unauthorized = new Map();
  const userMessageQueues = new Map();
  const transcripts = {};
  const chatLog = [];
  const waitingTools = new Map();
  let preferredNext = null;
  let activeChannel = null;
  let selectedId = null;
  let rememberedId = null;
  let pendingReplyAt = null;
  let activeTools = 0;
  /**
   * Channels with an open task. A task opens when the agent drives the browser
   * and closes only when that agent says it is done (`say`) — so a sequence of
   * tool calls holds control, and another AI's calls queue behind it.
   *
   * Per channel, not a single boolean: the old boolean leaked whenever the
   * channel that opened the task was no longer the active one (control had
   * moved on) and then dropped, which pinned the panel to "operating" forever.
   */
  const taskChannels = new Set();
  /** Channels with a browser-driving tool literally in flight right now. */
  const operatingChannels = new Set();
  /** Timestamp when a channel in taskChannels finished its last in-flight tool. */
  const taskIdleAt = new Map();
  let sending = false;
  let stopRequest = null;
  let stopRequestedAt = 0;
  let connectionEpoch = 0;
  let toolChain = Promise.resolve();
  let scanPromise;
  let discoveryTimer = null;
  let stopped = false;
  let browserIdentity = { id: `Profile-${crypto.randomUUID().slice(0, 6)}`, label: '' };

  async function resolveAutoProfileLabel() {
    try {
      if (chrome.identity?.getProfileUserInfo) {
        const info = await new Promise((resolve) => chrome.identity.getProfileUserInfo((u) => resolve(u || {})));
        if (info?.email) return info.email;
      }
    } catch (_) { /* identity permission optional */ }
    return '';
  }

  function effectiveBrowserIdentity() {
    const id = browserIdentity.id || 'Profile-default';
    const label = (browserIdentity.label || '').trim() || id;
    return { id, label };
  }

  const live = (channel) => channel?.online && channels.get(channel.port) === channel;
  const channelFor = (id) => live(activeChannel) && activeChannel.clientId === id ? activeChannel
    : [...channels.values()].find((channel) => live(channel) && channel.clientId === id);
  // Only a running task locks the browser. "Waiting for a reply" is a hint: the
  // agent may never answer, and locking control on it is what made the panel
  // (and AI switching) freeze after a side-panel message.
  const locked = () => activeTools > 0 || taskChannels.size > 0 || operatingChannels.size > 0 || sending;

  function persistChat() {
    if (selectedId) transcripts[selectedId] = chatLog.slice();
    chrome.storage.local.set({ [STORAGE_KEYS.chatLog]: chatLog.slice(), [STORAGE_KEYS.chatLogs]: { ...transcripts } }).catch(() => {});
  }
  function pushChat(entry, id = selectedId) {
    const clean = sanitizeChatRecord(entry);
    if (!clean || !id) return;
    if (id === selectedId) {
      chatLog.push(clean);
      if (chatLog.length > CHAT_RECORD_LIMIT) chatLog.splice(0, chatLog.length - CHAT_RECORD_LIMIT);
    } else transcripts[id] = [...(transcripts[id] || []), clean].slice(-CHAT_RECORD_LIMIT);
    persistChat();
    return clean;
  }
  function clearChat() {
    pendingReplyAt = null; stopRequest = null; stopRequestedAt = 0;
    chatLog.length = 0;
    persistChat();
  }
  /**
   * Called before every status snapshot. If the agent never answered, stop
   * claiming it owes an answer — with a note so the user knows why the panel
   * unblocked instead of wondering.
   */
  function settleWaits() {
    const now = Date.now();
    if (pendingReplyAt != null && now - pendingReplyAt > REPLY_TIMEOUT_MS) {
      pendingReplyAt = null;
      pushChat({ from: 'system', text: 'AI 还没有回复。消息已经送到，它下次操作时会看到；你可以继续发送。', at: new Date().toISOString() });
    }
    if (stopRequest && now - stopRequestedAt > STOP_TIMEOUT_MS) {
      stopRequest = null; stopRequestedAt = 0;
      pushChat({ from: 'system', text: '停止请求已发出，但没有收到确认。你可以继续操作。', at: new Date().toISOString() });
    }
    for (const channel of [...taskChannels]) {
      if (!operatingChannels.has(channel)) {
        const idleSince = taskIdleAt.get(channel);
        if (idleSince != null && now - idleSince > TASK_IDLE_MS) {
          taskChannels.delete(channel);
          taskIdleAt.delete(channel);
        }
      }
    }
  }
  async function loadState() {
    try {
      const savedIdentity = (await chrome.storage.local.get(STORAGE_KEYS.browserIdentity))[STORAGE_KEYS.browserIdentity];
      if (savedIdentity && typeof savedIdentity === 'object' && savedIdentity.id) {
        browserIdentity = { id: String(savedIdentity.id), label: String(savedIdentity.label || '').trim() };
      } else {
        const autoLabel = await resolveAutoProfileLabel();
        browserIdentity = { id: browserIdentity.id, label: autoLabel || browserIdentity.id };
        await chrome.storage.local.set({ [STORAGE_KEYS.browserIdentity]: browserIdentity }).catch(() => {});
      }
      if (!browserIdentity.label) {
        const autoLabel = await resolveAutoProfileLabel();
        if (autoLabel) {
          browserIdentity = { ...browserIdentity, label: autoLabel };
          await chrome.storage.local.set({ [STORAGE_KEYS.browserIdentity]: browserIdentity }).catch(() => {});
        }
      }
      const paired = (await chrome.storage.local.get(STORAGE_KEYS.pairedClients))[STORAGE_KEYS.pairedClients] || {};
      for (const [id, info] of Object.entries(paired)) clients.set(id, { ...info, id, paired: true });
      rememberedId = (await chrome.storage.local.get(STORAGE_KEYS.lastClient))[STORAGE_KEYS.lastClient] || null;
      const saved = (await chrome.storage.local.get(STORAGE_KEYS.chatLogs))[STORAGE_KEYS.chatLogs];
      if (saved && typeof saved === 'object') for (const [id, records] of Object.entries(saved)) transcripts[id] = sanitizeChatRecords(records);
      const legacy = (await chrome.storage.local.get(STORAGE_KEYS.chatLog))[STORAGE_KEYS.chatLog];
      if (rememberedId && !transcripts[rememberedId]) transcripts[rememberedId] = sanitizeChatRecords(legacy);
      const fallbackId = (rememberedId && clients.get(rememberedId)?.paired)
        ? rememberedId
        : visibleClients().find((c) => c.paired)?.id || null;
      if (!selectedId && fallbackId) {
        selectedId = fallbackId;
        rememberedId = fallbackId;
        chatLog.splice(0, chatLog.length, ...sanitizeChatRecords(transcripts[selectedId] || legacy));
      }
    } catch (_) { /* unavailable storage */ }
  }

  async function setBrowserLabel(rawLabel) {
    const clean = String(rawLabel ?? '').trim();
    const autoLabel = clean ? '' : await resolveAutoProfileLabel();
    browserIdentity = {
      id: browserIdentity.id,
      label: clean || autoLabel || browserIdentity.id,
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.browserIdentity]: browserIdentity }).catch(() => {});
    for (const channel of channels.values()) {
      if (live(channel) && channel.clientId && clients.get(channel.clientId)?.paired) {
        const record = clients.get(channel.clientId);
        void post({ t: WIRE.GRANT, ok: true, name: record.name, browser: effectiveBrowserIdentity() }, channel).catch(() => {});
      }
    }
    broadcast();
    return { ok: true, browserIdentity: effectiveBrowserIdentity() };
  }

  /**
   * One row per AI *software* in the panel, not per historical identity.
   *
   * A client's id comes from a file under ~/.agentlimb. When that folder is reset
   * (reinstall, moved to Trash, a second machine) the id changes while the
   * software name and kind stay the same — so the panel grew a row per reinstall
   * and showed "WorkBuddy AI" three times, all offline. To the user that is one
   * AI, so the panel must show one row.
   *
   * Identities are NOT deleted. Every one of them still holds saved trust, and
   * dropping one would force a re-pairing for a process that is running right
   * now. Collapsing happens on read instead: a live identity always wins,
   * otherwise the most recently paired one represents the software.
   *
   * A client with a live channel is always listed as itself, even when it is not
   * paired yet — that is exactly the "connected but waiting for one Copy" case
   * the panel has to show.
   */
  function visibleClients() {
    const keyOf = (client) => `${String(client.name || client.id)}\u0000${String(client.kind || 'generic')}`;
    const pending = [];
    const best = new Map();
    for (const client of clients.values()) {
      const live = !!channelFor(client.id);
      // Connected but not paired yet: always its own row, that is the
      // "waiting for one Copy click" case the panel must show.
      if (live && !client.paired) { pending.push(client); continue; }
      if (!client.paired) continue;
      const at = Date.parse(client.pairedAt || '') || 0;
      const seen = best.get(keyOf(client));
      if (!seen || (live && !seen.live) || (live === seen.live && at >= seen.at)) {
        best.set(keyOf(client), { client, live, at });
      }
    }
    return [...pending, ...[...best.values()].map((entry) => entry.client)];
  }

  async function persistPaired() {
    // Bounded, newest first, but never evicting an identity that is connected
    // right now — that would silently revoke a live session's trust.
    const kept = [...clients.values()]
      .filter((client) => client.paired)
      .sort((a, b) => (Date.parse(b.pairedAt || '') || 0) - (Date.parse(a.pairedAt || '') || 0));
    const records = {};
    for (const client of kept) {
      if (Object.keys(records).length >= 10 && !channelFor(client.id)) continue;
      records[client.id] = { id: client.id, name: client.name, kind: client.kind, pairedAt: client.pairedAt };
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.pairedClients]: records });
  }
  function getStatus() {
    settleWaits();
    const connected = live(activeChannel) && clients.get(selectedId)?.paired;
    const anyOnline = [...channels.values()].some(live);
    let browsers = 1;
    let browserList = [];
    for (const channel of channels.values()) {
      if (live(channel)) {
        if (channel.browsers > browsers) browsers = channel.browsers;
        if (Array.isArray(channel.browserList) && channel.browserList.length > browserList.length) {
          browserList = channel.browserList;
        }
      }
    }
    return {
      status: anyOnline ? 'connected' : 'disconnected',
      port: connected ? activeChannel.port : null,
      connectedClientId: connected ? selectedId : null,
      browserIdentity: effectiveBrowserIdentity(),
      browsers,
      browserList,
      clients: visibleClients().map((client) => ({ ...client, online: !!channelFor(client.id),
        waiting: preferredNext?.clientId === client.id || [...waitingTools.values()].some((item) => item.channel.clientId === client.id) })),
      unauthorized: [...unauthorized.values()],
      chat: chatLog.slice(), pendingReplyAt, busy: activeTools > 0, operating: taskChannels.size > 0 || operatingChannels.size > 0, sending, stopRequested: !!stopRequest,
    };
  }
  function broadcast() {
    const snapshot = getStatus();
    onStatus?.(snapshot);
    chrome.runtime.sendMessage({ type: 'AGENTLIMB_NOTIFY_STATUS', ...snapshot }).catch(() => {});
  }
  function activate(channel) {
    if (!live(channel) || !clients.get(channel.clientId)?.paired) return false;
    if (activeChannel === channel && selectedId === channel.clientId) return true;
    persistChat();
    connectionEpoch++;
    activeChannel = channel;
    selectedId = channel.clientId;
    rememberedId = selectedId;
    const target = clients.get(selectedId);
    if (!transcripts[selectedId]?.length && target) {
      const sibling = [...clients.values()].find((other) => other.paired
        && other.id !== selectedId
        && String(other.name || other.id) === String(target.name || target.id)
        && String(other.kind || 'generic') === String(target.kind || 'generic')
        && transcripts[other.id]?.length);
      if (sibling) transcripts[selectedId] = transcripts[sibling.id].slice();
    }
    pendingReplyAt = null; stopRequest = null; stopRequestedAt = 0; sending = false; taskChannels.clear(); operatingChannels.clear(); taskIdleAt.clear();
    chatLog.splice(0, chatLog.length, ...sanitizeChatRecords(transcripts[selectedId]));
    chrome.storage.local.set({ [STORAGE_KEYS.lastClient]: selectedId }).catch(() => {});
    broadcast();
    return true;
  }
  function selectClient(id) {
    settleWaits();
    const channel = channelFor(id);
    if (!clients.get(id)?.paired || !channel) return { ok: false, error: 'AI is offline. Open its software to reconnect.' };
    if (channel === activeChannel) return { ok: true };
    if (locked()) return { ok: false, error: 'Current AI is busy. Wait for its reply, or request Stop before switching.' };
    activate(channel);
    // This AI may have queued work from while it was waiting for control.
    drainWaiting();
    return { ok: true };
  }
  function chooseAvailable() {
    if (live(activeChannel)) return;
    if (locked() && activeTools > 0) return;
    const channel = channelFor(rememberedId) || [...channels.values()].find((c) => live(c) && clients.get(c.clientId)?.paired);
    if (channel) activate(channel);
  }
  async function post(frame, channel = activeChannel) {
    if (!live(channel)) throw new Error('bridge not connected');
    const response = await fetch(`http://127.0.0.1:${channel.port}/api/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ b: channel.browserId, ...frame }),
    });
    if (!response.ok) throw new Error(`bridge POST ${response.status}`);
    return response.json().catch(() => ({}));
  }
  function discardWaiting(channel, error) {
    for (const [id, item] of waitingTools) if (item.channel === channel) {
      clearTimeout(item.timer); waitingTools.delete(id);
      void post({ t: WIRE.TOOL_RESULT, tool_use_id: id, ok: false, error }, channel).catch(() => {});
    }
  }
  function dropChannel(channel) {
    if (channels.get(channel.port) !== channel) return;
    channel.online = false;
    channel.source.close();
    channels.delete(channel.port);
    // Whatever this channel was doing stops counting: a tool that was running
    // here can no longer report a result, so leaving it in the set would pin
    // the whole panel to "operating" forever.
    taskChannels.delete(channel); operatingChannels.delete(channel); taskIdleAt.delete(channel);
    discardWaiting(channel, 'AI connection closed; queued action was not executed');
    if (channel.clientId) unauthorized.delete(channel.clientId);
    if (preferredNext === channel) preferredNext = null;
    if (activeChannel === channel) {
      persistChat(); connectionEpoch++; activeChannel = null;
      pendingReplyAt = null; sending = false; stopRequest = null; stopRequestedAt = 0;
      // The outbox SURVIVES a drop. Most drops are transient (the MV3 worker was
      // suspended, the SSE stream was torn down), and a message the user typed
      // must still reach the agent when it comes back — otherwise it silently
      // disappears. Only an explicit "remove this AI" clears the queue.
    }
    drainWaiting(); chooseAvailable(); broadcast();
  }
  async function probe(candidate) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISCOVERY.PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`http://127.0.0.1:${candidate}/health`, { signal: controller.signal });
      const body = response.ok ? await response.json() : null;
      return body?.service === 'agentlimb-bridge' ? body : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }
  async function discover() {
    if (stopped) return;
    if (scanPromise) return scanPromise;
    scanPromise = (async () => {
      const results = await Promise.all(candidates.map(async (port) => ({ port, health: await probe(port) })));
      if (stopped) return;
      for (const { port, health } of results) {
        const existing = channels.get(port);
        if (!health) { if (existing) dropChannel(existing); continue; }
        if (existing) {
          existing.browsers = health.browsers || 1;
          existing.browserList = Array.isArray(health.browserList) ? health.browserList : [];
        }
        if (existing && health.client?.id && existing.clientId && health.client.id !== existing.clientId) dropChannel(existing);
        // Old bridge fixtures have no identity; only the first candidate is meaningful.
        if (!channels.has(port) && (health.client?.id || port === candidates[0])) {
          const ch = openStream(port);
          if (ch) {
            ch.browsers = health.browsers || 1;
            ch.browserList = Array.isArray(health.browserList) ? health.browserList : [];
          }
        }
      }
      chooseAvailable(); broadcast();
    })().finally(() => { scanPromise = null; });
    return scanPromise;
  }
  function openStream(port) {
    const channel = { port, browserId: crypto.randomUUID(), clientId: null, online: false, source: null };
    const source = channel.source = new EventSource(`http://127.0.0.1:${port}/events?b=${channel.browserId}`);
    channels.set(port, channel);
    source.onopen = () => { if (channels.get(port) !== channel) return; channel.online = true; broadcast(); };
    source.onmessage = (event) => {
      if (!live(channel)) return;
      let frame; try { frame = JSON.parse(event.data); } catch { return; }
      void handleFrame(frame, channel).catch((error) => console.warn('[bridge] frame error', error));
    };
    source.onerror = () => { dropChannel(channel); if (!stopped) setTimeout(() => { void discover(); }, DISCOVERY.RETRY_MS); };
  }
  function drainWaiting() {
    settleWaits();
    if (locked()) return;
    if (preferredNext && live(preferredNext) && clients.get(preferredNext.clientId)?.paired) activate(preferredNext);
    preferredNext = null;
    const item = waitingTools.values().next().value;
    if (!item) { chooseAvailable(); return; }
    waitingTools.delete(item.frame.tool_use_id); clearTimeout(item.timer);
    if (item.deadline <= Date.now() || !live(item.channel) || !clients.get(item.channel.clientId)?.paired) {
      // The queue's own timer normally reports this. When control becomes free
      // first, the timer is cleared above — so the answer must be sent here, or
      // the host's tool call hangs until its own timeout with no explanation.
      const reason = item.deadline <= Date.now()
        ? 'queued action expired; it was not executed'
        : 'AI connection closed; queued action was not executed';
      void post({ t: WIRE.TOOL_RESULT, tool_use_id: item.frame.tool_use_id, ok: false, error: reason }, item.channel).catch(() => {});
      drainWaiting(); return;
    }
    activate(item.channel);
    dispatchTool(item.frame, item.channel, item.deadline);
    for (const [id, next] of waitingTools) if (next.channel === item.channel) {
      waitingTools.delete(id); clearTimeout(next.timer);
      dispatchTool(next.frame, next.channel, next.deadline);
    }
    broadcast();
  }
  function dispatchTool(frame, channel, deadline) {
    const { tool_use_id, tool, args, tabId } = frame;
    const epoch = connectionEpoch;
    const drivesBrowser = tool !== 'ping';
    if (drivesBrowser) { taskChannels.add(channel); operatingChannels.add(channel); taskIdleAt.delete(channel); activeTools++; }
    broadcast();
    toolChain = toolChain.then(async () => {
      let result; let error;
      try {
        if (!live(channel) || !clients.get(channel.clientId)?.paired) throw new Error('browser connection changed');
        if (Date.now() >= deadline) throw new Error('queued action expired; it was not executed');
        if (drivesBrowser && (epoch !== connectionEpoch || activeChannel !== channel)) throw new Error('browser control changed');
        result = await onToolCall({ tool, args: args || {}, tabId, timeoutMs: Math.max(1, Math.min(TOOL_TIMEOUT_MS, deadline - Date.now())) });
      } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
      const userMessages = epoch === connectionEpoch && activeChannel === channel ? drainUserMessages(channel.clientId) : [];
      await post({ t: WIRE.TOOL_RESULT, tool_use_id, ok: !error, result, error, userMessages }, channel).catch(() => {});
      if (drivesBrowser) {
        operatingChannels.delete(channel);
        activeTools--;
        if (taskChannels.has(channel) && !operatingChannels.has(channel)) taskIdleAt.set(channel, Date.now());
      }
      drainWaiting(); chooseAvailable(); broadcast();
    });
  }
  async function handleFrame(frame, channel) {
    switch (frame.t) {
      case WIRE.HELLO: {
        const client = frame.client;
        if (!client?.id) return;
        channel.clientId = client.id;
        const known = clients.get(client.id);
        const record = { id: client.id, name: client.name || 'AI Agent', kind: client.kind || 'generic',
          paired: known?.paired === true, pairedAt: known?.pairedAt };
        clients.set(client.id, record);
        // Trust is either remembered from an earlier session, or granted by the
        // 30-minute window that clicking Copy opened. There is no approval page.
        // A remembered client that merely reconnects must NOT steal the chat
        // window from whoever owns it — only a fresh grant takes over.
        const remembered = record.paired;
        // Installing the host is the user's consent: by default a local MCP host
        // that connects is trusted without any click. The copy-prompt window is
        // only the stricter mode, for users who switch auto-authorize off.
        const auto = !remembered && (await chrome.storage.local.get(STORAGE_KEYS.autoTrust))[STORAGE_KEYS.autoTrust] !== false;
        const isSameClient = client.id === selectedId || (activeChannel && activeChannel.clientId === client.id);
        const takeOver = !remembered || isSameClient || !live(activeChannel);
        if (remembered || auto || await onboarding.consume()) {
          await trust(record, channel, { takeOver });
        } else {
          unauthorized.set(client.id, { id: client.id, name: record.name, kind: record.kind, at: new Date().toISOString() });
          await post({ t: WIRE.GRANT, ok: false, reason: 'not_authorized', browser: effectiveBrowserIdentity() }, channel).catch(() => {});
        }
        chooseAvailable(); broadcast(); break;
      }
      case WIRE.TOOL_CALL: {
        if (frame.client_id !== channel.clientId || !clients.get(channel.clientId)?.paired) {
          await post({ t: WIRE.TOOL_RESULT, tool_use_id: frame.tool_use_id, ok: false, error: 'AI client is not connected and paired' }, channel); return;
        }
        settleWaits();
        const deadline = Math.min(Number.isFinite(frame.deadline) ? frame.deadline : Date.now() + TOOL_TIMEOUT_MS, Date.now() + TOOL_TIMEOUT_MS);
        if (frame.tool !== 'ping' && activeChannel !== channel) {
          const sameClient = (live(activeChannel) && activeChannel.clientId === channel.clientId) || channel.clientId === selectedId;
          const noLiveOwner = !live(activeChannel);
          if (!locked() || (activeTools === 0 && !sending && (sameClient || noLiveOwner))) {
            activate(channel);
          } else {
            if (deadline <= Date.now()) return;
            const timer = setTimeout(() => {
              waitingTools.delete(frame.tool_use_id);
              void post({ t: WIRE.TOOL_RESULT, tool_use_id: frame.tool_use_id, ok: false, error: 'browser busy; queued action expired without execution' }, channel).catch(() => {});
              broadcast();
            }, deadline - Date.now());
            waitingTools.set(frame.tool_use_id, { frame, channel, deadline, timer }); broadcast(); return;
          }
        }
        dispatchTool(frame, channel, deadline); break;
      }
      case WIRE.AGENT_MESSAGE: {
        if (!clients.get(channel.clientId)?.paired) return;
        pushChat({ from: 'agent', text: frame.text, at: frame.at || new Date().toISOString() }, channel.clientId);
        if (channel === activeChannel) {
          // `say` is the agent saying its task is done: that closes the task and
          // releases both the lock and anything queued behind it.
          pendingReplyAt = null; taskChannels.delete(channel); operatingChannels.delete(channel); taskIdleAt.delete(channel);
          stopRequest = null; stopRequestedAt = 0;
          userMessageQueues.delete(channel.clientId);
        } else discardWaiting(channel, 'AI finished its task before taking control; queued action was not executed');
        drainWaiting(); broadcast(); break;
      }
      case WIRE.USER_MESSAGE: onAgentMessage?.(frame); break;
      case WIRE.PING: await post({ t: WIRE.PONG, at: new Date().toISOString() }, channel).catch(() => {}); break;
      case WIRE.REVOKED: await disconnectClient(channel.clientId); break;
    }
  }
  /**
   * Save trust for one client and answer its HELLO.
   * `takeOver` is true only for a grant the user just made; a client that
   * merely reconnected with saved trust waits for the chat to become free.
   */
  async function trust(record, channel, { takeOver = true } = {}) {
    const firstTime = !record.paired;
    record.paired = true;
    record.pairedAt = record.pairedAt || new Date().toISOString();
    clients.set(record.id, record);
    unauthorized.delete(record.id);
    if (firstTime) {
      await persistPaired();
      pushChat({ from: 'system', text: `已连接到 ${record.name}。请直接在 AI 工具中下达浏览器指令，AI 的操作回复会同步显示在这里。`, at: new Date().toISOString() }, record.id);
    }
    const delivered = await post({ t: WIRE.GRANT, ok: true, name: record.name, browser: effectiveBrowserIdentity() }, channel)
      .then(() => true).catch(() => false);
    // If the answer never reaches the host, the panel would sit on "connected"
    // while the agent stays blocked forever. Drop the channel instead:
    // discovery re-opens it and the handshake simply runs again.
    if (!delivered) { dropChannel(channel); return; }
    if (takeOver) {
      const sameClient = channel.clientId && (channel.clientId === selectedId || (activeChannel && activeChannel.clientId === channel.clientId));
      const canActivate = !locked() || (activeTools === 0 && !sending && (sameClient || !live(activeChannel)));
      if (canActivate) {
        activate(channel);
        drainWaiting();
      } else {
        preferredNext = channel;
      }
    }
  }
  /**
   * Clicking Copy is the whole authorization step: open the window for the next
   * unknown AI, and immediately trust any AI that is already connected and
   * waiting for it (the user just answered the agent's "not authorized" error).
   */
  async function openOnboarding() {
    const window = await onboarding.open();
    const waiting = [...channels.values()].filter((channel) =>
      live(channel) && channel.clientId && clients.get(channel.clientId) && !clients.get(channel.clientId).paired);
    for (const channel of waiting) await trust(clients.get(channel.clientId), channel);
    broadcast();
    return window;
  }
  // ── panel chat ─────────────────────────────────────────────────────────────
  async function sendUserMessage(text, collectPage) {
    if (!text || !text.trim()) return { ok: false, error: 'empty message' };
    const status = getStatus();
    const state = panelState(status);
    const fallbackClient = !state.connected
      ? (status.clients || []).find((c) => c.paired && c.id === (selectedId || rememberedId))
        || (status.clients || []).find((c) => c.paired)
      : null;
    const targetClient = state.client || fallbackClient;
    if (!targetClient) return { ok: false, error: 'bridge not connected' };
    if (sending) return { ok: false, error: 'A message is already being sent' };
    // Reserve synchronously BEFORE querying/screenshotting the page. Multiple
    // panels and rapid Enter presses share this one backend lock.
    sending = true;
    const wasLive = state.connected;
    const epoch = connectionEpoch;
    const clientId = targetClient.id;
    if (!selectedId) selectedId = clientId;
    broadcast();
    let message;
    let entry;
    try {
      const page = typeof collectPage === 'function' ? await collectPage() : collectPage;
      if (epoch !== connectionEpoch || !clients.get(clientId)?.paired || (wasLive && !panelState(getStatus()).connected)) {
        throw new Error('bridge not connected');
      }
      // Typing while the agent drives the browser (or between per-turn MCP
      // invocations) is normal — in the agent's own chat box it queues, and
      // here it does the same: the host delivers it with the next tool result.
      message = { text: text.trim(), at: new Date().toISOString(), ...(page ? { page } : {}) };
      entry = pushChat({ from: 'user', text: message.text, at: message.at,
        ...(page ? { page: { title: page.title, url: page.url, restricted: page.restricted } } : {}) }, clientId);
      pendingReplyAt = Date.now();
      queueUserMessage(clientId, message);
      broadcast();
      if (live(activeChannel)) {
        const response = await post({ t: WIRE.USER_MESSAGE, ...message });
        if (response.ok === false) throw new Error(response.error || 'message rejected');
      }
      return { ok: true };
    } catch (error) {
      if (epoch === connectionEpoch) {
        pendingReplyAt = null;
        userMessageQueues.delete(clientId);
        const index = chatLog.indexOf(entry);
        if (index >= 0) { chatLog.splice(index, 1); persistChat(); }
      }
      return { ok: false, error: error.message };
    } finally {
      if (epoch === connectionEpoch) sending = false;
      broadcast();
    }
  }

  /** A cooperative, plain-language request; it never cancels a tool or trust. */
  async function requestStop() {
    const state = panelState(getStatus());
    if (!state.connected) return { ok: false, error: 'bridge not connected' };
    if (stopRequest) return { ok: true, alreadyRequested: true };
    if (!state.canStop) return { ok: false, error: 'no task to stop' };
    const message = { text: USER_STOP_MESSAGE, at: new Date().toISOString() };
    const epoch = connectionEpoch;
    stopRequest = message; // reserve before any await: rapid clicks send once
    stopRequestedAt = Date.now();
    const entry = pushChat({ from: 'user', text: '请停止当前操作。', at: message.at });
    queueUserMessage(state.client.id, message);
    broadcast();
    try {
      const response = await post({ t: WIRE.USER_MESSAGE, ...message });
      if (response.ok === false) throw new Error(response.error || 'message rejected');
      return { ok: true };
    } catch (error) {
      if (epoch === connectionEpoch) {
        if (stopRequest === message) { stopRequest = null; stopRequestedAt = 0; }
        const queue = userMessageQueues.get(state.client.id) || [];
        userMessageQueues.set(state.client.id, queue.filter((item) => item !== message));
        const index = chatLog.indexOf(entry);
        if (index >= 0) { chatLog.splice(index, 1); persistChat(); }
        broadcast();
      }
      return { ok: false, error: error.message };
    }
  }

  function queueUserMessage(clientId, message) {
    const queue = userMessageQueues.get(clientId) || [];
    const entry = typeof message === 'string'
      ? { text: message, at: new Date().toISOString() }
      : message;
    // The host echoes our own USER_MESSAGE back over SSE; dedupe on (at, text)
    // so the agent doesn't receive the same message twice.
    if (!queue.some((m) => m.at === entry.at && m.text === entry.text)) queue.push(entry);
    // Bounded: the panel keeps a similar number of records, and an agent that
    // never comes back must not grow the queue forever.
    if (queue.length > CHAT_RECORD_LIMIT) queue.splice(0, queue.length - CHAT_RECORD_LIMIT);
    userMessageQueues.set(clientId, queue);
  }

  function drainUserMessages(clientId) {
    const queue = userMessageQueues.get(clientId);
    if (!queue || !queue.length) return [];
    userMessageQueues.delete(clientId);
    return queue;
  }

  async function disconnectClient(clientId) {
    const client = clients.get(clientId);
    if (!client) return { ok: false, error: 'Unknown AI' };
    // "Remove this AI" means the software, not one historical identity of it.
    // Otherwise removing the visible row just promotes a duplicate that was
    // hidden behind it, and the user has to click Remove again.
    const siblings = [...clients.values()].filter((other) => other.paired
      && other.id !== clientId
      && String(other.name || other.id) === String(client.name || client.id)
      && String(other.kind || 'generic') === String(client.kind || 'generic'));
    const targets = [...channels.values()].filter((channel) => channel.clientId === clientId
      || siblings.some((sibling) => sibling.id === channel.clientId));
    client.paired = false;
    unauthorized.delete(clientId);
    for (const channel of targets) {
      discardWaiting(channel, 'AI authorization removed; queued action was not executed');
      await post({ t: WIRE.REVOKED, client_id: channel.clientId }, channel).catch(() => {});
    }
    userMessageQueues.delete(clientId);
    delete transcripts[clientId];
    if (selectedId === clientId || siblings.some((s) => s.id === selectedId)) {
      clearChat();
      delete transcripts[clientId];
      activeChannel = null;
      selectedId = null;
      connectionEpoch++;
      taskChannels.clear();
      operatingChannels.clear();
      taskIdleAt.clear();
      sending = false;
      stopRequest = null;
      stopRequestedAt = 0;
    }
    clients.delete(clientId);
    for (const sibling of siblings) {
      userMessageQueues.delete(sibling.id);
      delete transcripts[sibling.id];
      clients.delete(sibling.id);
      if (preferredNext?.clientId === sibling.id) preferredNext = null;
    }
    if (preferredNext?.clientId === clientId) preferredNext = null;
    await persistPaired(); persistChat(); chooseAvailable(); broadcast();
    return { ok: true };
  }
  /**
   * Scan cadence. Tool calls arrive over the open SSE stream, so a connected
   * browser does not need fast scanning — only a fast scan while nothing is
   * connected yet, because that wait sits directly between "paste the prompt"
   * and "it works".
   */
  function nextScanDelay() {
    if (discoveryIntervalMs != null) return discoveryIntervalMs;
    return [...channels.values()].some(live) ? DISCOVERY.IDLE_MS : DISCOVERY.HUNT_MS;
  }
  function scheduleScan() {
    clearTimeout(discoveryTimer);
    discoveryTimer = null;
    const delay = nextScanDelay();
    if (stopped || !(delay > 0) || !chrome.runtime?.id) return;
    discoveryTimer = setTimeout(() => {
      discoveryTimer = null;
      discover().catch(() => {}).finally(scheduleScan);
    }, delay);
  }
  async function start() {
    stopped = false;
    await loadState();
    await discover();
    scheduleScan();
  }
  function stop() {
    stopped = true;
    clearTimeout(discoveryTimer);
    discoveryTimer = null;
    for (const item of waitingTools.values()) clearTimeout(item.timer);
    waitingTools.clear();
    for (const channel of [...channels.values()]) dropChannel(channel);
  }
  function ensure() { return discover(); }
  return { start, stop, ensure, discover, selectClient, getStatus, openOnboarding, closeOnboarding: onboarding.close,
    sendUserMessage, requestStop, disconnectClient, queueUserMessage, setBrowserLabel };
}
