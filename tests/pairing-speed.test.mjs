/**
 * Pairing speed budgets.
 *
 * These are the only assertions in the suite that care about *time*, so they
 * are written as ceilings, not targets: they fail only if pairing regresses to
 * the old "wait for the 2 s scan" behaviour. Every number here was measured by
 * scripts/pairing-bench.mjs, which prints the real distribution.
 *
 *   hunt (nothing connected)  300 ms cadence → ~270 ms observed
 *   idle (one AI connected)  1000 ms cadence → ~300 ms observed
 *   handshake                 tens of ms, independent of the cadence
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DISCOVERY, ONBOARD_WINDOW_MS, STORAGE_KEYS } from '../kernel/shared/constants.js';
import { createHost, createBrowser, sandboxHome, waitUntil, sleep } from '../scripts/lib/pairing-harness.mjs';

const WINDOW = () => Date.now() + ONBOARD_WINDOW_MS;

test('the first pairing completes in well under a second', { timeout: 20000 }, async () => {
  const home = sandboxHome();
  const browser = await createBrowser({ onboardUntil: WINDOW() });
  try {
    await browser.start();
    await sleep(40);
    const host = await createHost({ clientName: 'Speed One' });
    try {
      const elapsed = await waitUntil(() => host.timeline.grantAt != null, { timeout: 3000, label: 'grant' });
      // A 2 s scan loop lands at ~2000 ms here; the budget makes that a failure.
      assert.ok(elapsed < 1000, `first pairing took ${elapsed}ms (budget 1000ms, cadence ${DISCOVERY.HUNT_MS}ms)`);
      const handshake = host.timeline.grantAt - host.timeline.sseAt;
      assert.ok(handshake < 400, `handshake took ${Math.round(handshake)}ms (budget 400ms)`);
      // And the pair is usable immediately — no second round trip.
      const result = await host.bridge.callTool('ping', {}, 3000);
      assert.equal(result.result.pong, true);
    } finally { host.bridge.stop(); }
  } finally { browser.restore(); home.restore(); }
});

test('a second AI is noticed while the first is already connected', { timeout: 20000 }, async () => {
  const home = sandboxHome();
  const browser = await createBrowser({ onboardUntil: WINDOW() });
  let first; let second;
  try {
    await browser.start();
    first = await createHost({ clientName: 'Idle One', clientId: 'idle-one' });
    await waitUntil(() => first.timeline.grantAt != null, { timeout: 3000, label: 'first grant' });
    await browser.client.openOnboarding();
    second = await createHost({ clientName: 'Idle Two', clientId: 'idle-two' });
    const elapsed = await waitUntil(() => second.timeline.grantAt != null, { timeout: 4000, label: 'second grant' });
    // Cadence relaxes to IDLE_MS once something is connected; it must not go back
    // to seconds, or multi-software users wait every time they start a new tool.
    assert.ok(elapsed < DISCOVERY.IDLE_MS + 800, `second AI took ${elapsed}ms (cadence ${DISCOVERY.IDLE_MS}ms)`);
  } finally {
    second?.bridge.stop(); first?.bridge.stop();
    browser.restore(); home.restore();
  }
});

test('one Copy click authorizes exactly one new AI', { timeout: 20000 }, async () => {
  const home = sandboxHome();
  const browser = await createBrowser();
  let one; let two;
  try {
    await browser.start();
    await browser.client.openOnboarding();
    one = await createHost({ clientName: 'Racer One', clientId: 'racer-one' });
    two = await createHost({ clientName: 'Racer Two', clientId: 'racer-two' });
    await waitUntil(() => one.bridge.getActiveBrowser() || two.bridge.getActiveBrowser(), { timeout: 4000, label: 'one grant' });
    await sleep(600); // give the loser time to be denied too
    const granted = [one, two].filter((host) => host.bridge.getActiveBrowser());
    const denied = [one, two].filter((host) => host.bridge.getDeniedReason());
    assert.equal(granted.length, 1, 'a single Copy must not authorize two AI clients');
    assert.equal(denied.length, 1, 'the second AI must be told to ask for a Copy click');
    assert.equal(denied[0].bridge.getDeniedReason(), 'not_authorized');
    // The panel must show the loser so the user knows what to click for.
    const status = browser.client.getStatus();
    assert.equal(status.unauthorized.length, 1);
    assert.equal(status.unauthorized[0].id, denied[0].clientId);
  } finally {
    two?.bridge.stop(); one?.bridge.stop();
    browser.restore(); home.restore();
  }
});

test('a GRANT that never reaches the host is retried, not shown as connected', { timeout: 20000 }, async () => {
  const home = sandboxHome();
  const browser = await createBrowser({ onboardUntil: WINDOW() });
  const realFetch = globalThis.fetch;
  let swallowGrants = 1;
  try {
    globalThis.fetch = (url, options) => {
      if (swallowGrants > 0 && options?.body) {
        let frame = null;
        try { frame = JSON.parse(options.body); } catch (_) { /* not our frame */ }
        if (frame?.t === 'grant' && frame.ok) {
          swallowGrants -= 1;
          return Promise.reject(new Error('simulated network drop'));
        }
      }
      return realFetch(url, options);
    };
    await browser.start();
    await sleep(40);
    const host = await createHost({ clientName: 'Ghost Agent' });
    try {
      // First attempt is lost; the channel must be dropped and the handshake
      // retried on the next scan rather than leaving a phantom "connected".
      await waitUntil(() => host.bridge.getActiveBrowser(), { timeout: 5000, label: 'retried grant' });
      assert.equal(swallowGrants, 0, 'the first grant must actually have been swallowed');
      const status = browser.client.getStatus();
      assert.equal(status.status, 'connected');
      const result = await host.bridge.callTool('ping', {}, 3000);
      assert.equal(result.result.pong, true);
      // Trust survives the retry: the window was consumed, the pairing was not.
      assert.ok(browser.storage[STORAGE_KEYS.pairedClients]);
    } finally { host.bridge.stop(); }
  } finally {
    globalThis.fetch = realFetch;
    browser.restore(); home.restore();
  }
});

test('an expired window never leaves a stale authorization behind', { timeout: 20000 }, async () => {
  const home = sandboxHome();
  const browser = await createBrowser({ onboardUntil: Date.now() - 1 });
  try {
    await browser.start();
    await sleep(40);
    const host = await createHost({ clientName: 'Late Agent' });
    try {
      await waitUntil(() => host.bridge.getDeniedReason(), { timeout: 3000, label: 'denial' });
      assert.equal(host.bridge.getDeniedReason(), 'not_authorized');
      assert.equal(host.bridge.getActiveBrowser(), false);
      // A fresh Copy fixes it in place — no restart, no config edit.
      await browser.client.openOnboarding();
      await waitUntil(() => host.bridge.getActiveBrowser(), { timeout: 3000, label: 'grant after copy' });
    } finally { host.bridge.stop(); }
  } finally { browser.restore(); home.restore(); }
});
