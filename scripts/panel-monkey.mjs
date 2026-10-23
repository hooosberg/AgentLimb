#!/usr/bin/env node
/**
 * Panel monkey — random chaos on the side-panel chat state machine.
 *
 * The bug this exists for: a side-panel message is delivered on the agent's
 * NEXT tool call. If the agent is idle it never makes one, so the panel sat on
 * "等待回复" forever — composer disabled, control locked, Stop button showing a
 * request the agent never saw. Nothing timed out, so nothing recovered.
 *
 * This never asserts a specific sequence. It fires random operations at the
 * panel and the "agent" and then checks the invariants that must hold whatever
 * happened:
 *
 *   1. getStatus() never throws.
 *   2. The composer is only ever blocked by a message that is literally in
 *      flight — never by a missing reply or a running tool.
 *   3. Every wait has a deadline: once the clock passes it, nothing still
 *      claims a reply or a stop is owed.
 *   4. Nothing is silently lost: after the world settles, every accepted
 *      message has been delivered and every tool has an answer.
 *
 * Usage:
 *   node scripts/panel-monkey.mjs                   # 40 iterations
 *   node scripts/panel-monkey.mjs --iterations 300 --seed 7 --verbose
 */

import { WIRE, STORAGE_KEYS } from '../kernel/shared/constants.js';
import { createBridgeClient, PANEL_WAIT_LIMITS } from '../kernel/control/background/bridge-client.js';
import { panelState } from '../kernel/shared/panel-state.js';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const ITERATIONS = Number(arg('iterations', 40));
const VERBOSE = argv.includes('--verbose');
let seed = Number(arg('seed', Date.now() % 100000));

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
  failures.push({ message, context: context ? JSON.stringify(context).slice(0, 400) : '' });
  return false;
}

// ── fake world: two AI clients over two ports ────────────────────────────────
const PORTS = [18765, 18766];
const NAMES = ['driver', 'other'];
/** port -> the EventSource instance the extension currently holds. */
const liveSources = new Map();
const flush = async () => { for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

class World {
  constructor() {
    liveSources.clear();
    this.hellod = new Set();
    this.online = [true, true];
    this.clients = {};
    for (const id of NAMES) this.clients[id] = { name: id === 'driver' ? 'Test Driver' : 'Second Driver', paired: true, pairedAt: 'now' };
    this.rejectPosts = false;
    this.accepted = [];          // messages the host accepted from the panel
    this.delivered = new Set();  // `${at}::${text}` already attached to a result
    this.closed = new Set();     // messages whose turn ended before delivery
    this.pendingTools = new Map(); // tool_use_id -> client index, awaiting an answer
    this.answered = new Set();
    this.abandoned = new Set();  // tools whose client vanished mid-flight
    this.clockOffset = 0;
    this.realNow = Date.now;
    Date.now = () => this.realNow() + this.clockOffset;
  }

  install() {
    this.saved = { chrome: globalThis.chrome, fetch: globalThis.fetch, EventSource: globalThis.EventSource };
    globalThis.chrome = {
      runtime: { sendMessage: async () => {}, getURL: (p) => p },
      storage: { local: {
        get: async () => ({ [STORAGE_KEYS.pairedClients]: this.clients }),
        set: async () => {},
      } },
    };
    globalThis.EventSource = class {
      constructor(url) { this.port = Number(new URL(url).port); liveSources.set(this.port, this); }
      close() { this.closed = true; }
    };
    globalThis.fetch = async (url, options) => {
      const port = Number(new URL(url).port);
      const index = PORTS.indexOf(port);
      if (index < 0) throw new Error('no bridge');
      if (!options?.body) return { ok: true, json: async () => ({ service: 'agentlimb-bridge', client: { id: NAMES[index] } }) };
      const frame = JSON.parse(options.body);
      // A tool result is recorded even while the host is rejecting: the
      // extension attempted the delivery and the host answered with an error,
      // which is a real outcome the agent sees — not a lost tool.
      if (frame.t === WIRE.TOOL_RESULT) {
        if (!this.pendingTools.has(frame.tool_use_id) && !this.abandoned.has(frame.tool_use_id)) {
          failures.push({ message: `tool_result for a tool that was never dispatched: ${frame.tool_use_id}` });
        }
        if (this.answered.has(frame.tool_use_id)) {
          failures.push({ message: `duplicate tool_result for ${frame.tool_use_id}` });
        }
        this.answered.add(frame.tool_use_id);
        this.pendingTools.delete(frame.tool_use_id);
        for (const m of frame.userMessages || []) this.delivered.add(`${m.at}::${m.text}`);
      }
      // Never reject a GRANT: an unanswered grant makes the extension drop the
      // channel (correctly — the host never learned the answer), which would
      // look like a reconnect bug instead of the chat failure it is.
      if (this.rejectPosts && frame.t !== WIRE.GRANT) return { ok: false, json: async () => ({ ok: false, error: 'rejected' }) };
      if (frame.t === WIRE.USER_MESSAGE) this.accepted.push({ ...frame, for: this.bridge.getStatus().connectedClientId });
      return { ok: true, json: async () => ({ ok: true }) };
    };
  }

  restore() {
    // Never leave `chrome` undefined: the client keeps async continuations alive
    // (frame handlers, dropChannel) that may run after this iteration is over.
    globalThis.chrome = { runtime: { sendMessage: async () => {} }, storage: { local: { get: async () => ({}), set: async () => {} } } };
    Date.now = this.realNow;
  }

  async start() {
    this.install();
    this.bridge = createBridgeClient({ onToolCall: async () => ({ ok: true }), ports: PORTS });
    await this.bridge.start();
    for (const port of PORTS) {
      if (!liveSources.has(port)) throw new Error(`discovery never opened a stream on ${port}`);
    }
    await this.connect(0);
    await this.connect(1);
  }

  source(index) { return liveSources.get(PORTS[index]); }

  /**
   * Complete the handshake on whatever stream the extension currently holds.
   * The extension re-opens a stream on its own 400 ms after an error, so the
   * instance we used last may already be stale — always re-resolve it.
   */
  async handshake(index) {
    await this.bridge.ensure();
    const source = this.source(index);
    if (!source) throw new Error(`no stream on ${PORTS[index]}`);
    source.onopen?.();
    if (!this.hellod.has(source)) {
      this.hellod.add(source);
      source.onmessage({ data: JSON.stringify({ t: WIRE.HELLO, client: { id: NAMES[index], name: this.clients[NAMES[index]].name } }) });
      await flush();
    }
  }

  async connect(index) {
    this.online[index] = true;
    // Verify against what the extension actually sees: it re-opens streams on
    // its own schedule, so "we sent HELLO" is not proof the client is online.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await this.handshake(index);
      await flush();
      if (this.bridge.getStatus().clients.find((c) => c.id === NAMES[index])?.online) return;
    }
    throw new Error(`${NAMES[index]} never came back online`);
  }

  async drop(index) {
    // A tool already running on this channel can no longer report a result;
    // that is a failure the agent sees, not a silent hang the panel must hide.
    for (const [id, owner] of [...this.pendingTools]) {
      if (owner === index) { this.abandoned.add(id); this.pendingTools.delete(id); }
    }
    this.source(index).onerror?.(new Error('monkey drop'));
    this.online[index] = false;
    await flush();
  }

  /** Returns false when the client was offline and the frame was never sent. */
  async emit(index, frame) {
    if (!this.online[index]) return false;
    if (frame.t === WIRE.AGENT_MESSAGE && this.bridge.getStatus().connectedClientId === NAMES[index]) {
      // An agent reply ends the turn, and the outbox of the client that owned
      // the chat is cleared with it. A message that was still queued at that
      // moment is dropped by design — record it as closed, not lost.
      for (const message of this.accepted) {
        const key = `${message.at}::${message.text}`;
        if (!this.delivered.has(key)) this.closed.add(key);
      }
    }
    await this.handshake(index);
    this.source(index).onmessage({ data: JSON.stringify(frame) });
    await flush();
    return true;
  }

  /**
   * Bring the world to rest. Order matters: a message is only delivered while
   * its client is the active controller, and an agent's `say` clears that
   * client's outbox — so drain the client that already holds control first,
   * and only then take control away from it.
   */
  async settle() {
    this.rejectPosts = false;
    const activeIndex = NAMES.indexOf(this.bridge.getStatus().connectedClientId);
    const order = activeIndex >= 0 ? [activeIndex, ...[0, 1].filter((i) => i !== activeIndex)] : [0, 1];
    for (const index of order) {
      await this.connect(index);
      if (this.bridge.getStatus().connectedClientId !== NAMES[index]) {
        const current = NAMES.indexOf(this.bridge.getStatus().connectedClientId);
        if (current >= 0 && this.online[current]) {
          await this.emit(current, { t: WIRE.AGENT_MESSAGE, text: 'settled' });
        }
        await flush();
        const sel = this.bridge.selectClient(NAMES[index]);
        await flush();
        // Control may still be held by an unfinished task; a second `say`
        // releases it without inventing work.
        if (this.bridge.getStatus().connectedClientId !== NAMES[index]) {
          const still = NAMES.indexOf(this.bridge.getStatus().connectedClientId);
          if (still >= 0 && this.online[still]) await this.emit(still, { t: WIRE.AGENT_MESSAGE, text: 'settled' });
          await flush();
          this.bridge.selectClient(NAMES[index]);
          await flush();
        }
      }
      const id = `settle-${Math.floor(random() * 1e6)}`;
      this.pendingTools.set(id, index);
      const sent = await this.emit(index, { t: WIRE.TOOL_CALL, tool_use_id: id, tool: 'ping', args: {}, client_id: NAMES[index] });
      if (!sent) { this.pendingTools.delete(id); continue; }
      for (let i = 0; i < 200 && this.pendingTools.has(id); i += 1) await flush();
    }
  }
}

// ── invariants ───────────────────────────────────────────────────────────────
function invariants(world, { settled, tools = false }) {
  let status;
  try { status = world.bridge.getStatus(); } catch (error) {
    return check(false, `getStatus() threw: ${error.message}`);
  }
  const state = panelState(status);

  // The composer is an outbox: the only block is a message on the wire.
  if (state.connected) {
    check(state.locked === !!status.sending,
      `composer locked=${state.locked} while sending=${status.sending}`, status);
  }

  if (settled) {
    // Nothing may be owed past its deadline — but a fresh wait is still a wait.
    const now = Date.now();
    check(status.pendingReplyAt == null || now - status.pendingReplyAt <= PANEL_WAIT_LIMITS.replyMs,
      `a reply has been owed for ${status.pendingReplyAt ? now - status.pendingReplyAt : 0}ms`, status);
    check(!status.stopRequested || now - (status.stopRequestedAt || now) <= PANEL_WAIT_LIMITS.stopMs,
      'a stop has been unacknowledged for too long', status);
  }
  if (tools) {
    // Only meaningful once the world has been brought to rest: mid-chaos a tool
    // is legitimately in flight.
    check(world.pendingTools.size === 0, `${world.pendingTools.size} tool(s) still unanswered`);
    check(status.operating === false && status.busy === false, 'operating/busy must be false after settle + clock warp', status);
  }
  return status;
}

// ── operations ───────────────────────────────────────────────────────────────
function operations(world) {
  return [
    ['send', async () => {
      const result = await world.bridge.sendUserMessage(`msg-${Math.floor(random() * 1e6)}`, { title: 'Monkey page' });
      return `send → ${result.ok ? 'accepted' : result.error}`;
    }],
    ['stop', async () => {
      const result = await world.bridge.requestStop();
      return `stop → ${result.ok ? (result.alreadyRequested ? 'already' : 'sent') : result.error}`;
    }],
    ['say', async () => {
      const index = pick([0, 1]);
      await world.emit(index, { t: WIRE.AGENT_MESSAGE, text: 'monkey reply' });
      return `say from ${NAMES[index]}`;
    }],
    ['tool', async () => {
      const index = pick([0, 1]);
      const id = `tool-${Math.floor(random() * 1e6)}`;
      world.pendingTools.set(id, index);
      const sent = await world.emit(index, { t: WIRE.TOOL_CALL, tool_use_id: id, tool: 'read_page', args: {}, client_id: NAMES[index] });
      if (!sent) { world.abandoned.add(id); world.pendingTools.delete(id); return `tool to offline ${NAMES[index]} (dropped)`; }
      return `tool_call from ${NAMES[index]}`;
    }],
    ['drop', async () => {
      const index = pick([0, 1]);
      await world.drop(index);
      return `dropped ${NAMES[index]}`;
    }],
    ['reconnect', async () => {
      const index = pick([0, 1]);
      await world.connect(index);
      return `reconnected ${NAMES[index]}`;
    }],
    ['switch', async () => {
      const target = pick(NAMES);
      const result = world.bridge.selectClient(target);
      return `switch → ${target} ${result.ok ? 'ok' : result.error}`;
    }],
    ['warp', () => {
      // Jump past every deadline. This is the step that used to be impossible:
      // nothing in the old code ever timed out.
      world.clockOffset += 70_000;
      return 'warped the clock past every deadline';
    }],
    ['reject', () => {
      world.rejectPosts = !world.rejectPosts;
      return `host now ${world.rejectPosts ? 'rejects' : 'accepts'} posts`;
    }],
  ];
}

// ── iteration ────────────────────────────────────────────────────────────────
async function iteration(index) {
  const world = new World();
  try {
    await world.start();
    invariants(world, { settled: false });
    const steps = 6 + Math.floor(random() * 10);
    for (let step = 0; step < steps; step += 1) {
      const [name, run] = pick(operations(world));
      let detail;
      try { detail = await run(world); } catch (error) { detail = `threw: ${error.message}`; }
      if (VERBOSE) process.stdout.write(`  ${name}: ${detail}\n`);
      invariants(world, { settled: false });
      if (world.clockOffset > 0 && chance(0.25)) invariants(world, { settled: true });
    }

    // End state must converge: nothing owed, nothing unanswered, nothing lost.
    world.clockOffset += 70_000;
    await world.settle();
    const status = invariants(world, { settled: true, tools: true });
    for (const message of world.accepted) {
      const key = `${message.at}::${message.text}`;
      check(world.delivered.has(key) || world.closed.has(key),
        `message "${String(message.text).slice(0, 24)}" was accepted but never delivered`);
    }
    if (VERBOSE) process.stdout.write(`  final: ${status.status} pending=${status.pendingReplyAt} stop=${status.stopRequested}\n`);
    if (world.pendingTools.size) {
      process.stdout.write(`  state: pending=${[...world.pendingTools.keys()].join(',')} online=${world.online} active=${status.connectedClientId}`
        + ` waiting=${JSON.stringify(status.clients.map((c) => [c.id, c.online, c.waiting]))} operating=${status.operating} busy=${status.busy}\n`);
    }
  } catch (error) {
    failures.push({ message: `iteration ${index} threw: ${error.message}`, context: error.stack?.slice(0, 300) });
  } finally {
    world.bridge?.stop();
    world.restore();
  }
}

async function main() {
  process.stdout.write(`panel monkey · ${ITERATIONS} iterations · seed ${seed}\n`);
  const started = Date.now();
  let completed = 0;
  for (let index = 0; index < ITERATIONS; index += 1) {
    const before = failures.length;
    try { await iteration(index); completed += 1; } catch (error) {
      failures.push({ message: `iteration ${index} crashed: ${error.message}` });
    }
    if (failures.length > before) process.stdout.write(`  iteration ${index} FAILED (${failures.length - before})\n`);
  }
  process.stdout.write(`${completed}/${ITERATIONS} iterations in ${Date.now() - started}ms\n`);
  if (failures.length) {
    process.stdout.write(`\n${failures.length} invariant violation(s):\n`);
    for (const failure of failures.slice(0, 25)) process.stdout.write(`  ✗ ${failure.message} ${failure.context}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('all invariants held\n');
  }
}

await main();
