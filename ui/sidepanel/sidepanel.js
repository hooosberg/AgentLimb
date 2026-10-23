/**
 * AgentLimb side panel
 *
 * One top bar, two states, one tiny client manager:
 *   unpaired → copy the connection prompt (remembered trust is preserved)
 *   paired   → the agent's chat window, with a quiet feed of what it is doing
 *
 * The top bar never moves: left = which AI is driving (click for the manager),
 * right = copy prompt + settings. Settings is a list of sections, each one a
 * sub-page — connections, language, advanced, about.
 *
 * The panel is NOT required for control: closing it changes nothing about the
 * agent's ability to drive the browser. It is only how you *talk* to it.
 *
 * Every message sent from here carries the page you are looking at (screenshot
 * + url/title + text + interactive refs), so "translate this" needs no round
 * trip and no screenshot button.
 */

import { BRIDGE_HOST, DISCOVERY, MESSAGE_TYPES, STORAGE_KEYS, resolveBridgePorts } from '../../kernel/shared/constants.js';
import { buildConnectionPrompt } from '../../kernel/prompt/build-prompt.js';
import { panelState } from '../../kernel/shared/panel-state.js';

const $ = (id) => document.getElementById(id);

const manifest = chrome.runtime.getManifest();
const displayVersion = manifest.version_name || manifest.version;
$('about-version').textContent = displayVersion;
$('row-about-value').textContent = displayVersion;

const els = {
  stateUnpaired: $('state-unpaired'),
  statePaired: $('state-paired'),
  topDot: $('top-dot'),
  topStatus: $('top-status'),
  managerPopover: $('manager-popover'),
  managerList: $('manager-list'),
  managerCount: $('manager-count'),
  toast: $('toast'),
  unauthorizedBox: $('unauthorized-box'),
  unauthorizedDetail: $('unauthorized-detail'),
  bridgeOffline: $('bridge-offline'),
  inputHostPath: $('input-host-path'),
  btnSavePath: $('btn-save-path'),
  inputSourcePath: $('input-source-path'),
  btnSaveSource: $('btn-save-source'),
  chatLog: $('chat-log'),
  chatForm: $('chat-form'),
  chatInput: $('chat-input'),
  btnSend: $('btn-send'),
  composerStatus: $('composer-status'),
  pageNote: $('page-note'),
  bridgeIdle: $('bridge-idle'),
  sendError: $('send-error'),
  settingsView: $('settings-view'),
  settingsContent: document.querySelector('.settings-content'),
  clientList: $('client-list'),
  clientActionFeedback: $('client-action-feedback'),
  clientsSummary: $('clients-summary'),
  copyFeedbackPage: $('copy-feedback-page'),
  browserIdValue: $('browser-id-value'),
  btnCopyBrowserId: $('btn-copy-browser-id'),
  btnEditBrowserLabel: $('btn-edit-browser-label'),
  inputBrowserLabel: $('input-browser-label'),
  btnCopyBrowserLabel: $('btn-copy-browser-label'),
  btnSaveBrowserLabel: $('btn-save-browser-label'),
  updateStatus: $('update-status'),
  btnCheckUpdate: $('btn-check-update'),
  linkUpdateDownload: $('link-update-download'),
};

let lastStatus = null;
let renderedSignature = '';
let submitting = false;
let requestingStop = false;
let draftWhileLocked = null;
let english = false;
let activeClientId = null;
let copyingPrompt = false;
let clientManagerSignature = '';
let settingsPage = 'home';
let toastTimer = null;
// Site memory snapshot from the host (null = bridge not reachable yet). Declared
// up here because applyLanguage() re-renders it on every language switch.
let memoryInfo = null;
let memoryHostOld = false;
const DEFAULT_MEMORY_PATH = '~/.agentlimb/memory';
let updateCheckState = { state: 'idle', latestVersion: null, url: 'https://github.com/hooosberg/AgentLimb/releases/latest' };
let updateCheckedOnce = false;
// Last time the panel saw a live connection. A brief drop (worker suspended,
// SSE torn down) must not bounce the user back to the "not connected" screen
// and wipe the chat they were reading — that looks like the connection was lost
// when it is about to come back.
let connectedAt = 0;
const RECONNECT_GRACE_MS = 8000;
const draftsByClient = new Map();

const text = (key) => ({
  // top bar + manager
  managerAria: english ? 'Manage connected AI clients' : '管理已连接的 AI',
  topUnpaired: english ? 'Not connected' : '未连接',
  // A saved pairing with the AI software closed is normal, not a fault. The
  // wording must not make the user think the connection broke.
  topRemembered: (name) => english ? `${name} · paired, waiting for the AI to start` : `${name} · 已配对，等 AI 启动`,
  topOnlineIdle: (n) => english ? `${n} AI online · no task running` : `${n} 个 AI 在线 · 暂无任务`,
  othersOnline: (n) => english ? ` · +${n} online` : ` · 另有 ${n} 个在线`,
  managerCount: (total, online) => english ? `${total} total · ${online} online` : `${total} 个 · ${online} 在线`,
  standby: english ? 'Standby' : '待命',
  clientsTitle: english ? 'Connected AI' : '已连接的 AI',
  clientsRowDesc: english ? 'Switch or remove pairings' : '切换、移除已保存的配对',
  connectAnother: english ? 'Connect another AI' : '连接其他 AI',
  connectRowDesc: english ? 'Copy a prompt for a second AI client' : '复制提示词，接入第二个 AI 客户端',
  manageAll: english ? 'Manage' : '管理',
  countValue: (n) => english ? `${n}` : `${n} 个`,
  modeLabel: {
    offline: english ? 'Not connected' : '未连接',
    ready: english ? 'Connected' : '已连接',
    operating: english ? 'Working' : '正在操作',
    replying: english ? 'Waiting for reply' : '等待回复',
  },
  // settings shell
  settings: english ? 'Settings' : '设置',
  back: english ? 'Back' : '返回',
  pageTitles: {
    home: english ? 'Settings' : '设置',
    connect: english ? 'Connect another AI' : '连接其他 AI',
    clients: english ? 'Connected AI' : '已连接的 AI',
    language: english ? 'Language' : '界面语言',
    memory: english ? 'Site memory' : '网站记忆',
    advanced: english ? 'Advanced' : '高级',
    about: english ? 'About' : '关于',
  },
  groupConnect: english ? 'CONNECTION' : '连接',
  groupGeneral: english ? 'GENERAL' : '通用',
  groupAbout: english ? 'ABOUT' : '关于',
  // copy prompt
  copy: english ? 'Copy connection prompt' : '复制连接提示词',
  copySuccess: english ? 'Copied. Paste it into the AI client and follow its MCP setup; it will confirm when connected.' : '已复制：粘贴给 AI，按它提示启用 MCP。连通后会明确告诉你成功。',
  copyFailed: english ? 'Copy failed. Please try again.' : '复制失败，请再点一次。',
  connectPageDesc: english ? 'Generate a separate connection prompt for another AI client. Each client keeps its own pairing and transcript.' : '为另一个 AI 客户端生成独立的连接提示词。每个 AI 的配对与聊天记录各自独立保存。',
  connectTakeoverHint: english ? 'When the new AI connects it takes over this chat window. Switch back any time from the top-left manager.' : '新 AI 连上后会接管这个聊天窗口。随时可以从左上角的管理器切换回来。',
  // clients
  current: english ? 'In use' : '正在使用',
  switch: english ? 'Switch' : '切换',
  remove: english ? 'Remove' : '移除',
  online: english ? 'Online' : '在线',
  waiting: english ? 'Waiting to take over' : '等待接手',
  savedOffline: english ? 'Paired · waiting for the AI to start' : '已配对 · 等 AI 启动',
  empty: english ? 'Paired AI clients will appear here.' : '配对成功的 AI 会显示在这里。',
  managerEmpty: english ? 'No AI connected yet. Copy the prompt to connect one.' : '还没有连接任何 AI。复制提示词即可接入。',
  savedPairs: (n) => english ? `${n} saved pairing${n === 1 ? '' : 's'}. Select an online AI to switch the chat.` : `已保存 ${n} 个配对；点击在线 AI 可切换当前聊天对象。`,
  noPairs: english ? 'No saved AI pairings yet.' : '尚无已保存的 AI 配对。',
  selectFailedBusy: english ? 'This AI is busy. Wait for its current task to finish before switching.' : '当前 AI 正忙，请等当前操作完成后再切换。',
  selected: (name) => english ? `Switched to ${name}.` : `已切换到 ${name}。`,
  selectFailed: (reason) => english ? `Could not switch: ${reason}` : `切换失败：${reason}`,
  removeConfirm: (name) => english ? `Removing “${name}” revokes its pairing authorization. Continue?` : `移除“${name}”会撤销它的配对授权。确定继续吗？`,
  removed: (name) => english ? `Pairing authorization for ${name} was removed.` : `已移除 ${name} 的配对授权。`,
  removeFailed: (reason) => english ? `Could not remove pairing: ${reason}` : `移除失败：${reason}`,
  // language / advanced / about
  languageLabel: english ? 'Interface language' : '界面语言',
  languageHint: english ? 'Affects the extension UI only. The connection prompt is always English.' : '只影响扩展界面；复制出的连接提示词固定为英文。',
  languageValues: english ? ['Automatic', 'Simplified Chinese', 'English'] : ['自动', '简体中文', 'English'],
  languageNames: { auto: english ? 'Automatic' : '自动', 'zh-CN': english ? 'Simplified Chinese' : '简体中文', en: 'English' },
  advanced: english ? 'Advanced' : '高级',
  advancedRowValue: english ? 'Browser ID · MCP' : '浏览器标识 · MCP',
  browserIdPrefix: english ? 'Browser' : '当前浏览器',
  copyBrowserId: english ? 'Click to copy this browser identifier for the AI' : '点击复制当前浏览器标识（多开浏览器时可发给 AI 指定操作）',
  editBrowserLabel: english ? 'Rename' : '改名',
  browserLabelTitle: english ? 'Browser profile name (multi-browser routing)' : '当前浏览器名称（多浏览器识别）',
  browserLabelHint: english ? 'When you open multiple Chrome profiles at once, give each browser a short name (e.g. work or personal) so you can tell the AI which browser to control.' : '同时打开多个 Chrome 账号/浏览器时，给每个浏览器起个名字（如 work、personal），即可直接让 AI 指定操作某一个或同时操作多个。',
  browserIdCopied: (label) => english ? `Copied browser ID "${label}". Mention it to the AI to target this browser.` : `已复制浏览器标识“${label}”，发给 AI 即可指定操作此浏览器。`,
  sourcePathLabel: english ? 'Install source folder' : '安装源目录',
  sourcePathHint: english ? 'Folder that contains bin/agentlimb.mjs. Save it once and every copied prompt carries this absolute path, so the AI never has to search for it.' : '包含 bin/agentlimb.mjs 的仓库目录。填一次，之后复制出的提示词会带上这个绝对路径，AI 不用自己找。',
  hostPathLabel: english ? 'MCP command path' : 'MCP 命令路径',
  pathHint: english ? 'The installer places the MCP host in ~/.agentlimb/. If you chose another location, enter it here; copied prompts will use it.' : '安装脚本默认把 MCP 主机放在 ~/.agentlimb/。如自定义了位置，在此修改，复制出的提示词会带上它。',
  save: english ? 'Save' : '保存',
  saved: english ? 'Saved' : '已保存',
  // site memory / 网站记忆
  memoryLabel: english ? 'Site memory' : '网站记忆',
  memoryRowDesc: english ? 'Let the AI remember how each site is operated' : '让 AI 记住每个网站怎么操作',
  memoryRowOn: (n) => english ? `${n} site${n === 1 ? '' : 's'}` : `${n} 个网站`,
  memoryRowOff: english ? 'Off' : '已关闭',
  memoryToggle: english ? 'Enable site memory' : '启用网站记忆',
  memoryWhat: english
    ? 'A folder of plain Markdown files on this machine. Before the AI operates a website it reads that site\'s page; after it finishes, it writes back what was new — so the next run (or the next AI tool) does not have to explore the page again.'
    : '本机的一个纯 Markdown 文件夹。AI 操作某个网站前先读这个站的记录，操作完把新学到的写回去；下次（或者换一个 AI 工具）就不用重新摸索这个网站了。',
  memoryHowTitle: english ? 'HOW IT WORKS' : '怎么工作',
  memoryHow: english ? [
    'The prompt is injected automatically: every MCP client receives these rules when it connects, so nothing needs installing per AI tool.',
    'One file per site: direct URL, element anchors, pitfalls, and how to verify success — about 100 lines, never a screen recording.',
    'Reading is one file read (~10ms); logs are one small file per run and never slow an operation down.',
  ] : [
    '提示词自动注入：任何 MCP 客户端连上时都会收到这几条规则，不需要给每个 AI 工具单独装东西。',
    '一个网站一个文件：直达 URL、元素锚点、坑、成功判定，约 100 行；不记操作录像。',
    '读取只读一个文件（约 10ms）；日志是每次一行的小文件，不参与检索，不会拖慢操作。',
  ],
  memoryWhyTitle: english ? 'WHY' : '有什么用',
  memoryWhy: english ? [
    'Repeat runs are 5–8× cheaper: the AI stops re-exploring the page structure and gets straight to the action.',
    'Pitfalls survive: second confirms, captchas and A/B renames are written down once instead of being rediscovered.',
    'It is not tied to AgentLimb: the knowledge lives on disk, so another browser MCP or another AI tool can use it too.',
  ] : [
    '重复操作快 5–8 倍：AI 不用再重新认识页面结构，直接照步骤做。',
    '坑只踩一次：二次确认、验证码、改版后的按钮改名，记下来就不会反复踩。',
    '不绑定 AgentLimb：知识在磁盘上，换浏览器 MCP、换 AI 工具都能接着用。',
  ],
  memoryPathLabel: english ? 'Folder' : '保存位置',
  copyPath: english ? 'Copy' : '复制',
  savePath: english ? 'Save folder' : '保存路径',
  memoryPathHint: english
    ? 'Takes effect for the next MCP session (restart the AI tool or its MCP process). The folder is plain Markdown — back it up or move it any time.'
    : '对下一个 MCP 会话生效（重开 AI 工具或重启它的 MCP 进程）。这个文件夹就是普通 Markdown，随时可以备份或搬走。',
  memoryPrivacy: english
    ? 'Stores operation knowledge only: entry URLs, selectors, pitfalls. Never accounts, passwords, cookies, tokens, verification codes, or data copied from the site.'
    : '只存操作知识：入口 URL、选择器、坑。绝不存账号、密码、Cookie、Token、验证码，也不存网站上抓到的内容。',
  memoryStatusOn: (sites, runs, latest) => english
    ? `On · ${sites} site${sites === 1 ? '' : 's'} remembered · ${runs} run${runs === 1 ? '' : 's'} logged${latest ? ` · latest ${latest}` : ''}`
    : `已启用 · 已记录 ${sites} 个网站 · ${runs} 次操作${latest ? ` · 最近 ${latest}` : ''}`,
  memoryStatusOff: english ? 'Off · nothing is read or written' : '已关闭 · 不读也不写任何文件',
  memoryOffline: english ? 'Local bridge is not running — start your AI client to read the folder.' : '本地桥接未运行 — 启动 AI 客户端后才能读取这个文件夹。',
  memoryHostOld: english
    ? 'Site memory is on by default (folder below), but the installed AgentLimb host is older than this extension. Click "Copy prompt" in Connect and let your AI re-run the install — pairings are kept.'
    : '网站记忆默认开启（位置见下），但本机已安装的 AgentLimb 宿主比当前插件旧。到「连接」页点「复制提示词」，让 AI 重新安装一次即可，配对会保留。',
  memoryRowOld: english ? 'Host needs update' : '宿主需更新',
  autoTrustLabel: english ? 'Auto-authorize AI tools' : '自动授权 AI 工具',
  autoTrustHint: english
    ? 'On (default): an AI tool whose MCP host you installed is trusted the moment it connects — no copy-prompt click. Off: each new AI needs a Copy click first. You can always remove a trusted AI under Connected AIs.'
    : '开启（默认）：你装了 MCP 宿主的 AI 工具一连上就受信，不用再点复制提示词。关闭后每个新 AI 都要先点一次复制。已授权的 AI 随时可在「已连接」里移除。',
  memoryOnToast: english ? 'Site memory is on. It applies from the next MCP session.' : '网站记忆已开启，下一个 MCP 会话生效。',
  memoryOffToast: english ? 'Site memory is off. Nothing will be recorded.' : '网站记忆已关闭，之后不再记录。',
  memoryPathSaved: english ? 'Folder saved' : '路径已保存',
  aboutRow: english ? 'About AgentLimb' : '关于 AgentLimb',
  about: english ? 'AgentLimb connects AI assistants to Chrome so they can view pages and perform browser tasks with your authorization. Everything stays on your machine.' : 'AgentLimb 把 AI 助手连接到 Chrome，让它在你的授权下查看页面并执行浏览器任务。所有数据都留在本机。',
  version: english ? 'Version' : '版本',
  updateIdle: english ? 'Check GitHub for the latest release' : '检查是否有新版本发布',
  checkUpdate: english ? 'Check for updates' : '检查更新',
  checkingUpdate: english ? 'Checking…' : '正在检查…',
  downloadUpdate: english ? 'Download new version' : '前往下载新版',
  updateUpToDate: (v) => english ? `Up to date (v${v})` : `已是最新版本（v${v}）`,
  updateAvailable: (latest, current) => english ? `New version v${latest} available (current v${current})` : `发现新版本 v${latest}（当前 v${current}）`,
  updateRowBadge: (latest) => english ? `${displayVersion} · v${latest} new` : `${displayVersion} · 有新版 v${latest}`,
  updateFailed: english ? 'Could not reach GitHub to check for updates' : '暂时无法连接 GitHub 检查更新，请稍后再试',
  website: english ? 'Website' : '官网',
  license: english ? 'License' : '许可',
  // settings footer (every settings sub-page): official links + star encouragement
  footerStarPrompt: english ? 'Enjoying AgentLimb?' : '觉得 AgentLimb 好用？',
  footerStarAction: english ? 'Star us on GitHub ⭐' : '去 GitHub 点个 ⭐ 鼓励一下',
  blogPage: english ? 'Product page' : '产品页',
  // unpaired
  heroTitle: english ? 'Connect AI to your browser' : '连接 AI 到浏览器',
  heroSub: english
    ? 'Copy the prompt, paste it into your AI tool, and it connects to this browser.'
    : '复制提示词，粘贴给你要用的 AI 工具，它就能连上浏览器。',
  unauthorizedTitle: english ? 'An AI wants to connect' : '有一个 AI 想接入',
  unauthorizedHint: english ? 'Click Copy connection prompt to allow it. No confirmation page, no code.' : '点一下「复制连接提示词」就允许它接入，不用确认页也不用填码。',
  unauthorizedName: (name) => english ? `${name} is connected but not authorized yet` : `${name} 已连上，但还没获授权`,
  // Two very different situations that used to share one alarming sentence.
  // "Never paired" needs setup guidance; "the AI software closed its MCP
  // process" is routine and recovers by itself — saying so is the whole fix.
  bridgeOffline: english ? 'The local bridge is not running. Configure and start AgentLimb MCP in your AI client.' : '本地桥接未运行 — 请先在 AI 中配置并启动 AgentLimb MCP。',
  bridgeIdle: english ? 'This AI software is not connected right now (its MCP process stopped when it exited). Say anything to it and it reconnects automatically — no re-pairing, no config change.' : '这个 AI 软件当前没有连接（它退出时 MCP 进程随之停止）。对它随便说一句就会自动重连，不需要重新配对或改配置。',
  // chat / activity feed
  chatEmpty: english ? 'Connected. Give browser tasks directly in your AI tool (for example “summarize this page”); its replies will appear here.' : '已连接。请直接在你的 AI 工具中下达浏览器指令（例如“打开百度”或“总结当前网页”），AI 的操作回复会同步显示在这里。',
  reconnecting: english ? 'Reconnecting…' : '正在重连…',
  placeholderReconnecting: english ? 'Reconnecting to the AI…' : '正在重连，请稍候…',
  send: english ? 'Send' : '发送',
  stop: english ? 'Stop' : '停止',
  stopRequested: english ? 'Requested' : '已请求',
  stopTitle: english ? 'Send a stop request to the AI' : '向 AI 发送停止请求',
  sendTitle: english ? 'Send (Enter; Shift+Enter for a new line)' : '发送（Enter，Shift+Enter 换行）',
  placeholder: english ? 'Ask about this page or give it a task…' : '问它当前页面的事，或让它去做点什么…',
  placeholderOffline: english ? 'Connect an AI to start chatting' : '连接 AI 后即可聊天',
  placeholderOperating: english ? 'The AI is working in the browser…' : 'AI 正在操作浏览器，完成后可继续聊天…',
  placeholderReplying: english ? 'Waiting for the AI to reply…' : '正在等待 AI 回复，稍后可继续聊天…',
  placeholderStop: english ? 'Stop requested; waiting for the AI…' : '已请求停止，等待 AI 确认…',
  chatAria: english ? 'Message the AI' : '发给 AI 的消息',
  chatLogAria: english ? 'Recent chat messages' : '最近 20 条聊天记录',
  pageFallback: english ? 'Give commands in your AI tool to operate the current tab' : '在 AI 工具中发指令即可操作当前标签页',
  pageAttached: english ? 'Attached current page' : '已附带当前页面',
  pageUnreadable: english ? ' (page content unavailable)' : '（这类页面读不到正文）',
  pageNote: (title) => english ? `Current tab: ${title}` : `当前标签页：${title}`,
  unreadablePageNote: (title) => english ? `Current tab: ${title} (system page)` : `当前标签页：${title}（系统页面）`,
  sendError: (reason) => english ? `Send failed: ${reason || 'unknown error'}` : `发送失败：${reason || '未知错误'}`,
  busySend: english ? 'The AI is working or awaiting a reply. Please wait. Your message is saved.' : 'AI 正在操作或等待回复，请稍候再发送。输入内容已保留。',
  offlineSend: english ? 'The AI is offline. Start its MCP process; it will reconnect automatically.' : 'AI 还没连上——它的 MCP 进程没在运行。启动智能体软件后会自动连上，不用重新配对。',
  noPairedSend: english ? 'No AI is paired yet. Complete pairing first.' : '还没有配对的 AI——请先完成配对。',
  stopFailed: english ? 'Could not send stop request. Try again.' : '停止请求发送失败，请重试。',
  sendErrorStop: english ? 'Stop request was not sent' : '停止请求未发送',
  unknown: english ? 'Unknown error' : '未知错误',
}[key] ?? key);

// ── status + discovery wake loop ─────────────────────────────────────────────
/**
 * The MV3 worker is suspended after ~30 s of idleness, and a suspended worker
 * cannot see a bridge that just appeared — that gap is the entire reason
 * pairing can feel like "nothing happens". This panel is a live page, so it is
 * the one thing that is always able to wake the worker:
 *
 *   not connected → ask every 250 ms and let the scan run (this IS the
 *                   first-pairing latency: install → copy → paste → connected)
 *   connected     → ask every 20 s, only so the SSE stream is not torn down
 *                   while the user is reading instead of chatting
 *
 * Sending the message is itself what wakes a sleeping worker, so this works
 * even when the alarm has not fired yet.
 */
let wakeTimer = null;
let wakeDelay = 0;

function scheduleWake() {
  const delay = lastStatus?.status === 'connected' ? DISCOVERY.PANEL_WARM_MS : DISCOVERY.PANEL_HUNT_MS;
  if (wakeTimer !== null && delay === wakeDelay) return;
  clearTimeout(wakeTimer);
  wakeDelay = delay;
  wakeTimer = setTimeout(wake, delay);
}

async function wake() {
  wakeTimer = null;
  wakeDelay = 0;
  await refreshStatus(true);
  scheduleWake();
}

async function refreshStatus(scan = false) {
  try {
    const response = await chrome.runtime.sendMessage({ type: scan ? MESSAGE_TYPES.ENSURE : MESSAGE_TYPES.GET_STATUS });
    if (response?.ok) {
      lastStatus = response;
      render();
      return response;
    }
  } catch (_) {
    // Worker restarting — the wake loop retries on the next tick.
  }
  return null;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MESSAGE_TYPES.NOTIFY_STATUS) {
    lastStatus = { ...(lastStatus || {}), ...message };
    render();
  }
});

refreshStatus().then(scheduleWake);

// ── rendering ────────────────────────────────────────────────────────────────
function activePairedClient(state, paired) {
  if (state.client) return state.client;
  if (lastStatus?.connectedClientId) {
    const match = paired.find((c) => c.id === lastStatus.connectedClientId);
    if (match) return match;
  }
  return paired[0] || null;
}

function render() {
  const clients = lastStatus?.clients || [];
  const unauthorized = lastStatus?.unauthorized || [];
  const paired = clients.filter((c) => c.paired);
  const bridgeUp = lastStatus?.status === 'connected';
  const state = panelState(lastStatus || {});
  const currentClient = activePairedClient(state, paired);
  // Once paired, stay in the connected chat view until the user explicitly
  // removes/disconnects the AI. Per-turn MCP subprocess exits (e.g. after a
  // tool turn finishes) must never bounce the panel back to the copy-prompt
  // onboarding screen.
  const staysConnected = !!currentClient;

  renderTopbar(state, paired, currentClient);
  renderManager(clients, currentClient?.id || lastStatus?.connectedClientId);
  renderBrowserIdentity();

  const nextClientId = currentClient?.id || null;
  if (nextClientId !== activeClientId) {
    if (activeClientId) draftsByClient.set(activeClientId, draftWhileLocked ?? els.chatInput.value);
    activeClientId = nextClientId;
    draftWhileLocked = null;
    els.chatInput.value = activeClientId ? (draftsByClient.get(activeClientId) || '') : '';
    renderedSignature = '';
  }

  if (staysConnected) {
    if (els.statePaired.hidden) {
      els.statePaired.hidden = false;
      els.stateUnpaired.hidden = true;
      renderedSignature = ''; // fresh transcript mount
      els.chatLog.replaceChildren();
      void updatePageNote();
    }
    syncChat();
  } else {
    els.statePaired.hidden = true;
    els.stateUnpaired.hidden = false;

    els.unauthorizedBox.hidden = unauthorized.length === 0;
    if (unauthorized.length) {
      els.unauthorizedDetail.textContent = text('unauthorizedName')(unauthorized[0].name);
    }
    const idle = paired.length > 0;
    els.bridgeOffline.hidden = bridgeUp || idle;
    els.bridgeIdle.hidden = bridgeUp || !idle;
  }
  renderComposer();
  scheduleWake();
}

/** Left side of the top bar: which AI is connected right now (direct display, no dropdown menu). */
function renderTopbar(state, paired, currentClient = activePairedClient(state, paired)) {
  const onlineCount = paired.filter((client) => client.online).length;
  if (currentClient) {
    const mode = state.connected ? state.mode : (submitting || lastStatus?.sending || lastStatus?.pendingReplyAt ? 'replying' : 'ready');
    const busy = mode === 'operating' || mode === 'replying';
    els.topDot.className = `dot${busy ? ' busy' : ' online'}`;
    const others = state.connected ? Math.max(0, onlineCount - 1) : 0;
    els.topStatus.textContent = `${currentClient.name} · ${text('modeLabel')[mode]}${others ? text('othersOnline')(others) : ''}`;
  } else {
    els.topDot.className = 'dot';
    els.topStatus.textContent = text('topUnpaired');
  }
  $('row-clients-value').textContent = text('countValue')(paired.length);
}

function renderBrowserIdentity() {
  const identity = lastStatus?.browserIdentity;
  if (!identity) return;
  const display = identity.label && identity.label !== identity.id
    ? `${identity.label} (${identity.id})`
    : identity.id;
  els.browserIdValue.textContent = display;
  if (document.activeElement !== els.inputBrowserLabel) {
    els.inputBrowserLabel.value = identity.label && identity.label !== identity.id ? identity.label : '';
    els.inputBrowserLabel.placeholder = identity.id || 'work / personal';
  }
}

/** The tiny manager (popover) and the full list (settings page) share one model. */
function renderManager(clients, connectedClientId) {
  const paired = clients.filter((client) => client.paired);
  const signature = JSON.stringify({
    clients: paired.map(({ id, name, online, waiting }) => [id, name, Boolean(online), Boolean(waiting)]),
    connectedClientId: connectedClientId || null,
    english,
  });
  if (signature === clientManagerSignature) return;
  clientManagerSignature = signature;

  els.managerCount.textContent = text('managerCount')(paired.length, paired.filter((client) => client.online).length);
  els.managerList.replaceChildren();
  if (!paired.length) {
    const empty = document.createElement('p');
    empty.className = 'manager-empty';
    empty.textContent = text('managerEmpty');
    els.managerList.append(empty);
  }
  for (const client of paired) {
    const row = document.createElement('div');
    row.className = 'manager-row';
    const dot = document.createElement('span');
    // 绿=在线（含当前与待命），黄=正在等接手，灰=已保存但离线
    dot.className = `dot${!client.online ? '' : client.id === connectedClientId ? ' online' : client.waiting ? ' busy' : ' online'}`;
    const main = document.createElement('div');
    main.className = 'manager-row-main';
    const name = document.createElement('div');
    name.className = 'manager-row-name';
    name.textContent = client.name;
    const status = document.createElement('div');
    status.className = 'manager-row-status';
    status.textContent = client.online
      ? (client.id === connectedClientId ? text('current') : (client.waiting ? text('waiting') : text('standby')))
      : text('savedOffline');
    main.append(name, status);
    row.append(dot, main);
    if (client.online && client.id !== connectedClientId) {
      const actions = document.createElement('div');
      actions.className = 'manager-row-actions';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text('switch');
      button.addEventListener('click', () => selectClient(client));
      actions.append(button);
      row.append(actions);
    }
    els.managerList.append(row);
  }

  els.clientsSummary.textContent = paired.length ? text('savedPairs')(paired.length) : text('noPairs');
  els.clientList.replaceChildren();
  if (!paired.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = text('empty');
    els.clientList.append(empty);
  }
  for (const client of paired) {
    const row = document.createElement('div');
    row.className = 'client-row';
    row.dataset.clientId = client.id;
    const main = document.createElement('div');
    main.className = 'client-row-main';
    const name = document.createElement('div');
    name.className = 'client-row-name';
    name.textContent = client.name;
    const status = document.createElement('div');
    status.className = 'client-row-status';
    status.textContent = client.online
      ? (client.id === connectedClientId ? text('current') : (client.waiting ? text('waiting') : text('standby')))
      : text('savedOffline');
    main.append(name, status);
    const actions = document.createElement('div');
    actions.className = 'client-row-actions';
    if (client.online) {
      const select = document.createElement('button');
      select.className = 'btn-ghost';
      select.type = 'button';
      select.dataset.action = 'select';
      select.textContent = client.id === connectedClientId ? text('current') : text('switch');
      select.disabled = client.id === connectedClientId;
      select.addEventListener('click', () => selectClient(client));
      actions.append(select);
    }
    const remove = document.createElement('button');
    remove.className = 'btn-ghost';
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.textContent = text('remove');
    remove.addEventListener('click', () => removeClient(client));
    actions.append(remove);
    row.append(main, actions);
    els.clientList.append(row);
  }
}

function setClientFeedback(message, ok = false) {
  els.clientActionFeedback.hidden = !message;
  els.clientActionFeedback.dataset.ok = String(ok);
  els.clientActionFeedback.textContent = message;
}

async function selectClient(client) {
  setClientFeedback('');
  try {
    const type = MESSAGE_TYPES.SELECT_CLIENT || 'AGENTLIMB_SELECT_CLIENT';
    const response = await chrome.runtime.sendMessage({ type, clientId: client.id });
    if (!response?.ok) throw new Error(response?.error || '切换失败');
    const status = await refreshStatus();
    if (status?.connectedClientId !== client.id) throw new Error('Controller change has not completed yet');
    setClientFeedback(text('selected')(client.name), true);
    closeManager();
  } catch (error) {
    const message = String(error?.message || '切换失败');
    setClientFeedback(/busy|忙|awaiting/i.test(message)
      ? text('selectFailedBusy')
      : text('selectFailed')(message));
  }
}

async function removeClient(client) {
  if (!window.confirm(text('removeConfirm')(client.name))) return;
  setClientFeedback('');
  try {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.DISCONNECT_CLIENT, clientId: client.id });
    if (!response?.ok) throw new Error(response?.error || '移除失败');
    await refreshStatus();
    setClientFeedback(text('removed')(client.name), true);
  } catch (error) {
    setClientFeedback(text('removeFailed')(error?.message || text('unknown')));
  }
}

function isComposerLocked() {
  const paired = (lastStatus?.clients || []).filter((c) => c.paired);
  const state = panelState({ ...(lastStatus || {}), sending: submitting || lastStatus?.sending });
  const currentClient = activePairedClient(state, paired);
  return !(state.connected || !!currentClient) || submitting || !!lastStatus?.sending;
}

function renderComposer() {
  const paired = (lastStatus?.clients || []).filter((c) => c.paired);
  const state = panelState({ ...(lastStatus || {}), sending: submitting || lastStatus?.sending });
  const currentClient = activePairedClient(state, paired);
  const effectiveConnected = state.connected || !!currentClient;
  const effectiveMode = state.connected
    ? state.mode
    : (currentClient ? (submitting || lastStatus?.sending || lastStatus?.pendingReplyAt ? 'replying' : 'ready') : 'offline');
  const effectiveLocked = isComposerLocked();
  if (effectiveLocked) {
    if (draftWhileLocked === null) draftWhileLocked = els.chatInput.value;
    els.chatInput.value = '';
  } else if (draftWhileLocked !== null) {
    els.chatInput.value = draftWhileLocked;
    draftWhileLocked = null;
  }
  els.chatInput.placeholder = state.stopRequested ? text('placeholderStop') : {
    offline: text('placeholderOffline'),
    ready: text('placeholder'),
    operating: text('placeholderOperating'),
    replying: text('placeholderReplying'),
  }[effectiveMode];
  els.chatInput.setAttribute('aria-label', text('chatAria'));
  els.chatInput.disabled = effectiveLocked;
  const stop = state.action === 'stop';
  els.btnSend.dataset.action = state.action;
  els.btnSend.textContent = stop ? (state.stopRequested ? text('stopRequested') : text('stop')) : text('send');
  els.btnSend.title = stop ? text('stopTitle') : text('sendTitle');
  els.btnSend.disabled = stop ? !state.canStop || requestingStop : effectiveLocked || !els.chatInput.value.trim();
  els.composerStatus.hidden = true;
  els.composerStatus.textContent = text('modeLabel')[effectiveMode];
  els.composerStatus.dataset.mode = effectiveMode;
  els.chatForm.hidden = true;
  els.chatForm.setAttribute('aria-busy', String(effectiveConnected && effectiveLocked));
  autoGrow();
}

els.btnSend.addEventListener('click', async (event) => {
  if (els.btnSend.dataset.action !== 'stop') return;
  event.preventDefault();
  if (requestingStop || !panelState(lastStatus || {}).canStop) return;
  requestingStop = true;
  els.sendError.hidden = true;
  renderComposer();
  try {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CHAT_STOP });
    if (!response?.ok) throw new Error(response?.error || '停止请求未发送');
    await refreshStatus();
  } catch (_) {
    els.sendError.textContent = text('stopFailed');
    els.sendError.hidden = false;
  } finally {
    requestingStop = false;
    renderComposer();
  }
});

/** These 20 records are a display log of AI replies and status notes, never replayed as AI context. */
function syncChat() {
  const list = (lastStatus?.chat || []).filter(
    (m) => m && m.from !== 'user' && !/还没有回复|停止请求已发出/.test(m.text || ''),
  );
  const signature = JSON.stringify({ list, english });
  if (signature === renderedSignature) return;
  renderedSignature = signature;
  els.chatLog.replaceChildren();
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'chat-empty';
    empty.textContent = text('chatEmpty');
    els.chatLog.append(empty);
    return;
  }
  for (const message of list) appendMessage(message);
}

function appendMessage(message) {
  if (!message) return;
  const from = message.from || 'system';
  const div = document.createElement('div');
  div.className = `msg ${from}`;
  div.textContent = message.text || '';
  // Sent with the page attached? Say so — the user should never wonder whether
  // the agent could see what they were looking at.
  const title = message.page?.title;
  if (from === 'user' && (message.page || title)) {
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = title ? `${text('pageAttached')} · ${title}` : text('pageAttached');
    div.appendChild(meta);
  }
  els.chatLog.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

// ── toast ─────────────────────────────────────────────────────────────────────
function showToast(message, ok = true) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.dataset.ok = String(ok);
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3600);
}

// ── manager popover (disabled in topbar: topbar directly shows connected AI) ──
function closeManager() {
  els.managerPopover.hidden = true;
}
$('btn-manager').hidden = false;
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!els.settingsView.hidden) closeSettings();
});
$('btn-manage-all').addEventListener('click', () => {
  closeManager();
  openSettings('clients');
});
$('btn-connect-another').addEventListener('click', () => {
  closeManager();
  copyConnectionPrompt($('btn-connect-another'));
});

// ── copy prompt ───────────────────────────────────────────────────────────────
async function loadStoredPath(key) {
  try {
    const store = await chrome.storage.local.get(key);
    return store[key] || '';
  } catch (_) {
    return '';
  }
}
const loadHostPath = () => loadStoredPath(STORAGE_KEYS.hostPath);
const loadSourcePath = () => loadStoredPath(STORAGE_KEYS.sourcePath);

const copyButtons = () => [$('btn-copy-prompt'), $('btn-copy-hero'), $('btn-copy-page'), $('btn-connect-another')];

async function copyConnectionPrompt(button) {
  if (copyingPrompt) return;
  copyingPrompt = true;
  for (const el of copyButtons()) el.disabled = true;
  let windowOpened = false;
  try {
    // Copying IS the authorization: it opens a 30-minute window in which the
    // next unknown AI client is trusted. No page, no code, nothing to paste
    // into a config.
    const opened = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.COPY_PROMPT });
    if (!opened?.ok) throw new Error('Could not open the connection window');
    windowOpened = true;
    const [hostPath, sourcePath] = await Promise.all([loadHostPath(), loadSourcePath()]);
    const prompt = buildConnectionPrompt({
      hostPath: hostPath || undefined,
      sourcePath: sourcePath || undefined,
      // Chrome derives an unpacked extension's ID from its folder path, so the
      // ID is a fingerprint the agent can resolve back to the exact folder.
      extensionId: chrome.runtime.id,
    });
    const ok = await copyText(prompt);
    if (!ok) throw new Error('Clipboard failed');
    showToast(text('copySuccess'), true);
    els.copyFeedbackPage.hidden = false;
    els.copyFeedbackPage.textContent = text('copySuccess');
  } catch (_) {
    // Nothing was copied, so nothing should stay authorized.
    if (windowOpened) await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CANCEL_COPY }).catch(() => {});
    showToast(text('copyFailed'), false);
    els.copyFeedbackPage.hidden = false;
    els.copyFeedbackPage.textContent = text('copyFailed');
  } finally {
    copyingPrompt = false;
    for (const el of copyButtons()) el.disabled = false;
    if (button) button.disabled = false;
  }
}

$('btn-copy-prompt').addEventListener('click', () => copyConnectionPrompt($('btn-copy-prompt')));
$('btn-copy-hero').addEventListener('click', () => copyConnectionPrompt($('btn-copy-hero')));
$('btn-copy-page').addEventListener('click', () => copyConnectionPrompt($('btn-copy-page')));

// ── settings navigation ───────────────────────────────────────────────────────
const SETTINGS_PAGES = ['connect', 'clients', 'language', 'memory', 'advanced', 'about'];

function openSettings(page = 'home') {
  els.settingsView.hidden = false;
  showSettingsPage(page);
  $('btn-settings-back').focus({ preventScroll: true });
}
function closeSettings() {
  els.settingsView.hidden = true;
  renderComposer();
}
function showSettingsPage(page) {
  settingsPage = SETTINGS_PAGES.includes(page) ? page : 'home';
  $('settings-home').hidden = settingsPage !== 'home';
  for (const id of SETTINGS_PAGES) $(`page-${id}`).hidden = id !== settingsPage;
  $('settings-title').textContent = text('pageTitles')[settingsPage];
  els.settingsContent.scrollTop = 0;
  $('btn-settings-back').setAttribute('aria-label', settingsPage === 'home' ? text('settings') : text('back'));
  if (settingsPage === 'memory') void loadMemory();
  if ((settingsPage === 'home' || settingsPage === 'about') && !updateCheckedOnce) {
    updateCheckedOnce = true;
    void checkForUpdates();
  }
}
$('btn-settings').addEventListener('click', () => openSettings('home'));
$('btn-settings-back').addEventListener('click', () => {
  if (settingsPage === 'home') closeSettings();
  else showSettingsPage('home');
});
for (const row of document.querySelectorAll('.settings-row')) {
  row.addEventListener('click', () => showSettingsPage(row.dataset.page));
}

// ── language ──────────────────────────────────────────────────────────────────
async function initLanguage() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.lang);
    $('language-select').value = stored[STORAGE_KEYS.lang] || 'auto';
  } catch (_) { $('language-select').value = 'auto'; }
  $('language-select').addEventListener('change', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.lang]: $('language-select').value });
    applyLanguage();
  });
  applyLanguage();
}

/** All static copy is declared in the markup via data-i18n*; this fills it in. */
function applyLanguage() {
  const selected = $('language-select').value;
  english = selected === 'en' || (selected === 'auto' && /^en/i.test(chrome.i18n?.getUILanguage?.() || navigator.language));
  document.documentElement.lang = english ? 'en' : 'zh-CN';

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const value = text(el.dataset.i18n);
    if (typeof value === 'string') el.textContent = value;
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = text(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', text(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-i18n-list]')) {
    const items = text(el.dataset.i18nList);
    if (!Array.isArray(items)) continue;
    el.replaceChildren(...items.map((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      return li;
    }));
  }

  text('languageValues').forEach((value, index) => { $('language-select').options[index].textContent = value; });
  $('row-language-value').textContent = text('languageNames')[selected] || text('languageNames').auto;
  $('settings-title').textContent = text('pageTitles')[settingsPage];
  $('settings-view').setAttribute('aria-label', text('settings'));
  $('chat-log').setAttribute('aria-label', text('chatLogAria'));
  els.copyFeedbackPage.hidden = true;

  clientManagerSignature = '';
  renderManager(lastStatus?.clients || [], lastStatus?.connectedClientId);
  setClientFeedback('');
  renderMemory();
  renderUpdateStatus();
  render();
  if (!els.statePaired.hidden) void updatePageNote();
}
initLanguage();

els.btnSavePath.addEventListener('click', async () => {
  const value = els.inputHostPath.value.trim();
  await chrome.storage.local.set({ [STORAGE_KEYS.hostPath]: value });
  els.btnSavePath.textContent = text('saved');
  setTimeout(() => { els.btnSavePath.textContent = text('save'); }, 1200);
});

els.btnSaveSource.addEventListener('click', async () => {
  const value = els.inputSourcePath.value.trim();
  await chrome.storage.local.set({ [STORAGE_KEYS.sourcePath]: value });
  els.btnSaveSource.textContent = text('saved');
  setTimeout(() => { els.btnSaveSource.textContent = text('save'); }, 1200);
});

async function copyCurrentBrowserId() {
  const identity = lastStatus?.browserIdentity;
  const target = (els.inputBrowserLabel.value || identity?.label || identity?.id || '').trim();
  if (!target) return;
  const ok = await copyText(target);
  showToast(ok ? text('browserIdCopied')(target) : text('copyFailed'), ok);
}

els.btnCopyBrowserId.addEventListener('click', () => { void copyCurrentBrowserId(); });
els.btnCopyBrowserLabel.addEventListener('click', () => { void copyCurrentBrowserId(); });
els.btnEditBrowserLabel.addEventListener('click', () => {
  openSettings('advanced');
  setTimeout(() => els.inputBrowserLabel.focus(), 50);
});
els.btnSaveBrowserLabel.addEventListener('click', async () => {
  const label = els.inputBrowserLabel.value.trim();
  try {
    const res = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SET_BROWSER_LABEL, label });
    if (res?.ok && res.browserIdentity) {
      lastStatus = { ...(lastStatus || {}), browserIdentity: res.browserIdentity };
      renderBrowserIdentity();
    }
    els.btnSaveBrowserLabel.textContent = text('saved');
    setTimeout(() => { els.btnSaveBrowserLabel.textContent = text('save'); }, 1200);
  } catch (_) {
    showToast(text('unknown'), false);
  }
});

chrome.storage.local.get(STORAGE_KEYS.autoTrust).then((r) => { $('auto-trust-toggle').checked = r[STORAGE_KEYS.autoTrust] !== false; });
$('auto-trust-toggle').addEventListener('change', () => {
  void chrome.storage.local.set({ [STORAGE_KEYS.autoTrust]: $('auto-trust-toggle').checked });
});
loadHostPath().then((p) => { els.inputHostPath.value = p; });
loadSourcePath().then((p) => { els.inputSourcePath.value = p; });

// ── version update check (About page) ─────────────────────────────────────────
function compareSemver(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function renderUpdateStatus() {
  const { state, latestVersion, url } = updateCheckState;
  const currentVersion = manifest.version || '0.0.0';
  els.btnCheckUpdate.disabled = state === 'checking';
  els.btnCheckUpdate.textContent = state === 'checking' ? text('checkingUpdate') : text('checkUpdate');
  els.updateStatus.dataset.state = state;
  if (state === 'checking') {
    els.updateStatus.textContent = text('checkingUpdate');
    els.linkUpdateDownload.hidden = true;
  } else if (state === 'available' && latestVersion) {
    els.updateStatus.textContent = text('updateAvailable')(latestVersion, currentVersion);
    els.linkUpdateDownload.href = url || 'https://github.com/hooosberg/AgentLimb/releases/latest';
    els.linkUpdateDownload.hidden = false;
    $('row-about-value').textContent = text('updateRowBadge')(latestVersion);
  } else if (state === 'upToDate') {
    els.updateStatus.textContent = text('updateUpToDate')(currentVersion);
    els.linkUpdateDownload.hidden = true;
    $('row-about-value').textContent = displayVersion;
  } else if (state === 'error') {
    els.updateStatus.textContent = text('updateFailed');
    els.linkUpdateDownload.hidden = true;
  } else {
    els.updateStatus.textContent = text('updateIdle');
    els.linkUpdateDownload.hidden = true;
  }
}

async function checkForUpdates() {
  if (updateCheckState.state === 'checking') return;
  updateCheckState = { ...updateCheckState, state: 'checking' };
  renderUpdateStatus();
  const currentVersion = manifest.version || '0.0.0';
  let latestVersion = null;
  let releaseUrl = 'https://github.com/hooosberg/AgentLimb/releases/latest';

  try {
    const res = await fetch('https://api.github.com/repos/hooosberg/AgentLimb/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data = await res.json();
      const tag = String(data?.tag_name || '').replace(/^v/i, '').trim();
      if (/^\d+\.\d+\.\d+/.test(tag)) {
        latestVersion = tag;
        if (data?.html_url) releaseUrl = data.html_url;
      }
    }
  } catch (_) { /* fallback to main package.json below */ }

  try {
    const pkgRes = await fetch('https://raw.githubusercontent.com/hooosberg/AgentLimb/main/package.json', {
      signal: AbortSignal.timeout(4500),
    });
    if (pkgRes.ok) {
      const pkgData = await pkgRes.json();
      const mainVer = String(pkgData?.version || '').trim();
      if (/^\d+\.\d+\.\d+/.test(mainVer) && (!latestVersion || compareSemver(mainVer, latestVersion) > 0)) {
        latestVersion = mainVer;
      }
    }
  } catch (_) { /* ignore */ }

  if (!latestVersion) {
    updateCheckState = { state: 'error', latestVersion: null, url: releaseUrl };
  } else if (compareSemver(latestVersion, currentVersion) > 0) {
    updateCheckState = { state: 'available', latestVersion, url: releaseUrl };
  } else {
    updateCheckState = { state: 'upToDate', latestVersion, url: releaseUrl };
  }
  renderUpdateStatus();
}

els.btnCheckUpdate.addEventListener('click', () => { void checkForUpdates(); });

// ── site memory / 网站记忆 ────────────────────────────────────────────────────
/**
 * The panel is only the window: the folder, the toggle and the counters all
 * live on the host, which is also what the AI reads. So this talks to the
 * bridge's /api/memory instead of keeping a second copy in chrome.storage —
 * two sources of truth for "where are the notes" is exactly how they drift.
 */
async function bridgeJson(path, init) {
  for (const port of resolveBridgePorts()) {
    try {
      const response = await fetch(`http://${BRIDGE_HOST}:${port}${path}`, {
        ...init,
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return await response.json();
    } catch (_) {
      // Not this port — the bridge may be on another one (several AI clients).
    }
  }
  return null;
}

function renderMemory() {
  const toggle = $('memory-toggle');
  const status = $('memory-status');
  if (!memoryInfo) {
    // Default is ON with the default folder. Show that truthfully even while the
    // host is unreachable, instead of an empty switch that looks like "off".
    toggle.disabled = true;
    toggle.checked = true;
    if (!$('input-memory-path').value) $('input-memory-path').value = DEFAULT_MEMORY_PATH;
    status.dataset.state = 'off';
    status.textContent = memoryHostOld ? text('memoryHostOld') : text('memoryOffline');
    $('row-memory-value').textContent = memoryHostOld ? text('memoryRowOld') : '—';
    return;
  }
  toggle.disabled = false;
  toggle.checked = Boolean(memoryInfo.enabled);
  $('input-memory-path').value = memoryInfo.root || '';
  $('row-memory-value').textContent = memoryInfo.enabled
    ? text('memoryRowOn')(memoryInfo.sites || 0)
    : text('memoryRowOff');
  status.dataset.state = memoryInfo.enabled ? 'on' : 'off';
  status.textContent = memoryInfo.enabled
    ? text('memoryStatusOn')(memoryInfo.sites || 0, memoryInfo.runs || 0, memoryInfo.latest)
    : text('memoryStatusOff');
}

async function loadMemory() {
  memoryInfo = await bridgeJson('/api/memory');
  // A reachable bridge without /api/memory is a pre-0.6 host: say so, don't call it "not running".
  memoryHostOld = !memoryInfo && Boolean(await bridgeJson('/health'));
  renderMemory();
}

$('memory-toggle').addEventListener('change', async () => {
  const enabled = $('memory-toggle').checked;
  const result = await bridgeJson('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!result?.ok) {
    $('memory-toggle').checked = !enabled;
    showToast(text('memoryOffline'), false);
    return;
  }
  memoryInfo = result;
  renderMemory();
  showToast(enabled ? text('memoryOnToast') : text('memoryOffToast'), true);
});

$('btn-save-memory-path').addEventListener('click', async () => {
  const root = $('input-memory-path').value.trim();
  const result = await bridgeJson('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, enabled: true }),
  });
  if (!result?.ok) {
    showToast(text('memoryOffline'), false);
    return;
  }
  memoryInfo = result;
  renderMemory();
  const button = $('btn-save-memory-path');
  button.textContent = text('memoryPathSaved');
  setTimeout(() => { button.textContent = text('savePath'); }, 1400);
});

$('btn-copy-memory-path').addEventListener('click', async () => {
  const ok = await copyText($('input-memory-path').value);
  showToast(ok ? text('memoryPathSaved') : text('copyFailed'), ok);
});

void loadMemory();

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
      els.pageNote.textContent = text('pageFallback');
      return;
    }
    const readable = /^https?:/i.test(tab.url || '');
    const title = (tab.title || tab.url || '').trim();
    els.pageNote.textContent = readable
      ? text('pageNote')(title.slice(0, 40))
      : text('unreadablePageNote')(title.slice(0, 40));
  } catch (_) {
    els.pageNote.textContent = text('pageFallback');
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

els.chatInput.addEventListener('input', () => {
  if (activeClientId && !isComposerLocked()) draftsByClient.set(activeClientId, els.chatInput.value);
  autoGrow();
  renderComposer();
});

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
  if (!text || submitting || isComposerLocked()) return;
  submitting = true;
  els.sendError.hidden = true;
  renderComposer();
  try {
    // The SW attaches the current page (screenshot + text + refs) and pushes
    // the entry into the transcript.
    const res = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CHAT_SEND, text });
    if (res?.ok) {
      draftWhileLocked = '';
      els.chatInput.value = '';
      if (activeClientId) draftsByClient.delete(activeClientId);
      autoGrow();
      await refreshStatus();
      return;
    }
    draftWhileLocked = text; // restore only when the composer is editable
    autoGrow();
    els.sendError.textContent = explainSendError(res?.error);
    els.sendError.hidden = false;
  } catch (error) {
    draftWhileLocked = text;
    autoGrow();
    els.sendError.textContent = explainSendError(error.message);
    els.sendError.hidden = false;
  } finally {
    submitting = false;
    renderComposer();
  }
});

/** Raw protocol errors are not user language — translate the two that matter. */
function explainSendError(raw) {
  const msg = String(raw || '');
  if (/AI busy or awaiting reply/i.test(msg)) {
    return text('busySend');
  }
  if (/bridge not connected/i.test(msg)) {
    return text('offlineSend');
  }
  if (/no paired AI client/i.test(msg)) {
    return text('noPairedSend');
  }
  return text('sendError')(msg || text('unknown'));
}
