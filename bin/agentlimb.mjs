#!/usr/bin/env node
/**
 * AgentLimb CLI
 *
 *   agentlimb mcp                 run the MCP server (what AI agents spawn)
 *   agentlimb install             install the host to ~/.agentlimb + print MCP config
 *   agentlimb uninstall           remove ~/.agentlimb
 *   agentlimb status              probe the local bridge
 *   agentlimb pair-status         show persisted pairings
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { BRIDGE_PORTS, BRIDGE_HOST, APP_VERSION } from '../kernel/shared/constants.js';
import { agentlimbHome } from '../host/bridge-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'help', ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'mcp':
    case 'serve':
      await import('../host/mcp-server.mjs');
      break;

    case 'install':
      await install();
      break;

    case 'uninstall':
      await uninstall();
      break;

    case 'status':
      await status();
      break;

    case 'pair-status':
      await pairStatus();
      break;

    default:
      printHelp();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

// ── commands ─────────────────────────────────────────────────────────────────
async function install() {
  const home = agentlimbHome();
  // Mirror the repo layout so the installed host's relative imports resolve.
  const layout = [
    ['host/mcp-server.mjs', 'host/mcp-server.mjs'],
    ['host/bridge-server.mjs', 'host/bridge-server.mjs'],
    ['kernel/shared/constants.js', 'kernel/shared/constants.js'],
    ['kernel/control/host/tools.js', 'kernel/control/host/tools.js'],
  ];
  for (const [from, to] of layout) {
    const target = join(home, to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, from), target);
  }
  const mcpPath = join(home, 'host', 'mcp-server.mjs');
  console.log(`AgentLimb host installed to ${home}`);
  console.log('');
  console.log('Add this MCP server to your agent software (any MCP-capable client):');
  console.log('');
  console.log('  {');
  console.log('    "mcpServers": {');
  console.log('      "agentlimb": {');
  console.log('        "command": "node",');
  console.log(`        "args": ["${mcpPath}"]`);
  console.log('      }');
  console.log('    }');
  console.log('  }');
  console.log('');
  console.log('Then open the extension side panel, copy the connection prompt,');
  console.log('and paste it into your agent software. Pairing confirms on first connect.');
}

async function uninstall() {
  const home = agentlimbHome();
  if (!existsSync(home)) {
    console.log(`${home} does not exist — nothing to do.`);
    return;
  }
  rmSync(home, { recursive: true, force: true });
  console.log(`removed ${home}`);
  console.log('Note: remove the "agentlimb" entry from your agent software\'s MCP config to detach it.');
}

async function status() {
  for (const port of BRIDGE_PORTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 800);
      const res = await fetch(`http://${BRIDGE_HOST}:${port}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const body = await res.json();
        console.log(JSON.stringify(body, null, 2));
        return;
      }
    } catch (_) {
      // try next port
    }
  }
  console.log('AgentLimb bridge is not running.');
  console.log('Start it via your AI agent (it spawns the MCP server automatically),');
  console.log('or run: node bin/agentlimb.mjs mcp');
}

async function pairStatus() {
  const file = join(agentlimbHome(), 'paired-clients.json');
  if (!existsSync(file)) {
    console.log('no pairings yet.');
    return;
  }
  console.log(readFileSync(file, 'utf8'));
}

function printHelp() {
  console.log([
    `AgentLimb ${APP_VERSION}`,
    '',
    '  agentlimb install      install the host to ~/.agentlimb and print MCP setup',
    '  agentlimb mcp          run the MCP server (stdio) — used by AI agents',
    '  agentlimb status       probe the local bridge',
    '  agentlimb pair-status  show persisted pairings',
    '  agentlimb uninstall    remove ~/.agentlimb',
  ].join('\n'));
}
