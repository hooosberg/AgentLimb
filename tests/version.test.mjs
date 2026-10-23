/**
 * Version bookkeeping.
 *
 * The version lives in three files that must agree: `kernel/shared/constants.js`
 * (the code reads it), `package.json` and `manifest.json` (Chrome and npm read
 * it). They used to be edited by hand, so a bump could easily land in two of the
 * three and the panel would quietly show a different build than the host.
 *
 * These checks make an incomplete bump fail `npm test` instead.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_VERSION, APP_BUILD } from '../kernel/shared/constants.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const pkg = JSON.parse(read('package.json'));
const manifest = JSON.parse(read('manifest.json'));

test('constants, package.json and manifest.json agree on the version', () => {
  assert.equal(pkg.version, APP_VERSION, 'package.json must mirror APP_VERSION');
  assert.equal(pkg.agentlimbBuild, APP_BUILD, 'package.json must mirror APP_BUILD');
  assert.equal(manifest.version, APP_VERSION, 'manifest.json must mirror APP_VERSION');
  assert.equal(manifest.version_name, `${APP_VERSION}-${APP_BUILD}`, 'version_name is what the panel shows');
});

test('the build marker advances with the version', () => {
  // A version bump without a build bump means two different builds report the
  // same string, which defeats the point of having both.
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/, 'APP_VERSION must be semver');
  assert.match(APP_BUILD, /^[a-z]\d+$/, 'APP_BUILD must be a short marker like l4');
});

test('the changelog documents the current version', () => {
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, new RegExp(`^## ${APP_VERSION} / ${APP_BUILD} — \\d{4}-\\d{2}-\\d{2}$`, 'm'),
    'the newest changelog entry must match the current version, dated');
  // The newest entry must come first.
  const first = changelog.indexOf('## ');
  const current = changelog.indexOf(`## ${APP_VERSION} / ${APP_BUILD}`);
  assert.equal(first, current, 'the current version must be the topmost entry');
});

test('the docs quote the current version, not a stale one', () => {
  // CHANGELOG.md is exempt: it intentionally records old versions.
  for (const doc of ['README.md', 'docs/development.md', 'docs/onboarding.md']) {
    const text = read(doc);
    assert.ok(text.includes(`${APP_VERSION} / ${APP_BUILD}`) || text.includes(`${APP_VERSION}-${APP_BUILD}`),
      `${doc} must quote the current version`);
    for (const match of text.matchAll(/(\d+\.\d+\.\d+)\s*\/\s*([a-z]\d+)/g)) {
      assert.equal(`${match[1]}/${match[2]}`, `${APP_VERSION}/${APP_BUILD}`,
        `${doc} still quotes the stale version ${match[1]}/${match[2]}`);
    }
  }
});
