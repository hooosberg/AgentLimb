/**
 * AgentLimb i18n — runtime language switching
 *
 * Loads messages.json directly instead of relying on chrome.i18n.getMessage(),
 * so the user can switch language without changing browser settings.
 *
 * Usage:
 *   import { t, localizeDOM, initI18n, setLanguage, getLanguage } from '../lib/i18n.js';
 *   await initI18n();           → load saved language (or auto-detect)
 *   t('keyName')                → localized string
 *   t('keyName', ['arg'])       → with $1$ substitutions
 *   localizeDOM()               → auto-replace all [data-i18n] elements
 *   await setLanguage('en')     → switch + persist + re-localize
 */

export const LANGS = [
  { code: 'zh_CN', name: '简体中文',   flag: '🇨🇳' },
  { code: 'en',    name: 'English',    flag: '🇺🇸' },
  { code: 'ja',    name: '日本語',     flag: '🇯🇵' },
  { code: 'ko',    name: '한국어',     flag: '🇰🇷' },
  { code: 'es',    name: 'Español',    flag: '🇪🇸' },
  { code: 'fr',    name: 'Français',   flag: '🇫🇷' },
  { code: 'de',    name: 'Deutsch',    flag: '🇩🇪' },
  { code: 'pt_BR', name: 'Português',  flag: '🇧🇷' },
  { code: 'ru',    name: 'Русский',    flag: '🇷🇺' },
  { code: 'ar',    name: 'العربية',    flag: '🇸🇦' },
  { code: 'it',    name: 'Italiano',   flag: '🇮🇹' },
  { code: 'hi',    name: 'हिन्दी',      flag: '🇮🇳' },
];

const SUPPORTED = LANGS.map(l => l.code);
const STORAGE_KEY = 'agentlimb_lang';
const THEME_KEY   = 'agentlimb_theme';
let _messages = {};
let _lang = 'zh_CN';
let _theme = 'dark';

/** Detect best default language from browser */
function detectLang() {
  const ui = (navigator.language || 'zh-CN').replace('-', '_');
  if (ui.startsWith('zh')) return 'zh_CN';
  if (ui.startsWith('pt')) return 'pt_BR';
  // Match exact or prefix
  for (const code of SUPPORTED) {
    if (ui === code || ui.startsWith(code.split('_')[0])) return code;
  }
  return 'en';
}

/** Load a messages.json file */
async function loadMessages(lang) {
  try {
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    const res = await fetch(url);
    return await res.json();
  } catch {
    // Fallback to English
    if (lang !== 'en') {
      try {
        const url = chrome.runtime.getURL('_locales/en/messages.json');
        const res = await fetch(url);
        return await res.json();
      } catch { return {}; }
    }
    return {};
  }
}

/** Initialize i18n — call once at startup */
export async function initI18n() {
  // Read saved preference
  try {
    const data = await chrome.storage.local.get([STORAGE_KEY, THEME_KEY]);
    _lang = data[STORAGE_KEY] || detectLang();
    _theme = data[THEME_KEY] || 'dark';
  } catch {
    _lang = detectLang();
    _theme = 'dark';
  }
  if (!SUPPORTED.includes(_lang)) _lang = detectLang();
  _messages = await loadMessages(_lang);
  applyTheme(_theme);
}

/** Get current language */
export function getLanguage() {
  return _lang;
}

/** Switch language, persist, reload messages */
export async function setLanguage(lang) {
  if (!SUPPORTED.includes(lang)) return;
  _lang = lang;
  await chrome.storage.local.set({ [STORAGE_KEY]: lang });
  _messages = await loadMessages(lang);
  localizeDOM();
}

/** Get current theme */
export function getTheme() {
  return _theme;
}

/** Apply theme to DOM */
function applyTheme(theme) {
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/** Switch theme, persist, apply */
export async function setTheme(theme) {
  _theme = theme;
  await chrome.storage.local.set({ [THEME_KEY]: theme });
  applyTheme(theme);
}

/** Listen for system theme changes (when set to auto) */
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (_theme === 'auto') applyTheme('auto');
});

/** Translate a key, with optional substitutions */
export function t(key, substitutions) {
  const entry = _messages[key];
  if (!entry) return key;
  let msg = entry.message || key;
  // Replace $name$ placeholders with substitutions array
  if (substitutions && entry.placeholders) {
    const names = Object.keys(entry.placeholders);
    for (let i = 0; i < names.length; i++) {
      const ph = entry.placeholders[names[i]];
      // ph.content is like "$1", "$2" etc.
      const idx = parseInt(ph.content?.replace('$', ''), 10) - 1;
      if (idx >= 0 && idx < substitutions.length) {
        msg = msg.replace(new RegExp(`\\$${names[i]}\\$`, 'g'), substitutions[idx]);
      }
    }
  }
  return msg;
}

/**
 * Scan DOM for [data-i18n] and [data-i18n-*] attributes, replace content.
 *
 * data-i18n="keyName"              → el.textContent = t('keyName')
 * data-i18n-title="keyName"        → el.title = t('keyName')
 * data-i18n-placeholder="keyName"  → el.placeholder = t('keyName')
 * data-i18n-html="keyName"         → el.innerHTML = t('keyName')
 */
export function localizeDOM(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    const key = el.dataset.i18nTitle;
    if (key) el.title = t(key);
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    const key = el.dataset.i18nPlaceholder;
    if (key) el.placeholder = t(key);
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    const key = el.dataset.i18nHtml;
    if (key) el.innerHTML = t(key);
  }
}
