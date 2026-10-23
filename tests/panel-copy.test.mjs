/**
 * Side panel copy and DOM wiring.
 *
 * The panel has no build step and no type checker, so a stale `$('some-id')` or
 * a deleted i18n key fails silently at runtime: the element is simply `null` and
 * the label falls back to the raw key. Both have happened. These two checks cost
 * a few milliseconds and make the class of bug impossible to ship.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const html = readFileSync(join(root, 'ui/sidepanel/sidepanel.html'), 'utf8');
const js = readFileSync(join(root, 'ui/sidepanel/sidepanel.js'), 'utf8');

/** Keys declared in the `text = (key) => ({ ... })[key]` dictionary. */
function declaredKeys() {
  const start = js.indexOf('const text = (key) => ({');
  assert.ok(start > 0, 'the i18n dictionary must still be a literal object');
  const body = js.slice(start, js.indexOf('}[key] ?? key);', start));
  const keys = new Set();
  for (const line of body.split('\n')) {
    const match = /^ {2}([A-Za-z][A-Za-z0-9]*):/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

test('every data-i18n key in the markup has a translation', () => {
  const used = new Set();
  for (const match of html.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)) used.add(match[1]);
  assert.ok(used.size > 20, 'the panel should still declare its static copy via data-i18n');
  const defined = declaredKeys();
  const missing = [...used].filter((key) => !defined.has(key));
  assert.deepEqual(missing, [], `untranslated keys (the UI would print the raw key): ${missing.join(', ')}`);
});

test('every element the panel looks up exists in the markup', () => {
  const ids = new Set();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) ids.add(match[1]);
  // `$(\`page-${id}\`)` is built from SETTINGS_PAGES; resolve those explicitly.
  const dynamic = [...js.matchAll(/\$\('page-(\w+)'\)/g)].map((m) => `page-${m[1]}`);
  const looked = new Set();
  for (const match of js.matchAll(/\$\('([^']+)'\)/g)) looked.add(match[1]);
  for (const id of dynamic) looked.add(id);
  assert.ok(looked.size > 15, 'the panel should still wire a real number of elements');
  const dangling = [...looked].filter((id) => !ids.has(id));
  assert.deepEqual(dangling, [], `dead element lookups (they evaluate to null): ${dangling.join(', ')}`);
});

test('the unpaired screen says one thing, not a manual', () => {
  // The whole first screen is a headline, one sentence, and the copy button.
  // Everything else (MCP config, what a bridge is, how pairing works) is noise
  // at the moment the user just wants to connect.
  const unpaired = html.slice(html.indexOf('id="state-unpaired"'), html.indexOf('id="state-paired"'));
  assert.match(unpaired, /data-i18n="heroTitle"/);
  assert.match(unpaired, /data-i18n="heroSub"/);
  assert.equal((unpaired.match(/<p\b/g) || []).length, 1, 'the unpaired state may have exactly one paragraph');
  assert.doesNotMatch(unpaired, /MCP|mcpServers|JSON|bridge port/i, 'no configuration talk on the first screen');
  assert.match(unpaired, /data-i18n="copy"/);
});
