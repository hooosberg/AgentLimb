#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'help', ...args] = process.argv.slice(2);
const extensionId = readOption(args, '--extension-id');
const host = readOption(args, '--host') || 'http://127.0.0.1:7791';

try {
  switch (command) {
    case 'setup':
      await setup(extensionId);
      break;
    case 'status':
      await status(host);
      break;
    case 'mcp':
    case 'serve':
      await import('../runtime/mcp-server.mjs').then(({ runMcpServer }) => runMcpServer({ host }));
      break;
    case 'start':
      await start(host);
      break;
    default:
      printHelp();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function setup(id) {
  if (!/^[a-p]{32}$/.test(id || '')) {
    throw new Error('setup requires --extension-id <32-character Chromium extension ID>.');
  }

  const isWindows = process.platform === 'win32';
  const script = isWindows ? resolve(root, 'scripts', 'install.ps1') : resolve(root, 'scripts', 'install.sh');
  if (!existsSync(script)) throw new Error(`AgentLimb setup script is missing: ${script}`);

  const command = isWindows ? 'powershell.exe' : 'bash';
  const scriptArgs = isWindows
    ? ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ExtensionId', id]
    : [script, '--extension-id', id];
  await run(command, scriptArgs);
}

async function status(baseUrl) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/mvp/status`);
  if (!response.ok) throw new Error(`AgentLimb Bridge is offline (${response.status}). Run: agentlimb setup --extension-id <id>`);
  console.log(JSON.stringify(await response.json(), null, 2));
}

async function start(baseUrl) {
  try {
    await status(baseUrl);
    return;
  } catch {
    // The platform installers keep the Bridge alive. Starting their service is intentionally
    // delegated to the same platform runtime rather than creating another server process here.
    if (process.platform === 'win32') {
      await run('powershell.exe', ['-NoProfile', '-Command', 'Start-ScheduledTask -TaskName "AgentLimb Bridge"']);
    } else if (process.platform === 'darwin') {
      await run('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/com.agentlimb.bridge`]);
    } else {
      throw new Error('AgentLimb Runtime currently supports macOS and Windows.');
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 800));
    await status(baseUrl);
  }
}

function readOption(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : '';
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', rejectRun);
    child.once('exit', (code) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${command} exited with code ${code ?? 'unknown'}.`)));
  });
}

function printHelp() {
  console.log([
    'AgentLimb Runtime',
    '',
    '  agentlimb setup --extension-id <id>  Install or upgrade the local Runtime',
    '  agentlimb status                     Check the local Bridge',
    '  agentlimb start                      Start the installed Bridge service',
    '  agentlimb mcp                        Serve AgentLimb through MCP stdio',
  ].join('\n'));
}
