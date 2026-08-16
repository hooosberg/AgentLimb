import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

// i18n keys introduced with the b8 four-state status panel.
const B8_KEYS = [
  'bridgeWorking',
  'bridgeWorkingShort',
  'agentStateOperating',
  'agentStateOperatingSubtitle',
  'agentStateDone',
  'agentStateDoneSubtitle',
  'idleSupportedAgents',
];

test('every locale carries the four-state status panel keys', async () => {
  const locales = (await readdir(new URL('_locales', root))).sort();
  assert.ok(locales.length >= 12, 'expected at least 12 locales');
  for (const lang of locales) {
    const messages = JSON.parse(await read(`_locales/${lang}/messages.json`));
    for (const key of B8_KEYS) {
      assert.ok(
        messages[key]?.message && messages[key].message.trim().length > 0,
        `${lang} is missing a non-empty "${key}" message`,
      );
    }
  }
});

test('sidepanel markup exposes the four-state card and supported-agent hint', async () => {
  const html = await read('ui/sidepanel/sidepanel.html');
  assert.match(html, /id="connected-idle"[^>]*data-phase="idle"/);
  assert.match(html, /id="ci-icon"/);
  assert.match(html, /id="ci-title"/);
  assert.match(html, /id="ci-subtitle"/);
  assert.match(html, /data-i18n="idleSupportedAgents"/);
});

test('sidepanel logic drives idle → operating → done for direct tool calls', async () => {
  const js = await read('ui/sidepanel/sidepanel.js');
  // Lightweight state machine (no synthesized mission lifecycle).
  assert.match(js, /const agentActivity = \{ phase: 'idle'/);
  assert.match(js, /OPERATING_SETTLE_MS/);
  assert.match(js, /DONE_FADE_MS/);
  // Direct calls (no task_plan) feed the state machine instead of being dropped.
  assert.match(js, /if \(!task\.active\) \{\s*\n\s*\/\/ No mission.*\n\s*markAgentActivity\(\);/s);
  assert.match(js, /if \(!task\.active\) markAgentActivity\(\);/);
  // The header status dot mirrors the operating state.
  assert.match(js, /'status-working'/);
  assert.match(js, /'bridgeWorkingShort'/);
  // Bridge offline and task_plan activation both reset the panel state.
  assert.match(js, /resetAgentActivity\('idle'\);/);
});

test('sidepanel styles animate the hourglass and working status dot', async () => {
  const css = await read('ui/sidepanel/sidepanel.css');
  assert.match(css, /\.status-dot\.status-working/);
  assert.match(css, /@keyframes status-dot-pulse/);
  assert.match(css, /\.connected-idle-card\[data-phase="operating"\]/);
  assert.match(css, /@keyframes hourglass-flip/);
});
