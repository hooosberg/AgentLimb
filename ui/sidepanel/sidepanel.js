/**
 * AgentLimb side panel
 *
 * Two states, one responsibility each:
 *   unpaired → copy the connection prompt (that's all)
 *   paired   → a chat window with the connected AI (+ local quick actions)
 *
 * The panel is NOT required for control. Opening it only checks pairing state.
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
    lastStatus = message;
    render();
  }
  if (message.type === MESSAGE_TYPES.NOTIFY_CHAT) {
    appendMessage(message.message);
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
    renderChips(paired);
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

function renderChips(paired) {
  els.clientChips.innerHTML = '';
  for (const c of paired) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span class="dot"></span>正在与 ${escapeHtml(c.name)} 驱动浏览器`;
    els.clientChips.appendChild(chip);
  }
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
  appendMessage({ from: 'user', text, at: new Date().toISOString() });
  try {
    const res = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CHAT_SEND, text });
    if (res?.ok) {
      appendMessage({ from: 'system', text: '已送达 AI', at: new Date().toISOString() });
    } else {
      appendMessage({ from: 'system', text: `发送失败：${res?.error || 'unknown'}`, at: new Date().toISOString() });
    }
  } catch (error) {
    appendMessage({ from: 'system', text: `发送失败：${error.message}`, at: new Date().toISOString() });
  }
});

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

// quick actions — direct local control, no agent round trip
document.querySelectorAll('[data-quick]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.quick;
    try {
      let res;
      if (action === 'screenshot') {
        res = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.QUICK_ACTION, tool: 'computer', args: { action: 'screenshot' } });
        const image = res?.result?.image;
        if (image) {
          appendMessage({
            from: 'system',
            text: '',
            image: `data:${image.mimeType};base64,${image.data}`,
            at: new Date().toISOString(),
          });
        } else {
          appendMessage({ from: 'system', text: '截图失败', at: new Date().toISOString() });
        }
      } else if (action === 'tabs') {
        res = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.QUICK_ACTION, tool: 'tabs_context', args: {} });
        const lines = (res?.result?.tabs || []).map((t) =>
          `${t.active ? '▶' : ' '} #${t.id} ${t.title || '(无标题)'} — ${shortUrl(t.url)}`);
        appendMessage({ from: 'system', text: lines.join('\n') || '（无标签）', at: new Date().toISOString() });
      } else if (action === 'read_page') {
        res = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.QUICK_ACTION, tool: 'read_page', args: {} });
        const tree = res?.result?.tree || '';
        appendMessage({ from: 'system', text: tree.slice(0, 2000), at: new Date().toISOString() });
      }
    } catch (error) {
      appendMessage({ from: 'system', text: `操作失败：${error.message}`, at: new Date().toISOString() });
    }
  });
});

function appendMessage(message) {
  if (!message) return;
  const div = document.createElement('div');
  div.className = `msg ${message.from === 'user' ? 'user' : 'system'}`;
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

function shortUrl(url) {
  try {
    return new URL(url).hostname + new URL(url).pathname.slice(0, 30);
  } catch (_) {
    return String(url).slice(0, 50);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
