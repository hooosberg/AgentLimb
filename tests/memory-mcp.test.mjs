/**
 * 网站记忆 through the real MCP server process, with no model and no browser.
 *
 * The promise being pinned: on a machine where the user has done NOTHING
 * (no install step for memory, no config file, no folder), connecting any MCP
 * client turns the feature on at the default location, and what one session
 * records the next session reads back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../host/mcp-server.mjs', import.meta.url));

function freshHome() {
  const home = join(process.cwd(), '.tmp-test', `mcp-home-${randomUUID().slice(0, 8)}`);
  mkdirSync(home, { recursive: true });
  return home;
}

/** Minimal stdio MCP client: one process = one AI session. */
async function session(home, fn) {
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, HOME: home, USERPROFILE: home, AGENTLIMB_CLIENT_NAME: 'memory-mcp-test', AGENTLIMB_MEMORY_ROOT: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try { const message = JSON.parse(line); pending.get(message.id)?.(message); } catch (_) { /* not json */ }
    }
  });
  let nextId = 1;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 8000);
    pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'memory-mcp-test', version: '1' } });
    return await fn({
      call,
      tool: async (name, args) => (await call('tools/call', { name, arguments: args })).result.content[0].text,
    });
  } finally {
    child.kill('SIGKILL');
  }
}

test('zero-config: first session enables memory at the default folder and tells the AI', async () => {
  const home = freshHome();
  let instructions = '';
  const child = await session(home, async ({ call }) => {
    const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    instructions = init.result.instructions;
    const list = await call('tools/list');
    return list.result.tools.map((tool) => tool.name);
  });
  assert.ok(child.includes('site_memory'));
  assert.match(instructions, /Site memory \(enabled\)/);
  const root = join(home, '.agentlimb', 'memory');
  assert.ok(instructions.includes(root), 'the AI is told the default folder');
  assert.ok(existsSync(join(root, '.agentlimb-kb')), 'the folder was created without any user action');
});

test('record in one session, brief in the next', async () => {
  const home = freshHome();
  await session(home, async ({ tool }) => {
    assert.match(await tool('site_memory', { action: 'brief', site: 'https://tieba.baidu.com/f?kw=test' }), /^NO_PLAYBOOK: tieba\.baidu\.com/);
    const recorded = await tool('site_memory', {
      action: 'record', site: 'tieba.baidu.com', status: 'success', title: '百度贴吧',
      entry: 'https://tieba.baidu.com/f?kw=<吧名>', steps: '1) 打开吧 2) 点发帖 3) 标题 5-31 字',
      pitfalls: '标题少于 5 字会被拒', note: '列表第 1 条出现新帖',
    });
    assert.match(recorded, /^RECORDED: tieba\.baidu\.com → status=verified/);
  });
  await session(home, async ({ tool }) => {
    const text = await tool('site_memory', { action: 'brief', site: 'tieba.baidu.com' });
    assert.match(text, /status=verified/);
    assert.match(text, /标题少于 5 字/);
    assert.match(await tool('site_memory', { action: 'status' }), /tieba\.baidu\.com/);
  });
  assert.match(readFileSync(join(home, '.agentlimb', 'memory', 'knowledge', 'sites', 'tieba.baidu.com', 'PLAYBOOK.md'), 'utf8'), /百度贴吧/);
});

test('say is the finishing hook: after operating a site the AI is nudged to record', async () => {
  // No browser here, so drive the host-side tracker the same way mcp-server does.
  const { createMemoryHints, ensureMemory } = await import('../host/memory.mjs');
  const root = join(freshHome(), 'kb');
  ensureMemory(root);
  const hints = createMemoryHints();
  hints.navigated(root, 'https://tieba.baidu.com/');
  assert.match(hints.finishing(), /tieba\.baidu\.com.*not recorded/s);
});
