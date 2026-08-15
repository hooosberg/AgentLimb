import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;
let server;
let baseUrl;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'agentlimb-server-test-'));
  process.env.AGENTLIMB_MUSCLE_DIR = tmpDir;

  const { createMvpServer } = await import('../kernel/bridge/mvp/server.js');
  server = createMvpServer({ host: '127.0.0.1', port: 0 });
  await server.start();
  baseUrl = server.getBaseUrl();
});

after(async () => {
  await server.stop();
  delete process.env.AGENTLIMB_MUSCLE_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

test('GET /api/mvp/muscle/list returns empty array when no profiles', async () => {
  const data = await api('GET', '/api/mvp/muscle/list');
  assert.equal(data.ok, true);
  assert.ok(Array.isArray(data.domains));
});

test('POST /api/mvp/muscle/write creates a profile', async () => {
  const profile = {
    domain: 'github.com',
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    notes: [{ at: new Date().toISOString(), text: 'PR creation flow' }],
    selectors: { '提交PR': [{ value: '.btn-primary', type: 'css', reliability: 0.9 }] },
    workflows: [],
  };
  const data = await api('POST', '/api/mvp/muscle/write', { domain: 'github.com', profile });
  assert.equal(data.ok, true);
  assert.equal(data.domain, 'github.com');
  assert.ok(data.bytes > 0);
});

test('GET /api/mvp/muscle/read retrieves the written profile', async () => {
  const data = await api('GET', '/api/mvp/muscle/read?domain=github.com');
  assert.equal(data.ok, true);
  assert.equal(data.domain, 'github.com');
  assert.equal(data.profile.version, 1);
  assert.equal(data.profile.notes[0].text, 'PR creation flow');
});

test('GET /api/mvp/muscle/read returns null profile for unknown domain', async () => {
  const data = await api('GET', '/api/mvp/muscle/read?domain=unknown-xyz.com');
  assert.equal(data.ok, true);
  assert.equal(data.profile, null);
});

test('GET /api/mvp/muscle/read rejects missing domain', async () => {
  const data = await api('GET', '/api/mvp/muscle/read');
  assert.equal(data.ok, false);
});

test('POST /api/mvp/muscle/write rejects invalid domain', async () => {
  const data = await api('POST', '/api/mvp/muscle/write', { domain: '', profile: {} });
  assert.equal(data.ok, false);
});

test('POST /api/mvp/muscle/write rejects missing profile', async () => {
  const data = await api('POST', '/api/mvp/muscle/write', { domain: 'foo.com' });
  assert.equal(data.ok, false);
});

test('GET /api/mvp/muscle/list shows written domain', async () => {
  const data = await api('GET', '/api/mvp/muscle/list');
  assert.equal(data.ok, true);
  const found = data.domains.find(d => d.domain === 'github.com');
  assert.ok(found, 'github.com should be listed');
});

test('write then read round-trip with URL domain normalisation', async () => {
  const profile = { domain: 'zhihu.com', version: 1, notes: [], selectors: {}, workflows: [] };
  // write with full URL as domain key
  await api('POST', '/api/mvp/muscle/write', { domain: 'https://zhihu.com/question/123', profile });
  // read with plain domain
  const data = await api('GET', '/api/mvp/muscle/read?domain=zhihu.com');
  assert.equal(data.ok, true);
  assert.equal(data.domain, 'zhihu.com');
  assert.ok(data.profile !== null);
});
