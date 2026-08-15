import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt } from '../kernel/prompt/index.js';

test('buildPrompt includes host, client command, and task lifecycle', () => {
  const prompt = buildPrompt({
    hostBaseUrl: 'http://127.0.0.1:7791',
    clientCommand: 'node kernel/bridge/mvp/terminal-client.mjs',
    terminalName: 'Codex',
    terminalType: 'codex',
    taskId: 'task_123',
  });

  // Identity & environment
  assert.match(prompt, /AgentLimb/);
  assert.match(prompt, /http:\/\/127\.0\.0\.1:7791/);

  // Protocol lifecycle
  assert.match(prompt, /terminal-client\.mjs start --name "Codex" --type "codex" --task-id "task_123"/);
  assert.match(prompt, /terminal-client\.mjs call --tool/);
  assert.match(prompt, /terminal-client\.mjs complete/);
});

test('buildPrompt auto-generates tool catalog from HOST_TOOLS', () => {
  const prompt = buildPrompt({
    hostBaseUrl: 'http://127.0.0.1:7791',
    clientCommand: 'client',
  });

  // All 11 tools should appear
  for (const name of [
    'browser_session', 'tabs_context', 'page_snapshot', 'navigate',
    'javascript_eval', 'computer', 'form_input', 'wait',
    'muscle_recall', 'muscle_remember', 'muscle_commit',
  ]) {
    assert.match(prompt, new RegExp(`### ${name}`), `tool ${name} missing from prompt`);
  }

  // Tool count header
  assert.match(prompt, /Available Tools \(\d+\)/);
});

test('buildPrompt includes rules section', () => {
  const prompt = buildPrompt({
    hostBaseUrl: 'http://localhost:7791',
    clientCommand: 'client',
  });

  assert.match(prompt, /Usage Rules/);
  assert.match(prompt, /refId/);
  assert.match(prompt, /back_close_tab/);
});

test('buildPrompt injects mission when provided', () => {
  const prompt = buildPrompt({
    hostBaseUrl: 'http://localhost:7791',
    clientCommand: 'client',
    mission: 'Navigate to bing.com and search for AgentLimb',
  });

  // `## Mission` header must appear as a real section header — line-anchored —
  // not just as a passing reference in prose rules.
  assert.match(prompt, /^## Mission$/m);
  assert.match(prompt, /Navigate to bing\.com and search for AgentLimb/);
});

test('buildPrompt injects changes section when provided', () => {
  const prompt = buildPrompt({
    hostBaseUrl: 'http://localhost:7791',
    clientCommand: 'client',
    changes: 'wait(page_contains) switched to SW polling',
  });

  assert.match(prompt, /Changes in this round/);
  assert.match(prompt, /SW polling/);
});

test('buildPrompt omits mission and changes when not provided', () => {
  const prompt = buildPrompt({
    hostBaseUrl: 'http://localhost:7791',
    clientCommand: 'client',
  });

  // When no mission is provided the renderer must not emit the Mission section
  // header as a standalone line. Rules prose mentioning "## Mission" (e.g. the
  // Bootstrap discipline rules that refer to it by name) is allowed.
  assert.doesNotMatch(prompt, /^## Mission$/m);
  assert.doesNotMatch(prompt, /Changes in this round/);
});
