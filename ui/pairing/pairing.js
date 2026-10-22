/**
 * Pairing confirmation tab.
 *
 * URL: pairing.html?request_id=...&client_type=...&client_name=...
 * Confirming sends AGENTLIMB_PAIRING_RESPONSE to the SW, which answers the
 * bridge; the tab then closes itself.
 */

const params = new URLSearchParams(location.search);
const requestId = params.get('request_id') || '';
const clientType = params.get('client_type') || 'generic';
const clientName = params.get('client_name') || '';

const title = document.getElementById('title');
const nameInput = document.getElementById('name');
const status = document.getElementById('status');
const allowBtn = document.getElementById('btn-allow');
const ignoreBtn = document.getElementById('btn-ignore');

title.textContent = clientName
  ? `${clientName} 请求连接浏览器`
  : '智能体软件请求连接浏览器';
nameInput.placeholder = clientName ? `例如：${clientName}` : '例如：工作电脑、我的智能体';

function closeTab() {
  chrome.tabs.getCurrent((tab) => {
    if (tab?.id) chrome.tabs.remove(tab.id);
  });
}

allowBtn.addEventListener('click', async () => {
  allowBtn.disabled = true;
  ignoreBtn.disabled = true;
  status.textContent = '正在确认…';
  try {
    await chrome.runtime.sendMessage({
      type: 'AGENTLIMB_PAIRING_RESPONSE',
      request_id: requestId,
      ok: true,
      name: nameInput.value.trim() || undefined,
    });
    status.textContent = '已连接，关闭中…';
  } catch (error) {
    status.textContent = `失败：${error.message}`;
    allowBtn.disabled = false;
    ignoreBtn.disabled = false;
    return;
  }
  setTimeout(closeTab, 400);
});

ignoreBtn.addEventListener('click', async () => {
  ignoreBtn.disabled = true;
  allowBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({
      type: 'AGENTLIMB_PAIRING_RESPONSE',
      request_id: requestId,
      ok: false,
    });
  } catch (_) { /* ignore */ }
  setTimeout(closeTab, 200);
});

nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') allowBtn.click();
});
