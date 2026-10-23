/**
 * Shared harness for the pairing bench and the pairing monkey.
 *
 * It drives BOTH sides with the real code:
 *   host    → host/bridge-server.mjs   (createBridge, in-process)
 *   browser → kernel/control/background/bridge-client.js  (the shipped module)
 *
 * Nothing is re-implemented except the two browser APIs Node does not have
 * (EventSource, chrome.*), so the measured numbers are the numbers the
 * extension really sees.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { TEST_BRIDGE_PORTS, STORAGE_KEYS } from '../../kernel/shared/constants.js';
import { createBridge, loadOrCreateClientId, clientTrustPath, clientIdentityPath } from '../../host/bridge-server.mjs';
import { createBridgeClient } from '../../kernel/control/background/bridge-client.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `predicate()` is truthy, or throw. Returns the elapsed ms. */
export async function waitUntil(predicate, { timeout = 8000, interval = 5, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return Date.now() - started;
    if (Date.now() - started > timeout) throw new Error(`timed out after ${timeout}ms waiting for ${label}`);
    await sleep(interval);
  }
}

// ── browser APIs Node lacks ───────────────────────────────────────────────────
/**
 * Minimal EventSource: enough for `new EventSource(url)` + onopen/onmessage/
 * onerror/close(). Reconnect behaviour is deliberately absent — the extension
 * drops the channel and re-discovers on error, so a polyfill that reconnects
 * silently would hide real bugs.
 */
export class NodeEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.abort = new AbortController();
    void this.#run();
  }

  async #run() {
    try {
      const response = await fetch(this.url, { signal: this.abort.signal, headers: { Accept: 'text/event-stream' } });
      if (!response.ok) throw new Error(`SSE ${response.status}`);
      this.readyState = 1;
      this.onopen?.();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            this.onmessage?.({ data: line.slice(6) });
          }
        }
      }
      throw new Error('stream closed');
    } catch (error) {
      if (this.abort.signal.aborted) return;
      this.readyState = 2;
      this.onerror?.(error);
    }
  }

  close() {
    this.abort.abort();
    this.readyState = 2;
  }
}

/** The slice of chrome.* that bridge-client.js actually touches. */
export function createChromeMock(seed = {}) {
  const store = { ...seed };
  return {
    store,
    api: {
      runtime: {
        id: 'bench-extension',
        getURL: (path) => path,
        sendMessage: async () => ({ ok: true }),
      },
      storage: {
        local: {
          get: async (key) => (typeof key === 'string' ? { [key]: store[key] } : {}),
          set: async (patch) => { Object.assign(store, patch); },
        },
      },
      tabs: { create: async () => ({}), remove: async () => {} },
    },
  };
}

/**
 * Never leave `chrome` undefined: bridge-client keeps async continuations alive
 * (frame handlers, dropChannel) that may run after a scenario has torn down.
 * A detached no-op mock keeps those harmless instead of crashing the run.
 */
const DETACHED = createChromeMock().api;

// ── sandbox ───────────────────────────────────────────────────────────────────
/** Point ~/.agentlimb at a throwaway directory so runs never touch real trust. */
export function sandboxHome() {
  const home = mkdtempSync(join(tmpdir(), 'agentlimb-pairing-'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    home,
    /**
     * Pre-seed host-side trust, as if this AI had paired in an earlier session.
     * The identity file is seeded too, so `loadOrCreateClientId` returns the
     * same id and a later host really is the remembered AI.
     */
    seedHostTrust(clientName, clientKind, id = 'seeded-client') {
      mkdirSync(join(home, '.agentlimb'), { recursive: true });
      writeFileSync(clientTrustPath(id), JSON.stringify({ id, name: clientName, kind: clientKind, pairedAt: 'x' }));
      writeFileSync(clientIdentityPath(clientName, clientKind), JSON.stringify({ id, name: clientName, kind: clientKind }));
      return id;
    },
    restore() {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(home, { recursive: true, force: true });
    },
  };
}

// ── host ──────────────────────────────────────────────────────────────────────
/**
 * Start the real bridge. `timeline` records the moments that matter, taken
 * from the host's own log lines — no extra instrumentation in production code.
 */
export async function createHost({ clientName = 'Bench Agent', clientKind = 'bench', clientId, quiet = true, ports = TEST_BRIDGE_PORTS } = {}) {
  const timeline = { listeningAt: null, sseAt: null, grantAt: null, deniedAt: null, connectedAt: null };
  const id = clientId || loadOrCreateClientId(clientName, clientKind);
  const bridge = createBridge({
    clientId: id,
    clientName,
    clientKind,
    ports,
    onLog: (level, message) => {
      if (/bridge listening/.test(message)) timeline.listeningAt = performance.now();
      if (/browser connected/.test(message)) timeline.sseAt = performance.now();
      if (/browser authorized/.test(message)) timeline.grantAt = performance.now();
      if (/还没有授权|not authorized/.test(message)) timeline.deniedAt = performance.now();
      if (!quiet && level !== 'info') process.stderr.write(`[host:${level}] ${message}\n`);
    },
  });
  timeline.listeningAt = null;
  const started = performance.now();
  const port = await bridge.start();
  if (timeline.listeningAt == null) timeline.listeningAt = started;
  return { bridge, port, clientId: id, timeline };
}

/** Occupy a port with a look-alike server so the host has to move on. */
export async function occupyPort(port, { looksLikeAgentlimb = false } = {}) {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(looksLikeAgentlimb
      ? { ok: true, service: 'agentlimb-bridge', client: { id: 'impostor' }, paired: false }
      : { ok: true, hello: 'not agentlimb' }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { port, close: () => new Promise((resolve) => server.close(resolve)) };
}

// ── browser (the extension) ───────────────────────────────────────────────────
/**
 * Boot the shipped bridge client against the mock chrome APIs.
 * `pairedClients` / `onboardUntil` seed chrome.storage.local exactly like a
 * previous session would have.
 */
export async function createBrowser({ pairedClients, onboardUntil, discoveryIntervalMs, onToolCall, ports = TEST_BRIDGE_PORTS } = {}) {
  const seed = {};
  if (pairedClients) seed[STORAGE_KEYS.pairedClients] = pairedClients;
  if (onboardUntil != null) seed[STORAGE_KEYS.onboardUntil] = onboardUntil;
  const mock = createChromeMock(seed);
  globalThis.chrome = mock.api;
  globalThis.EventSource = NodeEventSource;

  const statuses = [];
  const toolCalls = [];
  const client = createBridgeClient({
    discoveryIntervalMs,
    ports,
    onStatus: (snapshot) => statuses.push({ at: performance.now(), ...snapshot }),
    onToolCall: async (call) => {
      toolCalls.push({ at: performance.now(), ...call });
      if (onToolCall) return onToolCall(call);
      return { ok: true, pong: true };
    },
  });

  const connectedAt = () => statuses.find((s) => s.status === 'connected')?.at ?? null;
  return {
    client,
    mock,
    statuses,
    toolCalls,
    connectedAt,
    storage: mock.store,
    async start() { await client.start(); },
    async stop() { client.stop(); },
    restore() {
      client.stop();
      globalThis.chrome = DETACHED;
    },
  };
}

/** All bridge ports, so a scenario can assert the host landed where expected. */
export const PORTS = TEST_BRIDGE_PORTS;
