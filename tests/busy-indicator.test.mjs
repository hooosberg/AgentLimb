/**
 * Minimal busy indicator: only the orange AgentLimb tab-group chip shows "⏳ AgentLimb"
 * while the AI is operating. The extension toolbar icon does not change, the page
 * title is untouched, and the side panel simply shows "正在操作" / "Working".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('only the tab-group chip carries the hourglass while busy', () => {
  const sw = read('kernel/control/background/service-worker.js');
  assert.match(sw, /'⏳ AgentLimb'/, 'tab group gets the hourglass while busy');
  assert.doesNotMatch(sw, /setBadgeText/, 'extension toolbar icon must not change when busy');

  const router = read('kernel/control/background/router.js');
  assert.match(router, /\(⏳ \)\?AgentLimb/, 'a busy group must still be matched, not duplicated');

  const indicator = read('kernel/control/content/indicator.js');
  assert.doesNotMatch(indicator, /⏳/, 'in-page indicator and document.title stay clean');

  const css = read('ui/sidepanel/sidepanel.css');
  assert.doesNotMatch(css, /hourglass-flip/, 'side panel uses simple text + dot, no hourglass animation');
});
