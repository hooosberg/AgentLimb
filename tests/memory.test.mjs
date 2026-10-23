/**
 * 网站记忆 / site memory.
 *
 * These tests pin the two properties the feature is sold on:
 *   1. the folder is self-describing and survives re-installs (nothing is
 *      overwritten, so a user's own notes are never lost), and
 *   2. what the AI reads back after a run is the same knowledge it wrote —
 *      including the "this keeps failing" signal that stops a stale playbook
 *      from being followed blindly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  MEMORY_MARKER,
  brief,
  ensureMemory,
  findSite,
  listSites,
  memoryInstructions,
  memoryState,
  normDomain,
  record,
  stats,
  writeMemoryConfig,
} from '../host/memory.mjs';

function sandbox() {
  const root = join(process.cwd(), '.tmp-test', `memory-${randomUUID().slice(0, 8)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

test('ensureMemory creates a self-describing folder and never overwrites edits', () => {
  const root = sandbox();
  const first = ensureMemory(root);
  assert.equal(first.created, true);
  for (const file of [MEMORY_MARKER, 'README.md', 'RULES.md', 'CONVENTIONS.md', 'INDEX.md']) {
    assert.ok(existsSync(join(root, file)), `${file} missing`);
  }
  assert.ok(existsSync(join(root, 'knowledge', 'sites')), 'knowledge/sites missing');

  // A user (or an older version) may have customised the rules; an upgrade must
  // not clobber them, otherwise the feature silently resets on every install.
  const rules = join(root, 'RULES.md');
  writeFileSync(rules, 'my own rules\n');
  const second = ensureMemory(root);
  assert.equal(second.created, false);
  assert.equal(readFileSync(rules, 'utf8'), 'my own rules\n');
});

test('normDomain folds URLs, www and ports into one folder name', () => {
  assert.equal(normDomain('https://www.youtube.com/watch?v=1'), 'youtube.com');
  assert.equal(normDomain('http://studio.youtube.com:443/channel/x'), 'studio.youtube.com');
  assert.equal(normDomain('m.example.com'), 'example.com');
  assert.equal(normDomain('  Example.COM.  '), 'example.com');
  assert.equal(normDomain(''), '');
});

test('brief on an unknown site says NO_PLAYBOOK and shows the exact record call', () => {
  const root = sandbox();
  ensureMemory(root);
  const result = brief(root, 'https://unknown.example/');
  assert.equal(result.found, false);
  assert.match(result.text, /^NO_PLAYBOOK: unknown\.example/);
  assert.match(result.text, /action:"record"/);
});

test('record then brief round-trips operation knowledge and counters', () => {
  const root = sandbox();
  ensureMemory(root);
  const outcome = record(root, {
    site: 'https://studio.youtube.com/channel/UC1/videos/upload',
    status: 'success',
    title: 'YouTube Studio',
    entry: 'https://studio.youtube.com/channel/UC1/videos/upload',
    steps: '1) 确认已登录 2) input[type=file] 走 DataTransfer 3) Publish',
    selectors: '标题框 → ytcp-video-metadata-editor #textbox → 页面有多个 #textbox',
    pitfalls: '点 Publish 后弹二次确认',
    note: '出现 Video published',
    capabilities: ['upload_video'],
    ai: 'test',
  });
  assert.equal(outcome.domain, 'studio.youtube.com');
  assert.equal(outcome.status, 'verified');
  assert.equal(outcome.knowledge, 4);
  assert.equal(outcome.runs, 1);

  const read = brief(root, 'studio.youtube.com');
  assert.equal(read.found, true);
  assert.match(read.text, /status=verified/);
  assert.match(read.text, /input\[type=file\]/);
  assert.match(read.text, /二次确认/);
  // Section 7 (success criteria) was never supplied, so it must not be invented.
  assert.doesNotMatch(read.text, /## 7\./);

  // Second run on the same site must not create a second playbook.
  record(root, { site: 'studio.youtube.com', status: 'success', note: '再来一次' });
  assert.equal(listSites(root).length, 1);
  const summary = stats(root);
  assert.equal(summary.sites, 1);
  assert.equal(summary.sessions, 2);
});

test('two consecutive failures mark the playbook stale so the AI re-verifies anchors', () => {
  const root = sandbox();
  ensureMemory(root);
  record(root, { site: 'shop.example', status: 'success', entry: 'https://shop.example/new' });
  assert.equal(brief(root, 'shop.example').text.includes('WARNING'), false);

  record(root, { site: 'shop.example', status: 'fail', note: '第 3 步找不到按钮' });
  record(root, { site: 'shop.example', status: 'fail', note: '按钮 aria-label 变了' });
  const after = brief(root, 'shop.example');
  assert.match(after.text, /WARNING/);
  assert.match(after.text, /status=stale/);
});

test('aliases and titles are findable even when the domain is not typed', () => {
  const root = sandbox();
  ensureMemory(root);
  record(root, { site: 'youtube.com', status: 'success', title: 'YouTube', capabilities: ['upload_video'] });
  // Aliases are only written through the front matter, which is a supported
  // hand-edit — the folder must still be findable after it.
  const file = findSite(root, 'youtube.com').file;
  writeFileSync(file, readFileSync(file, 'utf8').replace('aliases: []', 'aliases: [yt]'));
  assert.equal(findSite(root, 'yt')?.domain, 'youtube.com');
});

test('memoryInstructions names the folder and the read/write contract', () => {
  const text = memoryInstructions('/home/u/.agentlimb/memory');
  assert.match(text, /\/home\/u\/\.agentlimb\/memory/);
  assert.match(text, /action "brief"/);
  assert.match(text, /action "record"/);
  assert.match(text, /Never store credentials/);
});

test('memoryState honours the off switch and a missing folder', () => {
  const root = sandbox();
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  writeMemoryConfig({ enabled: true, root: join(root, 'notes') }, { home });
  ensureMemory(join(root, 'notes'));
  assert.equal(memoryState({ home }).enabled, true);

  writeMemoryConfig({ enabled: false }, { home });
  assert.equal(memoryState({ home }).enabled, false);
  assert.equal(memoryState({ home }).configured, false);
});

test('a playbook never grows into a tutorial', () => {
  const root = sandbox();
  ensureMemory(root);
  record(root, {
    site: 'news.example',
    status: 'success',
    entry: 'https://news.example/publish',
    steps: '1) 打开 2) 填 3) 发布',
  });
  const lines = readFileSync(findSite(root, 'news.example').file, 'utf8').split('\n').length;
  assert.ok(lines < 60, `a first playbook should stay small, got ${lines} lines`);
});

// ── 第二轮：把"提示词里的纪律"变成代码里的不变量 ───────────────────────────

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { redact } from '../host/memory.mjs';

test('a hostile site name can never escape the sites folder', () => {
  const root = sandbox();
  ensureMemory(root);
  for (const bad of ['..', '../../etc', 'a/../..', 'https://../x', '.', '...', '', '   ', 'x y', 'a\\b']) {
    assert.equal(normDomain(bad) === '' || !/[\\/\s]|\.\./.test(normDomain(bad)), true, `unsafe domain survived: ${JSON.stringify(bad)}`);
  }
  assert.throws(() => record(root, { site: '../../escape', status: 'success' }), /合法的 site/);
  assert.throws(() => record(root, { site: '..', status: 'success' }), /合法的 site/);
  assert.equal(existsSync(join(root, 'knowledge', 'PLAYBOOK.md')), false);
  assert.match(brief(root, '../..').text, /^INVALID_SITE/);
});

test('credential-shaped strings are scrubbed before they reach disk', () => {
  const root = sandbox();
  ensureMemory(root);
  const outcome = record(root, {
    site: 'login.example',
    status: 'success',
    steps: '1) 填 password: hunter2secret 2) 提交',
    pitfalls: 'Authorization: Bearer abcdef1234567890abcdef 会过期；验证码：123456',
    note: 'token=sk-abcdefghijklmnopqrstuvwxyz0123 ok',
  });
  assert.ok(outcome.redacted >= 4, `expected >=4 redactions, got ${outcome.redacted}`);
  const disk = readFileSync(join(root, 'knowledge/sites/login.example/PLAYBOOK.md'), 'utf8')
    + readdirSync(join(root, 'knowledge/sites/login.example/sessions')).map((f) => readFileSync(join(root, 'knowledge/sites/login.example/sessions', f), 'utf8')).join('');
  for (const secret of ['hunter2secret', 'abcdef1234567890abcdef', '123456', 'sk-abcdefghijklmnopqrstuvwxyz0123']) {
    assert.equal(disk.includes(secret), false, `${secret} leaked to disk`);
  }
  assert.equal(redact('入口 https://a.example/upload?x=1').hits, 0, 'operation knowledge must pass through untouched');
});

test('recording the same knowledge twice does not grow the playbook', () => {
  const root = sandbox();
  ensureMemory(root);
  for (let i = 0; i < 5; i += 1) record(root, { site: 'dup.example', status: 'success', entry: 'https://dup.example/go', selectors: '提交 → button[type=submit] → 唯一' });
  const body = readFileSync(findSite(root, 'dup.example').file, 'utf8');
  assert.equal(body.split('https://dup.example/go').length - 1, 1);
  assert.equal(body.split('button[type=submit]').length - 1, 1);
});

test('a playbook stays bounded however many runs are recorded', () => {
  const root = sandbox();
  ensureMemory(root);
  for (let i = 0; i < 80; i += 1) record(root, { site: 'busy.example', status: 'success', pitfalls: `坑 ${i}`, note: `第 ${i} 次` });
  const file = findSite(root, 'busy.example').file;
  const lines = readFileSync(file, 'utf8').split('\n').length;
  assert.ok(lines < 120, `playbook grew to ${lines} lines`);
  const text = brief(root, 'busy.example').text;
  assert.match(text, /坑 79/, 'the newest knowledge must survive trimming');
  assert.doesNotMatch(text, /坑 0\b/, 'the oldest knowledge is what gets trimmed');
  assert.ok(text.split('\n').length < 40, 'brief must stay small enough to read before every task');
});

test('stale means failing now: fail, success, fail is NOT stale', () => {
  const root = sandbox();
  ensureMemory(root);
  record(root, { site: 'flaky.example', status: 'success', entry: 'https://flaky.example/' });
  record(root, { site: 'flaky.example', status: 'fail' });
  record(root, { site: 'flaky.example', status: 'success' });
  const third = record(root, { site: 'flaky.example', status: 'fail' });
  assert.notEqual(third.status, 'stale');
  assert.equal(brief(root, 'flaky.example').text.includes('WARNING'), false);
  const fourth = record(root, { site: 'flaky.example', status: 'partial' });
  assert.equal(fourth.status, 'stale');
  assert.equal(record(root, { site: 'flaky.example', status: 'success' }).status, 'verified', 'one clean run recovers a stale playbook');
});

test('parallel clients recording into one folder lose nothing', () => {
  const root = sandbox();
  ensureMemory(root);
  const module = new URL('../host/memory.mjs', import.meta.url).href;
  const code = `import(${JSON.stringify(module)}).then((m) => { for (let i = 0; i < 10; i += 1) m.record(${JSON.stringify(root)}, { site: 'shared.example', status: 'success', note: 'w' + process.pid + '-' + i }); });`;
  const children = Array.from({ length: 4 }, () => spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' }));
  for (const child of children) assert.equal(child.status, 0, child.stderr);
  const site = findSite(root, 'shared.example');
  assert.equal(site.fm.runs, 40, `lost updates: runs=${site.fm.runs}`);
  assert.equal(stats(root).sessions, 40, 'every run keeps its own session file');
});

test('a secret in the title of a brand-new site is scrubbed from the heading too', () => {
  const root = sandbox();
  ensureMemory(root);
  record(root, { site: 'new.example', status: 'success', title: 'token=ZZtopSecret99 $& Studio' });
  const disk = readFileSync(findSite(root, 'new.example').file, 'utf8');
  assert.equal(disk.includes('ZZtopSecret99'), false);
  assert.match(disk, /# .*\$& Studio/, 'special replacement patterns in a title stay literal');
});

import { createMemoryHints } from '../host/memory.mjs';

test('auto hints: first visit carries the playbook, repeat visits stay quiet', () => {
  const root = sandbox();
  ensureMemory(root);
  record(root, { site: 'tieba.baidu.com', status: 'success', entry: 'https://tieba.baidu.com/f?kw=x', pitfalls: '标题 5-31 字' });
  const hints = createMemoryHints();
  const first = hints.navigated(root, 'https://tieba.baidu.com/f?kw=test');
  assert.match(first, /SITE MEMORY \(auto\)/);
  assert.match(first, /标题 5-31 字/);
  assert.equal(hints.navigated(root, 'https://tieba.baidu.com/p/1'), '', 'same site is not repeated in one session');
  assert.match(hints.navigated(root, 'https://new.example/'), /no playbook for new\.example/);
  for (const skip of ['chrome://extensions', 'about:blank', 'javascript:1', '', undefined]) {
    assert.equal(hints.navigated(root, skip), '', `must ignore ${skip}`);
  }
});

test('auto hints: finishing nudges once per unrecorded site, never after recording', () => {
  const root = sandbox();
  ensureMemory(root);
  const hints = createMemoryHints();
  assert.equal(hints.finishing(), '', 'nothing operated, nothing to nudge');
  hints.navigated(root, 'https://a.example/');
  hints.navigated(root, 'https://b.example/');
  hints.recorded('https://b.example/x');
  const nudge = hints.finishing();
  assert.match(nudge, /a\.example/);
  assert.doesNotMatch(nudge, /b\.example/);
  assert.equal(hints.finishing(), '', 'one nudge per site, not a nag');
});
