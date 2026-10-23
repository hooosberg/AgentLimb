#!/usr/bin/env node
/**
 * Self-test for Gate 0 of the connection prompt.
 *
 * Chrome gives an extension no way to read its own folder, but an unpacked
 * extension's ID *is* the folder path's fingerprint: SHA-256(path) → first
 * 16 bytes → hex digits mapped 0-f → a-p. The prompt uses that in two steps:
 *
 *   Step 1  read the path Chrome recorded in the profile
 *           (`extensions.settings[<id>].path`) — fast and authoritative
 *   Step 2  scan `bin/agentlimb.mjs` and keep the folder that hashes to the ID
 *           — fallback for unusual profile locations
 *
 * Both commands are taken from the prompt text itself (not re-implemented), so
 * this test fails if the published command breaks.
 *
 * Throwaway HOME layout:
 *   Projects/agentlimb              complete repo, the folder we "loaded"
 *   copy-of-repo/agentlimb          identical copy (package.json also matches)
 *   old/agentlimb                   complete, but package.json name differs
 *   .agentlimb.backup-<stamp>/repo  backup copy, name differs
 *   node_modules/some-dep/agentlimb dependency copy, excluded by the command
 *   Library/.../Chrome/Default/Secure Preferences   records the ID → folder
 *
 * Usage: node scripts/verify-install-discovery.mjs [--keep]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildConnectionPrompt } from '../kernel/prompt/build-prompt.js';
import { APP_VERSION, APP_BUILD } from '../kernel/shared/constants.js';

/** Chrome's unpacked-extension ID: SHA-256(path), 16 bytes, hex → a-p. */
export function chromeExtensionId(folder) {
  const hex = createHash('sha256').update(folder).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

function seed(home) {
  const repo = (root, { name = 'agentlimb', host = true, bin = true } = {}) => {
    mkdirSync(join(root, 'bin'), { recursive: true });
    mkdirSync(join(root, 'host'), { recursive: true });
    if (bin) writeFileSync(join(root, 'bin', 'agentlimb.mjs'), '// cli\n');
    if (host) writeFileSync(join(root, 'host', 'mcp-server.mjs'), '// host\n');
    // Mirrors the real package.json, so bumping the version never makes this
    // fixture look like a stale copy.
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name, version: APP_VERSION, agentlimbBuild: APP_BUILD }));
  };
  const target = join(home, 'Projects', 'agentlimb');
  repo(target);
  repo(join(home, 'copy-of-repo', 'agentlimb'));
  repo(join(home, 'old', 'agentlimb'), { name: 'agentlimb-old' });
  repo(join(home, '.agentlimb.backup-20260816', 'repo'), { name: 'agentlimb-backup' });
  repo(join(home, 'node_modules', 'some-dep', 'agentlimb'));
  mkdirSync(join(home, '.agentlimb.backup-20260816', 'runtime'), { recursive: true });
  writeFileSync(join(home, '.agentlimb.backup-20260816', 'runtime', 'mcp-server.mjs'), '// legacy\n');

  // What Chrome writes when the extension is loaded unpacked.
  const id = chromeExtensionId(target);
  const profileDir = join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default');
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(
    join(profileDir, 'Secure Preferences'),
    JSON.stringify({ extensions: { settings: { [id]: { path: target, location: 4 } } } }),
  );
  return { target, id };
}

/** Every ```sh block in the prompt, in order (Step 1, then Step 2). */
export function extractUnixCommands(prompt) {
  const blocks = [...prompt.matchAll(/```sh\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  if (!blocks.length) throw new Error('prompt has no sh block');
  return blocks;
}

function run(command, home) {
  const stdout = execFileSync('/bin/sh', ['-c', command], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Fallback rule the prompt states for the no-ID case. */
export function isValidByPackageJson(candidate) {
  const root = dirname(dirname(candidate));
  if (!existsSync(join(root, 'host', 'mcp-server.mjs'))) return false;
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')).name === 'agentlimb';
  } catch {
    return false;
  }
}

/** Step 1: does the published command read the folder Chrome recorded? */
export function verifyProfileLookup({ keep = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-profile-'));
  try {
    const { target, id } = seed(home);
    const prompt = buildConnectionPrompt({ extensionId: id });
    const command = extractUnixCommands(prompt)[0];
    const matches = run(command, home);
    return { home, id, target, command, matches, ok: matches.length === 1 && matches[0] === target };
  } finally {
    if (!keep) rmSync(home, { recursive: true, force: true });
  }
}

/** Step 2: does the scan command resolve the ID back to one folder? */
export function verifyFingerprint({ keep = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-fingerprint-'));
  try {
    const { target, id } = seed(home);
    const prompt = buildConnectionPrompt({ extensionId: id });
    const blocks = extractUnixCommands(prompt);
    const command = blocks[1];
    if (!command) throw new Error('prompt has no Step 2 scan block');
    const matches = run(command, home);
    return { home, id, target, command, matches, ok: matches.length === 1 && matches[0] === target };
  } finally {
    if (!keep) rmSync(home, { recursive: true, force: true });
  }
}

/** No-ID fallback: the package.json rule cannot separate two identical copies. */
export function verifyDiscovery({ keep = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-discovery-'));
  try {
    seed(home);
    const prompt = buildConnectionPrompt({});
    const command = extractUnixCommands(prompt)[0];
    const candidates = run(command, home);
    const valid = candidates.filter(isValidByPackageJson);
    return { home, command, candidates, valid, ok: valid.length > 1 };
  } finally {
    if (!keep) rmSync(home, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const keep = process.argv.includes('--keep');
  const print = (label, list, home) => {
    console.log(`${label}:`);
    for (const item of list) console.log('  ' + item.replace(home, '$HOME'));
    if (!list.length) console.log('  (none)');
  };

  const profile = verifyProfileLookup({ keep });
  console.log('Gate 0 / Step 1 — read the path Chrome recorded\n');
  console.log(profile.command, '\n');
  console.log('extension id:', profile.id, '\n');
  print('paths', profile.matches, profile.home);
  console.log(profile.ok ? '\nPASS - the profile lookup returned the loaded folder' : '\nFAIL - profile lookup missed');

  const scan = verifyFingerprint({ keep });
  console.log('\nGate 0 / Step 2 — scan + hash fallback\n');
  print('matched folders', scan.matches, scan.home);
  console.log(scan.ok ? '\nPASS - the scan resolved the ID to exactly one folder' : '\nFAIL - expected exactly one match');

  const fallback = verifyDiscovery({ keep });
  console.log('\nGate 0 / no-ID fallback (package.json rule)\n');
  print('valid by package.json', fallback.valid, fallback.home);
  console.log(fallback.ok
    ? '\nPASS - demonstrably ambiguous (>1 valid copy), which is why the ID comes first'
    : '\nNOTE - the fallback happened to be unambiguous in this fixture');

  if (keep) console.log('\nkept for inspection:', profile.home);
  process.exitCode = profile.ok && scan.ok ? 0 : 1;
}
