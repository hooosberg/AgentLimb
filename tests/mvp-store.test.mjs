import test from 'node:test';
import assert from 'node:assert/strict';

import { createMvpStore } from '../kernel/bridge/mvp/store.js';

test('MVP store creates queued prompt tasks and lets a terminal claim them', () => {
  const store = createMvpStore();

  const terminal = store.registerTerminal({
    name: 'Codex',
    type: 'codex',
  });

  const task = store.submitPrompt({
    prompt: '帮我打开百家号后台并检查草稿箱',
    source: 'sidepanel',
  });

  assert.equal(task.status, 'queued');
  assert.equal(store.getTask(task.id).prompt, '帮我打开百家号后台并检查草稿箱');

  const next = store.claimNextTask({ token: terminal.token });
  assert.equal(next.id, task.id);
  assert.equal(next.status, 'claimed');
  assert.equal(next.claimedBy.name, 'Codex');
});

test('MVP store accepts terminal results and updates task status', () => {
  const store = createMvpStore();
  const terminal = store.registerTerminal({
    name: 'Codex',
    type: 'codex',
  });
  const task = store.submitPrompt({
    prompt: '测试输入框点击和截图',
    source: 'sidepanel',
  });

  store.claimNextTask({ token: terminal.token });

  const updated = store.submitResult({
    token: terminal.token,
    taskId: task.id,
    ok: true,
    output: '已点击输入框并返回截图',
  });

  assert.equal(updated.status, 'completed');
  assert.equal(updated.result.ok, true);
  assert.equal(updated.result.output, '已点击输入框并返回截图');
});

test('MVP store rejects results from the wrong terminal', () => {
  const store = createMvpStore();
  const codex = store.registerTerminal({
    name: 'Codex',
    type: 'codex',
  });
  const cursor = store.registerTerminal({
    name: 'Cursor',
    type: 'cursor',
  });
  const task = store.submitPrompt({
    prompt: '错误归属测试',
    source: 'sidepanel',
  });

  store.claimNextTask({ token: codex.token });

  assert.throws(() => {
    store.submitResult({
      token: cursor.token,
      taskId: task.id,
      ok: false,
      error: 'not yours',
    });
  }, /claimed by another terminal/i);
});

test('MVP store queues browser tool calls for the extension and stores results', () => {
  const store = createMvpStore();

  const call = store.submitBrowserToolCall({
    tool: 'tabs_context',
    params: {},
    source: 'codex',
  });

  assert.equal(call.status, 'queued');

  const claimed = store.claimNextBrowserToolCall();
  assert.equal(claimed.id, call.id);
  assert.equal(claimed.tool, 'tabs_context');
  assert.equal(claimed.status, 'claimed');

  const completed = store.submitBrowserToolResult({
    callId: call.id,
    ok: true,
    result: {
      page: {
        url: 'https://example.com',
      },
    },
  });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.page.url, 'https://example.com');
});

test('MVP store tracks multiple extensions and routes targeted calls', () => {
  const store = createMvpStore();

  store.recordExtensionPoll({ extensionId: 'ext_a', label: 'Profile-A' });
  store.recordExtensionPoll({ extensionId: 'ext_b', label: 'Profile-B' });

  const listed = store.listExtensions();
  assert.equal(listed.length, 2);
  assert.ok(listed.find((e) => e.id === 'ext_a' && e.label === 'Profile-A'));
  assert.ok(listed.find((e) => e.id === 'ext_b' && e.label === 'Profile-B'));

  const targeted = store.submitBrowserToolCall({ tool: 'tabs_context', target: 'ext_b' });
  const broadcast = store.submitBrowserToolCall({ tool: 'tabs_context' });

  // ext_a must skip the targeted call (reserved for ext_b) and get the broadcast one.
  const claimedByA = store.claimNextBrowserToolCall({ extensionId: 'ext_a' });
  assert.equal(claimedByA.id, broadcast.id);

  // ext_b gets its targeted call next.
  const claimedByB = store.claimNextBrowserToolCall({ extensionId: 'ext_b' });
  assert.equal(claimedByB.id, targeted.id);
  assert.equal(claimedByB.claimedBy, 'ext_b');
});

test('MVP store hard-suspends extension: broadcast skipped, targeted rejected at submit', () => {
  const store = createMvpStore();

  store.recordExtensionPoll({ extensionId: 'ext_a', label: 'Profile-A' });
  store.recordExtensionPoll({ extensionId: 'ext_b', label: 'Profile-B' });

  store.setExtensionSuspended('ext_a', true);

  // Broadcast call should skip ext_a entirely and only be claimable by ext_b.
  store.submitBrowserToolCall({ tool: 'tabs_context' });
  const claimedByA = store.claimNextBrowserToolCall({ extensionId: 'ext_a' });
  assert.equal(claimedByA, null);
  const claimedByB = store.claimNextBrowserToolCall({ extensionId: 'ext_b' });
  assert.ok(claimedByB);

  // Targeted call to ext_a must be rejected at submit time with TARGET_SUSPENDED.
  assert.throws(
    () => store.submitBrowserToolCall({ tool: 'tabs_context', target: 'ext_a' }),
    (err) => err.code === 'TARGET_SUSPENDED' && err.target === 'ext_a',
  );
});

test('MVP store resolves target by label (case-insensitive) and normalizes to extensionId', () => {
  const store = createMvpStore();

  store.recordExtensionPoll({ extensionId: 'ext_a', label: 'Profile-b83324' });
  store.recordExtensionPoll({ extensionId: 'ext_b', label: 'ops@example.com' });

  // Label lookup (exact)
  const callByLabel = store.submitBrowserToolCall({
    tool: 'tabs_context',
    target: 'Profile-b83324',
  });
  assert.equal(callByLabel.target, 'ext_a');
  assert.equal(callByLabel.targetLabel, 'Profile-b83324');

  // Label lookup (case-insensitive email)
  const callByEmail = store.submitBrowserToolCall({
    tool: 'tabs_context',
    target: 'OPS@example.com',
  });
  assert.equal(callByEmail.target, 'ext_b');

  // Unknown target → TARGET_NOT_FOUND
  assert.throws(
    () => store.submitBrowserToolCall({ tool: 'tabs_context', target: 'Profile-nobody' }),
    (err) => err.code === 'TARGET_NOT_FOUND',
  );
});

test('MVP store fans out broadcast tools to every active extension (task_plan)', () => {
  const store = createMvpStore();
  store.recordExtensionPoll({ extensionId: 'ext_a', label: 'A' });
  store.recordExtensionPoll({ extensionId: 'ext_b', label: 'B' });

  const parent = store.submitBrowserToolCall({
    tool: 'task_plan',
    params: { title: 'bootstrap', steps: ['s1'] },
  });

  assert.equal(parent.broadcast, true);
  assert.equal(Array.isArray(parent.fanout), true);
  assert.equal(parent.fanout.length, 2);
  assert.equal(parent.status, 'queued');

  // Each child is targeted at a distinct extension — no one abandoned.
  const claimedByA = store.claimNextBrowserToolCall({ extensionId: 'ext_a' });
  const claimedByB = store.claimNextBrowserToolCall({ extensionId: 'ext_b' });
  assert.ok(claimedByA && claimedByB);
  assert.notEqual(claimedByA.id, claimedByB.id);
  assert.equal(claimedByA.parent, parent.id);
  assert.equal(claimedByB.parent, parent.id);

  // Parent stays un-claimable (it is an aggregator, not a real call).
  const extraClaim = store.claimNextBrowserToolCall({ extensionId: 'ext_a' });
  assert.equal(extraClaim, null);

  // First child completion unblocks the parent — AI's wait loop sees 'completed'.
  store.submitBrowserToolResult({
    callId: claimedByA.id,
    ok: true,
    result: { plan: { title: 'bootstrap' } },
  });
  const parentAfterFirst = store.getBrowserToolCall(parent.id);
  assert.equal(parentAfterFirst.status, 'completed');
  assert.equal(parentAfterFirst.result.plan.title, 'bootstrap');
});

test('MVP store skips fan-out when only one active extension exists', () => {
  const store = createMvpStore();
  store.recordExtensionPoll({ extensionId: 'ext_solo', label: 'Solo' });

  const call = store.submitBrowserToolCall({
    tool: 'task_complete',
    params: { summary: 'done' },
  });

  assert.notEqual(call.broadcast, true);
  assert.equal(call.fanout, undefined);
  assert.equal(call.target, null);
});

test('MVP store excludes suspended extensions from fan-out', () => {
  const store = createMvpStore();
  store.recordExtensionPoll({ extensionId: 'ext_a', label: 'A' });
  store.recordExtensionPoll({ extensionId: 'ext_b', label: 'B' });
  store.recordExtensionPoll({ extensionId: 'ext_c', label: 'C' });
  store.setExtensionSuspended('ext_b', true);

  const parent = store.submitBrowserToolCall({
    tool: 'task_plan',
    params: { title: 't', steps: ['a'] },
  });

  assert.equal(parent.fanout.length, 2);
  const targets = parent.fanout.map((id) => store.getBrowserToolCall(id).target);
  assert.ok(targets.includes('ext_a'));
  assert.ok(targets.includes('ext_c'));
  assert.ok(!targets.includes('ext_b'));
});

test('MVP store broadcast tools with explicit target bypass fan-out', () => {
  const store = createMvpStore();
  store.recordExtensionPoll({ extensionId: 'ext_a', label: 'A' });
  store.recordExtensionPoll({ extensionId: 'ext_b', label: 'B' });

  const call = store.submitBrowserToolCall({
    tool: 'task_plan',
    params: { title: 't', steps: ['a'] },
    target: 'ext_a',
  });

  // Explicit target → single targeted call, no fan-out.
  assert.equal(call.fanout, undefined);
  assert.equal(call.target, 'ext_a');
});

test('MVP store treats panel-closed extensions as suspended (silent skip in fan-out, TARGET_SUSPENDED on target)', () => {
  const store = createMvpStore();
  store.recordExtensionPoll({ extensionId: 'ext_open', label: 'Open', panelActive: true });
  store.recordExtensionPoll({ extensionId: 'ext_closed', label: 'Closed', panelActive: false });

  // Snapshot exposes derived suspended state driven purely by panelActive.
  const [openEntry, closedEntry] = store.listExtensions();
  assert.equal(openEntry.suspended, false);
  assert.equal(closedEntry.suspended, true);

  // Add a third (also active) so fan-out kicks in; confirm the panel-closed
  // profile is silently skipped while both panel-open profiles get a child.
  store.recordExtensionPoll({ extensionId: 'ext_open2', label: 'Open2', panelActive: true });
  const parent = store.submitBrowserToolCall({
    tool: 'task_plan',
    params: { title: 't', steps: ['a'] },
  });
  assert.equal(parent.fanout?.length ?? 0, 2);
  const fanoutTargets = parent.fanout.map((id) => store.getBrowserToolCall(id).target);
  assert.ok(fanoutTargets.includes('ext_open') && fanoutTargets.includes('ext_open2'));
  assert.ok(!fanoutTargets.includes('ext_closed'));

  // Targeting the closed-panel profile returns TARGET_SUSPENDED — identical to manual suspend.
  assert.throws(
    () => store.submitBrowserToolCall({ tool: 'tabs_context', target: 'ext_closed' }),
    (err) => err.code === 'TARGET_SUSPENDED' && err.target === 'ext_closed',
  );

  // Reopening the panel flips the profile back to active without any manual toggle.
  store.recordExtensionPoll({ extensionId: 'ext_closed', label: 'Closed', panelActive: true });
  const reopened = store.listExtensions().find((e) => e.id === 'ext_closed');
  assert.equal(reopened.suspended, false);
});

test('MVP store refuses to suspend the last active worker', () => {
  const store = createMvpStore();
  store.recordExtensionPoll({ extensionId: 'ext_solo', label: 'Solo' });

  assert.throws(
    () => store.setExtensionSuspended('ext_solo', true),
    (err) => err.code === 'LAST_ACTIVE_WORKER',
  );

  // With a second active worker, suspending the first is allowed.
  store.recordExtensionPoll({ extensionId: 'ext_backup', label: 'Backup' });
  const updated = store.setExtensionSuspended('ext_solo', true);
  assert.equal(updated.suspended, true);

  // Now the backup is the last active — cannot suspend it.
  assert.throws(
    () => store.setExtensionSuspended('ext_backup', true),
    (err) => err.code === 'LAST_ACTIVE_WORKER',
  );
});
