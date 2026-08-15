import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildIdentitySection } from '../kernel/prompt/identity.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const escapedVersion = version.replaceAll('.', '\\.');

test('Windows first-run prompt bootstraps from a fixed public source tag', () => {
  const prompt = buildIdentitySection({
    platform: 'Windows',
    extensionOnline: true,
    bridgeOnline: false,
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
  });

  assert.match(prompt, new RegExp(`archive/refs/tags/v${escapedVersion}\\.zip`));
  assert.match(prompt, /scripts\\install\.ps1/);
  assert.match(prompt, /AgentLimb source version check failed/);
  assert.match(prompt, /Set-ExecutionPolicy -Scope Process Bypass -Force/);
  assert.match(prompt, /-ChromeExtensionId \$extensionId/);
  assert.match(prompt, /Before downloading files, creating a scheduled task/);
  assert.doesNotMatch(prompt, /agentlimb-windows-v/);
  assert.doesNotMatch(prompt, /launchctl/);
});

test('macOS first-run prompt bootstraps from the same fixed public source tag', () => {
  const prompt = buildIdentitySection({
    platform: 'macOS',
    extensionOnline: true,
    bridgeOnline: false,
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
  });

  assert.match(prompt, new RegExp(`archive/refs/tags/v${escapedVersion}\\.zip`));
  assert.match(prompt, /scripts\/install\.sh/);
  assert.match(prompt, /--extension-id "\$EXTENSION_ID"/);
  assert.match(prompt, /AgentLimb source version check failed/);
  assert.match(prompt, /Before downloading files, creating a scheduled task/);
  assert.doesNotMatch(prompt, /agentlimb-windows-v/);
});
