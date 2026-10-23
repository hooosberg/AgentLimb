import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionDiagnosis } from '../host/diagnostics.mjs';

const target = { clientName: 'WorkBuddy', clientKind: 'workbuddy' };
const health = (patch = {}) => ({ client: { name: 'WorkBuddy', kind: 'workbuddy' }, browsers: 0, paired: false, activeBrowser: false, ...patch });

test('diagnosis does not mistake an old or other-client bridge for this MCP', () => {
  for (const bridges of [[], [health({ client: { name: 'Development', kind: 'test' }, paired: true, activeBrowser: true })]]) {
    const result = connectionDiagnosis(bridges, target);
    assert.equal(result.stage, 'no_matching_mcp');
    assert.match(result.next, /Trust is UNKNOWN/);
  }
});

test('saved trust does not imply a connected or authorized browser', () => {
  assert.equal(connectionDiagnosis([health({ paired: true })], target).stage, 'awaiting_extension');
  assert.equal(connectionDiagnosis([health({ paired: true, browsers: 1 })], target).stage, 'awaiting_authorization');
  assert.match(connectionDiagnosis([health({ browsers: 1 })], target).next, /copy-prompt button/);
  assert.equal(connectionDiagnosis([health({ browsers: 1, activeBrowser: true })], target).stage, 'browser_ready_ping_required');
});

test('diagnostics without a target cannot claim an arbitrary bridge belongs to this AI', () => {
  assert.equal(connectionDiagnosis([health({ activeBrowser: true })]).stage, 'target_required');
});
