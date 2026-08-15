import test from 'node:test';
import assert from 'node:assert/strict';

import { createMvpServer } from '../kernel/bridge/mvp/server.js';

test('MVP server exposes prompt submit, task claim, and result submit HTTP flow', async () => {
  const server = createMvpServer({ port: 0 });
  await server.start();

  try {
    const baseUrl = server.getBaseUrl();

    const terminalResponse = await fetch(`${baseUrl}/api/mvp/terminal/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Codex',
        type: 'codex',
      }),
    });
    const terminalData = await terminalResponse.json();
    assert.equal(terminalData.ok, true);
    assert.ok(terminalData.token);

    const promptResponse = await fetch(`${baseUrl}/api/mvp/extension/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '请打开当前页面并返回快照',
      }),
    });
    const promptData = await promptResponse.json();
    assert.equal(promptData.ok, true);
    assert.equal(promptData.task.status, 'queued');

    const nextResponse = await fetch(`${baseUrl}/api/mvp/terminal/next`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AgentLimb-Terminal': terminalData.token,
      },
      body: JSON.stringify({}),
    });
    const nextData = await nextResponse.json();
    assert.equal(nextData.ok, true);
    assert.equal(nextData.task.id, promptData.task.id);
    assert.equal(nextData.task.status, 'claimed');

    const resultResponse = await fetch(`${baseUrl}/api/mvp/terminal/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AgentLimb-Terminal': terminalData.token,
      },
      body: JSON.stringify({
        taskId: promptData.task.id,
        ok: true,
        output: 'snapshot ready',
      }),
    });
    const resultData = await resultResponse.json();
    assert.equal(resultData.ok, true);
    assert.equal(resultData.task.status, 'completed');

    const taskResponse = await fetch(`${baseUrl}/api/mvp/tasks/${promptData.task.id}`);
    const taskData = await taskResponse.json();
    assert.equal(taskData.ok, true);
    assert.equal(taskData.task.result.output, 'snapshot ready');
  } finally {
    await server.stop();
  }
});

test('MVP server rejects ordinary web origins and permits extension origins', async () => {
  const server = createMvpServer({ port: 0 });
  await server.start();

  try {
    const baseUrl = server.getBaseUrl();
    const blocked = await fetch(`${baseUrl}/api/mvp/status`, {
      headers: { Origin: 'https://malicious.example' },
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);

    const extensionOrigin = 'chrome-extension://hldldfepjhljhbcneojddjkkodkjglof';
    const allowed = await fetch(`${baseUrl}/api/mvp/status`, {
      headers: { Origin: extensionOrigin },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), extensionOrigin);
  } finally {
    await server.stop();
  }
});

test('MVP server exposes browser tool call relay HTTP flow', async () => {
  const server = createMvpServer({ port: 0 });
  await server.start();

  try {
    const baseUrl = server.getBaseUrl();

    const callResponse = await fetch(`${baseUrl}/api/mvp/browser/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'tabs_context',
        params: {},
        source: 'codex',
      }),
    });
    const callData = await callResponse.json();
    assert.equal(callData.ok, true);
    assert.equal(callData.call.tool, 'tabs_context');

    const nextResponse = await fetch(`${baseUrl}/api/mvp/extension/browser/next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const nextData = await nextResponse.json();
    assert.equal(nextData.ok, true);
    assert.equal(nextData.call.id, callData.call.id);

    const resultResponse = await fetch(`${baseUrl}/api/mvp/extension/browser/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callId: callData.call.id,
        ok: true,
        result: {
          page: {
            url: 'https://example.com',
          },
        },
      }),
    });
    const resultData = await resultResponse.json();
    assert.equal(resultData.ok, true);
    assert.equal(resultData.call.status, 'completed');

    const statusResponse = await fetch(`${baseUrl}/api/mvp/browser/calls/${callData.call.id}`);
    const statusData = await statusResponse.json();
    assert.equal(statusData.ok, true);
    assert.equal(statusData.call.result.page.url, 'https://example.com');
  } finally {
    await server.stop();
  }
});
