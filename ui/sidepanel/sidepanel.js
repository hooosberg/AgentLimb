/**
 * AgentLimb side panel
 *
 * Two states, one responsibility each:
 *   unpaired → copy the connection prompt (that's all)
 *   paired   → a chat window ON the agent, plus a live feed of what it does
 *
 * The panel is NOT required for control. Opening it only checks pairing state.
 * Every message the user sends carries the current page (text + interactive
 * refs) so the agent can answer "translate this" without a round trip.
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
  btnStop: $('btn-stop'),
};

let lastStatus = null;
let chatSignature = '';

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
  if (message.type === MESSAGE_TYPES.NOTIFY_CHAT) {
    refreshStatus();
  }
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
    els.stateUnpaired.hidden = true;
    els.statePaired.hidden = false;
    renderChips(paired, bridgeUp);
    syncChat();
    renderThinking();
  } else {
    els.stateUnpaired.hidden = false;
    els.statePaired.hidden = true;

    els.pendingBox.hidden = pending.length === 0;
    if (pending.length) {
      const p = pending[0];
      els.pendingDetail.textContent = `${p.name}（智能体软件）正在请求连接`;
    }
    els.bridgeOffline.hidden = bridgeUp;
  }
}

function renderChips(paired, connected) {
  els.clientChips.innerHTML = '';
  // Single tenant: only the most recently paired client is shown, so switching
  // from software A to B never leaves a stack of stale chips behind.
  const latest = [...paired].sort((a, b) => String(b.pairedAt || '').localeCompare(String(a.pairedAt || '')))[0];
  if (!latest) return;
  const chip = document.createElement('span');
  // Honest state: paired ≠ connected. When the agent software is not running
  // (its MCP is down) the chip must not claim it is driving the browser.
  chip.className = connected ? 'chip' : 'chip chip-offline';
  chip.innerHTML = connected
    ? `<span class="dot"></span>正在与 ${escapeHtml(latest.name)} 驱动浏览器`
    : `<span class="dot"></span>已配对 · 等待 ${escapeHtml(latest.name)} 连接`;
  chip.title = connected ? 'AI 已连接，可以下指令' : 'AI 的 MCP 进程没在运行，启动后会自动连上（不用重新配对）';
  els.clientChips.appendChild(chip);
}

/** The SW owns the transcript; the panel just mirrors it (survives close/reopen). */
function syncChat() {
  const list = lastStatus?.chat || [];
  const last = list[list.length - 1];
  const sig = `${list.length}:${last?.at || ''}:${last?.text || ''}`;
  if (sig === chatSignature) return;
  chatSignature = sig;
  els.chatLog.innerHTML = '';
  for (const entry of list) appendMessage(entry);
}

function appendMessage(message) {
  if (!message) return;
  const div = document.createElement('div');
  const from = message.from || 'system';
  div.className = `msg ${from}`;
  if (message.image) {
    const img = document.createElement('img');
    img.src = message.image;
    img.alt = 'screenshot';
    div.appendChild(img);
  } else if (message.text) {
    div.textContent = message.text;
  }
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

/**
 * "正在思考…" — the only liveness signal when the agent is silent.
 * Sent → dots; no answer after 40s → an honest hint instead of spinning forever.
 */
function renderThinking() {
  document.querySelectorAll('.msg.thinking, .msg.pending-hint').forEach((n) => n.remove());
  const at = lastStatus?.pendingReplyAt;
  if (!at) return;
  const age = Date.now() - at;
  const div = document.createElement('div');
  if (age < 40000) {
    div.className = 'msg thinking';
    div.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>正在思考…';
  } else {
    div.className = 'msg pending-hint';
    div.textContent = 'AI 还没回应——它可能没在处理这条消息；你这条会在它下次调用工具时送达。';
  }
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
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
els.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  els.chatInput.value = '';
  try {
    // The SW attaches the current page and pushes the entry into the transcript.
    const res = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CHAT_SEND, text });
    if (res?.ok) {
      refreshStatus();
      return;
    }
    els.chatInput.value = text; // don't swallow what the user typed
    appendMessage({ from: 'system', text: explainSendError(res?.error), at: new Date().toISOString() });
  } catch (error) {
    els.chatInput.value = text;
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

els.btnDisconnect.addEventListener('click', async () => {
  const paired = (lastStatus?.clients || []).filter((c) => c.paired);
  for (const c of paired) {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.DISCONNECT_CLIENT, clientId: c.id });
  }
  refreshStatus();
});

els.btnStop.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.STOP_AGENT });
  appendMessage({ from: 'system', text: '已请求停止', at: new Date().toISOString() });
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
