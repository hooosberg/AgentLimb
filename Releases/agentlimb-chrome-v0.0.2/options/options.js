/**
 * options.js — AgentLimb About page
 */

import { initI18n, localizeDOM } from '../lib/i18n.js';

(async () => {
  await initI18n();
  localizeDOM();

  // Read version from manifest.json and display
  try {
    const manifest = chrome.runtime.getManifest();
    const v = manifest.version;
    const vStr = `v${v}`;
    const el1 = document.getElementById('ext-version');
    const el2 = document.getElementById('display-version');
    if (el1) el1.textContent = vStr;
    if (el2) el2.textContent = v;
  } catch (e) {
    // Ignore (may fail outside Chrome extension context)
  }
})();
