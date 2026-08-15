#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, URL as NodeURL } from 'node:url';
import { parseArgs } from 'node:util';
import { request as httpRequest } from 'node:http';

import { createMvpHttpClient } from './client.js';
import { bootstrapTerminalTaskSession } from './bootstrap-session.js';

const DEFAULT_SESSION_FILE = new URL('../../.mvp-terminal-session.json', import.meta.url);
const DEFAULT_HOST = 'http://127.0.0.1:7791';

/**
 * Node-native fetch shim using http.request with explicit IPv4 host.
 * Avoids undici's IPv6/IPv4 dual-stack quirks against 127.0.0.1.
 * Retries once after 200ms on connection-level failures.
 */
function createNodeFetch() {
  return async function nodeFetch(urlStr, init = {}) {
    const url = new NodeURL(urlStr);
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const host = isLocalhost ? '127.0.0.1' : url.hostname;
    const port = url.port ? Number(url.port) : 80;

    const doRequest = () => new Promise((resolveReq, rejectReq) => {
      const req = httpRequest(
        {
          host,
          port,
          path: url.pathname + url.search,
          method: init.method || 'GET',
          headers: init.headers || {},
          family: 4, // force IPv4
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolveReq({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              text: async () => text,
              json: async () => (text ? JSON.parse(text) : {}),
            });
          });
        },
      );
      req.on('error', rejectReq);
      if (init.body !== undefined) req.write(init.body);
      req.end();
    });

    try {
      return await doRequest();
    } catch (err) {
      // Retry once after 200ms — most undici/local-port flakes resolve on second try
      await new Promise((r) => setTimeout(r, 200));
      try {
        return await doRequest();
      } catch (err2) {
        const msg = err2?.message || String(err2);
        throw new Error(
          `fetch failed (likely an IPv6 resolution issue or the Bridge has exited); still failed after 1 retry: ${msg}. Verify directly with: curl ${urlStr}.`,
        );
      }
    }
  };
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    host: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    cwd: { type: 'string' },
    token: { type: 'string' },
    'task-id': { type: 'string' },
    tool: { type: 'string' },
    params: { type: 'string' },
    ok: { type: 'string' },
    output: { type: 'string' },
    error: { type: 'string' },
    'session-file': { type: 'string' },
    timeout: { type: 'string' },
  },
});

const command = positionals[0] || 'help';
const sessionFile = values['session-file']
  ? pathToFileURL(resolve(values['session-file']))
  : DEFAULT_SESSION_FILE;
const savedSession = loadSession(sessionFile);
const client = createMvpHttpClient({
  baseUrl: values.host || savedSession?.hostBaseUrl || DEFAULT_HOST,
  fetchImpl: createNodeFetch(),
});

try {
  switch (command) {
    case 'connect':
      await runConnect();
      break;
    case 'status':
      await runStatus();
      break;
    case 'start':
      await runStart();
      break;
    case 'claim':
      await runClaim();
      break;
    case 'task':
      await runTask();
      break;
    case 'call':
      await runCall();
      break;
    case 'complete':
      await runComplete();
      break;
    default:
      printHelp();
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        command,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

async function runConnect() {
  const response = await client.connectTerminal({
    name: values.name || savedSession?.terminal?.name || 'Codex',
    type: values.type || savedSession?.terminal?.type || 'codex',
    cwd: values.cwd || process.cwd(),
  });

  saveSession(sessionFile, {
    hostBaseUrl: client.getBaseUrl(),
    token: response.token,
    terminal: response.terminal,
  });

  console.log(JSON.stringify(response, null, 2));
}

async function runStatus() {
  const response = await client.getStatus();
  console.log(
    JSON.stringify(
      {
        ok: true,
        hostBaseUrl: client.getBaseUrl(),
        savedSession,
        status: response.status,
        terminals: response.terminals,
      },
      null,
      2,
    ),
  );
}

async function runStart() {
  const session = await bootstrapTerminalTaskSession({
    client,
    taskId: values['task-id'] || undefined,
    terminalName: values.name || savedSession?.terminal?.name || 'Codex',
    terminalType: values.type || savedSession?.terminal?.type || 'codex',
    cwd: values.cwd || process.cwd(),
    timeoutMs: values.timeout ? Number(values.timeout) : 30000,
  });

  saveSession(sessionFile, {
    ...loadSession(sessionFile),
    hostBaseUrl: client.getBaseUrl(),
    token: session.token,
    terminal: session.terminal,
    lastTaskId: session.task?.id || savedSession?.lastTaskId || null,
  });

  console.log(JSON.stringify(session, null, 2));
}

async function runClaim() {
  const token = resolveToken();
  const response = await client.claimTask({
    token,
    taskId: values['task-id'],
  });

  if (response.task) {
    saveSession(sessionFile, {
      ...loadSession(sessionFile),
      hostBaseUrl: client.getBaseUrl(),
      token,
      lastTaskId: response.task.id,
    });
  }

  console.log(JSON.stringify(response, null, 2));
}

async function runTask() {
  const taskId = values['task-id'] || savedSession?.lastTaskId;
  if (!taskId) {
    throw new Error('task-id is required when no last task exists in the saved session.');
  }

  const response = await client.getTask(taskId);
  console.log(JSON.stringify(response, null, 2));
}

async function runCall() {
  const tool = values.tool;
  if (!tool) {
    throw new Error('--tool is required.');
  }

  const params = values.params ? JSON.parse(values.params) : {};
  const response = await client.callBrowserTool({
    tool,
    params,
    source: savedSession?.terminal?.type || 'terminal',
    timeoutMs: values.timeout ? Number(values.timeout) : 30000,
  });

  console.log(JSON.stringify(response, null, 2));
}

async function runComplete() {
  const token = resolveToken();
  const taskId = values['task-id'] || savedSession?.lastTaskId;
  if (!taskId) {
    throw new Error('--task-id is required when no last task exists in the saved session.');
  }

  const ok = parseBoolean(values.ok);
  const response = await client.completeTask({
    token,
    taskId,
    ok,
    output: values.output || '',
    error: values.error || '',
  });

  saveSession(sessionFile, {
    ...loadSession(sessionFile),
    hostBaseUrl: client.getBaseUrl(),
    token,
    lastTaskId: taskId,
  });

  console.log(JSON.stringify(response, null, 2));
}

function resolveToken() {
  const token = values.token || savedSession?.token;
  if (!token) {
    throw new Error('No terminal token found. Run `connect` first or pass --token.');
  }
  return token;
}

function parseBoolean(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('--ok must be either true or false.');
}

function loadSession(fileUrl) {
  try {
    if (!existsSync(fileUrl)) return null;
    return JSON.parse(readFileSync(fileUrl, 'utf8'));
  } catch {
    return null;
  }
}

function saveSession(fileUrl, session) {
  writeFileSync(fileUrl, JSON.stringify(session, null, 2));
}

function printHelp() {
  console.log(
    [
      'AgentLimb MVP terminal client',
      '',
      'Commands:',
      '  start    --name Codex --type codex --task-id task_xxx',
      '  connect  --name Codex --type codex',
      '  status',
      '  claim    [--task-id task_xxx]',
      '  task     --task-id task_xxx',
      '  call     --tool tabs_context --params \'{}\'',
      '  complete --task-id task_xxx --ok true --output "done"',
      '',
      `Session file: ${sessionFile.pathname}`,
      `Host: ${client.getBaseUrl()}`,
    ].join('\n'),
  );
}
