/**
 * Unit tests for session buffer + flushSession (the muscle auto-loop core).
 *
 * Uses an in-memory mock for chrome.storage.local and a mock Host fetch to
 * exercise all four status branches without hitting the filesystem.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMuscleStore } from '../kernel/muscle/store.js';
import { flushSession } from '../kernel/muscle/auto-capture.js';

function createMockStorage() {
  const data = new Map();
  return {
    _data: data,
    get(key, cb) {
      const value = data.get(key);
      cb(value != null ? { [key]: value } : {});
    },
    set(obj, cb) {
      for (const [k, v] of Object.entries(obj)) data.set(k, v);
      if (cb) cb();
    },
    remove(key, cb) {
      data.delete(key);
      if (cb) cb();
    },
  };
}

function createMockFetch() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body || null });
    if (String(url).includes('/api/mvp/muscle/write')) {
      return {
        ok: true,
        json: async () => ({ ok: true, path: '/tmp/fake.json', bytes: 100 }),
      };
    }
    return { ok: true, json: async () => ({ ok: true, profile: null }) };
  };
  return { fetch: fetchImpl, calls };
}

test('appendSession + readSession round-trip', async () => {
  const storage = createMockStorage();
  const store = createMuscleStore({ storage, hostBaseUrl: 'http://test' });

  await store.appendSession('task1', {
    domain: 'example.com',
    role: 'button',
    label: 'Submit',
    selector: '#submit',
    at: '2026-04-17T10:00:00Z',
  });

  const read = await store.readSession('task1');
  assert.equal(read.length, 1);
  assert.equal(read[0].selector, '#submit');
});

test('appendSession dedupes identical entries', async () => {
  const storage = createMockStorage();
  const store = createMuscleStore({ storage, hostBaseUrl: 'http://test' });

  const entry = {
    domain: 'example.com',
    role: 'button',
    label: 'Go',
    selector: '.btn-go',
    at: '2026-04-17T10:00:00Z',
  };
  await store.appendSession('task1', entry);
  await store.appendSession('task1', entry);
  await store.appendSession('task1', entry);

  const read = await store.readSession('task1');
  assert.equal(read.length, 1, 'same selector+role+domain should dedupe');
});

test('flushSession(failed) drops buffer and never writes Host', async () => {
  const storage = createMockStorage();
  const { fetch, calls } = createMockFetch();
  globalThis.fetch = fetch;
  const store = createMuscleStore({ storage, hostBaseUrl: 'http://test' });

  await store.appendSession('task1', {
    domain: 'example.com',
    role: 'button',
    label: 'X',
    selector: '.x',
    at: '2026-04-17T10:00:00Z',
  });

  const result = await flushSession({ store }, { taskId: 'task1', status: 'failed' });
  assert.equal(result.action, 'dropped');
  assert.equal(result.droppedEntries, 1);

  const session = await store.readSession('task1');
  assert.equal(session.length, 0, 'session should be cleared');

  const writeCalls = calls.filter((c) => c.url.includes('/write'));
  assert.equal(writeCalls.length, 0, 'no Host write on failed');
});

test('flushSession(success) writes to Host and clears session', async () => {
  const storage = createMockStorage();
  const { fetch, calls } = createMockFetch();
  globalThis.fetch = fetch;
  const store = createMuscleStore({ storage, hostBaseUrl: 'http://test' });

  await store.appendSession('task1', {
    domain: 'example.com',
    role: 'button',
    label: 'Submit',
    selector: '#sub',
    at: '2026-04-17T10:00:00Z',
  });

  const result = await flushSession(
    { store },
    { taskId: 'task1', status: 'success', verification: 'URL changed to /done' },
  );

  assert.equal(result.action, 'flushed');
  assert.equal(result.flushed.length, 1);
  assert.equal(result.flushed[0].domain, 'example.com');
  assert.equal(result.flushed[0].ok, true);

  // Session cleared after success
  const session = await store.readSession('task1');
  assert.equal(session.length, 0);

  // Host write happened
  const writeCalls = calls.filter((c) => c.url.includes('/write'));
  assert.equal(writeCalls.length, 1);

  // Pending cleared after successful write
  const pending = await store.readPending();
  assert.equal(pending.length, 0);
});

test('flushSession(partial) marks workflow partial + keeps stepsCompleted', async () => {
  const storage = createMockStorage();
  const { fetch } = createMockFetch();
  globalThis.fetch = fetch;
  const store = createMuscleStore({ storage, hostBaseUrl: 'http://test' });

  await store.appendSession('task1', {
    domain: 'example.com',
    role: 'input',
    label: 'Email',
    selector: '#email',
    at: '2026-04-17T10:00:00Z',
  });
  await store.appendSession('task1', {
    domain: 'example.com',
    role: 'input',
    label: 'Password',
    selector: '#pwd',
    at: '2026-04-17T10:00:01Z',
  });

  const result = await flushSession(
    { store },
    {
      taskId: 'task1',
      status: 'partial',
      verification: 'Filled up to the password field; captcha done manually afterwards',
      stepsCompleted: 2,
      workflowName: 'Login first half',
    },
  );

  assert.equal(result.action, 'flushed');

  const profile = storage._data.get('muscle_v1_example.com');
  assert.ok(profile);
  assert.equal(profile.workflows.length, 1);
  assert.equal(profile.workflows[0].partial, true);
  assert.equal(profile.workflows[0].stepsCompleted, 2);
  assert.equal(profile.workflows[0].name, 'Login first half');
});

test('flushSession(manual) writes but keeps session for continued accumulation', async () => {
  const storage = createMockStorage();
  const { fetch } = createMockFetch();
  globalThis.fetch = fetch;
  const store = createMuscleStore({ storage, hostBaseUrl: 'http://test' });

  await store.appendSession('task1', {
    domain: 'example.com',
    role: 'button',
    label: 'Save',
    selector: '.save',
    at: '2026-04-17T10:00:00Z',
  });

  const result = await flushSession(
    { store },
    { taskId: 'task1', status: 'manual', note: 'user asked to save it now' },
  );

  assert.equal(result.action, 'flushed');

  // Session NOT cleared on manual — allows further accumulation
  const session = await store.readSession('task1');
  assert.equal(session.length, 1, 'manual keeps session buffer alive');

  // Profile written with a manual note
  const profile = storage._data.get('muscle_v1_example.com');
  assert.ok(profile);
  assert.ok(
    profile.notes.some((n) => n.text.includes('[manual commit]')),
    'manual adds a [manual commit] note',
  );
});

test('flushSession(empty session) returns noop without error', async () => {
  const storage = createMockStorage();
  const { fetch } = createMockFetch();
  globalThis.fetch = fetch;
  const store = createMuscleStore({ storage, hostBaseUrl: 'http://test' });

  const result = await flushSession({ store }, { taskId: 'task1', status: 'success' });
  assert.equal(result.action, 'noop');
});

test('flushSession keeps pending when Host write fails', async () => {
  const storage = createMockStorage();
  globalThis.fetch = async () => {
    throw new Error('Host unreachable');
  };
  const store = createMuscleStore({ storage, hostBaseUrl: 'http://test' });

  await store.appendSession('task1', {
    domain: 'example.com',
    role: 'button',
    label: 'X',
    selector: '.x',
    at: '2026-04-17T10:00:00Z',
  });

  const result = await flushSession(
    { store },
    { taskId: 'task1', status: 'success', verification: 'ok' },
  );

  // Flushed but not ok since Host down
  assert.equal(result.flushed[0].ok, false);

  // Pending retained — retry next time
  const pending = await store.readPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0], 'example.com');

  // Hot layer still has the merged profile
  const hot = storage._data.get('muscle_v1_example.com');
  assert.ok(hot, 'hot layer should have profile even if Host failed');
});

test('pending domain API add/remove/read', async () => {
  const storage = createMockStorage();
  const store = createMuscleStore({ storage, hostBaseUrl: 'http://test' });

  await store.addPending('a.com');
  await store.addPending('b.com');
  await store.addPending('a.com'); // dedupe

  let pending = await store.readPending();
  assert.deepEqual(pending.sort(), ['a.com', 'b.com']);

  await store.removePending('a.com');
  pending = await store.readPending();
  assert.deepEqual(pending, ['b.com']);
});
