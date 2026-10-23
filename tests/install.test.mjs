import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeMcpConfig } from '../host/install.mjs';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(root, 'bin', 'agentlimb.mjs');

function withHome(run) {
  const temp = mkdtempSync(join(tmpdir(), 'agentlimb-install-test-'));
  const home = join(temp, 'isolated-home');
  mkdirSync(home);
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    run({ home, env });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function runCli(args, env) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test('install creates the ESM runtime, emits absolute-path JSON, and preserves pairings', () => {
  withHome(({ home, env }) => {
    const runtime = join(home, '.agentlimb');
    mkdirSync(runtime);
    const existingPairings = '{"existing":{"id":"existing","name":"Other client"}}\n';
    writeFileSync(join(runtime, 'paired-clients.json'), existingPairings);
    writeFileSync(join(runtime, 'other-client-config.json'), '{"keep":true}\n');

    const output = runCli(['install', '--client-name', 'WorkBuddy', '--client-kind', 'workbuddy'], env);
    const start = output.indexOf('{\n  "mcpServers"');
    assert.notEqual(start, -1, output);
    const config = JSON.parse(output.slice(start, output.indexOf('\n}\n', start) + 2));
    const server = config.mcpServers.agentlimb;
    assert.equal(server.command, process.execPath);
    assert.equal(server.args[0], join(runtime, 'host', 'mcp-server.mjs'));
    assert.equal(server.env.AGENTLIMB_CLIENT_NAME, 'WorkBuddy');
    assert.equal(server.env.AGENTLIMB_CLIENT_KIND, 'workbuddy');
    assert.equal(readFileSync(join(runtime, 'paired-clients.json'), 'utf8'), existingPairings);
    assert.equal(readFileSync(join(runtime, 'other-client-config.json'), 'utf8'), '{"keep":true}\n');

    for (const rel of [
      'host/mcp-server.mjs', 'host/bridge-server.mjs', 'host/diagnostics.mjs',
      'kernel/shared/constants.js', 'kernel/control/host/tools.js', 'package.json',
    ]) assert.equal(existsSync(join(runtime, rel)), true, `missing ${rel}`);
    assert.equal(JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8')).type, 'module');

    // Dynamic import needs a URL, not a path: on Windows a bare `C:\...` throws
    // ERR_UNSUPPORTED_ESM_URL_SCHEME, so hand Node a file:// URL everywhere.
    const moduleCheck = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import(${JSON.stringify(pathToFileURL(join(runtime, 'host', 'bridge-server.mjs')).href)}).then(m => { if (typeof m.loadOrCreateClientId !== 'function') process.exit(2); })`,
    ], { env, encoding: 'utf8' });
    assert.equal(moduleCheck.status, 0, moduleCheck.stderr);
  });
});

test('config prints valid JSON with escaped Windows-style paths and environment overrides', () => {
  withHome(({ home, env }) => {
    const simulatedHome = 'C:\\Users\\A User\\.agentlimb';
    const output = runCli(['config', '--client-name', 'WorkBuddy', '--client-kind', 'workbuddy'], env);
    const config = JSON.parse(output);
    assert.equal(config.mcpServers.agentlimb.command, process.execPath);
    assert.equal(config.mcpServers.agentlimb.env.AGENTLIMB_CLIENT_NAME, 'WorkBuddy');
    assert.equal(config.mcpServers.agentlimb.env.AGENTLIMB_CLIENT_KIND, 'workbuddy');
    const winConfig = makeMcpConfig({ home: simulatedHome, clientName: 'WorkBuddy', clientKind: 'workbuddy' });
    const serialized = JSON.stringify(winConfig);
    assert.match(serialized, /C:\\\\Users/);
    assert.deepEqual(JSON.parse(serialized), winConfig);
    assert.ok(home.endsWith('isolated-home'));
  });
});

test('doctor uses environment defaults and accepts CLI identity overrides', () => {
  withHome(({ env }) => {
    assert.equal(existsSync(join(root, 'host', 'diagnostics.mjs')), true);
    const output = runCli(['doctor', '--client-name', 'WorkBuddy', '--client-kind', 'workbuddy'], {
      ...env,
      AGENTLIMB_CLIENT_NAME: 'Default name',
      AGENTLIMB_CLIENT_KIND: 'default-kind',
    });
    const report = JSON.parse(output);
    assert.deepEqual(report.target, { name: 'WorkBuddy', kind: 'workbuddy' });

    const envDefaults = JSON.parse(runCli(['doctor'], {
      ...env,
      AGENTLIMB_CLIENT_NAME: 'Env client',
      AGENTLIMB_CLIENT_KIND: 'env-kind',
    }));
    assert.deepEqual(envDefaults.target, { name: 'Env client', kind: 'env-kind' });
  });
});

test('unlabelled config lets MCP identify the actual software instead of sharing AI Agent', () => {
  const config = makeMcpConfig();
  assert.equal(Object.hasOwn(config.mcpServers.agentlimb.env, 'AGENTLIMB_CLIENT_NAME'), false);
});

test('the generated MCP config carries no authorization secret', () => {
  // Authorization happens when the user clicks Copy in the side panel, so an
  // expired grant can never leave a stale code baked into a client's config.
  const config = makeMcpConfig({ clientName: 'WorkBuddy', clientKind: 'workbuddy', pairingToken: 'a'.repeat(64) });
  const env = config.mcpServers.agentlimb.env;
  assert.deepEqual(Object.keys(env).sort(), ['AGENTLIMB_CLIENT_KIND', 'AGENTLIMB_CLIENT_NAME']);
  assert.ok(!JSON.stringify(config).includes('a'.repeat(64)));
});
