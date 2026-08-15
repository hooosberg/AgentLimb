/**
 * Muscle store for the Chrome extension side.
 *
 * Two-layer architecture:
 *   Cache  — chrome.storage.local (fast reads, survives extension reload)
 *   Truth  — ~/Desktop/AgentLimb-muscle/<domain>.json via MVP Host HTTP
 *
 * Reads: cache-first, fall through to Host on miss.
 * Writes: write cache then sync to Host.
 */

const STORAGE_PREFIX = 'muscle_v1_';
const SESSION_PREFIX = 'muscle_session_';
const PENDING_KEY = 'muscle_pending_domains';
const SESSION_MAX_ENTRIES = 200;
const HOST_BASE = 'http://127.0.0.1:7791';

/**
 * Create a muscle store bound to the Chrome extension environment.
 * In unit tests (no chrome.*), pass mock implementations.
 */
export function createMuscleStore({ storage = null, hostBaseUrl = HOST_BASE } = {}) {
  const store = storage || (typeof chrome !== 'undefined' ? chrome.storage.local : null);

  async function get(domain) {
    // 1. Try cache
    const cached = await storageGet(store, `${STORAGE_PREFIX}${domain}`);
    if (cached) return cached;

    // 2. Miss → fetch from Host, populate cache
    try {
      const res = await fetch(`${hostBaseUrl}/api/mvp/muscle/read?domain=${encodeURIComponent(domain)}`);
      const data = await res.json();
      if (data.ok && data.profile) {
        await storageSet(store, `${STORAGE_PREFIX}${domain}`, data.profile);
        return data.profile;
      }
    } catch {
      // Host unreachable — return null gracefully
    }
    return null;
  }

  async function set(domain, profile) {
    // 1. Write cache immediately
    await storageSet(store, `${STORAGE_PREFIX}${domain}`, profile);

    // 2. Sync to Host (best-effort, don't throw on failure)
    try {
      await fetch(`${hostBaseUrl}/api/mvp/muscle/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, profile }),
      });
    } catch {
      // Host unreachable — cached, will sync on next read
    }
  }

  async function list() {
    try {
      const res = await fetch(`${hostBaseUrl}/api/mvp/muscle/list`);
      const data = await res.json();
      if (data.ok) return data.domains;
    } catch { /* ignore */ }
    return [];
  }

  async function invalidate(domain) {
    await storageRemove(store, `${STORAGE_PREFIX}${domain}`);
  }

  // ── Hot-only write (no Host sync) — used by auto-capture ──
  async function setHot(domain, profile) {
    await storageSet(store, `${STORAGE_PREFIX}${domain}`, profile);
  }

  // ── Session buffer (per task) ──

  async function appendSession(taskId, entry) {
    const key = `${SESSION_PREFIX}${taskId}`;
    const existing = (await storageGet(store, key)) || [];
    // Dedupe by domain + selector + role — same click twice shouldn't inflate
    const sig = `${entry.domain}|${entry.role}|${entry.selector}`;
    const alreadyHas = existing.some(
      (e) => `${e.domain}|${e.role}|${e.selector}` === sig,
    );
    if (alreadyHas) return existing.length;
    const next = [...existing, entry].slice(-SESSION_MAX_ENTRIES);
    await storageSet(store, key, next);
    return next.length;
  }

  async function readSession(taskId) {
    const key = `${SESSION_PREFIX}${taskId}`;
    return (await storageGet(store, key)) || [];
  }

  async function clearSession(taskId) {
    const key = `${SESSION_PREFIX}${taskId}`;
    await storageRemove(store, key);
  }

  // ── Pending domain tracking (dirty set for Host sync) ──

  async function addPending(domain) {
    const list = (await storageGet(store, PENDING_KEY)) || [];
    if (!list.includes(domain)) {
      await storageSet(store, PENDING_KEY, [...list, domain]);
    }
  }

  async function removePending(domain) {
    const list = (await storageGet(store, PENDING_KEY)) || [];
    const next = list.filter((d) => d !== domain);
    await storageSet(store, PENDING_KEY, next);
  }

  async function readPending() {
    return (await storageGet(store, PENDING_KEY)) || [];
  }

  // ── Direct Host write (used by auto-capture flush) ──

  async function writeToHost(domain, profile) {
    const res = await fetch(`${hostBaseUrl}/api/mvp/muscle/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, profile }),
    });
    if (!res.ok) throw new Error(`Host write failed: ${res.status}`);
    return res.json();
  }

  return {
    get,
    set,
    list,
    invalidate,
    setHot,
    appendSession,
    readSession,
    clearSession,
    addPending,
    removePending,
    readPending,
    writeToHost,
  };
}

// ── chrome.storage.local wrappers (promise-based) ──

function storageGet(storage, key) {
  if (!storage) return Promise.resolve(null);
  return new Promise((resolve) => {
    storage.get(key, (result) => resolve(result?.[key] ?? null));
  });
}

function storageSet(storage, key, value) {
  if (!storage) return Promise.resolve();
  return new Promise((resolve) => {
    storage.set({ [key]: value }, resolve);
  });
}

function storageRemove(storage, key) {
  if (!storage) return Promise.resolve();
  return new Promise((resolve) => {
    storage.remove(key, resolve);
  });
}
