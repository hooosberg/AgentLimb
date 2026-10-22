/**
 * AgentLimb side panel
 *
 * Two states, one responsibility each:
 *   unpaired → copy the connection prompt (that's all)
 *   paired   → the agent's chat window, with a quiet feed of what it is doing
 *
 * The panel is NOT required for control: closing it changes nothing about the
 * agent's ability to drive the browser. It is only how you *talk* to it.
 *
 * Every message sent from here carries the page you are looking at (screenshot
 * + url/title + text + interactive refs), so "translate this" needs no round
 * trip and no screenshot button.
 */

import { MESSAGE_TYPES, STORAGE_KEYS } from '../../kernel/shared/constants.js';
import { buildConnectionPrompt, detectLang } from '../../kernel/prompt/build-prompt.js';

const $ = (id) => document.getElementById(id);

const els = {
  stateUnpaired: $('state-unpaired'),
  statePaired: $('state-paired'),
  btnCopyPrompt: $('btn-copy-prompt'),
  copyFeedback: $('copy-feedback'),
  pendingBox: $('pending-box'),
  pendingDetail: $('pending-detail'),
  bridgeOffline: $('bridge-offline'),
  inputHostPath: $('input-host-path'),
  btnSavePath: $('btn-save-path'),
  clientChips: $('client-chips'),
  btnDisconnect: $('btn-disconnect'),
  chatLog: $('chat-log'),
  chatForm: $('chat-form'),
  chatInput: $('chat-input'),
  pageNote: $('page-note'),
};

let lastStatus = null;
/** How many transcript entries are already in the DOM (append-only rendering). */
let rendered = 0;

// ── status polling + broadcasts ───────────────────────────────────────────────
async function refreshStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_STATUS });
    if (response?.ok) {
      lastStatus = response;
      render();
    }
  } catch (_) {
    // SW restarting — retry on next tick
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MESSAGE_TYPES.NOTIFY_STATUS) {
    lastStatus = { ...(lastStatus || {}), ...message };
    render();
  }
  if (message.type === MESSAGE_TYPES.NOTIFY_CHAT) refreshStatus();
});

setInterval(refreshStatus, 2000);
refreshStatus();

// ── rendering ────────────────────────────────────────────────────────────────
function render() {
  const clients = lastStatus?.clients || [];
  const pending = lastStatus?.pending || [];
  const paired = clients.filter((c) => c.paired);
  const bridgeUp = lastStatus?.status === 'connected';

  if (paired.length > 0) {
    if (els.statePaired.hidden) {
      els.statePaired.hidden = false;
      els.stateUnpaired.hidden = true;
      rendered = 0; // fresh transcript mount
      void updatePageNote();
    }
    renderChips(paired, bridgeUp);
    syncChat();
    renderThinking();
  } else {
    els.statePaired.hidden = true;
    els.stateUnpaired.hidden = false;

    els.pendingBox.hidden = pending.length === 0;
    if (pending.length) {
      const p = pending[0];
      els.pendingDetail.textContent = `${p.name}（智能体软件）正在请求连接`;
    }
    els.bridgeOffline.hidden = bridgeUp;
  }
}

function renderChips(paired, connected) {
  // Single tenant: only the most recently paired client is shown, so switching
  // from software A to B never leaves a stack of stale chips behind.
  const latest = [...paired].sort((a, b) => String(b.pairedAt || '').localeCompare(String(a.pairedAt || '')))[0];
  if (!latest) return;
  const signature = `${latest.id}:${latest.name}:${connected}`;
  if (els.clientChips.dataset.sig === signature) return;
  els.clientChips.dataset.sig = signature;

  const chip = document.createElement('span');
  // Honest state: paired ≠ connected. When the agent software is not running
  // (its MCP is down) the chip must not claim it is driving the browser.
  chip.className = connected ? 'chip' : 'chip chip-offline';
  chip.innerHTML = connected
    ? `<span class="dot"></span>${escapeHtml(latest.name)}`
    : `<span class="dot"></span>${escapeHtml(latest.name)} · 未连接`;
  chip.title = connected
    ? 'AI 已连接，可以对话'
    : 'AI 的 MCP 进程没在运行，启动后会自动连上（不用重新配对）';
  els.clientChips.innerHTML = '';
  els.clientChips.appendChild(chip);
}

/**
 * The transcript is owned by the SW and is append-only; the panel just mirrors
 * whatever is new. (Full re-render on every tick would fight the scroll.)
 */
function syncChat() {
  const list = lastStatus?.chat || [];
  if (list.length < rendered) {
    els.chatLog.innerHTML = '';
    rendered = 0;
  }
  for (let i = rendered; i < list.length; i++) appendMessage(list[i]);
  rendered = list.length;
}

function appendMessage(message) {
  if (!message) return;
  const from = message.from || 'system';
  // A run of browser actions is ONE line in the conversation, not thirteen —
  // otherwise the feed drowns the chat. Click to unfold the full sequence.
  if (from === 'activity') {
    appendActivity(message.text || '');
    return;
  }
  const div = document.createElement('div');
  div.className = `msg ${from}`;
  if (message.image) {
    const img = document.createElement('img');
    img.src = message.image;
    img.alt = 'screenshot';
    div.appendChild(img);
  } else if (message.text) {
    div.textContent = message.text;
  }
  // Sent with the page attached? Say so — the user should never wonder whether
  // the agent could see what they were looking at.
  const title = message.page?.title;
  if (from === 'user' && (message.page || title)) {
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = title ? `已附带当前页面 · ${title}` : '已附带当前页面';
    div.appendChild(meta);
  }
  els.chatLog.appendChild(div);
  scrollToBottom();
}

/** Fold consecutive activity lines into a single expandable row. */
function appendActivity(text) {
  let host = els.chatLog.lastElementChild;
  if (host && (host.classList.contains('thinking') || host.classList.contains('pending-hint'))) {
    host = host.previousElementSibling;
  }
  if (!host || !host.classList.contains('activity')) {
    host = document.createElement('div');
    host.className = 'msg activity';
    host.dataset.steps = '[]';
    host.addEventListener('click', () => {
      host.dataset.open = host.dataset.open === '1' ? '0' : '1';
      paintActivity(host);
    });
    els.chatLog.appendChild(host);
  }
  const steps = JSON.parse(host.dataset.steps || '[]');
  steps.push(text);
  host.dataset.steps = JSON.stringify(steps);
  paintActivity(host);
  scrollToBottom();
}

function paintActivity(el) {
  const steps = JSON.parse(el.dataset.steps || '[]');
  const open = el.dataset.open === '1';
  if (steps.length <= 1 && !open) {
    el.textContent = steps[0] || '';
    el.classList.remove('grouped');
    return;
  }
  el.classList.add('grouped');
  if (open) {
    el.textContent = steps.map((s) => `· ${s}`).join('\n');
  } else {
    el.textContent = `执行了 ${steps.length} 步操作 · ${steps[steps.length - 1]}`;
  }
  el.title = open ? '点击收起' : steps.join('\n');
}

function scrollToBottom() {
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

/**
 * "正在思考…" — the only liveness signal when the agent is silent.
 * While a tool is running it says so instead (the agent is doing something,
 * just not typing); if nothing comes back the message is honest about it
 * rather than spinning forever.
 */
function renderThinking() {
  document.querySelectorAll('.msg.thinking, .msg.pending-hint').forEach((n) => n.remove());
  const at = lastStatus?.pendingReplyAt;
  if (!at) return;
  const age = Date.now() - at;
  const div = document.createElement('div');
  if (age < 8000) {
    div.className = 'msg thinking';
    div.innerHTML = lastStatus?.busy
      ? '<span class="dots"><i></i><i></i><i></i></span>正在操作页面…'
      : '<span class="dots"><i></i><i></i><i></i></span>正在思考…';
  } else {
    div.className = 'msg pending-hint';
    div.textContent = 'AI 没在等你——它现在没有任务在跑。这条已经排队，等它下次动手（或你让它做事）时会读到。';
  }
  els.chatLog.appendChild(div);
  scrollToBottom();
}

// ── copy prompt ───────────────────────────────────────────────────────────────
async function loadHostPath() {
  try {
    const store = await chrome.storage.local.get(STORAGE_KEYS.hostPath);
    return store[STORAGE_KEYS.hostPath] || '';
  } catch (_) {
    return '';
  }
}

els.btnCopyPrompt.addEventListener('click', async () => {
  const hostPath = (await loadHostPath()) || undefined;
  const prompt = buildConnectionPrompt({ hostPath, lang: detectLang() });
  const ok = await copyText(prompt);
  els.copyFeedback.hidden = !ok;
  els.copyFeedback.textContent = ok ? '已复制 — 去粘贴给 AI 吧' : '复制失败，请手动复制';
  if (ok) setTimeout(() => { els.copyFeedback.hidden = true; }, 2600);
});

els.btnSavePath.addEventListener('click', async () => {
  const value = els.inputHostPath.value.trim();
  await chrome.storage.local.set({ [STORAGE_KEYS.hostPath]: value });
  els.btnSavePath.textContent = '已保存';
  setTimeout(() => { els.btnSavePath.textContent = '保存'; }, 1200);
});

loadHostPath().then((p) => { els.inputHostPath.value = p; });

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    Object.assign(ta.style, { position: 'fixed', opacity: '0', top: '0', left: '0' });
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

// ── chat ──────────────────────────────────────────────────────────────────────
/** Tell the user what this message will carry, without spending a screenshot. */
async function updatePageNote() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      els.pageNote.textContent = '它会自动看到你当前标签页的内容';
      return;
    }
    const readable = /^https?:/i.test(tab.url || '');
    const title = (tab.title || tab.url || '').trim();
    els.pageNote.textContent = readable
      ? `会附带：${title.slice(0, 40)}`
      : `会附带：${title.slice(0, 40)}（这类页面读不到正文）`;
  } catch (_) {
    els.pageNote.textContent = '它会自动看到你当前标签页的内容';
  }
}

chrome.tabs?.onActivated?.addListener(() => { if (!els.statePaired.hidden) updatePageNote(); });
chrome.tabs?.onUpdated?.addListener((_id, info) => {
  if (els.statePaired.hidden) return;
  if (info.title || info.status === 'complete') updatePageNote();
});

function autoGrow() {
  const input = els.chatInput;
  input.style.height = 'auto';
  // +2px: scrollHeight rounds down, which would leave a 1px scrollbar behind.
  input.style.height = `${Math.min(input.scrollHeight + 2, 120)}px`;
  input.style.overflowY = input.scrollHeight > 120 ? 'auto' : 'hidden';
}

els.chatInput.addEventListener('input', autoGrow);

els.chatInput.addEventListener('keydown', (event) => {
  // Enter sends, Shift+Enter is a newline — the convention every chat window uses.
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    els.chatForm.requestSubmit();
  }
});

els.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  els.chatInput.value = '';
  autoGrow();
  try {
    // The SW attaches the current page (screenshot + text + refs) and pushes
    // the entry into the transcript.
    const res = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CHAT_SEND, text });
    if (res?.ok) {
      refreshStatus();
      return;
    }
    els.chatInput.value = text; // don't swallow what the user typed
    autoGrow();
    appendMessage({ from: 'system', text: explainSendError(res?.error), at: new Date().toISOString() });
  } catch (error) {
    els.chatInput.value = text;
    autoGrow();
    appendMessage({ from: 'system', text: explainSendError(error.message), at: new Date().toISOString() });
  }
});

/** Raw protocol errors are not user language — translate the two that matter. */
function explainSendError(raw) {
  const msg = String(raw || '');
  if (/bridge not connected/i.test(msg)) {
    return 'AI 还没连上——它的 MCP 进程没在运行。启动智能体软件后会自动连上，不用重新配对。';
  }
  if (/no paired AI client/i.test(msg)) {
    return '还没有配对的 AI——请先完成配对。';
  }
  return `发送失败：${msg || 'unknown'}`;
}

/**
 * Disconnect = stop talking to this AI and forget the trust. The agent is told
 * in plain words (it will not silently keep trying to drive a browser that is
 * no longer there), and the panel goes back to the copy-prompt state.
 */
els.btnDisconnect.addEventListener('click', async () => {
  const paired = (lastStatus?.clients || []).filter((c) => c.paired);
  for (const c of paired) {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.DISCONNECT_CLIENT, clientId: c.id });
  }
  rendered = 0;
  els.chatLog.innerHTML = '';
  refreshStatus();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
