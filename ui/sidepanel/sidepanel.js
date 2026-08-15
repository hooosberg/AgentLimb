/**
 * AgentLimb Sidepanel — UI layer
 *
 * Wires together:
 *   - Bridge status polling (HTTP)
 *   - SW activity push (NOTIFY_TOOL_CALLED)
 *   - Task / progress auto-tracker
 *   - Muscle panel (chrome.storage read)
 *   - Settings: theme / project path / copy prompt
 */

import { MESSAGE_TYPES } from '../../kernel/shared/constants.js';
import { MVP_HOST_BASE_URL } from '../../kernel/shared/mvp-config.js';
import { buildPrompt } from '../../kernel/prompt/index.js';

// ── DOM helper ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Clipboard helper (navigator.clipboard + execCommand fallback) ─────────────
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    Object.assign(ta.style, { position: 'fixed', opacity: '0', top: '0', left: '0' });
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

// ── i18n ──────────────────────────────────────────────────────────────────────
const LANG_KEY = 'agentlimb_lang';
const SUPPORTED_LANGS = ['en', 'zh_CN', 'ja', 'ko', 'es', 'fr', 'de', 'pt_BR', 'ru', 'ar', 'it', 'hi'];
// Map runtime lang code → _locales directory. BCP-47 "zh-CN" → Chrome folder "zh_CN".
let langOverride = null; // { lang: 'ja', messages: { key: 'value', ... } }

function t(key) {
  if (langOverride?.messages) {
    const v = langOverride.messages[key];
    if (v) return v;
  }
  try { const m = chrome.i18n.getMessage(key); if (m) return m; } catch (_) {}
  return key;
}
// Substitution helper for messages containing $name$ placeholders.
// Usage: tf('statusTerminalConnected', { name: 'Codex' })
//   Looks up the message, then replaces every $<key>$ with the corresponding value.
// The `fallback` arg is used verbatim (with substitution) if no localization is found.
function tf(key, vars = {}, fallback) {
  let raw = t(key);
  if (raw === key && typeof fallback === 'string') raw = fallback;
  return raw.replace(/\$(\w+)\$/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `$${name}$`,
  );
}
function localizeDOM() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const m = t(el.dataset.i18n); if (m !== el.dataset.i18n) el.textContent = m;
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const m = t(el.dataset.i18nHtml); if (m !== el.dataset.i18nHtml) el.innerHTML = m;
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const m = t(el.dataset.i18nTitle); if (m !== el.dataset.i18nTitle) el.title = m;
  });
  // Keep the html lang attribute in sync for a11y (best-effort mapping back to BCP-47).
  const bcp47 = langOverride?.lang ? langOverride.lang.replace('_', '-') : document.documentElement.lang;
  document.documentElement.lang = bcp47;
}

async function loadLocaleMessages(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return null;
  const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = await res.json();
    // messages.json format: { key: { message: "...", placeholders?: {...} } }
    const flat = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v.message === 'string') flat[k] = v.message;
    }
    return flat;
  } catch { return null; }
}

// Language resolution — separates "detected from browser" from "current effective".
// detectBrowserLang(): what chrome.i18n.getUILanguage() maps to, normalized to our folder format.
// getCurrentLang(): manual override if set, otherwise the browser-detected language.
function detectBrowserLang() {
  let ui = '';
  try { ui = chrome.i18n.getUILanguage?.() || ''; } catch (_) {}
  ui = ui.replace('-', '_');
  if (SUPPORTED_LANGS.includes(ui)) return ui;
  // Try the base (e.g. "ja-JP" → "ja", "zh_TW" → "zh_CN" only if zh_CN is the sole zh variant we ship)
  const base = ui.split('_')[0];
  if (SUPPORTED_LANGS.includes(base)) return base;
  if (base === 'zh' && SUPPORTED_LANGS.includes('zh_CN')) return 'zh_CN';
  return 'en';
}

function getCurrentLang() {
  if (langOverride?.lang) return langOverride.lang;
  return detectBrowserLang();
}

function isAutoMode() {
  // Auto mode is the default (no override at all) OR the override carries the `auto` flag.
  return !langOverride || langOverride.auto === true;
}

async function applyLanguage(lang) {
  const messages = await loadLocaleMessages(lang);
  if (!messages) return false;
  langOverride = { lang, messages };
  try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
  localizeDOM();
  refreshLangPicker();
  return true;
}

// Auto mode: follow the browser's UI language. Clears any manual override and
// re-renders using the freshly detected locale's messages.
async function applyAutoLanguage() {
  const detected = detectBrowserLang();
  const messages = await loadLocaleMessages(detected);
  if (!messages) return false;
  // Clear the manual override. We still pin the just-loaded messages so t() is
  // deterministic (chrome.i18n.getMessage() can be flaky about exact sub-locales,
  // e.g. "zh_TW" returning no match when only zh_CN is shipped).
  langOverride = { lang: detected, messages, auto: true };
  try { localStorage.removeItem(LANG_KEY); } catch (_) {}
  localizeDOM();
  refreshLangPicker();
  return true;
}

async function initLanguage() {
  let stored = null;
  try { stored = localStorage.getItem(LANG_KEY); } catch (_) {}
  if (stored && SUPPORTED_LANGS.includes(stored)) {
    // Manual override persisted from a previous session.
    await applyLanguage(stored);
  } else {
    // No override → auto-adapt to the browser's UI language.
    await applyAutoLanguage();
  }
}

function refreshLangPicker() {
  const auto = isAutoMode();
  const detected = detectBrowserLang();
  const current = getCurrentLang();
  const trigger = $('lang-picker-trigger');
  const flagEl = $('lang-picker-flag');
  const nameEl = $('lang-picker-name');
  const autoDetectedEl = $('lang-auto-detected');

  const options = document.querySelectorAll('#lang-picker-menu .lang-option');
  for (const opt of options) {
    const isAutoOpt = opt.dataset.lang === '__auto__';
    const isActive = auto ? isAutoOpt : opt.dataset.lang === current;
    opt.classList.toggle('active', isActive);
  }

  // Show the detected language name next to the "Auto" option (e.g. "Auto (follow browser) · English").
  if (autoDetectedEl) {
    const detectedName = t('lang' + localeKeySuffix(detected));
    autoDetectedEl.textContent = detectedName ? ` · ${detectedName}` : '';
  }

  // Update the trigger pill. Auto mode shows the 🌐 flag + the detected language name
  // (the 🌐 icon is the auto-mode signal; no need to repeat the word "Auto" in the trigger).
  // Manual mode shows the country flag + language name.
  if (auto) {
    if (flagEl) flagEl.textContent = '🌐';
    const detectedName = t('lang' + localeKeySuffix(detected));
    if (nameEl) nameEl.textContent = detectedName || t('langAuto');
  } else {
    const activeOpt = document.querySelector(`#lang-picker-menu .lang-option[data-lang="${current}"]`);
    if (activeOpt) {
      if (flagEl) flagEl.textContent = activeOpt.dataset.flag || '';
      const nm = activeOpt.querySelector('.lang-name');
      if (nameEl && nm) nameEl.textContent = nm.textContent;
    }
  }

  if (trigger) trigger.setAttribute('aria-expanded', trigger.classList.contains('open') ? 'true' : 'false');
}

// Map a locale code to the `langXxx` message-key suffix (matches the existing convention).
function localeKeySuffix(lang) {
  const map = {
    en: 'En', zh_CN: 'ZhCN', ja: 'Ja', ko: 'Ko', es: 'Es', fr: 'Fr',
    de: 'De', pt_BR: 'PtBR', ru: 'Ru', ar: 'Ar', it: 'It', hi: 'Hi',
  };
  return map[lang] || '';
}

function initLangPicker() {
  const picker = $('lang-picker');
  const trigger = $('lang-picker-trigger');
  const menu = $('lang-picker-menu');
  if (!picker || !trigger || !menu) return;

  const close = () => {
    menu.classList.add('hidden');
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    menu.classList.remove('hidden');
    trigger.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  };

  trigger.addEventListener('click', (ev) => {
    ev.stopPropagation();
    trigger.classList.contains('open') ? close() : open();
  });

  menu.querySelectorAll('.lang-option').forEach((opt) => {
    opt.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const lang = opt.dataset.lang;
      if (!lang) return;
      const ok = lang === '__auto__' ? await applyAutoLanguage() : await applyLanguage(lang);
      if (ok) close();
    });
  });

  // Close on outside click or Esc
  document.addEventListener('click', (ev) => {
    if (!picker.contains(ev.target)) close();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && trigger.classList.contains('open')) close();
  });

  refreshLangPicker();
}

// ── Theme ──────────────────────────────────────────────────────────────────────
const THEME_KEY = 'agentlimb_theme';
function applyTheme(theme) {
  const dark = theme === 'dark' ||
    (theme === 'auto' && !window.matchMedia('(prefers-color-scheme: light)').matches);
  dark
    ? document.documentElement.removeAttribute('data-theme')
    : document.documentElement.setAttribute('data-theme', 'light');
  document.querySelectorAll('.theme-segment-btn').forEach(
    (b) => b.classList.toggle('active', b.dataset.themeValue === theme),
  );
}

// ── Project path + prompt ──────────────────────────────────────────────────────
const PROJ_PATH_KEY = 'agentlimb_project_path';
const PROJ_PATH_SOURCE_KEY = 'agentlimb_project_path_source';
let projectPath = '';
let cachedPrompt = null;

async function loadProjectPath() {
  return new Promise((resolve) => {
    chrome.storage.local.get([PROJ_PATH_KEY, PROJ_PATH_SOURCE_KEY], async (data) => {
      const storedPath = data[PROJ_PATH_KEY] || '';
      const storedSource = data[PROJ_PATH_SOURCE_KEY] || '';
      const companionPath = await queryCompanionPath().catch(() => '');

      // Explicit user choices win. Automatically discovered and legacy cached
      // paths are refreshed after runtime upgrades or directory migrations.
      projectPath = storedSource === 'manual' && storedPath
        ? storedPath
        : companionPath || storedPath;

      if (companionPath && storedSource !== 'manual') {
        chrome.storage.local.set({
          [PROJ_PATH_KEY]: companionPath,
          [PROJ_PATH_SOURCE_KEY]: 'companion',
        });
      }
      const el = $('input-project-path');
      if (el) el.value = projectPath;
      resolve(projectPath);
    });
  });
}

async function queryCompanionPath() {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative('com.agentlimb.bridge');
    const timeout = setTimeout(() => { port.disconnect(); reject(new Error('timeout')); }, 2000);
    port.onMessage.addListener((msg) => {
      clearTimeout(timeout);
      port.disconnect();
      resolve(msg?.projectDir || '');
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timeout);
      reject(new Error(chrome.runtime.lastError?.message || 'disconnected'));
    });
    port.postMessage({ type: 'get_config' });
  });
}

function saveProjectPath(path) {
  projectPath = path.trim();
  if (projectPath) {
    chrome.storage.local.set({
      [PROJ_PATH_KEY]: projectPath,
      [PROJ_PATH_SOURCE_KEY]: 'manual',
    });
  } else {
    chrome.storage.local.remove([PROJ_PATH_KEY, PROJ_PATH_SOURCE_KEY]);
  }
  cachedPrompt = null; // invalidate cache
}

function getClientCommand() {
  if (projectPath) {
    return `node "${projectPath}/kernel/bridge/mvp/terminal-client.mjs"`;
  }
  if (/win/i.test(navigator.userAgentData?.platform || navigator.platform || '')) {
    // Windows setup puts the CLI here. Use an absolute path so the terminal that
    // ran the installer does not need to be restarted before it can use the CLI.
    return '& "$env:LOCALAPPDATA\\AgentLimb\\bin\\agentlimb.cmd"';
  }
  // Fallback: companion installed by install.sh (production / store install)
  return `~/.agentlimb/bin/agentlimb`;
}

async function collectEnvironmentMetadata() {
  const meta = {};

  // Manifest info (sync)
  try {
    const manifest = chrome.runtime.getManifest?.();
    if (manifest) {
      meta.appVersion = manifest.version;
      meta.appName = manifest.name;
    }
  } catch (_) {}

  // Extension ID (sync)
  try { meta.extensionId = chrome.runtime.id; } catch (_) {}

  // Platform OS + arch — Chrome API is most authoritative
  try {
    const info = await chrome.runtime.getPlatformInfo();
    const osMap = { mac: 'macOS', win: 'Windows', linux: 'Linux', android: 'Android', cros: 'ChromeOS' };
    meta.platform = osMap[info.os] || info.os;
    meta.platformArch = info.arch;
  } catch (_) {
    // Fallback to navigator
    const p = navigator.userAgentData?.platform || navigator.platform || '';
    meta.platform = /win/i.test(p) ? 'Windows' : /mac/i.test(p) ? 'macOS' : /linux/i.test(p) ? 'Linux' : p || 'unknown';
  }

  // OS version (best-effort, may be restricted by browser)
  try {
    const hv = await navigator.userAgentData?.getHighEntropyValues(['platformVersion', 'architecture']);
    if (hv?.platformVersion) meta.platformVersion = hv.platformVersion;
    if (hv?.architecture && !meta.platformArch) meta.platformArch = hv.architecture;
  } catch (_) {}

  // Language preferences
  try {
    meta.languages = (navigator.languages || []).slice(0, 3).join(' / ');
  } catch (_) {}

  // Muscle site count — authoritative source is Bridge /api/mvp/muscle/list
  // Falls back to '?' when Bridge is offline so the prompt stays honest
  try {
    const res = await fetch(`${MVP_HOST_BASE_URL}/api/mvp/muscle/list`);
    if (res.ok) {
      const data = await res.json();
      meta.muscleCount = Array.isArray(data.domains) ? data.domains.length : 0;
    } else {
      meta.muscleCount = '?';
    }
  } catch (_) {
    meta.muscleCount = '?';
  }

  return meta;
}

async function getPrompt() {
  if (cachedPrompt) return cachedPrompt;
  try {
    cachedPrompt = buildPrompt({
      hostBaseUrl: MVP_HOST_BASE_URL,
      clientCommand: getClientCommand(),
      projectDir: projectPath || '',
    });
  } catch (e) {
    cachedPrompt = `[AgentLimb] Prompt generation failed: ${e.message}`;
  }
  return cachedPrompt;
}

async function copyPrompt(feedbackId = 'prompt-copied') {
  let text;
  try {
    const envMeta = await collectEnvironmentMetadata();
    text = buildPrompt({
      hostBaseUrl: MVP_HOST_BASE_URL,
      clientCommand: getClientCommand(),
      projectDir: projectPath || '',
      extensionOnline: true,
      bridgeOnline: bridgeOnline,
      compact: bridgeOnline,
      mode: bridgeOnline ? 'minimal' : 'full',
      ...envMeta,
    });
  } catch (e) {
    text = `[AgentLimb] Prompt generation failed: ${e.message}`;
  }
  try {
    await copyText(text);
    const el = $(feedbackId);
    if (el) { el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 2500); }
    setStatus(t('statusPromptCopied'));
  } catch (e) {
    setStatus(tf('statusCopyFailed', { error: e.message }));
  }
}

async function renderPromptPreview() {
  const text = await getPrompt();
  const el = $('prompt-preview-text');
  if (el) el.textContent = text;
}

// ── SW messaging ──────────────────────────────────────────────────────────────
function sendToSW(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(res ?? null);
    });
  });
}

// Tell the SW which Chrome window hosts this panel so default tab targeting
// (navigate / tabs_context) stays locked to this window. Last panel to register
// wins — re-register on visibility so the user-focused panel is always the lock.
async function registerPanelWindow() {
  try {
    const win = await chrome.windows.getCurrent();
    if (Number.isInteger(win?.id)) {
      await sendToSW({ type: MESSAGE_TYPES.REGISTER_PANEL_WINDOW, windowId: win.id });
    }
  } catch (_) { /* best-effort */ }
}

// ── Bridge status ──────────────────────────────────────────────────────────────
let bridgeOnline = false;
let prevTerminalCount = 0;
// Tracks whether we've confirmed Bridge online at least once this session — lets
// us distinguish "first-time connect" from "reconnect after Bridge restart".
let bridgeEverOnline = false;
// Separate timer for bridge-down → task-failed transition. Using a dedicated
// variable prevents pollBridgeStatus (every 5s) from resetting task.timer and
// delaying / preventing the bridge-offline→failed transition indefinitely.
let bridgeDownTimer = null;

// ── Multi-profile identity + suspend state ────────────────────────────────────
let selfIdentity = null;          // { extensionId, label }
let selfSuspended = false;
let canToggleSuspend = false;     // true when another online active worker exists OR we're suspended (resume always allowed)

async function fetchSelfIdentity() {
  const res = await sendToSW({ type: MESSAGE_TYPES.GET_EXTENSION_IDENTITY });
  if (res?.ok) {
    selfIdentity = { extensionId: res.extensionId, label: res.label || '' };
    renderIdentity();
  }
  return selfIdentity;
}

function renderIdentity() {
  const nameEl = $('identity-name');
  if (!nameEl) return;
  nameEl.textContent = selfIdentity?.label || '—';
}

// Merge suspended state + active-worker count from the bridge's extensions list.
// Called from pollBridgeStatus (we use /api/mvp/status which already embeds it).
function applyMultiControlState(extensionList) {
  const list = Array.isArray(extensionList) ? extensionList : [];
  const selfId = selfIdentity?.extensionId;
  const selfEntry = selfId ? list.find((e) => e.id === selfId) : null;
  selfSuspended = selfEntry?.suspended === true;

  // Other active online workers besides self
  const otherActiveOnline = list.some(
    (e) => e.id !== selfId && e.online && !e.suspended,
  );
  // Suspend allowed only if there's another active worker.
  // Resume is always allowed.
  canToggleSuspend = selfSuspended || otherActiveOnline;

  // Multi-control scenario = at least 2 online extensions total
  const onlineCount = list.filter((e) => e.online).length;
  const inMultiControl = onlineCount >= 2 || selfSuspended;

  renderSuspendControl(inMultiControl);
}

function renderSuspendControl(show) {
  const btn = $('btn-suspend-toggle');
  const label = $('suspend-label');
  if (!btn || !label) return;
  btn.classList.toggle('hidden', !show);
  if (!show) return;
  label.textContent = selfSuspended ? t('resumeAction') : t('suspendAction');
  btn.disabled = !canToggleSuspend;
  btn.classList.toggle('is-suspended', selfSuspended);
  btn.title = selfSuspended
    ? t('resumeActionTitle')
    : canToggleSuspend
      ? t('suspendActionTitle')
      : t('suspendBlockedLastWorker');
}

function updateBridgeStatusDot() {
  const dot = $('bridge-status');
  const labelEl = $('bridge-status-label');
  if (!dot && !labelEl) return;

  let cls = 'status-error';
  let tipKey = 'bridgeNotConnected';
  let shortKey = 'bridgeNotConnectedShort';
  if (bridgeOnline) {
    if (selfSuspended) {
      cls = 'status-suspended';
      tipKey = 'bridgeSuspended';
      shortKey = 'bridgeSuspendedShort';
    } else {
      cls = 'status-ok';
      tipKey = 'bridgeConnected';
      shortKey = 'bridgeConnectedShort';
    }
  }

  if (dot) {
    dot.className = `status-dot ${cls}`;
    dot.title = t(tipKey);
  }
  if (labelEl) labelEl.textContent = t(shortKey);
}

async function copyIdentityLabel() {
  const label = selfIdentity?.label;
  if (!label) return;
  try {
    await copyText(label);
    const feedback = $('identity-copied');
    if (feedback) {
      feedback.classList.remove('hidden');
      setTimeout(() => feedback.classList.add('hidden'), 1500);
    }
    setStatus(t('identityCopied'));
  } catch (_) {
    setStatus(t('identityCopyFailed'));
  }
}

async function toggleSelfSuspend() {
  if (!selfIdentity?.extensionId) return;
  const btn = $('btn-suspend-toggle');
  if (btn?.disabled) return;
  const wantSuspend = !selfSuspended;
  try {
    const res = await fetch(
      `${MVP_HOST_BASE_URL}/api/mvp/extensions/${encodeURIComponent(selfIdentity.extensionId)}/suspend`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended: wantSuspend }),
        signal: AbortSignal.timeout(3000),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(
        data?.code === 'LAST_ACTIVE_WORKER'
          ? t('suspendBlockedLastWorker')
          : t('suspendFailed'),
      );
      return;
    }
    // Optimistic update; next poll will re-sync.
    selfSuspended = wantSuspend;
    renderSuspendControl(true);
    updateBridgeStatusDot();
  } catch (_) {
    setStatus(t('suspendFailed'));
  }
}

async function pollBridgeStatus() {
  try {
    const res = await fetch(`${MVP_HOST_BASE_URL}/api/mvp/status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error('not ok');
    const data = await res.json();
    setBridgeStatus(true, data);
  } catch (_) {
    setBridgeStatus(false, null);
  }
}

function setBridgeStatus(online, data) {
  const wasOnline = bridgeOnline;
  bridgeOnline = online;

  // Reconnect after Bridge restart: Bridge has wiped its tasks/calls Maps, so
  // whatever task this panel was tracking is now stale. Reset local state so
  // we don't keep showing a ghost task card that points at nothing upstream.
  if (online && !wasOnline && bridgeEverOnline && task.active) {
    console.info('[AgentLimb] bridge reconnected — clearing stale task state');
    resetTask();
  }
  if (online) bridgeEverOnline = true;

  // Drive the 3-state status dot (online+working / online+suspended / offline)
  // via a dedicated helper so the suspend toggle can refresh it independently.
  const extensionList = data?.status?.extensions?.list || [];
  applyMultiControlState(extensionList);
  updateBridgeStatusDot();
  updateMonitorLayout();

  const terminals = data?.terminals || [];
  renderSessions(terminals);
  updateMuscleFolderButton();


  // Terminal count change is a connection signal only — it no longer
  // mutates plan step state. Connection ≠ progress; letting it advance
  // steps produced the "instantly at E2" false-complete pattern.
  const newCount = terminals.length;
  if (online && newCount > prevTerminalCount && task.active) {
    const termName = terminals[terminals.length - 1]?.name || 'Terminal';
    setStatus(tf('statusTerminalConnected', { name: termName }));
  }
  prevTerminalCount = newCount;

  if (!online) {
    setStatus(t('statusIdleHint'));
    // Bridge went offline — start bridge-down timer only once (poll runs every 5s;
    // using a dedicated variable prevents each poll from resetting the countdown).
    if (task.active && task.status === 'running' && !bridgeDownTimer) {
      bridgeDownTimer = setTimeout(() => {
        bridgeDownTimer = null;
        onTaskBridgeOffline();
      }, BRIDGE_DOWN_MS);
    }
    // Refresh Muscles tab to show offline state instead of stale data
    if (document.querySelector('.tab.active')?.dataset.tab === 'skills') {
      refreshMusclePanel();
    }
  } else {
    // Bridge back online — cancel any pending bridge-down countdown
    if (bridgeDownTimer) {
      clearTimeout(bridgeDownTimer);
      bridgeDownTimer = null;
    }
  }
}

// ── Monitor panel layout state machine ──────────────────────────────────────
// Three mutually-exclusive views:
//   - 'offline'        → idle-state (first-time copy-prompt UI) when bridge is down
//   - 'connected-idle' → compact "Connected — ready for mission" placeholder
//   - 'task'           → task-card + progress-card (only when a real task_plan arrived)
//
// This is the user-facing robustness guarantee: the sidepanel never renders an AI-
// synthesized bootstrap task as a noisy "Failed" card. A real task only enters the
// UI when task_plan arrives AND its plan looks like actual browser work.
function updateMonitorLayout() {
  const idleState     = $('idle-state');
  const connectedIdle = $('connected-idle');
  const taskCard      = $('task-card');
  const progressCard  = $('progress-card');

  // task.active takes priority: keep the task card visible even when Bridge
  // is offline so the user sees the running→failed transition (onTaskBridgeOffline
  // fires after BRIDGE_DOWN_MS). The offline idle UI only shows when no task is open.
  const mode = task.active   ? 'task'
             : !bridgeOnline ? 'offline'
             : 'connected-idle';

  idleState?.classList.toggle('hidden', mode !== 'offline');
  connectedIdle?.classList.toggle('hidden', mode !== 'connected-idle');
  taskCard?.classList.toggle('hidden', mode !== 'task');
  progressCard?.classList.toggle('hidden', mode !== 'task');
}

// Defense-in-depth against AI ignoring the "no task without a mission" prompt rule.
// A bootstrap plan has a setup/verify/runtime title AND no browser-impacting steps.
// If we detect one, suppress the task card and stay on the connected-idle placeholder.
function isBootstrapPlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  const title = String(plan.title || '').toLowerCase();
  const stepsText = (plan.steps || [])
    .map((s) => String((s && (s.text ?? s)) || '').toLowerCase())
    .join(' ');
  const titleLooksBootstrap = /(bootstrap|initialize|verify|runtime|health\s*check|environment|setup)/.test(title);
  const hasRealAction = /(navigate|click|type|fill|submit|input|scroll|screenshot|form|login|search)/.test(stepsText);
  return titleLooksBootstrap && !hasRealAction;
}

function renderSessions(terminals) {
  const panel = $('session-panel');
  const list  = $('session-list');
  if (!panel || !list) return;
  if (!terminals.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  list.innerHTML = terminals.map((t) =>
    `<div class="session-item">
      <span class="session-name">${escHtml(t.name || 'Terminal')}</span>
      <span class="session-type" style="font-size:10px;color:var(--text-muted)">${escHtml(t.type || '')}</span>
    </div>`
  ).join('');
}

// ── Task auto-tracker ─────────────────────────────────────────────────────────
const INACTIVITY_MS      = 300_000; // 5 min — AI can take >30s between tool calls
const BRIDGE_DOWN_MS =  15_000; // 15s after bridge goes offline during a task
const task = {
  active: false,
  title: '',
  status: 'idle',      // idle | running | success | failed | timeout
  reason: '',
  summary: '',
  steps: [],           // { id, text, status: active|done|error }
  plan: null,          // { title, steps: [{text, hint, status: pending|active|done|error|cancelled}] }
  timer: null,
  startedAt: 0,
  lastActivityAt: 0,   // wall-clock timestamp of the most recent tool call
};

let taskTickerTimer = null;

// Central reset — use this whenever the sidepanel needs to forget any stale
// task it was tracking (e.g., Bridge restart, suppressed bootstrap, explicit
// close). Leaves the UI in a clean "connected-idle" slate after updateMonitorLayout().
function resetTask() {
  task.active = false;
  task.title = '';
  task.status = 'idle';
  task.reason = '';
  task.summary = '';
  task.steps = [];
  task.plan = null;
  task.startedAt = 0;
  task.lastActivityAt = 0;
  if (task.timer) {
    clearTimeout(task.timer);
    task.timer = null;
  }
  if (bridgeDownTimer) {
    clearTimeout(bridgeDownTimer);
    bridgeDownTimer = null;
  }
  stopTaskTicker();
}

function startTaskTicker() {
  stopTaskTicker();
  taskTickerTimer = setInterval(() => {
    if (!task.active || task.status !== 'running') {
      stopTaskTicker();
      return;
    }
    updateProgressMeta();
  }, 2000);
}

function stopTaskTicker() {
  if (taskTickerTimer) {
    clearInterval(taskTickerTimer);
    taskTickerTimer = null;
  }
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function buildProgressMetaText() {
  const parts = [];
  if (task.plan?.steps?.length) {
    const done = task.plan.steps.filter(s => s.status === 'done').length;
    parts.push(tf('progressStepsMeta', { done, total: task.plan.steps.length }));
  } else {
    parts.push(tf('progressCallsMeta', { count: task.steps.length }));
  }
  if (task.startedAt) {
    const elapsedS = Math.max(0, Math.round((Date.now() - task.startedAt) / 1000));
    parts.push(`⏱ ${formatDuration(elapsedS)}`);
  }
  if (task.lastActivityAt && task.status === 'running') {
    const idleS = Math.max(0, Math.round((Date.now() - task.lastActivityAt) / 1000));
    if (idleS >= 5) {
      parts.push(`💤 ${formatDuration(idleS)}`);
    }
  }
  return parts.join(' · ');
}

function updateProgressMeta() {
  const metaEl = $('progress-meta');
  if (metaEl) metaEl.textContent = buildProgressMetaText();
}

function toolToStep(tool, params) {
  switch (tool) {
    case 'browser_navigate': {
      let host = params?.url || '';
      try { host = new URL(params.url).hostname; } catch (_) {}
      return tf('toolSummaryNavigate', { host });
    }
    case 'browser_click':       return t('toolSummaryClick') + (params?.refId ? ' #' + params.refId : '');
    case 'browser_type':        return tf('toolSummaryType', { text: String(params?.text || '').slice(0, 30) });
    case 'browser_scroll':      return tf('toolSummaryScroll', { direction: params?.direction || '' });
    case 'browser_screenshot':  return t('toolSummaryScreenshot');
    case 'browser_snapshot':    return t('toolSummarySnapshot');
    case 'browser_wait':        return tf('toolSummaryWait', { condition: params?.condition || '' });
    case 'browser_evaluate':    return t('toolSummaryEval');
    case 'browser_select':      return tf('toolSummarySelect', { value: params?.value || '' });
    case 'browser_tab_new':     return t('toolSummaryTabNew');
    case 'browser_tab_close':   return t('toolSummaryTabClose');
    case 'muscle_commit':       return `muscle_commit (${params?.status || ''})`;
    case 'muscle_recall':       return 'muscle_recall';
    case 'muscle_remember':     return 'muscle_remember';
    default:                    return tool;
  }
}

function onToolActivity(entry) {
  const { kind, tool, params, callId } = entry;

  if (kind === 'call') {
    // Only track tool activity when a real task_plan has activated the task card.
    // Bootstrap / self-verification calls without a plan stay silent — their
    // details are still visible in the Logs tab; we just don't pollute the
    // Monitor tab with a synthesized "AI running…" card.
    if (!task.active) return;

    task.steps.push({ id: callId, text: toolToStep(tool, params), status: 'active' });
    task.lastActivityAt = Date.now();
    renderTask();

    clearTimeout(task.timer);
    task.timer = setTimeout(onTaskTimeout, INACTIVITY_MS);

  } else if (kind === 'result') {
    task.lastActivityAt = Date.now();
    const step = task.steps.find((s) => s.id === entry.callId);
    if (step) {
      step.status = entry.ok ? 'done' : 'error';
      if (!entry.ok && entry.error) step.error = entry.error;
    }
    // Plan step advancement is driven exclusively by `task_step_done`
    // (see onTaskLifecycle). Tool-call volume is not a meaningful proxy
    // for logical progress — one plan step ≈ 5-20 tool calls.
    renderTask();

    // Auto-refresh Local Muscles tab when a write succeeds
    if (entry.ok && entry.tool === 'muscle_remember') {
      refreshMusclePanel();
    }
  }

  addLogEntry(entry);
}

function onTaskTimeout() {
  if (!task.active) return;
  const idleS = task.lastActivityAt
    ? Math.round((Date.now() - task.lastActivityAt) / 1000)
    : Math.round((Date.now() - task.startedAt) / 1000);
  task.status = 'timeout';
  task.reason = `no tool activity for ${idleS}s`;
  if (task.plan?.steps) {
    task.plan.steps.forEach((s) => {
      if (s.status === 'active') s.status = 'error';
      else if (s.status === 'pending') s.status = 'cancelled';
    });
  }
  stopTaskTicker();
  renderTask();
  setStatus(t('statusTaskTimeout'));
}

function onTaskBridgeOffline() {
  if (!task.active || task.status !== 'running') return;
  task.status = 'failed';
  task.reason = 'bridge offline';
  if (task.plan?.steps) {
    task.plan.steps.forEach((s) => {
      if (s.status === 'active') s.status = 'error';
      else if (s.status === 'pending') s.status = 'cancelled';
    });
  }
  stopTaskTicker();
  renderTask();
  setStatus(t('statusBridgeLost'));
}

function onTaskLifecycle(event) {
  if (!task.active) return;
  const { kind } = event;

  if (kind === 'step_done') {
    const { index, ok, note } = event;
    if (!task.plan?.steps) return;
    const steps = task.plan.steps;
    for (let i = 0; i < index; i++) {
      if (steps[i] && steps[i].status !== 'done' && steps[i].status !== 'error') {
        steps[i].status = 'done';
      }
    }
    if (steps[index]) {
      steps[index].status = ok ? 'done' : 'error';
      if (note) steps[index].note = note;
    }
    const nextIdx = index + 1;
    if (nextIdx < steps.length && steps[nextIdx].status === 'pending') {
      steps[nextIdx].status = 'active';
    }
    renderTask();

  } else if (kind === 'complete') {
    task.status = 'success';
    task.summary = event.summary || '';
    if (task.plan?.steps) {
      task.plan.steps.forEach((s) => { if (s.status !== 'done' && s.status !== 'error') s.status = 'done'; });
    }
    clearTimeout(task.timer);
    stopTaskTicker();
    renderTask();
    setStatus(task.summary ? tf('statusTaskCompleteWith', { summary: task.summary }) : t('statusTaskComplete'));

  } else if (kind === 'fail') {
    task.status = 'failed';
    task.reason = event.reason || t('reasonUnknown');
    if (task.plan?.steps) {
      const si = Number.isFinite(event.stepIndex) ? event.stepIndex : -1;
      task.plan.steps.forEach((s, i) => {
        if (i === si) s.status = 'error';
        else if (s.status === 'pending' || s.status === 'active') s.status = 'cancelled';
      });
    }
    clearTimeout(task.timer);
    stopTaskTicker();
    renderTask();
    setStatus(tf('statusTaskFailed', { reason: task.reason }));
  }
}

function onTaskPlan(planData) {
  // Defense-in-depth: even if the AI ignored the "no task without a mission"
  // rule, refuse to render a bootstrap self-verification plan in the UI.
  // Also wipe any stale task state from a previous session so the connected-idle
  // placeholder is what the user sees — not a ghost task card.
  if (isBootstrapPlan(planData)) {
    console.info('[AgentLimb] suppressing bootstrap task plan from monitor UI', planData?.title);
    if (task.active) {
      resetTask();
      updateMonitorLayout();
    }
    return;
  }

  task.active    = true;
  task.status    = 'running';
  task.reason    = '';
  task.summary   = '';
  task.title     = planData.title || t('taskDefaultTitle');
  task.steps     = [];
  task.startedAt = Date.now();
  task.lastActivityAt = Date.now();
  task.plan      = {
    title: planData.title,
    steps: (planData.steps || []).map((s, i) => ({
      text: s.text || String(s),
      hint: s.hint || 'tool_call',
      status: i === 0 ? 'active' : 'pending',
    })),
  };
  updateMonitorLayout();
  renderTask();
  clearTimeout(task.timer);
  task.timer = setTimeout(onTaskTimeout, INACTIVITY_MS);
  startTaskTicker();
}

function renderTask() {
  // Render-time invariant: a task in a terminal status must have a consistent
  // progress view. If status is 'success', every non-error step must be done
  // (covers missed task_step_done events, late-arriving complete, etc.). If
  // status is 'failed'/'timeout', any still-active step is cancelled.
  if (task.plan?.steps?.length) {
    if (task.status === 'success') {
      task.plan.steps.forEach((s) => {
        if (s.status !== 'done' && s.status !== 'error') s.status = 'done';
      });
    } else if (task.status === 'failed' || task.status === 'timeout') {
      task.plan.steps.forEach((s) => {
        if (s.status === 'active' || s.status === 'pending') s.status = 'cancelled';
      });
    }
  }

  const titleEl   = $('task-title');
  const badge     = $('task-status-badge');
  const summaryEl = $('task-summary');
  const descEl    = $('task-desc');

  if (titleEl) titleEl.textContent = task.title;

  if (badge) {
    const badgeMap = {
      running: ['badge-running', t('badgeRunning')],
      success: ['badge-done',    t('badgeDone')],
      failed:  ['badge-failed',  t('badgeFailed')],
      timeout: ['badge-timeout', t('badgeTimeout')],
      idle:    ['badge-running', t('badgeRunning')],
    };
    const [cls, text] = badgeMap[task.status] || badgeMap.idle;
    badge.className = `task-badge ${cls}`;
    badge.textContent = text;
  }

  if (summaryEl) {
    if (task.status === 'success' && task.summary) {
      summaryEl.textContent = task.summary;
      summaryEl.className = 'task-summary task-summary-success';
      summaryEl.classList.remove('hidden');
    } else if ((task.status === 'failed' || task.status === 'timeout') && task.reason) {
      summaryEl.textContent = task.reason;
      summaryEl.className = `task-summary task-summary-${task.status}`;
      summaryEl.classList.remove('hidden');
    } else {
      summaryEl.classList.add('hidden');
    }
  }

  if (descEl) descEl.innerHTML = '';

  // ── Progress card: plan steps ──
  const stepsEl = $('progress-steps');
  const metaEl  = $('progress-meta');
  if (!stepsEl) return;

  let html = '';
  if (task.plan?.steps?.length) {
    html = task.plan.steps.map((s, i) => {
      const num = i + 1;
      const cls = `step-item step-${s.status}`;
      const noteHtml = s.note ? ` <span class="step-note">${escHtml(s.note)}</span>` : '';
      return `<div class="${cls}">
        <span class="step-num" data-num="${num}">${num}</span>
        <span class="step-text">${escHtml(s.text)}${noteHtml}</span>
      </div>`;
    }).join('');
  }
  stepsEl.innerHTML = html;

  if (metaEl) {
    metaEl.textContent = buildProgressMetaText();
  }
}

// ── Activity log ──────────────────────────────────────────────────────────────
const MAX_LOG = 150;
const logEntries = [];

function addLogEntry(entry) {
  const { kind, tool, ok, error, ts } = entry;
  const time = ts ? new Date(ts).toLocaleTimeString() : new Date().toLocaleTimeString();
  const text  = kind === 'call'
    ? `▶ ${tool}`
    : (ok ? `✓ ${tool}` : `✗ ${tool}${error ? ' — ' + error : ''}`);
  const level = kind === 'call' ? 'info' : (ok ? 'success' : 'error');
  logEntries.unshift({ text, level, time });
  if (logEntries.length > MAX_LOG) logEntries.pop();

  setStatus(`${time} ${text}`);

  // Only re-render if logs tab is active
  if (document.querySelector('.tab.active')?.dataset.tab === 'logs') renderLog();
}

function renderLog() {
  const logEl   = $('activity-log');
  const emptyEl = $('log-empty');
  if (!logEl) return;
  if (!logEntries.length) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    logEl.innerHTML = ''; return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');
  logEl.innerHTML = logEntries.map((e) =>
    `<div class="log-entry log-${e.level}">
      <span class="log-ts">${e.time}</span> ${escHtml(e.text)}
    </div>`
  ).join('');
}

async function loadActivityLog() {
  const res = await sendToSW({ type: MESSAGE_TYPES.GET_ACTIVITY_LOG });
  if (res?.ok && Array.isArray(res.log)) {
    for (const entry of [...res.log].reverse()) addLogEntry(entry);
  }
}

// ── Muscle folder button ──────────────────────────────────────────────────────
async function updateMuscleFolderButton() {
  const btn = $('btn-open-muscle-folder');
  if (!btn) return;
  let folderExists = false;
  try {
    const res = await fetch(`${MVP_HOST_BASE_URL}/api/mvp/muscle/exists`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = await res.json();
      folderExists = data?.exists === true;
    }
  } catch (_) {
    folderExists = false;
  }
  btn.disabled      = !folderExists;
  btn.title         = folderExists ? t('muscleOpenFolderTitle') : t('muscleFolderNotCreatedTitle');
  btn.style.opacity = folderExists ? '' : '0.4';
  btn.style.cursor  = folderExists ? '' : 'not-allowed';
}

// ── Muscle panel ──────────────────────────────────────────────────────────────
async function refreshMusclePanel() {
  const listEl  = $('muscle-sites-list');
  const countEl = $('muscle-site-count');
  try {
    // Authoritative domain list comes from Bridge (disk truth).
    // Only fall back to chrome.storage when Bridge is unreachable.
    let domains = [];
    let bridgeReachable = false;
    try {
      const res = await fetch(`${MVP_HOST_BASE_URL}/api/mvp/muscle/list`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        // Bridge returns objects { domain, sizeBytes, mtimeMs } — extract domain strings
        const raw = Array.isArray(data.domains) ? data.domains : [];
        domains = raw.map((d) => (typeof d === 'object' && d !== null ? d.domain : d)).filter(Boolean);
        bridgeReachable = true;
      }
    } catch (_) {
      // Bridge offline
    }

    if (!bridgeReachable) {
      // Bridge offline — show clear message, do not show stale cached cards
      if (countEl) countEl.textContent = '—';
      if (listEl) listEl.innerHTML = `<div class="skills-empty">${escHtml(t('muscleNoBridgeData'))}</div>`;
      const card = $('muscle-session-card');
      if (card) card.style.display = 'none';
      return;
    }

    if (countEl) countEl.textContent = domains.length;
    if (!listEl) return;

    if (!domains.length) {
      listEl.innerHTML = `<div class="skills-empty">${t('muscleNoSites')}</div>`;
    } else {
      // Fetch profiles for display — Bridge is authoritative
      const profiles = await Promise.all(
        domains.map(async (domain) => {
          try {
            const res = await fetch(
              `${MVP_HOST_BASE_URL}/api/mvp/muscle/read?domain=${encodeURIComponent(domain)}`,
              { signal: AbortSignal.timeout(2000) },
            );
            if (res.ok) {
              const d = await res.json();
              if (d.ok && d.profile) return d.profile;
            }
          } catch (_) {}
          return { domain };
        }),
      );

      listEl.innerHTML = profiles.filter(Boolean).map((p) => {
        const selN = Object.keys(p.selectors || {}).length;
        const wfN  = (p.workflows || []).length;
        const upd  = p.lastUpdatedAt ? new Date(p.lastUpdatedAt).toLocaleString() : '—';
        return `<div class="skill-card">
          <div style="font-weight:600;font-size:12px">${escHtml(p.domain || '—')}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
            selectors: ${selN} · workflows: ${wfN}
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${upd}</div>
        </div>`;
      }).join('');
    }

    // Session candidates (from chrome.storage — correct source for buffer)
    const all = await new Promise((r) => chrome.storage.local.get(null, r));
    const sessKeys = Object.keys(all).filter((k) => k.startsWith('muscle_session_'));
    const card = $('muscle-session-card');
    if (card) {
      if (sessKeys.length) {
        card.style.display = '';
        const first = all[sessKeys[0]];
        const domEl = $('muscle-session-domain');
        const cntEl = $('muscle-session-count');
        if (domEl) domEl.textContent = `domain: ${first?.domain || '—'}`;
        if (cntEl) cntEl.textContent = tf('muscleCandidatesCaptured', { count: sessKeys.length });
      } else {
        card.style.display = 'none';
      }
    }
  } catch (e) {
    if (listEl) listEl.innerHTML = `<div class="skills-empty">${escHtml(tf('muscleReadFailed', { error: e.message }))}</div>`;
  }
}

// ── Status bar ────────────────────────────────────────────────────────────────
function setStatus(text) {
  const el = $('statusbar');
  if (el) el.textContent = text;
}

// ── Util ──────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
      tab.classList.add('active');
      const panel = $(`panel-${tab.dataset.tab}`);
      if (panel) panel.classList.remove('hidden');
      if (tab.dataset.tab === 'skills') refreshMusclePanel();
      if (tab.dataset.tab === 'logs')   renderLog();
    });
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────
function initSettings() {
  const overlay = $('settings-overlay');

  $('btn-settings')?.addEventListener('click', () => {
    overlay?.classList.remove('hidden');
    showSettingsPage('main');
  });
  $('btn-settings-back')?.addEventListener('click', () => overlay?.classList.add('hidden'));

  document.querySelectorAll('.settings-menu-item').forEach((item) =>
    item.addEventListener('click', () => showSettingsPage(item.dataset.page)),
  );
  document.querySelectorAll('.settings-back-btn[data-back]').forEach((btn) =>
    btn.addEventListener('click', () => showSettingsPage(btn.dataset.back)),
  );

  // Theme
  document.querySelectorAll('.theme-segment-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      localStorage.setItem(THEME_KEY, btn.dataset.themeValue);
      applyTheme(btn.dataset.themeValue);
    }),
  );

  // Language picker
  initLangPicker();

  // Settings prompt copy
  $('btn-settings-copy-prompt')?.addEventListener('click', () => copyPrompt('settings-prompt-copied'));

  // External links (About page)
  const LINKS = {
    'link-chromestore': 'https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof',
    'link-website':     'https://agentlimb.com/',
    'link-github':      'https://github.com/hooosberg/AgentLimb',
  };
  for (const [id, url] of Object.entries(LINKS)) {
    $(id)?.addEventListener('click', () => chrome.tabs.create({ url }));
  }

  // Idle-state GitHub star card (the <a> tags use default link behavior via chrome.tabs)
  $('idle-star-card')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    const url = ev.currentTarget.dataset.url;
    if (url) chrome.tabs.create({ url });
  });

  // Update check (dual-source: GitHub releases → Chrome Web Store)
  $('btn-check-update')?.addEventListener('click', onCheckUpdateClick);
}

// ── Update check ──
const GITHUB_REPO = 'hooosberg/AgentLimb';
const CHROME_STORE_ID = 'hldldfepjhljhbcneojddjkkodkjglof';
const CHROME_STORE_URL = `https://chromewebstore.google.com/detail/agentlimb/${CHROME_STORE_ID}`;

async function onCheckUpdateClick() {
  const btn = $('btn-check-update');
  const result = $('update-result');
  if (!btn || !result) return;
  const labelIdle = btn.dataset.labelIdle || btn.textContent.trim();
  btn.dataset.labelIdle = labelIdle;

  btn.disabled = true;
  btn.textContent = t('updateChecking');
  result.className = 'update-result hidden';

  const current = chrome.runtime.getManifest?.()?.version || '0.0.0';
  let latest = null;

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      latest = (data.tag_name || '').replace(/^v/, '');
    }
  } catch { /* fallback below */ }

  if (latest && compareVersions(latest, current) > 0) {
    result.className = 'update-result new-version';
    const msg = tf('updateNewVersion', { version: latest });
    const storeLabel = t('updateOpenStore');
    const ghLabel = t('updateOpenGitHub');
    result.innerHTML =
      `<div>${escHtml(msg)}</div>` +
      `<div class="update-actions">` +
        `<a class="update-download" href="${escHtml(CHROME_STORE_URL)}" target="_blank" rel="noopener">${escHtml(storeLabel)}</a>` +
        `<a class="update-link" href="https://github.com/${GITHUB_REPO}/releases" target="_blank" rel="noopener">${escHtml(ghLabel)}</a>` +
      `</div>`;
  } else if (latest) {
    result.className = 'update-result up-to-date';
    result.textContent = t('updateUpToDate');
  } else {
    result.className = 'update-result check-error';
    result.textContent = t('updateCheckFailed');
  }

  btn.disabled = false;
  btn.textContent = labelIdle;
}

function compareVersions(a, b) {
  const pa = (a || '').split('.').map(Number);
  const pb = (b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function showSettingsPage(page) {
  document.querySelectorAll('.settings-page').forEach((p) => p.classList.add('hidden'));
  const target = $(`settings-${page}`);
  if (!target) return;
  target.classList.remove('hidden');
  if (page === 'prompt') {
    getPrompt().then((text) => {
      const el = $('settings-prompt-text');
      if (el) el.textContent = text;
    });
  }
  if (page === 'about') {
    const verEl = $('about-ver-val');
    const aboutEl = $('about-version');
    const v = chrome.runtime.getManifest?.()?.version || '—';
    if (verEl) verEl.textContent = v;
    if (aboutEl) aboutEl.textContent = 'v' + v;
  }
}

// ── SW message listener ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MESSAGE_TYPES.NOTIFY_TOOL_CALLED && message.entry) {
    onToolActivity(message.entry);
  }
  if (message?.type === MESSAGE_TYPES.NOTIFY_TASK_PLAN && message.plan) {
    onTaskPlan(message.plan);
  }
  if (message?.type === MESSAGE_TYPES.NOTIFY_TASK_LIFECYCLE && message.event) {
    onTaskLifecycle(message.event);
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await registerPanelWindow();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void registerPanelWindow();
  });

  await initLanguage();
  localizeDOM();
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  await loadProjectPath();
  initTabs();
  initSettings();

  // Buttons
  $('btn-copy-prompt')?.addEventListener('click', () => copyPrompt('prompt-copied'));
  $('btn-header-copy-prompt')?.addEventListener('click', () => copyPrompt('prompt-copied'));
  $('btn-suspend-toggle')?.addEventListener('click', toggleSelfSuspend);
  $('identity-name')?.addEventListener('click', copyIdentityLabel);

  // Fetch own identity up front — the suspend toggle and identity row need it.
  void fetchSelfIdentity();

  $('btn-clear-log')?.addEventListener('click', () => {
    logEntries.length = 0; renderLog();
  });

  $('btn-close-task')?.addEventListener('click', () => {
    resetTask();
    updateMonitorLayout();
  });
  $('btn-shutdown')?.addEventListener('click', async () => {
    const shutdownPrompt =
      'Shut down the AgentLimb Bridge now. Run, in order:\n' +
      '1. pkill -f "run-server.js" || true\n' +
      '2. launchctl disable gui/$(id -u)/com.agentlimb.bridge ; launchctl bootout gui/$(id -u)/com.agentlimb.bridge 2>/dev/null || true\n' +
      '3. lsof -nP -iTCP:7791 || echo "Bridge is down; port 7791 is free"';
    try {
      await copyText(shutdownPrompt);
      setStatus(t('statusShutdownCopied'));
    } catch (_) {
      setStatus(t('statusShutdownCopyFailed'));
    }
  });


  $('btn-open-muscle-folder')?.addEventListener('click', async () => {
    const btn = $('btn-open-muscle-folder');
    if (btn?.disabled) return;
    try {
      await fetch(`${MVP_HOST_BASE_URL}/api/mvp/muscle/open-folder`, {
        method: 'POST', signal: AbortSignal.timeout(2000),
      });
    } catch (_) {
      await copyText('~/Desktop/AgentLimb-muscle/').catch(() => {});
      setStatus(t('statusPathCopied'));
    }
  });

  // Muscle folder button state
  updateMuscleFolderButton();

  // Load history from SW
  await loadActivityLog();

  // Prompt preview
  await renderPromptPreview();

  // Initial monitor layout — shows "Not connected" idle-state or "Connected — ready"
  // placeholder based on the very first pollBridgeStatus result below.
  updateMonitorLayout();

  // Bridge poll
  await pollBridgeStatus();
  setInterval(pollBridgeStatus, 5000);

  setStatus(t('ready'));
}

init().catch(console.error);
