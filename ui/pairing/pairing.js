/**
 * Pairing confirmation tab.
 *
 * URL: pairing.html?request_id=...&client_type=...&client_name=...
 *
 * The agent software identifies itself over MCP (initialize.clientInfo.name),
 * so the user never types a name — this page only says who is asking and takes
 * a yes/no. The name can arrive a moment after the tab opens, so it is
 * refreshed from the SW while the page is open.
 */

const params = new URLSearchParams(location.search);
const requestId = params.get('request_id') || '';
let clientName = params.get('client_name') || '';

const title = document.getElementById('title');
const subtitle = document.getElementById('subtitle');
const status = document.getElementById('status');
const allowBtn = document.getElementById('btn-allow');
const ignoreBtn = document.getElementById('btn-ignore');

function renderName(name) {
  clientName = (name || '').trim();
  title.textContent = clientName
    ? `${clientName} 请求连接浏览器`
    : '智能体软件请求连接浏览器';
  subtitle.textContent = clientName
    ? `允许后，${clientName} 可以新建标签、读取页面、点击和输入。你可以随时在侧栏断开。`
    : '允许后，它可以新建标签、读取页面、点击和输入。你可以随时在侧栏断开。';
}
renderName(clientName);

// The host learns the client name from the MCP initialize call, which can land
// after this tab opens — poll the SW so the heading shows the real software.
let pollTimer = null;
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
async function refreshName() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'AGENTLIMB_GET_STATUS' });
    const pending = (res?.pending || []).find((p) => p.request_id === requestId);
    if (!pending) {
      stopPolling(); // answered elsewhere or expired
      return;
    }
    if (pending.name && pending.name !== clientName) renderName(pending.name);
  } catch (_) { /* SW restarting */ }
}
pollTimer = setInterval(refreshName, 1000);

function closeTab() {
  chrome.tabs.getCurrent((tab) => {
    if (tab?.id) chrome.tabs.remove(tab.id);
  });
}

allowBtn.addEventListener('click', async () => {
  allowBtn.disabled = true;
  ignoreBtn.disabled = true;
  status.textContent = '正在确认…';
  stopPolling();
  try {
    await chrome.runtime.sendMessage({
      type: 'AGENTLIMB_PAIRING_RESPONSE',
      request_id: requestId,
      ok: true,
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
  stopPolling();
  try {
    await chrome.runtime.sendMessage({
      type: 'AGENTLIMB_PAIRING_RESPONSE',
      request_id: requestId,
      ok: false,
    });
  } catch (_) { /* ignore */ }
  setTimeout(closeTab, 200);
});
