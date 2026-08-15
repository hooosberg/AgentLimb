import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('runtime stays local to the GitHub Release archive', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.name, 'agentlimb-runtime');
  assert.equal(pkg.private, true);
  assert.equal(pkg.agentlimbBuild, 'b2');
  assert.equal(pkg.bin, undefined);
});

test('MCP runtime serves initialize and tools/list over stdio', () => {
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  ].join('\n');
  const result = spawnSync(process.execPath, ['bin/agentlimb.mjs', 'mcp'], {
    cwd: new URL('../', import.meta.url),
    input,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const replies = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(replies[0].result.protocolVersion, '2025-03-26');
  assert.ok(replies[1].result.tools.some((tool) => tool.name === 'page_snapshot'));
});
