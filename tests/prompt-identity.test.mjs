import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildIdentitySection } from '../kernel/prompt/identity.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releaseBase = `https://github.com/hooosberg/AgentLimb/releases/download/v${pkg.version}`;
const runtimeAsset = `agentlimb-runtime-v${pkg.version}-${pkg.agentlimbBuild}.zip`;

test('offline Windows prompt uses the signed GitHub Release Runtime', () => {
  const prompt = buildIdentitySection({
    platform: 'Windows',
    extensionOnline: true,
    bridgeOnline: false,
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    browserName: 'Microsoft Edge',
  });

  assert.match(prompt, new RegExp(`${releaseBase}/${runtimeAsset}`));
  assert.match(prompt, new RegExp(`${releaseBase}/SHA256SUMS\\.txt`));
  assert.match(prompt, /scripts\\install\.ps1 -ExtensionId abcdefghijklmnopabcdefghijklmnop/);
  assert.match(prompt, /Invoke-WebRequest/);
  assert.match(prompt, /Do not scan browser profiles, desktop folders, zip files, or source directories/);
  assert.match(prompt, /- Browser:\s+Microsoft Edge/);
  assert.doesNotMatch(prompt, /@agentlimb\/mcp|npx --yes|Preferences|findExtensionSource|find_extension_source|C:\\Mac/);
});

test('online runtime without a Mission waits without creating a task', () => {
  const prompt = buildIdentitySection({
    platform: 'Windows',
    extensionOnline: true,
    bridgeOnline: true,
  });

  assert.match(prompt, /No browser mission is present/);
  assert.match(prompt, /MCP command:/);
  assert.doesNotMatch(prompt, /start the Bridge|task_plan/);
});

test('offline macOS prompt uses the matching GitHub Release Runtime', () => {
  const prompt = buildIdentitySection({
    platform: 'macOS',
    extensionOnline: true,
    bridgeOnline: false,
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
  });

  assert.match(prompt, new RegExp(`${releaseBase}/${runtimeAsset}`));
  assert.match(prompt, /scripts\/install\.sh --extension-id abcdefghijklmnopabcdefghijklmnop/);
  assert.match(prompt, /curl -sf/);
  assert.doesNotMatch(prompt, /Application Support|\$HOME\/Desktop|@agentlimb\/mcp/);
});
