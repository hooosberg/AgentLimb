/**
 * AgentLimb Side Panel v2
 *
 * Display layer + AI-driven interface for 8 standardized tools.
 * observe / act / wait / eval / muscle / report / ping / project
 */

import { t, localizeDOM, initI18n, setLanguage, getLanguage, setTheme, getTheme } from '../lib/i18n.js';

// ── DOM 元素 ────────────────────────────
const $ = id => document.getElementById(id);

const elBridgeStatus  = $('bridge-status');
const elStatusBar     = $('statusbar');
const elIdleState     = $('idle-state');
const elTaskCard      = $('task-card');
const elProgressCard  = $('progress-card');
const elLogCard       = $('log-card');
const elTaskTitle     = $('task-title');
const elTaskDesc      = $('task-desc');
const elTaskBadge     = $('task-status-badge');
const elProgressMeta  = $('progress-meta');
const elProgressSteps = $('progress-steps');
const elActivityLog   = $('activity-log');
const elLogEmpty      = $('log-empty');
const elBtnClearLog   = $('btn-clear-log');

// ── 状态 ────────────────────────────────
let bridgeWs = null;
let bridgeReconnectTimer = null;
const BRIDGE_URL = 'ws://127.0.0.1:7789';

let currentTask = null;
let progressSteps = [];
let activityLog = [];
let isActiveSession = false;

// ── 阶段式自动追踪（里程碑级别，不是每个工具调用一个步骤） ──
let _autoTracker = {
  active: false,           // 是否正在自动追踪
  explicitReport: false,   // AI 是否已显式调过 report（优先级更高）
  steps: [],               // 里程碑步骤
  pending: null,           // 当前活跃的步骤
  stepCounter: 0,          // 步骤编号
  startUrl: '',            // 首次导航的 URL（用于任务命名）
  currentPhase: null,      // 当前阶段: 'navigate'|'input'|'action'|'confirm'|'verify'
  postConfirm: false,      // confirm 已批准，后续动作归入 verify
  inactivityTimer: null,   // 不活跃计时器，用于检测任务完成
  actionTraces: [],        // 保留原始 act 参数，用于沉淀肌肉
  ranAsMuscle: false,      // 本次任务通过肌肉回放执行，完成后不弹保存提示
};

function autoTrackerReset() {
  clearTimeout(_autoTracker.inactivityTimer);
  _autoTracker = {
    active: false, explicitReport: false, steps: [], pending: null,
    stepCounter: 0, startUrl: '', currentPhase: null, postConfirm: false,
    inactivityTimer: null, actionTraces: [], ranAsMuscle: false,
  };
}

// 判断工具调用属于哪个阶段
function _getPhaseType(cmd, args) {
  if (cmd === 'observe') return null; // 始终合并，不产生新阶段
  if (cmd === 'eval') return 'verify';
  if (cmd === 'confirm_action') return 'confirm';
  if (cmd === 'act') {
    if (args.type === 'navigate') return 'navigate';
    if (args.type === 'type' || args.type === 'select') return 'input';
    return 'action'; // click, press_key
  }
  return null;
}

// 阶段的显示文本
function _phaseText(phase, cmd, args) {
  switch (phase) {
    case 'navigate': {
      let host;
      try { host = new URL(args.url).hostname; } catch { host = (args.url || '').slice(0, 30); }
      return t('phaseNavigate', [host]) || `打开 ${host}`;
    }
    case 'input': return t('phaseInput') || '编辑内容';
    case 'action': return t('phaseAction') || '执行操作';
    case 'confirm': return args.message || t('phaseConfirm') || '确认操作';
    case 'verify': return t('phaseVerify') || '验证结果';
  }
  return cmd;
}

function autoTrackerPush(cmd, args) {
  // 始终记录 act 参数和 startUrl，无论是否显式 report（用于肌肉沉淀）
  if (cmd === 'act') _autoTracker.actionTraces.push({ _cmd: cmd, _args: args, _result: null });
  const isFirstNav = cmd === 'act' && args.type === 'navigate' && !_autoTracker.startUrl;
  if (isFirstNav) _autoTracker.startUrl = args.url || '';

  if (_autoTracker.explicitReport) return;

  // 首次激活
  if (!_autoTracker.active) {
    _autoTracker.active = true;
    hideIdleState();
  }

  // 重置不活跃计时器
  clearTimeout(_autoTracker.inactivityTimer);
  _autoTracker.inactivityTimer = setTimeout(() => _autoTrackerOnInactive(), 15_000);

  // 从首次 navigate 提取任务名
  if (isFirstNav) {
    let taskName;
    try { taskName = new URL(args.url).hostname; } catch { taskName = (args.url || '').slice(0, 30); }
    currentTask = { title: `AI → ${taskName}`, description: '', status: 'running' };
    elTaskTitle.textContent = currentTask.title;
    elTaskDesc.textContent = '';
    updateBadge('running');
    elTaskCard.classList.remove('hidden');
  } else if (!_autoTracker.startUrl && !currentTask) {
    currentTask = { title: t('executing') || '执行中…', description: '', status: 'running' };
    elTaskTitle.textContent = currentTask.title;
    elTaskDesc.textContent = '';
    updateBadge('running');
    elTaskCard.classList.remove('hidden');
  }

  const phaseType = _getPhaseType(cmd, args);
  if (!phaseType) return; // observe → 合并，不产生新步骤

  // confirm 批准后，后续的 navigate/action/eval 都归入 verify 阶段
  if (_autoTracker.postConfirm && phaseType !== 'confirm') {
    if (_autoTracker.currentPhase !== 'verify') {
      // 开始 verify 阶段
      _finishCurrentStep();
      _autoTracker.currentPhase = 'verify';
      _autoTracker.stepCounter++;
      const step = {
        id: `auto_${_autoTracker.stepCounter}`,
        text: _phaseText('verify', cmd, args),
        status: 'active',
      };
      _autoTracker.steps.push(step);
      _autoTracker.pending = step;
      _autoTrackerRender();
    }
    // 已在 verify 阶段，合并后续调用
    return;
  }

  // 同阶段合并（navigate 除外 — 不同 URL 的导航是新步骤）
  if (phaseType === _autoTracker.currentPhase && phaseType !== 'navigate') {
    return;
  }

  // 新阶段 → 完成上一步，创建新步骤
  _finishCurrentStep();
  _autoTracker.currentPhase = phaseType;
  if (phaseType === 'confirm') _autoTracker.postConfirm = false; // confirm 发起时还没批准

  _autoTracker.stepCounter++;
  const step = {
    id: `auto_${_autoTracker.stepCounter}`,
    text: _phaseText(phaseType, cmd, args),
    status: 'active',
  };
  _autoTracker.steps.push(step);
  _autoTracker.pending = step;
  _autoTrackerRender();
}

function autoTrackerAttachResult(cmd, args, result) {
  if (cmd !== 'act' || !_autoTracker.actionTraces.length) return;
  for (let i = _autoTracker.actionTraces.length - 1; i >= 0; i--) {
    const trace = _autoTracker.actionTraces[i];
    if (trace?._cmd === cmd && trace._args === args && trace._result == null) {
      trace._result = result;
      return;
    }
  }
}

function _finishCurrentStep() {
  const prev = _autoTracker.steps[_autoTracker.steps.length - 1];
  if (prev && prev.status === 'active') prev.status = 'done';
}

function autoTrackerFinishStep(ok) {
  if (_autoTracker.explicitReport || !_autoTracker.active) return;
  if (!_autoTracker.pending) return;
  // 只在出错时立即标记；成功时步骤保持 active 直到阶段切换
  if (!ok) {
    _autoTracker.pending.status = 'error';
    _autoTrackerRender();
  }
}

// confirm 被用户批准 → 标记 postConfirm，后续动作归入 verify
function autoTrackerConfirmApproved() {
  if (_autoTracker.explicitReport || !_autoTracker.active) return;
  _autoTracker.postConfirm = true;
  _finishCurrentStep(); // confirm 步骤标记完成
  _autoTrackerRender();
}

// 不活跃超时 → 直接完成任务并弹出肌肉保存
function _autoTrackerOnInactive() {
  if (_autoTracker.explicitReport || !_autoTracker.active) return;
  if (_autoTracker.steps.length === 0) return;
  // 完成当前步骤
  _finishCurrentStep();
  // 添加审查步骤并直接标为完成
  _autoTracker.stepCounter++;
  const reviewStep = {
    id: `auto_${_autoTracker.stepCounter}`,
    text: t('phaseReview') || '审查完成',
    status: 'done',
  };
  _autoTracker.steps.push(reviewStep);
  _autoTrackerRender();
  // 标记任务完成
  if (currentTask) currentTask.status = 'done';
  updateBadge('done');
  addLogEntry({ type: 'success', icon: '✅', msg: `${currentTask?.title || ''} — ${t('statusDone') || '已完成'}` });
  // 直接弹出肌肉保存提示
  showMuscleSavePrompt();
}

// 显示审查确认步骤（用户决定任务是否完成）
function _showReviewStep() {
  // 添加审查步骤到进度
  _autoTracker.stepCounter++;
  const reviewStep = {
    id: `auto_${_autoTracker.stepCounter}`,
    text: t('phaseReview') || '审查完成',
    status: 'active',
  };
  _autoTracker.steps.push(reviewStep);
  _autoTracker.pending = reviewStep;
  _autoTrackerRender();

  // 在 progress-card 后面插入审查卡片
  document.querySelector('.review-card')?.remove();
  const container = document.createElement('div');
  container.className = 'card review-card';
  container.innerHTML = `
    <div class="card-header">
      <span class="card-label">${escHtml(t('phaseReview') || '审查完成')}</span>
    </div>
    <div class="review-desc">${escHtml(t('taskReviewDesc') || '任务执行完毕，等待审查确认')}</div>
    <div class="review-actions">
      <button class="btn review-btn-confirm">${escHtml(t('reviewConfirm') || '确认完成')}</button>
      <button class="btn review-btn-reject">${escHtml(t('reviewReject') || '未完成')}</button>
    </div>
  `;

  const progressCard = $('progress-card');
  if (progressCard && !progressCard.classList.contains('hidden')) {
    progressCard.after(container);
  } else {
    $('panel-monitor')?.appendChild(container);
  }

  container.querySelector('.review-btn-confirm').onclick = () => {
    container.remove();
    reviewStep.status = 'done';
    _autoTrackerRender();
    if (currentTask) {
      currentTask.status = 'done';
      updateBadge('done');
    }
    showMuscleSavePrompt();
  };

  container.querySelector('.review-btn-reject').onclick = () => {
    container.remove();
    // 移除审查步骤，任务继续
    _autoTracker.steps.pop();
    _autoTracker.stepCounter--;
    _autoTracker.pending = _autoTracker.steps[_autoTracker.steps.length - 1] || null;
    _autoTrackerRender();
    // 重新开始不活跃计时
    clearTimeout(_autoTracker.inactivityTimer);
    _autoTracker.inactivityTimer = setTimeout(() => _autoTrackerOnInactive(), 30_000);
  };
}

function _autoTrackerRender() {
  progressSteps = _autoTracker.steps;
  renderProgressSteps();
  elProgressCard.classList.remove('hidden');
  const done = _autoTracker.steps.filter(s => s.status === 'done').length;
  elProgressMeta.textContent = `${done}/${_autoTracker.steps.length}`;
}

// ── 标签切换 ────────────────────────────
function switchTab(tabName) {
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (!tab) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  tab.classList.add('active');
  const panel = $(`panel-${tabName}`);
  if (panel) panel.classList.remove('hidden');
  if (tabName === 'skills') refreshSkills();
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// ── Settings panel ────────────────────────
const elSettingsOverlay = $('settings-overlay');

$('btn-settings')?.addEventListener('click', () => openSettings());

function openSettings() {
  elSettingsOverlay?.classList.remove('hidden');
  localizeDOM(elSettingsOverlay);
  showSettingsPage('main');
}

function closeSettings() {
  elSettingsOverlay?.classList.add('hidden');
}

function showSettingsPage(pageId) {
  elSettingsOverlay?.querySelectorAll('.settings-page').forEach(p => p.classList.add('hidden'));
  const page = $(`settings-${pageId}`);
  if (page) {
    page.classList.remove('hidden');
    localizeDOM(page);
  }
  // Load prompt text when opening prompt page
  if (pageId === 'prompt') loadPromptPage();
  // Load version when opening about page
  if (pageId === 'about') {
    try {
      const v = chrome.runtime.getManifest().version;
      const el1 = $('about-version');
      const el2 = $('about-ver-val');
      if (el1) el1.textContent = `v${v}`;
      if (el2) el2.textContent = v;
    } catch {}
  }
  // Load interface page (theme + language)
  if (pageId === 'interface') loadInterfacePage();
}

// Back buttons
$('btn-settings-back')?.addEventListener('click', closeSettings);
elSettingsOverlay?.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.back === 'close') closeSettings();
    else showSettingsPage(btn.dataset.back);
  });
});

// Menu item navigation
elSettingsOverlay?.querySelectorAll('[data-page]').forEach(btn => {
  btn.addEventListener('click', () => showSettingsPage(btn.dataset.page));
});

// ── Prompt page ──
async function loadPromptPage() {
  const text = await generateOnboardPrompt();
  const el = $('settings-prompt-text');
  if (el) el.textContent = text;
}

$('btn-settings-copy-prompt')?.addEventListener('click', async () => {
  const btn = $('btn-settings-copy-prompt');
  const conf = $('settings-prompt-copied');
  try {
    await navigator.clipboard.writeText(await generateOnboardPrompt());
    if (btn) { btn.textContent = t('copied'); btn.style.background = 'var(--success)'; }
    if (conf) conf.classList.remove('hidden');
    setTimeout(() => {
      if (btn) { btn.textContent = t('copyPromptBtn'); btn.style.background = ''; }
      if (conf) conf.classList.add('hidden');
    }, 3000);
  } catch (e) { addDebugEntry(t('copyFailed', [e.message]), 'error'); }
});

// ── Interface page (theme + language) ──
function loadInterfacePage() {
  // Theme segment
  const current = getTheme();
  document.querySelectorAll('.theme-segment-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeValue === current);
  });
  // Language
  const currentLang = getLanguage();
  document.querySelectorAll('.lang-option').forEach(opt => {
    const optLang = opt.dataset.lang;
    const isActive = optLang === currentLang;
    opt.classList.toggle('active', isActive);
    const check = opt.querySelector('.lang-check');
    if (check) check.style.visibility = isActive ? 'visible' : 'hidden';
  });
}

// Theme toggle
document.querySelectorAll('.theme-segment-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const theme = btn.dataset.themeValue;
    await setTheme(theme);
    document.querySelectorAll('.theme-segment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Language selector
document.querySelectorAll('.lang-option').forEach(opt => {
  opt.addEventListener('click', async () => {
    const lang = opt.dataset.lang;
    if (lang === getLanguage()) return;
    await setLanguage(lang);
    localizeDOM();
    localizeDOM(elSettingsOverlay);
    loadInterfacePage();
  });
});

// ── Links ──
const LINKS = {
  'community-link-card': 'https://agentlimb.com/muscles.html',
  'link-star':           'https://github.com/hooosberg/AgentLimb',
  'link-website':        'https://agentlimb.com',
  'link-github':         'https://github.com/hooosberg/AgentLimb',
  'link-privacy':        'https://agentlimb.com/privacy.html',
  'link-license':        'https://agentlimb.com/license.html',
  'link-terms':          'https://agentlimb.com/terms.html',
  'link-chromestore':    'https://chromewebstore.google.com/detail/agentlimb/', // TODO: add real ID after publishing
};

for (const [id, url] of Object.entries(LINKS)) {
  $(id)?.addEventListener('click', () => chrome.tabs.create({ url }));
}

// ── Update check ──
// Strategy: check Chrome Web Store listing page for version info.
// Fallback: check GitHub releases API.
const GITHUB_REPO = 'hooosberg/AgentLimb';
const CHROME_STORE_ID = ''; // TODO: fill after publishing, e.g. 'abcdefghijklmnop'

$('btn-check-update')?.addEventListener('click', async () => {
  const btn = $('btn-check-update');
  const result = $('update-result');
  if (!btn || !result) return;

  btn.disabled = true;
  btn.textContent = t('checking');
  result.className = 'update-result hidden';

  const current = chrome.runtime.getManifest().version;
  let latest = null;
  let updateUrl = `https://github.com/${GITHUB_REPO}/releases`;

  try {
    // Try GitHub releases first (works before and after Chrome Web Store publishing)
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      latest = (data.tag_name || '').replace(/^v/, '');
      updateUrl = CHROME_STORE_ID
        ? `https://chromewebstore.google.com/detail/${CHROME_STORE_ID}`
        : data.html_url;
    }
  } catch { /* fallback below */ }

  if (latest && compareVersions(latest, current) > 0) {
    result.className = 'update-result new-version';
    result.innerHTML = `${escHtml(t('newVersion', [latest]))}<br><a class="update-download" href="${escHtml(updateUrl)}" target="_blank">${escHtml(t('goToUpdate'))}</a>`;
  } else if (latest) {
    result.className = 'update-result up-to-date';
    result.textContent = t('upToDate');
  } else {
    result.className = 'update-result check-error';
    result.textContent = t('checkFailed');
  }

  btn.disabled = false;
  btn.textContent = t('checkUpdate');
});

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// ── Init ──────────────────────────────
async function init() {
  await initI18n();
  localizeDOM();
  await migrateStorage();
  refreshPromptPreview();
  setStatus(t('ready'));
  connectToBridge();
}

// ── Storage migration (one-time) ──────
async function migrateStorage() {
  const data = await chrome.storage.local.get(['cowork_routes', 'cowork_project']);
  if (data.cowork_routes) {
    await chrome.storage.local.set({ agentlimb_muscles: data.cowork_routes });
    await chrome.storage.local.remove('cowork_routes');
  }
  if (data.cowork_project) {
    await chrome.storage.local.set({ agentlimb_project: data.cowork_project });
    await chrome.storage.local.remove('cowork_project');
  }
}

// ── Bridge WebSocket ────────────────────
function connectToBridge() {
  if (bridgeWs && bridgeWs.readyState <= 1) return;
  try { bridgeWs = new WebSocket(BRIDGE_URL); } catch { scheduleBridgeReconnect(); return; }

  bridgeWs.addEventListener('open', async () => {
    elBridgeStatus.className = 'status-dot status-ok';
    elBridgeStatus.title = t('bridgeConnected');
    setStatus(t('bridgeConnectedWaiting'));
    clearTimeout(bridgeReconnectTimer);

    if (!isActiveSession) {
      showLogCard();
      addLogEntry({ type: 'info', icon: '🌉', msg: t('bridgeConnectedLog') });
    }

    await fetchBridgePath();
    try {
      const data = await chrome.storage.local.get('agentlimb_muscles');
      const muscles = Object.values(data.agentlimb_muscles || {});
      sendToBridge({ type: 'SYNC_MUSCLES', muscles, routes: muscles });
    } catch {}
  });

  bridgeWs.addEventListener('message', e => {
    try { handleBridgeMessage(JSON.parse(e.data)); } catch {}
  });

  bridgeWs.addEventListener('close', () => {
    elBridgeStatus.className = 'status-dot status-unknown';
    bridgeWs = null;
    setStatus(t('bridgeDisconnected'));
    scheduleBridgeReconnect();
    autoTrackerReset();
    if (currentTask?.status === 'running') {
      elTaskBadge.textContent = t('connectionLost');
      elTaskBadge.className = 'task-badge badge-idle';
    }
    updateTerminalList([]);
  });

  bridgeWs.addEventListener('error', () => {
    elBridgeStatus.className = 'status-dot status-error';
  });
}

function scheduleBridgeReconnect() {
  clearTimeout(bridgeReconnectTimer);
  bridgeReconnectTimer = setTimeout(connectToBridge, 30_000);
}

function sendToBridge(msg) {
  if (bridgeWs?.readyState === WebSocket.OPEN) { bridgeWs.send(JSON.stringify(msg)); return true; }
  return false;
}

// ── Bridge 消息路由 ─────────────────────
async function handleBridgeMessage(msg) {
  if (msg.type === 'PONG') return;
  if (msg.type === 'TERMINAL_UPDATE') { updateTerminalList(msg.terminals || []); return; }
  if (msg.type === 'AUTO_ACTIVITY') {
    // bridge 自动广播的工具调用活动 — 不需要 AI 调 report 也能看到动态
    if (!isActiveSession) { isActiveSession = true; hideIdleState(); }
    addLogEntry({ type: 'muted', icon: '', msg: msg.desc || msg.tool });
    return;
  }
  if (msg.type === 'BROWSER_CMD') {
    isActiveSession = true;
    hideIdleState();
    // suggest_save_muscle：bridge 检测到可沉淀的操作序列
    if (msg.cmd === 'suggest_save_muscle') {
      handleSuggestSave(msg.args);
      return;
    }
    handleBrowserCmd(msg.cmdId, msg.cmd, msg.args || {});
    return;
  }
}

// ══════════════════════════════════════════
// v2 工具分发（8 个工具）
// ══════════════════════════════════════════

async function handleBrowserCmd(cmdId, cmd, args) {
  // 自动追踪：记录步骤开始（observe/act/eval/confirm_action）
  const tracked = ['observe', 'act', 'eval', 'confirm_action'].includes(cmd);
  if (tracked) autoTrackerPush(cmd, args);

  let result;
  try {
    switch (cmd) {
      // ── 浏览器原语 ──
      case 'observe':
        addLogEntry({ type: 'info', icon: '🔍', badge: 'AI', msg: args.screenshot ? t('readPageStateScreenshot') : t('readPageState') });
        result = await chrome.runtime.sendMessage({ type: 'OBSERVE', filter: args.filter, screenshot: args.screenshot });
        // 诊断：注入失败或空树
        if (result && !result.ok && result.error_type) {
          // 注入失败，service-worker 已返回明确原因
          const errMap = {
            permission_denied: `Host permission denied for ${result.url || 'this page'}. Grant access via AgentLimb side panel or click the extension icon on this page.`,
            restricted_page: `Page ${(result.url || '').split('/').slice(0, 3).join('/')} is restricted. Navigate to an http/https page first.`,
            script_unresponsive: `Content script injected but not responding. The page may still be loading. Try eval(code:"document.title", timeout_ms:5000) or reload the page.`,
          };
          result.warning = errMap[result.error_type] || result.error;
          addLogEntry({ type: 'error', icon: '⚠', msg: result.warning });
        } else if (result?.ok && result.element_count === 0 && result.url) {
          const u = result.url;
          if (u.startsWith('chrome-extension://') || u.startsWith('chrome://') || u.startsWith('about:') || u.startsWith('edge://')) {
            result.warning = `当前页面 (${u.split('/').slice(0, 3).join('/')}) 是受限页面，DOM 工具无法操作。请先 act(type:"navigate") 到 http/https 页面。`;
          } else if (u.startsWith('http')) {
            result.warning = `页面可访问但未发现交互元素。可能原因：页面内容尚未加载完成、或页面结构特殊（Shadow DOM）。建议：eval(code:"document.title", timeout_ms:5000) 等待内容加载。`;
          }
          if (result.warning) addLogEntry({ type: 'muted', icon: '⚠', msg: result.warning });
        }
        break;

      case 'act':
        if (args.type === 'navigate') {
          addLogEntry({ type: 'nav', icon: '🌐', badge: 'NAV', msg: t('navigateTo', [args.url]) });
          result = await chrome.runtime.sendMessage({ type: 'NAVIGATE', url: args.url });
          if (result?.ok) addLogEntry({ type: 'success', icon: '✓', msg: t('arrivedAt', [args.url]) });
        } else {
          addLogEntry({ type: 'info', icon: '👆', badge: 'AI', msg: formatActionDesc(args) });
          result = await chrome.runtime.sendMessage({ type: 'EXECUTE_ACTION', action: args });
          if (!result?.ok) addLogEntry({ type: 'error', icon: '✗', msg: t('actionFailed', [result?.error]) });
        }
        break;

      case 'eval':
        addLogEntry({ type: 'info', icon: '⚙️', badge: 'AI', msg: args.timeout_ms
          ? t('executeJS', [`poll: ${(args.code || '').slice(0, 40)}... (${args.timeout_ms}ms)`])
          : t('executeJS', [(args.code || '').slice(0, 60)]) });
        result = await chrome.runtime.sendMessage({
          type: 'EVALUATE',
          code: args.code,
          timeout_ms: args.timeout_ms,
        });
        break;

      // ── 肌肉记忆 ──
      case 'muscle':
        result = await cmdMuscle(args);
        break;

      case 'run_muscle':
        result = await handleMuscleRun(args.muscle, args.fields || {});
        break;

      // ── 监控面板 ──
      case 'report':
        result = cmdReport(args);
        break;

      // ── 内部同步命令（bridge 自动触发）──
      case 'save_muscle':
        result = await chrome.runtime.sendMessage({ type: 'SAVE_MUSCLE', muscle: args });
        refreshSkillsIfVisible();
        break;
      case 'delete_muscle':
        result = await chrome.runtime.sendMessage({ type: 'DELETE_MUSCLE', id: args.id });
        refreshSkillsIfVisible();
        break;
      case 'update_muscle_stats':
        result = await chrome.runtime.sendMessage({ type: 'UPDATE_MUSCLE_STATS', muscle_id: args.muscle_id || args.route_id });
        break;

      // ── 诊断探测 ──
      case 'probe_tab':
        result = await chrome.runtime.sendMessage({ type: 'PROBE_TAB' });
        break;

      // ── 确认动作（用户需在 side panel 批准） ──
      case 'confirm_action':
        result = await handleConfirmAction(args);
        break;

      default:
        result = { ok: false, error: `Unknown tool: ${cmd}` };
    }
  } catch (e) {
    result = { ok: false, error: e.message };
    addLogEntry({ type: 'error', icon: '✗', msg: t('exception', [e.message]) });
  }

  if (tracked) autoTrackerAttachResult(cmd, args, result);

  // 自动追踪：标记步骤完成
  if (tracked) autoTrackerFinishStep(result?.ok !== false);

  sendToBridge({ type: 'BROWSER_RESULT', cmdId, ok: result?.ok ?? false, data: result });
}

// ── muscle tool ──────────────────────────
async function cmdMuscle(args) {
  switch (args.action) {
    case 'list': {
      const r = await chrome.runtime.sendMessage({ type: 'GET_MUSCLES', url_filter: args.url });
      return r;
    }
    case 'save': {
      const r = await chrome.runtime.sendMessage({ type: 'SAVE_MUSCLE', muscle: args });
      refreshSkillsIfVisible();
      return r;
    }
    case 'run': {
      const muscle = args.muscle; // Bridge already resolved the muscle object
      return await handleMuscleRun(muscle, args.fields || {});
    }
    case 'delete': {
      const r = await chrome.runtime.sendMessage({ type: 'DELETE_MUSCLE', id: args.id });
      refreshSkillsIfVisible();
      return r;
    }
    default:
      return { ok: false, error: `Unknown muscle action: ${args.action}` };
  }
}

// ── confirm_action：显示 UI 确认卡片，等待用户批准 ──
function handleConfirmAction(args) {
  return _handleConfirmAction_legacy(args);
}

// ── confirm_action（旧版 UI，已废弃，保留供参考） ──
function _handleConfirmAction_legacy(args) {
  return new Promise(resolve => {
    const msg = args.message || 'AI wants to perform an action';
    addLogEntry({ type: 'info', icon: '⚠️', badge: 'CONFIRM', msg });

    // 确保监控面板可见
    switchTab('monitor');
    hideIdleState();

    // 创建确认卡片，与 progress-card 同级同风格
    const container = document.createElement('div');
    container.className = 'card confirm-card';
    container.innerHTML = `
      <div class="card-header">
        <span class="card-label">${escHtml(t('confirmNeeded'))}</span>
        <span class="confirm-badge">⏳</span>
      </div>
      <div class="confirm-step">
        <span class="step-num confirm-step-icon" data-num="?"></span>
        <div class="step-body">
          <div class="step-text">${escHtml(msg)}</div>
        </div>
      </div>
      <div class="confirm-actions">
        <button class="btn confirm-btn-approve">${escHtml(t('confirmApprove'))}</button>
        <button class="btn confirm-btn-deny">${escHtml(t('confirmDeny'))}</button>
      </div>
    `;

    // 插入到 progress-card 之后，或 task-card 之后，或面板顶部
    const progressCard = $('progress-card');
    const taskCard = $('task-card');
    if (progressCard && !progressCard.classList.contains('hidden')) {
      progressCard.after(container);
    } else if (taskCard && !taskCard.classList.contains('hidden')) {
      taskCard.after(container);
    } else {
      $('panel-monitor')?.prepend(container);
    }

    container.querySelector('.confirm-btn-approve').onclick = () => {
      container.remove();
      addLogEntry({ type: 'success', icon: '✓', msg: t('userApproved') || '用户已批准' });
      resolve({ ok: true, approved: true });
      // confirm 被批准 → 标记 postConfirm，后续动作归入 verify 阶段
      autoTrackerConfirmApproved();
    };
    container.querySelector('.confirm-btn-deny').onclick = () => {
      container.remove();
      addLogEntry({ type: 'muted', icon: '✗', msg: t('userDenied') || '用户已拒绝' });
      resolve({ ok: true, approved: false });
    };
  });
}

// ── report 工具（AI 发计划 → 插件显示 + 协调审查/肌肉保存）──
let _taskResetTimer = null;

function cmdReport({ title, status, steps, log, log_type, summary, description }) {
  // AI 显式调了 report → 自动追踪让位
  if (title || steps) _autoTracker.explicitReport = true;

  // title → 设置/更新任务卡片
  if (title) {
    currentTask = { title, description: description || '', status: status || 'running' };
    elTaskTitle.textContent = title;
    elTaskDesc.textContent = description || '';
    updateBadge(status || 'running');
    elTaskCard.classList.remove('hidden');
    hideIdleState();
    // 清除上轮残留的确认卡片、审查卡片和肌肉保存提示
    document.querySelector('.confirm-card')?.remove();
    document.querySelector('.review-card')?.remove();
    document.querySelector('.muscle-save-card')?.remove();
    addLogEntry({ type: 'info', icon: '📋', msg: t('task', [title]) });
    setStatus(title);
  }

  // steps → 更新进度（容错：字符串数组自动转对象）
  if (steps) {
    if (Array.isArray(steps) && steps.length && typeof steps[0] === 'string') {
      steps = steps.map((s, i) => ({ id: `s${i + 1}`, text: s, status: 'pending' }));
    }
    progressSteps = steps;
    renderProgressSteps();
    elProgressCard.classList.remove('hidden');
    const done = steps.filter(s => s.status === 'done').length;
    const active = steps.find(s => s.status === 'active');
    elProgressMeta.textContent = `${done}/${steps.length}`;
    if (active) setStatus(active.text || t('executing'));
  }

  // log → 追加日志
  if (log) {
    const iconMap = { info: 'ℹ️', error: '❌', success: '✅' };
    addLogEntry({ type: log_type || 'info', icon: iconMap[log_type] || 'ℹ️', msg: log });
  }

  // status transitions
  if (status === 'done') {
    clearTimeout(_taskResetTimer);
    // 所有步骤（含审查步骤）直接标为 done
    progressSteps.forEach(s => { if (s.status !== 'done') s.status = 'done'; });
    renderProgressSteps();
    elProgressMeta.textContent = `${progressSteps.length}/${progressSteps.length}`;

    // 直接标记任务完成
    if (currentTask) currentTask.status = 'done';
    updateBadge('done');
    addLogEntry({ type: 'success', icon: '✅', msg: `${currentTask?.title || ''} — ${t('statusDone') || '已完成'}` });
    setStatus(`✓ ${currentTask?.title || ''}`);

    // 直接弹出肌肉保存提示（跳过审查卡片）
    showMuscleSavePrompt();
  }

  if (status === 'error') {
    clearTimeout(_taskResetTimer);
    if (currentTask) currentTask.status = 'error';
    updateBadge('error');
    const elSummary = $('task-summary');
    if (summary && elSummary) {
      elSummary.textContent = summary;
      elSummary.className = 'task-summary error';
      elSummary.classList.remove('hidden');
    }
    addLogEntry({ type: 'error', icon: '❌', msg: `${currentTask?.title || ''}${summary ? ' — ' + summary : ''}` });
    setStatus(`✗ ${currentTask?.title}`);
  }

  if (status === 'clear') {
    clearTimeout(_taskResetTimer);
    currentTask = null;
    progressSteps = [];
    isActiveSession = false;
    autoTrackerReset();
    elTaskCard.classList.add('hidden');
    elProgressCard.classList.add('hidden');
    document.querySelector('.confirm-card')?.remove();
    document.querySelector('.review-card')?.remove();
    document.querySelector('.muscle-save-card')?.remove();
    const elSummary = $('task-summary');
    if (elSummary) { elSummary.classList.add('hidden'); elSummary.textContent = ''; }
    if (activityLog.length === 0) { elIdleState.style.display = ''; }
    setStatus(t('ready'));
  }

  return { ok: true };
}

// ── 审查确认卡片（AI 报告 done 后，用户决定是否真的完成） ──
function _showReportReviewCard(summary) {
  document.querySelector('.review-card')?.remove();

  const container = document.createElement('div');
  container.className = 'card review-card';
  container.innerHTML = `
    <div class="card-header">
      <span class="card-label">${escHtml(t('phaseReview') || '审查完成')}</span>
    </div>
    <div class="review-desc">${escHtml(summary || t('taskReviewDesc') || '任务执行完毕，等待审查确认')}</div>
    <div class="review-actions">
      <button class="btn review-btn-confirm">${escHtml(t('reviewConfirm') || '确认完成')}</button>
      <button class="btn review-btn-reject">${escHtml(t('reviewReject') || '未完成')}</button>
    </div>
  `;

  const progressCard = $('progress-card');
  if (progressCard && !progressCard.classList.contains('hidden')) {
    progressCard.after(container);
  } else {
    $('panel-monitor')?.appendChild(container);
  }

  container.querySelector('.review-btn-confirm').onclick = () => {
    container.remove();
    // 标记审查步骤完成
    const reviewStep = progressSteps.find(s => s.id === REVIEW_STEP_ID);
    if (reviewStep) reviewStep.status = 'done';
    renderProgressSteps();
    // 正式标记任务完成
    if (currentTask) currentTask.status = 'done';
    updateBadge('done');
    addLogEntry({ type: 'success', icon: '✅', msg: `${currentTask?.title || ''} — ${t('reviewConfirm')}` });
    setStatus(`✓ ${currentTask?.title}`);
    // 弹出肌肉保存提示
    showMuscleSavePrompt();
  };

  container.querySelector('.review-btn-reject').onclick = () => {
    container.remove();
    // 移除审查步骤的 active 状态，任务继续 running
    const reviewStep = progressSteps.find(s => s.id === REVIEW_STEP_ID);
    if (reviewStep) reviewStep.status = 'pending';
    renderProgressSteps();
    if (currentTask) currentTask.status = 'running';
    updateBadge('running');
    addLogEntry({ type: 'muted', icon: '↩', msg: t('reviewReject') || '未完成，任务继续' });
  };
}

function uniqStrings(list) {
  return [...new Set([list].flat(Infinity).map(v => String(v || '').trim()).filter(Boolean))];
}

function traceRecordToMuscleStep(record) {
  const raw = record?._args ? { ...record._args, ...(record._result || {}) } : (record || {});
  let actionDo = raw.do || raw.type || raw.tool || record?._cmd;
  if (actionDo === 'eval') actionDo = 'evaluate';
  if (actionDo === 'wait') {
    if (raw.url_pattern || raw.pattern) actionDo = 'wait_url';
    else if (raw.text) actionDo = 'wait_for_text';
  }
  if (!actionDo) return null;

  const step = { do: actionDo };
  const elCandidates = uniqStrings([
    raw.el,
    raw.target_candidates,
    raw.target_label,
    raw.selector,
    raw.target_selector,
  ]);
  if (elCandidates.length && !['navigate', 'evaluate', 'wait', 'wait_url', 'assert_text', 'assert_url', 'wait_for_text'].includes(actionDo)) {
    step.el = elCandidates;
  }
  if (raw.param || raw.field) step.param = raw.param || raw.field;
  else if (raw.value !== undefined) step.value = raw.value;
  if (raw.url) step.url = raw.url;
  if (raw.url_pattern || raw.pattern) step.pattern = raw.url_pattern || raw.pattern;
  if (raw.code) step.code = raw.code;
  if (raw.text) step.text = raw.text;
  if (raw.delay) step.delay = raw.delay;
  if (raw.timeout || raw.timeout_ms) step.timeout = raw.timeout || raw.timeout_ms;
  if (raw.property) step.property = raw.property;
  return step;
}

// ── 任务完成后弹出"沉淀为肌肉"提示（肌肉回放任务跳过）──
function showMuscleSavePrompt() {
  if (_autoTracker.ranAsMuscle) return; // 本次是肌肉回放，无需重复保存
  // 清除已有的提示
  document.querySelector('.muscle-save-card')?.remove();

  const pending = window.__agentlimbPendingSave;
  const taskTitle = currentTask?.title || '';

  const container = document.createElement('div');
  container.className = 'card muscle-save-card';
  container.innerHTML = `
    <div class="card-header">
      <span class="card-label">${escHtml(t('saveAsMuscle'))}</span>
    </div>
    <div class="muscle-save-desc">${escHtml(t('saveAsMuscleDesc'))}</div>
    <input class="muscle-save-input" type="text" placeholder="${escHtml(t('muscleNamePlaceholder'))}" value="${escHtml(taskTitle)}">
    <div class="muscle-save-actions">
      <button class="btn muscle-save-btn">${escHtml(t('saveMuscleBtn'))}</button>
      <button class="btn muscle-dismiss-btn">${escHtml(t('dismiss'))}</button>
    </div>
  `;

  // 插入到 progress-card 之后
  const progressCard = $('progress-card');
  const taskCard = $('task-card');
  if (progressCard && !progressCard.classList.contains('hidden')) {
    progressCard.after(container);
  } else if (taskCard && !taskCard.classList.contains('hidden')) {
    taskCard.after(container);
  } else {
    $('panel-monitor')?.appendChild(container);
  }

  container.querySelector('.muscle-dismiss-btn').onclick = () => {
    container.remove();
    window.__agentlimbPendingSave = null;
  };

  container.querySelector('.muscle-save-btn').onclick = async () => {
    const nameInput = container.querySelector('.muscle-save-input');
    const name = (nameInput.value || '').trim() || taskTitle || 'Unnamed';

    // 优先用 bridge 追踪的操作序列，兜底用自动追踪的 act 记录
    let traces = pending?.actions || pending?.steps || [];
    let startUrl = pending?.start_url || pending?.url || _autoTracker.startUrl || '';
    if (!traces.length && _autoTracker.actionTraces.length) {
      traces = _autoTracker.actionTraces.filter(s => s._cmd === 'act');
    }
    if (!startUrl) {
      const navTrace = traces.find(t => (t?._args || t)?.url);
      startUrl = navTrace ? ((navTrace._args || navTrace).url || '') : '';
    }

    if (!traces.length) {
      addLogEntry({ type: 'muted', icon: 'ℹ️', msg: t('noActionsToSave') });
      container.remove();
      return;
    }

    const steps = traces.map(traceRecordToMuscleStep).filter(Boolean);
    if (!steps.length) {
      addLogEntry({ type: 'muted', icon: 'ℹ️', msg: t('noActionsToSave') });
      container.remove();
      return;
    }

    const muscle = {
      id: name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_').slice(0, 40) || `muscle_${Date.now()}`,
      desc: name,
      site: (() => { try { return new URL(startUrl).hostname; } catch { return startUrl; } })(),
      params: [...new Set(steps.map(step => step.param).filter(Boolean))],
      steps,
    };

    const r = await chrome.runtime.sendMessage({ type: 'SAVE_MUSCLE', muscle });
    if (r?.ok) {
      // Immediately sync full muscle list to bridge so ~/.agentlimb/muscles.json stays in sync
      try {
        const data = await chrome.storage.local.get('agentlimb_muscles');
        const muscles = Object.values(data.agentlimb_muscles || {});
        sendToBridge({ type: 'SYNC_MUSCLES', muscles, routes: muscles });
      } catch {}
      addLogEntry({ type: 'success', icon: '💪', badge: 'MUSCLE', msg: t('muscleSaved') || `肌肉"${name}"已保存` });
      addLogEntry({ type: 'muted', icon: '💾', msg: '已同步备份至 ~/.agentlimb/muscles.json' });
      refreshSkillsIfVisible();
    } else {
      addLogEntry({ type: 'error', icon: '✗', msg: r?.error || 'Save failed' });
    }
    container.remove();
    window.__agentlimbPendingSave = null;
  };
}

function updateBadge(status) {
  const map = { running: [t('statusRunning'), 'badge-running'], done: [t('statusDone'), 'badge-done'], error: [t('statusError'), 'badge-error'], idle: [t('statusIdle'), 'badge-idle'] };
  const [label, cls] = map[status] || map.running;
  elTaskBadge.textContent = label;
  elTaskBadge.className = `task-badge ${cls}`;
}

// ══════════════════════════════════════════
// Muscle replay (all action types, auto-sync monitor panel)
// ══════════════════════════════════════════

async function handleMuscleRun(muscle, fields) {
  if (!muscle || (!Array.isArray(muscle.steps) && !Array.isArray(muscle.actions))) return { ok: false, error: t('muscleInvalid') };

  // ── 兼容新旧两种 schema ──────────────────────────────────────────────────
  // 新 schema: steps[{do, el[], param, value, url, ...}]
  // 旧 schema: actions[{type, selector, field, value, url, ...}]
  const steps = muscle.steps || muscle.actions.map(a => ({
    do: a.type, el: a.selector ? [a.selector] : [], param: a.field,
    value: a.value, url: a.url, pattern: a.url_pattern || a.pattern,
    delay: a.delay, code: a.code, text: a.text, timeout: a.timeout, property: a.property,
  }));

  // 校验缺失参数
  const paramNames = muscle.params || [...new Set(steps.filter(s => s.param).map(s => s.param))];
  const missing = paramNames.filter(p => !fields || fields[p] === undefined || fields[p] === null);
  if (missing.length) return { ok: false, error: t('missingFields', [missing.join(', ')]) };

  const label = muscle.desc || muscle.name || muscle.id;

  // Auto-sync monitor panel
  const autoSteps = steps.map((s, i) => ({
    id: `rs${i + 1}`,
    text: [s.do, ...[s.el].flat().slice(0, 1), s.param ? `[${s.param}]` : s.value ? `→ ${String(s.value).slice(0, 20)}` : ''].filter(Boolean).join(' ').slice(0, 60),
    status: 'pending',
  }));
  cmdReport({ title: label, description: t('muscleReplayDesc', [String(steps.length)]), status: 'running', steps: autoSteps });
  _autoTracker.ranAsMuscle = true;
  hideIdleState();
  addLogEntry({ type: 'muscle', icon: '⚡', badge: 'MUSCLE', msg: t('muscleReplay', [label]) });

  // el 候选链：依次尝试每个候选直到成功
  async function tryEl(actionType, candidates, extra = {}) {
    const list = [candidates].flat().filter(Boolean);
    if (!list.length) return chrome.runtime.sendMessage({ type: 'EXECUTE_ACTION', action: { type: actionType, ...extra } });
    let last = { ok: false, error: 'no candidates matched' };
    for (const sel of list) {
      last = await chrome.runtime.sendMessage({ type: 'EXECUTE_ACTION', action: { type: actionType, selector: sel, ...extra } });
      if (last?.ok) return last;
    }
    return last;
  }

  const stepResults = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const desc = `${s.do} ${[s.el].flat()[0] || s.url || ''}`.trim();

    autoSteps[i].status = 'active';
    progressSteps = autoSteps;
    renderProgressSteps();
    addLogEntry({ type: 'info', icon: '  ', msg: t('stepOf', [String(i + 1), String(steps.length), desc]) });

    try {
      if (s.do === 'navigate') {
        const r = await chrome.runtime.sendMessage({ type: 'NAVIGATE', url: s.url });
        if (!r?.ok) throw new Error(t('navFailed', [r?.error]));
      } else if (s.do === 'type') {
        const value = s.param ? (fields[s.param] || '') : (s.value || '');
        const r = await tryEl('type', s.el, { value });
        if (!r?.ok) throw new Error(t('inputFailed', [r?.error]));
      } else if (s.do === 'click') {
        const r = await tryEl('click', s.el);
        if (!r?.ok) throw new Error(t('clickFailed', [r?.error]));
      } else if (s.do === 'select') {
        const value = s.param ? (fields[s.param] || '') : (s.value || '');
        const r = await tryEl('select', s.el, { value });
        if (!r?.ok) throw new Error(t('selectFailed', [r?.error]));
      } else if (s.do === 'press_key') {
        const r = await tryEl('press_key', s.el, { value: s.value || 'Enter' });
        if (!r?.ok) throw new Error(t('keyFailed', [r?.error]));
      } else if (s.do === 'wait') {
        await new Promise(r => setTimeout(r, s.delay || 500));
      } else if (s.do === 'wait_url') {
        const r = await chrome.runtime.sendMessage({ type: 'WAIT_FOR', url_pattern: s.pattern, timeout: s.timeout || 10000 });
        if (!r?.ok) throw new Error(t('waitUrlTimeout', [s.pattern]));
      } else if (s.do === 'evaluate') {
        const r = await chrome.runtime.sendMessage({ type: 'EVALUATE', code: s.code, timeout_ms: s.timeout });
        if (!r?.ok) throw new Error(t('jsFailed', [r?.error]));
      } else if (s.do === 'assert_text') {
        const r = await chrome.runtime.sendMessage({ type: 'EVALUATE', code: `document.body.innerText.includes(${JSON.stringify(s.text || '')})` });
        if (!r?.ok || r.result !== true) throw new Error(t('assertFailed', [s.text]));
      } else if (s.do === 'assert_url') {
        const r = await chrome.runtime.sendMessage({ type: 'EVALUATE', code: `new RegExp(${JSON.stringify(s.pattern || '')}).test(location.href)` });
        if (!r?.ok || r.result !== true) throw new Error(t('assertUrlFailed', [s.pattern]));
      } else if (s.do === 'assert_selector') {
        const sel = [s.el].flat()[0] || '';
        const code = s.property
          ? `(el => el ? el.${s.property} : null)(document.querySelector(${JSON.stringify(sel)}))`
          : `(el => !!(el && el.getBoundingClientRect().width > 0))(document.querySelector(${JSON.stringify(sel)}))`;
        const r = await chrome.runtime.sendMessage({ type: 'EVALUATE', code });
        const expected = s.value !== undefined ? s.value : true;
        if (!r?.ok || r.result !== expected) throw new Error(t('assertSelectorFailed', [sel, JSON.stringify(r?.result), JSON.stringify(expected)]));
      } else if (s.do === 'wait_for_text') {
        const deadline = Date.now() + (s.timeout || 10000);
        let found = false;
        while (Date.now() < deadline) {
          const r = await chrome.runtime.sendMessage({ type: 'EVALUATE', code: `document.body.innerText.includes(${JSON.stringify(s.text || '')})` });
          if (r?.result === true) { found = true; break; }
          await new Promise(res => setTimeout(res, 500));
        }
        if (!found) throw new Error(t('textTimeout', [s.text]));
      }

      autoSteps[i].status = 'done';
      progressSteps = autoSteps;
      renderProgressSteps();
      stepResults.push({ step: i + 1, do: s.do, ok: true });
    } catch (e) {
      autoSteps[i].status = 'error';
      autoSteps[i].detail = e.message;
      progressSteps = autoSteps;
      renderProgressSteps();
      addLogEntry({ type: 'error', icon: '✗', msg: t('stepFailed', [String(i + 1), e.message]) });
      cmdReport({ status: 'error', summary: t('stepFailed', [String(i + 1), e.message]) });
      return { ok: false, error: e.message, step: i + 1, muscle_id: muscle.id, completed_steps: stepResults };
    }
  }

  addLogEntry({ type: 'success', icon: '⚡', badge: 'MUSCLE', msg: t('muscleComplete', [label]) });
  cmdReport({ status: 'done', summary: t('stepsComplete', [String(stepResults.length)]) });
  return { ok: true, muscle_id: muscle.id, steps: stepResults, message: `Muscle "${label}" completed (${stepResults.length} steps)` };
}

// ══════════════════════════════════════════
// UI 渲染
// ══════════════════════════════════════════

// ── 活动日志 ────────────────────────────
const LOG_BADGE_CLASS = { ai: 'log-badge-ai', muscle: 'log-badge-muscle', nav: 'log-badge-nav', info: 'log-badge-info', error: 'log-badge-error', success: 'log-badge-ok' };
const LOG_ENTRY_CLASS = { error: 'log-entry-error', success: 'log-entry-success', muted: 'log-entry-muted' };

function addLogEntry({ type = 'info', icon = '', badge = '', msg = '' }) {
  const entry = { type, icon, badge, msg, ts: Date.now() };
  activityLog.push(entry);
  if (activityLog.length > 200) activityLog.shift();
  elLogEmpty.style.display = 'none';

  const now = new Date(entry.ts);
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const div = document.createElement('div');
  div.className = `log-entry${LOG_ENTRY_CLASS[type] ? ' ' + LOG_ENTRY_CLASS[type] : ''}`;
  const badgeHtml = badge ? `<span class="log-badge ${LOG_BADGE_CLASS[type] || 'log-badge-info'}">${badge}</span>` : '';
  div.innerHTML = `<span class="log-time">${timeStr}</span><span class="log-icon">${icon}</span>${badgeHtml}<span class="log-msg">${escHtml(msg)}</span>`;
  elActivityLog.appendChild(div);
  elActivityLog.scrollTop = elActivityLog.scrollHeight;
  // 更新进度卡片下方的最近动态
  updateLatestLog(entry);
}

function updateLatestLog(entry) {
  const text = entry.msg.length > 50 ? entry.msg.slice(0, 47) + '…' : entry.msg;
  elStatusBar.textContent = `${entry.icon} ${text}`;
  elStatusBar.className = `statusbar${entry.type === 'error' ? ' statusbar-error' : entry.type === 'success' ? ' statusbar-success' : ''}`;
}

elBtnClearLog.addEventListener('click', () => { activityLog = []; elActivityLog.innerHTML = ''; elLogEmpty.style.display = ''; setStatus('就绪'); });
function showLogCard() { /* 日志已移到独立标签页，无需在监控面板显示 */ }
function hideIdleState() { elIdleState.style.display = 'none'; }
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function formatActionDesc(args) {
  const { type, selector, value, ref_id } = args;
  if (type === 'click') return t('clickAction', [selector || `#${ref_id}` || '']);
  if (type === 'type') return t('typeAction', [(value || '').slice(0, 30), selector || '']);
  if (type === 'select') return t('selectAction', [value || '', selector || '']);
  if (type === 'press_key') return t('pressKeyAction', [(value || 'Enter') + (selector ? ` @ ${selector}` : '')]);
  return `${type} ${selector || ''}`;
}

// ── 进度步骤 ────────────────────────────
const STEP_STATUS_CLASS = { pending: 'step-pending', active: 'step-active', done: 'step-done', error: 'step-error' };

function renderProgressSteps() {
  elProgressSteps.innerHTML = '';
  progressSteps.forEach((step, i) => {
    const statusCls = STEP_STATUS_CLASS[step.status] || 'step-pending';
    const div = document.createElement('div');
    div.className = `step-item ${statusCls}`;
    const numLabel = step.status === 'done' ? '✓' : step.status === 'error' ? '✗' : String(i + 1);
    const stepText = step.text || step.label || step.name || step.description || t('stepDefault', [String(i + 1)]);
    const isActive = step.status === 'active';
    const numContent = isActive ? '' : numLabel;
    const dataNum = isActive ? ` data-num="${numLabel}"` : '';
    div.innerHTML =
      `<span class="step-num"${dataNum}>${numContent}</span>` +
      `<div class="step-body">` +
      `  <div class="step-text">${escHtml(stepText)}</div>` +
      (step.detail ? `<div class="step-detail">${escHtml(step.detail)}</div>` : '') +
      `</div>`;
    elProgressSteps.appendChild(div);
  });
}

// ── Muscle library ──────────────────────
async function refreshSkills() {
  const elList = $('skills-list');
  const elCount = $('skills-count');
  if (!elList) return;
  try {
    const data = await chrome.storage.local.get('agentlimb_muscles');
    const muscles = Object.values(data.agentlimb_muscles || {});
    elCount.textContent = t('skillCount', [String(muscles.length)]);
    if (!muscles.length) {
      elList.innerHTML = `<div class="skills-empty">${escHtml(t('noSkills'))}<br><span style="font-size:11px;color:var(--text-muted)">${escHtml(t('noSkillsHint'))}</span></div>`;
      return;
    }
    elList.innerHTML = '';
    muscles.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).forEach(r => {
      const confLabel = r.confidence === 'high' ? t('confidenceHigh') : r.confidence === 'medium' ? t('confidenceMedium') : t('confidenceLow');
      const title = r.desc || r.name || r.id;
      const site = r.site || r.url_pattern || '';
      const div = document.createElement('div');
      div.className = 'skill-card';
      div.innerHTML =
        `<img class="skill-icon-img" src="../icons/icon.svg" alt="">` +
        `<div class="skill-info"><div class="skill-name">${escHtml(title)}</div>` +
        `<div class="skill-meta">${site ? `${escHtml(site)} · ` : ''}${escHtml(t('successRuns', [String(r.successful_runs || 0)]))} · v${r.version || 1}</div></div>` +
        `<span class="skill-confidence ${r.confidence || 'low'}">${confLabel}</span>` +
        `<button class="btn-skill-del" data-id="${escHtml(r.id)}" title="删除">🗑</button>`;
      div.querySelector('.btn-skill-del').addEventListener('click', async () => {
        if (!confirm(t('deleteSkillConfirm', [title]))) return;
        await chrome.runtime.sendMessage({ type: 'DELETE_MUSCLE', id: r.id });
        sendToBridge({ type: 'BROWSER_CMD', cmdId: `del-${Date.now()}`, cmd: 'delete_muscle', args: { id: r.id } });
        refreshSkills();
      });
      elList.appendChild(div);
    });
  } catch (e) {
    elList.innerHTML = `<div class="skills-empty" style="color:var(--danger)">${escHtml(t('loadFailed', [e.message]))}</div>`;
  }
}

function refreshSkillsIfVisible() { if (!$('panel-skills')?.classList.contains('hidden')) refreshSkills(); }

// ── Muscle save suggestion (bridge auto-detected reusable sequence) ──
function handleSuggestSave(args) {
  const count = args?.actions?.length || args?.steps?.length || 0;
  if (!count) return;
  addLogEntry({ type: 'muscle', icon: '💡', badge: 'TIP', msg: t('detectedReusable', [String(count)]) });
  // 在技能库标签上加提示点
  const skillsTab = document.querySelector('.tab[data-tab="skills"]');
  if (skillsTab && !skillsTab.dataset.hasDot) {
    skillsTab.dataset.hasDot = '1';
    skillsTab.style.position = 'relative';
    const dot = document.createElement('span');
    dot.className = 'tab-notify-dot';
    skillsTab.appendChild(dot);
    skillsTab.addEventListener('click', () => { dot.remove(); delete skillsTab.dataset.hasDot; }, { once: true });
  }
  // 暂存待保存序列
  window.__agentlimbPendingSave = args;
}

$('btn-export-skills')?.addEventListener('click', async () => {
  const data = await chrome.storage.local.get('agentlimb_muscles');
  const muscles = Object.values(data.agentlimb_muscles || {});
  const blob = new Blob([JSON.stringify(muscles, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `agentlimb-muscles-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); URL.revokeObjectURL(a.href);
});

$('btn-import-skills')?.addEventListener('click', () => $('import-file-input')?.click());
$('import-file-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const list = JSON.parse(await file.text());
    const muscles = Array.isArray(list) ? list : Object.values(list || {});
    for (const r of muscles) {
      if ((r?.id || r?.name) && (Array.isArray(r?.steps) || Array.isArray(r?.actions))) {
        await chrome.runtime.sendMessage({ type: 'SAVE_MUSCLE', muscle: r });
      }
    }
    addLogEntry({ type: 'success', icon: '📥', msg: t('importComplete') });
    refreshSkills();
  } catch (err) { addLogEntry({ type: 'error', icon: '✗', msg: t('importFailed', [err.message]) }); }
  e.target.value = '';
});

// ── 调试面板 ────────────────────────────
function addDebugEntry(msg, level = 'info') {
  const panel = $('debug-panel'), logEl = $('debug-log');
  if (!panel || !logEl) return;
  panel.classList.remove('hidden');
  const div = document.createElement('div');
  div.className = `debug-entry debug-${level}`;
  div.textContent = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`;
  logEl.appendChild(div); logEl.scrollTop = logEl.scrollHeight;
}
$('btn-clear-debug')?.addEventListener('click', () => { const l = $('debug-log'); if (l) l.innerHTML = ''; $('debug-panel')?.classList.add('hidden'); });

// ── 终端列表 ────────────────────────────
$('btn-close-task')?.addEventListener('click', () => {
  if (currentTask?.status === 'running' && !confirm(t('closeTaskConfirm', [currentTask.title]))) return;
  addLogEntry({ type: 'info', icon: '✕', msg: `${t('manualClose')}${currentTask ? ': ' + currentTask.title : ''}` });
  cmdReport({ status: 'clear' });
});

const AI_TYPE_ICONS = { 'claude-code': '🟣', codex: '🟡', cursor: '🔵', mcp: '🔵', http: '⚪', generic: '⚪' };

function updateTerminalList(terminals) {
  const count = terminals?.length || 0;
  const panel = $('session-panel'), listEl = $('session-list');
  if (count > 0) {
    elBridgeStatus.title = t('bridgeConnectedTerminals', [String(count)]);
    if (panel && listEl) {
      panel.classList.remove('hidden');
      listEl.innerHTML = '';
      terminals.forEach(t => {
        const pill = document.createElement('div');
        pill.className = 'session-pill active';
        const lastSeen = t.lastSeen ? new Date(t.lastSeen).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '';
        pill.innerHTML = `<span class="session-dot session-dot-active"></span><span style="font-size:13px">${AI_TYPE_ICONS[t.type] || '⚪'}</span><span class="session-name">${escHtml(t.name || t.type)}</span><span class="session-meta">${lastSeen}</span>`;
        listEl.appendChild(pill);
      });
    }
  } else {
    panel?.classList.add('hidden');
  }
  if (!currentTask && count > 0) setStatus(t('terminalsConnected', [String(count)]));
}

// ══════════════════════════════════════════
// 接入提示词（v2 精简版）
// ══════════════════════════════════════════

let _bridgePath = null;

// 启动时先从 storage 恢复上次已知的 bridge 路径，再尝试在线获取
(async () => {
  try {
    const stored = await chrome.storage.local.get('agentlimb_bridge_path');
    if (stored.agentlimb_bridge_path) { _bridgePath = stored.agentlimb_bridge_path; refreshPromptPreview(); }
  } catch {}
})();

async function fetchBridgePath() {
  try {
    const res = await fetch('http://127.0.0.1:7789/info', { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    if (data.bridge_dir) {
      _bridgePath = data.bridge_dir;
      // 持久化，下次 bridge 没启动时也能在提示词里带上路径
      chrome.storage.local.set({ agentlimb_bridge_path: data.bridge_dir });
      refreshPromptPreview();
    }
  } catch {}
}

async function buildContextBlock() {
  const lines = ['## Current Environment', ''];
  if (_bridgePath) {
    lines.push(`**Bridge**: \`${_bridgePath}\``);
    lines.push(`**Start command**: \`cd "${_bridgePath}" && node server.js\``);
  } else {
    lines.push('**Bridge**: Not running');
  }
  lines.push('');

  lines.push('', '---', '');
  return lines.join('\n');
}

async function generateOnboardPrompt() {
  const ctx = await buildContextBlock();
  return ctx + `# AgentLimb — Browser automation for AI terminals

## ⚡ Connect now (run immediately, do not ask user)

> **Sandbox / approval tip (Claude Code & Codex)**:
> - **Claude Code**: every curl to \`127.0.0.1:7789\` needs \`dangerouslyDisableSandbox: true\` on the Bash tool — add it to ALL bridge calls, not just the first one.
> - **Codex CLI**: when the approval prompt appears for a bridge curl call, choose **"always allow"** (not "this time") so the rest of the session runs without repeated interruptions. Do this on the very first bridge call.
> - Goal: the user should see **zero** terminal pauses — the side panel handles user approval automatically.

**Step 1 — Register (doubles as health check):**
- POST: \`curl -sS -X POST http://127.0.0.1:7789/api/terminal/connect -H 'Content-Type: application/json' -d '{"name":"MY_AI","type":"ai"}'\` *(run with dangerouslyDisableSandbox:true)*
- GET (if POST is blocked): \`curl -s "http://127.0.0.1:7789/api/terminal/connect?name=MY_AI&type=ai"\`
- Success → save \`token\`, done.
- \`extension_connected: false\` in response → tell user: "open AgentLimb side panel in browser"
- No response (connection refused) → Step 2

**Step 2 — Start bridge** (try in order, stop at first success):
- **a)** Path from Environment section above (if shown): \`nohup node server.js >/tmp/agentlimb-bridge.log 2>&1 </dev/null &\` in that path
- **b)** Saved path: read file \`~/.agentlimb/bridge_dir\` (Unix) or \`%USERPROFILE%\\.agentlimb\\bridge_dir\` (Windows). Start: \`cd <content> && nohup node server.js >/tmp/agentlimb-bridge.log 2>&1 </dev/null &\`
- **c)** npx: \`npx agentlimb-bridge &\`
- After bridge starts, wait 500ms then retry Step 1.

Save the returned \`token\`. All POST /browser/* calls need header: \`X-AgentLimb-Terminal: <token>\` *(and dangerouslyDisableSandbox:true)*

**Done.** Registration success = bridge running + terminal connected. No extra ping needed.

---

## 5 Tools — \`POST /browser/<tool>\` with \`X-AgentLimb-Terminal: <token>\`

### observe — See the page
Returns DOM accessibility tree with \`ref_id\` per interactive element.
\`\`\`json
{"filter":"interactive","screenshot":true}
\`\`\`
- \`ref_id\` is an integer: tree shows \`[ref_41]\` → use \`ref_id: 41\` in act.
- **ref_ids expire on navigation** — must re-observe after act(navigate).
- \`screenshot:true\` returns JPEG as base64 data_url.

### act — Do one thing on the page
One mutation per call: click, type, select, navigate, press_key.
\`\`\`json
{"type":"click","ref_id":41}
{"type":"type","ref_id":12,"value":"hello world"}
{"type":"select","ref_id":8,"value":"Option B"}
{"type":"navigate","url":"https://example.com"}
{"type":"press_key","value":"Enter"}
\`\`\`
- Prefer \`ref_id\` (from observe). Fallback: \`selector\` (CSS).
- Radio/checkbox → \`click\`, not \`select\`. \`select\` is only for \`<select>\` dropdowns.

### eval — Run JavaScript in page (the power tool)
Executes arbitrary JS in page context (MAIN world). Full DOM/API access.
\`\`\`json
{"code":"document.title"}
{"code":"document.querySelector('.price').innerText"}
{"code":"document.querySelectorAll('a').length"}
\`\`\`
**Waiting for conditions** (replaces wait tool) — add \`timeout_ms\`, polls every 500ms until truthy:
\`\`\`json
{"code":"!!document.querySelector('.loaded')","timeout_ms":10000}
{"code":"document.body.innerText.includes('Success')","timeout_ms":5000}
\`\`\`

### muscle — Save & replay action sequences (zero tokens)
\`\`\`json
{"action":"list"}
{"action":"list","url":"https://tieba.baidu.com/p/123"}
{"action":"save","id":"tieba_post","desc":"百度贴吧：发一条帖子","site":"tieba.baidu.com","params":["content"],"steps":[
  {"do":"click","el":["发帖","写帖子"]},
  {"do":"type","el":["内容输入框","textarea","[contenteditable=true]"],"param":"content"},
  {"do":"click","el":["提交","发布","确认"]}
]}
{"action":"run","id":"tieba_post","fields":{"content":"你好"}}
{"action":"delete","id":"tieba_post"}
\`\`\`
- Before exploring a site from scratch, call \`muscle({"action":"list","url":current_url})\` first. If a matching muscle exists, prefer replay + verify over rebuilding the workflow.
- \`el\` array: candidates tried in order until one succeeds. Use element's **visible label from observe tree** first (e.g. \`button "发帖" [ref_41]\` → \`"el":["发帖"]\`), then add CSS fallbacks: \`["发帖","button[type=submit]"]\`.
- Save the **reusable essence**, not the raw trace. Keep stable menu path / editor / submit structure; drop page-specific noise, temporary popups, one-off URLs, and ephemeral DOM details.
- Good \`el\` order: visible text → \`aria-label/name/placeholder\` style label → stable CSS fallback. Avoid \`ref_id\`, \`:nth-child(...)\`, hashed class names, and one-off selectors tied to a single render.
- \`desc\`: one-line summary, AI uses this to match task intent when listing muscles.
- \`site\`: host / wildcard / regex this muscle applies to (e.g. \`tieba.baidu.com\`, \`*.baidu.com\`, or \`/^https:\\/\\/[^/]*example\\.com\\//i\`). Default to the narrowest reusable host. Use wildcard only when the same workflow truly spans subdomains; use regex only when host/path rules are genuinely complex.
- \`params\`: required parameter names. Pass values via \`fields\` at run time.
- \`do\` verbs: \`click\` \`type\` \`select\` \`navigate\` \`press_key\` \`wait\` \`wait_url\` \`evaluate\` \`assert_text\` \`assert_url\` \`assert_selector\` \`wait_for_text\`.
- Never use \`ref_id\` in saved muscles — ref_ids expire on every navigation.
- \`list\` returns compact format (id/desc/site/params only). Use \`list\` with current URL to find relevant muscles before starting a task.

### report — Update side panel UI (human sees progress)
**IMPORTANT: Call report at the START of every task with your plan.**
1. First call: set title + numbered plan steps (your execution plan)
2. During execution: update step statuses as you progress
3. When all steps finished: \`report({status:"done"})\` — side panel marks task complete; the plugin may suggest or prompt muscle save automatically

**Workflow A — manual task (navigate → fill → submit → verify):**
\`\`\`json
// 1. Start
{"title":"Post to X","status":"running","steps":[
  {"id":"s1","text":"Open x.com","status":"active"},
  {"id":"s2","text":"Write content","status":"pending"},
  {"id":"s3","text":"Submit post","status":"pending"},
  {"id":"s4","text":"Verify published","status":"pending"}
]}
// 2. Update as you go (full replacement each call)
{"steps":[
  {"id":"s1","text":"Open x.com","status":"done"},
  {"id":"s2","text":"Write content","status":"done"},
  {"id":"s3","text":"Submit post","status":"active"},
  {"id":"s4","text":"Verify published","status":"pending"}
]}
// 3. After verify passes — done (plugin may prompt user to save as muscle automatically)
{"status":"done"}
\`\`\`

**Workflow B — muscle replay task:**
\`\`\`json
// 1. Start (muscle will auto-replace steps during replay)
{"title":"Post 你好 to X","status":"running","steps":[
  {"id":"s1","text":"Run muscle: X发文","status":"active"},
  {"id":"s2","text":"Verify result","status":"pending"}
]}
// 2. Run the muscle — side panel auto-updates step progress
muscle({"action":"run","id":"X发文","fields":{"content":"你好"}})
// 3. After muscle succeeds, verify, then done (no muscle save prompt)
{"status":"done"}
\`\`\`
- \`steps\` is a **full replacement** each call — include ALL steps.
- Do NOT add a "save muscle" step — the plugin handles suggestion/prompt automatically after done.

## Key rules
- **report first** — before any browser action, call report(title, steps) with your numbered plan.
- **list before rebuild** — if the task might be repeatable on this site, call \`muscle(list,url)\` before exploring from scratch.
- observe → act/eval → observe. Always re-observe after navigation.
- eval for reading/waiting, act for mutations. eval can also mutate if needed.
- For saving muscles: prefer reusable structure over raw trace history.
- **Verify before done** — include a verify step in your plan. Only call report(status:"done") after confirming the result.
- For muscle replay: plan has 2 steps (run muscle + verify). No save-muscle step needed.
- chrome:// pages are inaccessible. File upload needs human. CAPTCHA → report + hand off.
- \`GET /guide\` and \`GET /tools\` for full reference if needed.`;
}

async function refreshPromptPreview() {
  const preview = $('prompt-preview-text');
  if (!preview) return;
  preview.textContent = await generateOnboardPrompt();
}

$('btn-copy-prompt')?.addEventListener('click', async () => {
  const btn = $('btn-copy-prompt'), conf = $('prompt-copied');
  try {
    await navigator.clipboard.writeText(await generateOnboardPrompt());
    if (btn) { btn.textContent = t('copied'); btn.style.background = 'var(--success)'; }
    if (conf) conf.classList.remove('hidden');
    setTimeout(() => { if (btn) { btn.textContent = t('copyPromptBtn'); btn.style.background = ''; } if (conf) conf.classList.add('hidden'); }, 3000);
  } catch (e) { addDebugEntry(t('copyFailed', [e.message]), 'error'); }
});

// (project tool removed — AI terminals have filesystem access)

// ── 工具 ────────────────────────────────
function setStatus(text) { elStatusBar.textContent = text; elStatusBar.className = 'statusbar'; }

// ── 启动 ────────────────────────────────
init();
