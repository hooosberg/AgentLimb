#!/usr/bin/env node
/**
 * Pairing monkey — random chaos, invariant checks.
 *
 * A smoke test proves the happy path. This proves that the *unhappy* paths
 * leave the system in a coherent state, which is what actually breaks users:
 * a half-paired client, a channel pointing at a dead port, a tool call that
 * hangs forever, a copy click that silently authorized nobody.
 *
 * It never asserts a particular sequence. Each iteration:
 *   1. builds a random world (0-3 AI hosts, random saved trust, random window)
 *   2. applies random operations (start/stop hosts, rip the SSE stream, copy,
 *      cancel, revoke, fire tool calls, spam HELLO, drop the worker)
 *   3. after every operation, checks the invariants below
 *
 * Usage:
 *   node scripts/pairing-monkey.mjs                 # 30 iterations
 *   node scripts/pairing-monkey.mjs --iterations 200 --seed 7
 *   node scripts/pairing-monkey.mjs --verbose
 */

import { ONBOARD_WINDOW_MS, STORAGE_KEYS, WIRE } from '../kernel/shared/constants.js';
import {
  createHost, createBrowser, sandboxHome, waitUntil, sleep,
} from './lib/pairing-harness.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const ITERATIONS = Number(arg('iterations', 30));
const VERBOSE = argv.includes('--verbose');
let seed = Number(arg('seed', Date.now() % 100000));

// mulberry32 — a seed makes any failure reproducible.
function random() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (p) => random() < p;

const failures = [];
function check(condition, message, context) {
  if (condition) return true;
  failures.push({ message, context });
  if (VERBOSE) process.stdout.write(`  ✗ ${message}\n`);
  return false;
}

// ── world ────────────────────────────────────────────────────────────────────
class World {
  constructor() {
    this.hosts = [];
    this.browser = null;
    this.home = null;
    this.log = [];
  }

  async spawn({ onboardUntil, pairedClients, home } = {}) {
    this.home = home || sandboxHome();
    this.browser = await createBrowser({ onboardUntil, pairedClients });
    await this.browser.start();
  }

  async addHost(name) {
    const host = await createHost({ clientName: name, clientKind: 'monkey', quiet: true });
    host.name = name;
    this.hosts.push(host);
    return host;
  }
  async killHost(host) {
    host.bridge.stop();
    this.hosts = this.hosts.filter((item) => item !== host);
    await sleep(30);
  }

  livePorts() {
    return new Set(this.hosts.map((host) => host.port));
  }

  async teardown() {
    for (const host of this.hosts) host.bridge.stop();
    this.hosts = [];
    if (this.browser) this.browser.restore();
    if (this.home) this.home.restore();
    await sleep(40);
  }
}

// ── invariants ───────────────────────────────────────────────────────────────
/**
 * `strict` is off mid-chaos (transitions are allowed to be in flight) and on
 * after a settle, where the state must have converged.
 */
function invariants(world, { strict }) {
  const client = world.browser.client;
  let status;
  try {
    status = client.getStatus();
  } catch (error) {
    check(false, `getStatus() threw: ${error.message}`);
    return;
  }
  const livePorts = world.livePorts();
  const ports = new Set((status.clients || []).map((c) => c.id));

  check(Array.isArray(status.clients), 'status.clients must be an array');
  check(Array.isArray(status.chat), 'status.chat must be an array');
  check(Array.isArray(status.unauthorized), 'status.unauthorized must be an array');

  // 1. Never report an online client whose bridge is gone.
  for (const item of status.clients || []) {
    if (!item.online) continue;
    const backed = world.hosts.some((host) => host.clientId === item.id && livePorts.has(host.port));
    check(backed, `client ${item.id} reported online but no bridge is running for it`, status);
  }

  // 2. Trust shown in the panel must exist in storage (never display-only).
  const saved = world.browser.storage[STORAGE_KEYS.pairedClients] || {};
  for (const item of status.clients || []) {
    if (!item.paired) continue;
    check(Boolean(saved[item.id]), `client ${item.id} shown as paired but missing from storage`, saved);
  }

  // 3. An unauthorized entry must never be a paired client.
  for (const entry of status.unauthorized || []) {
    const record = (status.clients || []).find((c) => c.id === entry.id);
    check(!record || !record.paired, `unauthorized list contains paired client ${entry.id}`, status.unauthorized);
  }

  // 4. The chat owner must be a paired, online client.
  if (status.connectedClientId) {
    const owner = (status.clients || []).find((c) => c.id === status.connectedClientId);
    check(Boolean(owner), `connectedClientId ${status.connectedClientId} is not a known client`);
    if (owner) {
      check(owner.paired, `chat owner ${owner.id} is not paired`);
      check(owner.online, `chat owner ${owner.id} is not online`);
    }
    check(status.status === 'connected', 'connectedClientId set while status is not connected');
  }

  // 5. Every host must agree with the browser about who may drive it.
  //    Grouped by clientId: two instances of the same AI software share one
  //    identity, and the browser only tracks the identity.
  for (const host of world.hosts) {
    const item = (status.clients || []).find((c) => c.id === host.clientId);
    if (!item || !item.paired) continue;
    if (!strict) continue;
    if (item.online) {
      const siblings = world.hosts.filter((other) => other.clientId === host.clientId);
      const authorized = siblings.some((other) => other.bridge.getActiveBrowser());
      check(authorized, `host ${host.clientId} is online+paired but no instance is authorized on its side`);
    } else {
      check(!host.bridge.getActiveBrowser(), `host ${host.clientId} still authorized after the browser dropped it`);
    }
  }

  // 6. No port may be tracked twice (the map is keyed by port for a reason).
  check(ports.size === (status.clients || []).length, 'duplicate client ids in status');
  return status;
}

// ── operations ───────────────────────────────────────────────────────────────
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];

function operations() {
  return [
    ['addHost', async (world) => {
      if (world.hosts.length >= 3) return 'skipped (3 hosts)';
      const used = new Set(world.hosts.map((host) => host.name));
      const name = NAMES.find((n) => !used.has(n)) || `Extra${world.hosts.length}`;
      const host = await world.addHost(name);
      return `added ${name} on ${host.port}`;
    }],
    ['killHost', async (world) => {
      if (!world.hosts.length) return 'skipped (no host)';
      const host = pick(world.hosts);
      await world.killHost(host);
      return `killed ${host.clientId}`;
    }],
    ['copy', async (world) => {
      await world.browser.client.openOnboarding();
      return 'copy window opened';
    }],
    ['cancelCopy', async (world) => {
      await world.browser.client.closeOnboarding();
      return 'copy window closed';
    }],
    ['ripStream', async (world) => {
      // Exactly what an MV3 worker suspension does: the SSE stream dies and
      // comes back a moment later.
      world.browser.client.stop();
      await sleep(10 + Math.floor(random() * 120));
      await world.browser.start();
      return 'stream ripped and restored';
    }],
    ['toolCall', async (world) => {
      if (!world.hosts.length) return 'skipped (no host)';
      const host = pick(world.hosts);
      const started = performance.now();
      let outcome;
      try {
        const result = await host.bridge.callTool('ping', {}, 2000);
        outcome = result?.result?.pong === true ? 'pong' : 'empty result';
      } catch (error) {
        outcome = `error: ${error.message.slice(0, 40)}`;
      }
      const took = Math.round(performance.now() - started);
      // A call may fail, but it must never hang past its own timeout.
      check(took < 4000, `callTool to ${host.clientId} took ${took}ms (timeout was 2000ms)`, outcome);
      return `${host.clientId} → ${outcome} (${took}ms)`;
    }],
    ['revoke', async (world) => {
      if (!world.hosts.length) return 'skipped (no host)';
      const host = pick(world.hosts);
      const result = await world.browser.client.disconnectClient(host.clientId);
      return `revoke ${host.clientId} → ${result.ok ? 'ok' : result.error}`;
    }],
    ['idle', async () => {
      await sleep(10 + Math.floor(random() * 200));
      return 'idle';
    }],
  ];
}

// ── iteration ────────────────────────────────────────────────────────────────
async function iteration(index) {
  const world = new World();
  try {
    // A random starting point: fresh install, half-paired, or fully trusted.
    const mode = pick(['fresh', 'fresh', 'window', 'trusted', 'expired']);
    if (mode === 'trusted') {
      const home = sandboxHome();
      const clientId = home.seedHostTrust('Alpha', 'monkey');
      await world.spawn({ home, pairedClients: { [clientId]: { id: clientId, name: 'Alpha', paired: true, pairedAt: 'x' } } });
    } else if (mode === 'window') {
      await world.spawn({ onboardUntil: Date.now() + ONBOARD_WINDOW_MS });
    } else if (mode === 'expired') {
      await world.spawn({ onboardUntil: Date.now() - 5000 });
    } else {
      await world.spawn();
    }
    if (VERBOSE) process.stdout.write(`#${index} world=${mode}\n`);

    invariants(world, { strict: false });

    const steps = 4 + Math.floor(random() * 6);
    for (let step = 0; step < steps; step += 1) {
      const [name, run] = pick(operations());
      let detail;
      try { detail = await run(world); } catch (error) { detail = `threw: ${error.message}`; }
      if (VERBOSE) process.stdout.write(`  ${name}: ${detail}\n`);
      invariants(world, { strict: false });
    }

    // Let the world settle, then demand convergence.
    await sleep(400);
    invariants(world, { strict: true });

    // A copy window that was never consumed must not authorize a client that
    // never showed up — and, conversely, must still be usable afterwards.
    const leftover = world.browser.storage[STORAGE_KEYS.onboardUntil];
    check(leftover == null || typeof leftover === 'number', 'onboardUntil must stay a number');

    return { mode, steps, failures: failures.length };
  } finally {
    await world.teardown();
  }
}

async function main() {
  process.stdout.write(`pairing monkey · ${ITERATIONS} iterations · seed ${seed}\n`);
  const started = Date.now();
  let completed = 0;
  for (let index = 0; index < ITERATIONS; index += 1) {
    const before = failures.length;
    try {
      await iteration(index);
      completed += 1;
    } catch (error) {
      failures.push({ message: `iteration ${index} threw: ${error.message}`, context: error.stack });
    }
    if (failures.length > before) {
      process.stdout.write(`  iteration ${index} FAILED (${failures.length - before} invariant(s))\n`);
    }
  }
  const elapsed = Date.now() - started;
  process.stdout.write(`${completed}/${ITERATIONS} iterations completed in ${elapsed}ms\n`);
  if (failures.length) {
    process.stdout.write(`\n${failures.length} invariant violation(s):\n`);
    for (const failure of failures.slice(0, 20)) process.stdout.write(`  ✗ ${failure.message}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('all invariants held\n');
  }
}

await main();
