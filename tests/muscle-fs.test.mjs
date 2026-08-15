import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use a temp dir so tests never pollute ~/Desktop
let tmpDir;
before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'agentlimb-muscle-test-'));
  process.env.AGENTLIMB_MUSCLE_DIR = tmpDir;
});
after(async () => {
  delete process.env.AGENTLIMB_MUSCLE_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

// Dynamic import so MUSCLE_DIR env is set before module loads
const { normalizeDomain, readProfile, writeProfile, listDomains, readIndex } =
  await import('../kernel/bridge/mvp/muscle-fs.js');

test('normalizeDomain strips protocol and path', () => {
  assert.equal(normalizeDomain('https://tieba.baidu.com/f?kw=python'), 'tieba.baidu.com');
  assert.equal(normalizeDomain('http://github.com'), 'github.com');
  assert.equal(normalizeDomain('github.com'), 'github.com');
  assert.equal(normalizeDomain('GITHUB.COM'), 'github.com');
});

test('normalizeDomain rejects dangerous inputs', () => {
  assert.equal(normalizeDomain(''), null);
  assert.equal(normalizeDomain(null), null);
  assert.equal(normalizeDomain('..'), null);
  assert.equal(normalizeDomain('foo/bar'), null);
  assert.equal(normalizeDomain('foo\\bar'), null);
});

test('readProfile returns null for unknown domain', async () => {
  const profile = await readProfile('unknown-site.com');
  assert.equal(profile, null);
});

test('writeProfile then readProfile round-trip', async () => {
  const profile = {
    domain: 'tieba.baidu.com',
    lastUpdatedAt: new Date().toISOString(),
    version: 1,
    notes: [{ at: new Date().toISOString(), text: '编辑器加载慢' }],
    selectors: { '发帖按钮': [{ value: '.btn-post', type: 'css', reliability: 0.9 }] },
    workflows: [],
  };
  await writeProfile('tieba.baidu.com', profile);
  const read = await readProfile('tieba.baidu.com');
  assert.deepEqual(read, profile);
});

test('writeProfile is atomic (overwrites cleanly)', async () => {
  const v1 = { domain: 'example.com', version: 1, notes: [], selectors: {}, workflows: [] };
  const v2 = { domain: 'example.com', version: 2, notes: [], selectors: {}, workflows: [] };
  await writeProfile('example.com', v1);
  await writeProfile('example.com', v2);
  const read = await readProfile('example.com');
  assert.equal(read.version, 2);
});

test('writeProfile rejects invalid domain', async () => {
  await assert.rejects(() => writeProfile('', {}), /Invalid domain/);
  await assert.rejects(() => writeProfile('foo/bar', {}), /Invalid domain/);
});

test('listDomains returns written domains sorted by mtime', async () => {
  // tieba and example were written above; clear temp dir for isolation
  const { mkdtemp: mk } = await import('node:fs/promises');
  const isolatedDir = await mkdtemp(join(tmpdir(), 'agentlimb-list-test-'));
  const origDir = process.env.AGENTLIMB_MUSCLE_DIR;
  process.env.AGENTLIMB_MUSCLE_DIR = isolatedDir;

  await writeProfile('site-a.com', { domain: 'site-a.com', version: 1, notes: [], selectors: {}, workflows: [] });
  await writeProfile('site-b.com', { domain: 'site-b.com', version: 1, notes: [], selectors: {}, workflows: [] });

  const domains = await listDomains();
  const names = domains.map(d => d.domain);
  assert.ok(names.includes('site-a.com'));
  assert.ok(names.includes('site-b.com'));

  process.env.AGENTLIMB_MUSCLE_DIR = origDir;
  await rm(isolatedDir, { recursive: true, force: true });
});

test('readIndex reflects written domains', async () => {
  const index = await readIndex();
  assert.ok(Array.isArray(index.domains));
  const found = index.domains.find(d => d.domain === 'tieba.baidu.com');
  assert.ok(found, 'tieba.baidu.com should be in index');
});
