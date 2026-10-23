import test from 'node:test';
import assert from 'node:assert/strict';

import { buildConnectionPrompt } from '../kernel/prompt/build-prompt.js';
import {
  verifyDiscovery,
  verifyFingerprint,
  verifyProfileLookup,
  extractUnixCommands,
  chromeExtensionId,
} from '../scripts/verify-install-discovery.mjs';

const CJK = /[\u4e00-\u9fff]/;
const EXT_ID = 'poiblbjgbeecibjhnadcpmleigpopllj';

test('the copied prompt is English-only, whatever the UI language is', () => {
  const zh = buildConnectionPrompt({ lang: 'zh' });
  const en = buildConnectionPrompt({ lang: 'en' });
  assert.equal(zh, en, 'the prompt must not branch on language any more');
  assert.ok(!CJK.test(zh), 'prompt must not contain CJK characters');
  assert.ok(!/[「」【】（）、，。：；]/.test(zh), 'prompt must not contain CJK punctuation');
});

test('Gate 0 turns the extension ID into the install folder', () => {
  const prompt = buildConnectionPrompt({ extensionId: EXT_ID });
  assert.match(prompt, /## Gate 0/);
  assert.match(prompt, new RegExp(`Extension ID: \`${EXT_ID}\``));
  assert.match(prompt, /SHA-256\(absolute folder path\)/);
  assert.match(prompt, /0-f.*a-p/s);

  const blocks = extractUnixCommands(prompt);
  assert.equal(blocks.length, 2, 'step 1 (profile) + step 2 (scan)');
  // Step 1 must be the cheap authoritative lookup, not a disk scan.
  assert.match(blocks[0], /Secure Preferences/);
  assert.ok(blocks[0].includes(`'${EXT_ID}'`), 'the ID must be substituted into step 1');
  // Step 2 is the scan fallback and must filter by the same ID.
  assert.match(blocks[1], /^find "\$HOME"/);
  assert.match(blocks[1], /xargs -0 node -e/);
  assert.ok(blocks[1].includes(`'${EXT_ID}'`));

  // CRX installs have signature-based IDs: the prompt must say so.
  assert.match(prompt, /installed as a package \(CRX\) rather than unpacked/);
  assert.match(prompt, /ask the user exactly one question/);
  // The old, unusable instruction must stay gone.
  assert.ok(!/locate the trusted extension\/repository folder/.test(prompt));
});

test('without an extension ID the prompt falls back to the package.json rule', () => {
  const prompt = buildConnectionPrompt({});
  assert.ok(!/Extension ID:/.test(prompt));
  assert.match(prompt, /whose `name` is `agentlimb`/);
  assert.match(prompt, /Get-ChildItem/, 'Windows discovery command must be present');
  assert.match(prompt, /never install from `\.agentlimb\.backup-\*`/i);
});

test('a saved install source is embedded but must still hash to the extension ID', () => {
  const prompt = buildConnectionPrompt({ sourcePath: '/Users/me/Projects/agentlimb', extensionId: EXT_ID });
  assert.match(prompt, /Install source saved by the user: `\/Users\/me\/Projects\/agentlimb`/);
  assert.match(prompt, /it must hash to the extension ID above/);
  assert.match(prompt, /the saved path points at a copy/);
});

test('Chrome ID algorithm matches the IDs Chrome actually assigned on this machine', () => {
  // Recorded from two real profiles (Secure Preferences → extensions.settings).
  assert.equal(
    chromeExtensionId('/Users/maohuhu/进行中的项目/编程项目/开发项目/chrome插件/cowork_lite'),
    'poiblbjgbeecibjhnadcpmleigpopllj',
  );
  assert.equal(
    chromeExtensionId('/Users/maohuhu/进行中的项目/编程项目/开发项目/chrome插件/cowork_local'),
    'ideicnclmcbcbkpmifakpaofkipgeljn',
  );
});

test('step 1 reads back the folder Chrome recorded for that ID', () => {
  const report = verifyProfileLookup();
  assert.ok(report.ok, `paths were:\n${report.matches.join('\n')}`);
  assert.equal(report.matches[0], report.target);
});

test('step 2 resolves the ID to one folder even when identical copies exist', () => {
  const report = verifyFingerprint();
  assert.ok(report.ok, `matches were:\n${report.matches.join('\n')}`);
  assert.equal(report.matches.length, 1);
  assert.match(report.matches[0], /Projects[\\/]agentlimb$/);
});

test('the package.json fallback is ambiguous by design — that is why the ID comes first', () => {
  const report = verifyDiscovery();
  assert.ok(report.ok, 'two identical copies should both look valid to the fallback rule');
  assert.equal(report.valid.length, 2);
});

test('cross-platform & universal agent prompt: fast-path, Linux/Windows profile lookup, and Windows UTF-16LE ID hashing', async () => {
  const { execFileSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const prompt = buildConnectionPrompt({ extensionId: EXT_ID });
  // 1. Fast path for already-configured agents (1-second reconnect/switch).
  assert.match(prompt, /Fast path.*skip Gates 0–2 and go directly to Gate 5/);
  // 2. Universal agent formats (TOML, YAML, CLI/terminal agents).
  assert.match(prompt, /terminal\/CLI agent/);
  assert.match(prompt, /TOML/);
  assert.match(prompt, /YAML/);

  // 3. Linux Chromium / Snap & Windows LOCALAPPDATA profile lookup via Step 1 command.
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-xplat-'));
  try {
    const linuxTarget = join(home, 'opt', 'agentlimb');
    const linuxId = chromeExtensionId(linuxTarget);
    const linuxProfile = join(home, '.config', 'chromium', 'Default');
    mkdirSync(linuxProfile, { recursive: true });
    writeFileSync(
      join(linuxProfile, 'Secure Preferences'),
      JSON.stringify({ extensions: { settings: { [linuxId]: { path: linuxTarget } } } }),
    );
    const step1 = extractUnixCommands(buildConnectionPrompt({ extensionId: linuxId }))[0];
    const out = execFileSync('/bin/sh', ['-c', step1], { env: { ...process.env, HOME: home }, encoding: 'utf8' }).trim();
    assert.equal(out, linuxTarget, 'Step 1 finds Linux Chromium profile path');

    // 4. Windows UTF-16LE unpacked extension ID hashing in Step 2 ID_FILTER.
    const winTarget = join(home, 'win-repo', 'agentlimb');
    mkdirSync(join(winTarget, 'bin'), { recursive: true });
    const winBin = join(winTarget, 'bin', 'agentlimb.mjs');
    writeFileSync(winBin, '// cli\n');
    const winHex = createHash('sha256').update(Buffer.from(winTarget, 'utf16le')).digest('hex').slice(0, 32);
    const winId = [...winHex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    const step2 = extractUnixCommands(buildConnectionPrompt({ extensionId: winId }))[1];
    const matched = execFileSync('/bin/sh', ['-c', step2], { env: { ...process.env, HOME: home }, encoding: 'utf8' }).trim();
    assert.equal(matched, winTarget, 'Step 2 ID_FILTER matches Windows UTF-16LE hashed extension ID');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
