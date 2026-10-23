#!/usr/bin/env node
/**
 * Pairing speed bench — "how long does the user wait?"
 *
 * Every scenario boots the real bridge (host/bridge-server.mjs) and the real
 * extension transport (kernel/control/background/bridge-client.js), then reports
 * the milliseconds the user actually feels:
 *
 *   discover  = bridge is listening  →  the browser authorized it
 *   handshake = SSE stream opened    →  GRANT accepted by the host
 *   tool      = callTool() issued    →  the browser executed it
 *
 * Usage:
 *   node scripts/pairing-bench.mjs              # default table, 3 runs
 *   node scripts/pairing-bench.mjs --runs 10
 *   node scripts/pairing-bench.mjs --json
 *   node scripts/pairing-bench.mjs --only cold-pair,second-ai
 */

import { ONBOARD_WINDOW_MS, STORAGE_KEYS, WIRE } from '../kernel/shared/constants.js';
import { TEST_BRIDGE_PORTS } from '../kernel/shared/constants.js';
import {
  createHost, createBrowser, sandboxHome, occupyPort, waitUntil, sleep,
} from './lib/pairing-harness.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const RUNS = Number(arg('runs', 3));
const JSON_OUT = argv.includes('--json');
const ONLY = arg('only', '') ? arg('only', '').split(',').map((s) => s.trim()).filter(Boolean) : null;
// --cadence 2000 reproduces the old fixed 2 s scan loop, so the table can show
// the before/after instead of asking anyone to trust a claim.
const CADENCE = arg('cadence', '') ? Number(arg('cadence', '')) : null;
const newBrowser = (opts = {}) => createBrowser({ discoveryIntervalMs: CADENCE ?? undefined, ...opts });

const WINDOW = () => Date.now() + ONBOARD_WINDOW_MS;
const ms = (value) => (value == null ? null : Math.round(value * 10) / 10);

/** A scenario returns { ok, ms:{discover,handshake,tool}, notes:[], error? }. */
const SCENARIOS = [];
const scenario = (name, run) => SCENARIOS.push({ name, run });

// ── 1. the money path: nothing paired, panel open, AI starts fresh ────────────
scenario('cold-pair', async () => {
  const home = sandboxHome();
  // The user already clicked Copy, so the 30-minute window is open.
  const browser = await newBrowser({ onboardUntil: WINDOW() });
  try {
    // The panel is open and hunting before the AI software even starts.
    await browser.start();
    await sleep(50);
    const host = await createHost({ clientName: 'Cold Agent' });
    try {
      await waitUntil(() => host.timeline.grantAt != null, { timeout: 6000, label: 'grant' });
      const toolStart = performance.now();
      const result = await host.bridge.callTool('ping', {}, 5000);
      return {
        ok: result?.result?.pong === true,
        ms: {
          discover: ms(host.timeline.grantAt - host.timeline.listeningAt),
          handshake: ms(host.timeline.grantAt - host.timeline.sseAt),
          tool: ms(performance.now() - toolStart),
        },
        notes: [`port ${host.port}`],
      };
    } finally { host.bridge.stop(); }
  } finally { browser.restore(); home.restore(); }
});

// ── 2. the worker was asleep: the bridge is already up when the panel wakes ───
scenario('wake-then-pair', async () => {
  const home = sandboxHome();
  const host = await createHost({ clientName: 'Wake Agent' });
  // Nothing is watching yet: this is the MV3 worker suspended, stream torn down.
  await sleep(150);
  const browser = await newBrowser({ onboardUntil: WINDOW() });
  try {
    await browser.start();
    await waitUntil(() => host.timeline.grantAt != null, { timeout: 6000, label: 'grant' });
    return {
      ok: true,
      ms: {
        discover: ms(host.timeline.grantAt - host.timeline.listeningAt),
        handshake: ms(host.timeline.grantAt - host.timeline.sseAt),
        tool: null,
      },
      notes: ['bridge already up before the panel woke'],
    };
  } finally { browser.restore(); host.bridge.stop(); home.restore(); }
});

// ── 3. a trusted AI comes back: no copy click, no window ─────────────────────
scenario('warm-reconnect', async () => {
  const home = sandboxHome();
  const clientId = home.seedHostTrust('Warm Agent', 'bench');
  const browser = await newBrowser({
    pairedClients: { [clientId]: { id: clientId, name: 'Warm Agent', paired: true, pairedAt: 'x' } },
  });
  try {
    await browser.start();
    await sleep(50);
    const host = await createHost({ clientName: 'Warm Agent', clientId });
    try {
      await waitUntil(() => host.timeline.grantAt != null, { timeout: 6000, label: 'grant' });
      const toolStart = performance.now();
      await host.bridge.callTool('ping', {}, 5000);
      return {
        ok: true,
        ms: {
          discover: ms(host.timeline.grantAt - host.timeline.listeningAt),
          handshake: ms(host.timeline.grantAt - host.timeline.sseAt),
          tool: ms(performance.now() - toolStart),
        },
        notes: ['remembered trust, no window needed'],
      };
    } finally { host.bridge.stop(); }
  } finally { browser.restore(); home.restore(); }
});

// ── 4. no window: refuse fast, then one Copy click fixes it ──────────────────
scenario('no-window-then-copy', async () => {
  const home = sandboxHome();
  const browser = await newBrowser();
  try {
    await browser.start();
    await sleep(50);
    const host = await createHost({ clientName: 'Unknown Agent' });
    try {
      await waitUntil(() => host.timeline.deniedAt != null, { timeout: 6000, label: 'denial' });
      const deniedIn = ms(host.timeline.deniedAt - host.timeline.listeningAt);
      const status = browser.client.getStatus();
      const unauthorized = status.unauthorized.length === 1;
      // The agent gets an actionable error instead of a silent hang.
      const callStart = performance.now();
      let actionable = false;
      try { await host.bridge.callTool('ping', {}, 4000); } catch (error) { actionable = /copy-prompt button/i.test(error.message); }
      const errorIn = ms(performance.now() - callStart);
      // The user now clicks Copy — the waiting AI must be trusted in place.
      const copyStart = performance.now();
      await browser.client.openOnboarding();
      await waitUntil(() => host.bridge.getActiveBrowser(), { timeout: 3000, label: 'grant after copy' });
      const copyIn = ms(performance.now() - copyStart);
      return {
        ok: unauthorized && actionable,
        ms: { discover: deniedIn, handshake: null, tool: errorIn, copy: copyIn },
        notes: ['denied fast, then Copy authorized the waiting AI'],
      };
    } finally { host.bridge.stop(); }
  } finally { browser.restore(); home.restore(); }
});

// ── 5. the window expired while the user was reading the prompt ──────────────
scenario('window-expired', async () => {
  const home = sandboxHome();
  const browser = await newBrowser({ onboardUntil: Date.now() - 1000 });
  try {
    await browser.start();
    await sleep(50);
    const host = await createHost({ clientName: 'Late Agent' });
    try {
      await waitUntil(() => host.timeline.deniedAt != null, { timeout: 6000, label: 'denial' });
      return {
        ok: host.bridge.getDeniedReason() === 'not_authorized',
        ms: { discover: ms(host.timeline.deniedAt - host.timeline.listeningAt), handshake: null, tool: null },
        notes: ['expired window must never leave a stale code behind'],
      };
    } finally { host.bridge.stop(); }
  } finally { browser.restore(); home.restore(); }
});

// ── 6. a second AI appears while the first one is already connected ──────────
scenario('second-ai', async () => {
  const home = sandboxHome();
  const first = await createHost({ clientName: 'First Agent', clientId: 'first-agent' });
  const browser = await newBrowser({ onboardUntil: WINDOW() });
  try {
    await browser.start();
    await waitUntil(() => first.timeline.grantAt != null, { timeout: 6000, label: 'first grant' });
    // The user copies again for a second AI — one Copy authorizes one client.
    await browser.client.openOnboarding();
    const second = await createHost({ clientName: 'Second Agent', clientId: 'second-agent' });
    try {
      // The host logs the grant on receipt; the extension then finishes
      // activating the channel. Wait for the browser side, not just the POST.
      await waitUntil(() => second.timeline.grantAt != null
        && browser.client.getStatus().connectedClientId === 'second-agent',
      { timeout: 6000, label: 'second grant' });
      const tookOver = browser.client.getStatus().connectedClientId === 'second-agent';
      return {
        ok: tookOver,
        ms: {
          discover: ms(second.timeline.grantAt - second.timeline.listeningAt),
          handshake: ms(second.timeline.grantAt - second.timeline.sseAt),
          tool: null,
        },
        notes: ['second AI takes the chat window while the first is idle'],
      };
    } finally { second.bridge.stop(); }
  } finally { browser.restore(); first.bridge.stop(); home.restore(); }
});

// ── 7. ports 8765-8767 taken: the host must still be found quickly ───────────
scenario('port-contention', async () => {
  const home = sandboxHome();
  const squatters = [];
  for (const port of TEST_BRIDGE_PORTS.slice(0, 3)) squatters.push(await occupyPort(port));
  const browser = await newBrowser({ onboardUntil: WINDOW() });
  try {
    await browser.start();
    await sleep(50);
    const host = await createHost({ clientName: 'Squeezed Agent' });
    try {
      await waitUntil(() => host.timeline.grantAt != null, { timeout: 6000, label: 'grant' });
      return {
        ok: host.port === TEST_BRIDGE_PORTS[3],
        ms: {
          discover: ms(host.timeline.grantAt - host.timeline.listeningAt),
          handshake: ms(host.timeline.grantAt - host.timeline.sseAt),
          tool: null,
        },
        notes: [`landed on ${host.port} (expected ${TEST_BRIDGE_PORTS[3]})`],
      };
    } finally { host.bridge.stop(); }
  } finally {
    browser.restore(); home.restore();
    for (const squatter of squatters) await squatter.close();
  }
});

// ── 8. something else answers 200 on 8765 — must be ignored, not trusted ─────
scenario('impostor-port', async () => {
  const home = sandboxHome();
  const impostor = await occupyPort(TEST_BRIDGE_PORTS[0]);
  const browser = await newBrowser({ onboardUntil: WINDOW() });
  try {
    await browser.start();
    await sleep(50);
    const host = await createHost({ clientName: 'Real Agent' });
    try {
      await waitUntil(() => host.timeline.grantAt != null, { timeout: 6000, label: 'grant' });
      return {
        ok: host.port === TEST_BRIDGE_PORTS[1],
        ms: {
          discover: ms(host.timeline.grantAt - host.timeline.listeningAt),
          handshake: ms(host.timeline.grantAt - host.timeline.sseAt),
          tool: null,
        },
        notes: [`non-agentlimb server on ${TEST_BRIDGE_PORTS[0]} skipped, found ${host.port}`],
      };
    } finally { host.bridge.stop(); }
  } finally {
    browser.restore(); home.restore();
    await impostor.close();
  }
});

// ── 9. stream dropped mid-session: does control come back on its own? ────────
scenario('stream-drop-recovery', async () => {
  const home = sandboxHome();
  const browser = await newBrowser({ onboardUntil: WINDOW() });
  try {
    await browser.start();
    await sleep(50);
    const host = await createHost({ clientName: 'Flaky Agent' });
    try {
      await waitUntil(() => host.timeline.grantAt != null, { timeout: 6000, label: 'grant' });
      // Rip the SSE stream away exactly like a suspended worker would.
      browser.client.stop();
      await waitUntil(() => !host.bridge.getActiveBrowser(), { timeout: 3000, label: 'host noticed the drop' });
      const recoverStart = performance.now();
      await browser.start();
      await waitUntil(() => host.bridge.getActiveBrowser(), { timeout: 6000, label: 'recovered' });
      return {
        ok: true,
        ms: {
          discover: ms(performance.now() - recoverStart),
          handshake: ms(host.timeline.grantAt - host.timeline.sseAt),
          tool: null,
        },
        notes: ['reconnect used remembered trust, no window'],
      };
    } finally { host.bridge.stop(); }
  } finally { browser.restore(); home.restore(); }
});

// ── runner ───────────────────────────────────────────────────────────────────
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function main() {
  const selected = ONLY ? SCENARIOS.filter((s) => ONLY.includes(s.name)) : SCENARIOS;
  const results = [];
  for (const { name, run } of selected) {
    const samples = [];
    let lastError = null;
    let notes = [];
    for (let index = 0; index < RUNS; index += 1) {
      try {
        const result = await run();
        samples.push(result);
        notes = result.notes || [];
      } catch (error) {
        lastError = error;
      }
      await sleep(60); // let the OS release the port
    }
    const pick = (key) => samples.map((s) => s.ms?.[key]).filter((v) => v != null);
    results.push({
      name,
      runs: samples.length,
      // A run that threw is a failure even if the others were fine — silently
      // dropping it would hide exactly the flakiness this bench exists to find.
      ok: samples.length > 0 && !lastError && samples.every((s) => s.ok),
      discover: { p50: percentile(pick('discover'), 50), p95: percentile(pick('discover'), 95) },
      handshake: { p50: percentile(pick('handshake'), 50), p95: percentile(pick('handshake'), 95) },
      tool: { p50: percentile(pick('tool'), 50), p95: percentile(pick('tool'), 95) },
      copy: { p50: percentile(pick('copy'), 50), p95: percentile(pick('copy'), 95) },
      notes,
      error: lastError ? lastError.message : null,
    });
  }

  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    const rows = results.map((r) => [
      r.ok ? 'ok' : 'FAIL',
      r.name,
      r.discover.p50 ?? '-',
      r.discover.p95 ?? '-',
      r.handshake.p50 ?? '-',
      r.tool.p50 ?? '-',
      r.copy.p50 ?? '-',
      r.error || (r.notes[0] || ''),
    ]);
    const header = ['', 'scenario', 'discover p50', 'p95', 'handshake', 'tool', 'copy', 'note'];
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
    const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');
    process.stdout.write(`${line(header)}\n${widths.map((w) => '─'.repeat(w)).join('  ')}\n`);
    for (const row of rows) process.stdout.write(`${line(row)}\n`);
    process.stdout.write(`\n${RUNS} run(s) per scenario · all values in ms · lower is better\n`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    process.stderr.write(`\n${failed.length} scenario(s) failed: ${failed.map((r) => r.name).join(', ')}\n`);
    process.exitCode = 1;
  }
}

await main();
