#!/usr/bin/env node
/** AgentLimb CLI. */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { BRIDGE_HOST, APP_VERSION, resolveBridgePorts } from '../kernel/shared/constants.js';
import { agentlimbHome } from '../host/bridge-server.mjs';
import { installHost, makeMcpConfig } from '../host/install.mjs';
import { listSites, memoryState, stats as memoryStats, writeMemoryConfig } from '../host/memory.mjs';

const [command = 'help', ...args] = process.argv.slice(2);
let options;

try {
  options = parseOptions(args);
  switch (command) {
    case 'mcp':
    case 'serve':
      await import('../host/mcp-server.mjs');
      break;
    case 'bridge':
      await bridge();
      break;
    case 'install':
      await install();
      break;
    case 'config':
      printConfig();
      break;
    case 'doctor':
      await doctor();
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
    case 'memory':
      await memory();
      break;
    default:
      printHelp();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseOptions(argv) {
  const result = {};
  const withValue = { '--client-name': 'clientName', '--client-kind': 'clientKind', '--memory-root': 'memoryRoot' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--no-memory') {
      result.noMemory = true;
    } else if (withValue[key]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
      result[withValue[key]] = value;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${key}`);
    }
  }
  return result;
}

function clientOptions() {
  return {
    clientName: options.clientName || process.env.AGENTLIMB_CLIENT_NAME || undefined,
    clientKind: options.clientKind || process.env.AGENTLIMB_CLIENT_KIND || undefined,
  };
}

async function install() {
  const { home, memory } = await installHost({ memory: !options.noMemory, memoryRoot: options.memoryRoot });
  console.log(`AgentLimb host installed to ${home}`);
  console.log('Existing pairing data and other client configuration were preserved.');
  if (memory.enabled) {
    console.log(`网站记忆 / Site memory: ${memory.root}`);
    console.log('  Every MCP client gets this as a soft prompt; the AI records how each site is operated and reuses it next time.');
    console.log('  Move it any time with --memory-root <dir>, or turn it off in the side panel → Settings → 网站记忆.');
  } else {
    console.log('网站记忆 / Site memory: off (--no-memory). Turn it on later in the side panel → Settings → 网站记忆.');
  }
  console.log('Copy this JSON into the target client\'s MCP settings (adapt the format if needed):');
  console.log(JSON.stringify(makeMcpConfig({ ...clientOptions(), home }), null, 2));
  console.log('In the target software, enable/trust this MCP entry if required, then reload MCP or restart the software.');
  console.log('Clicking Copy connection prompt in the AgentLimb side panel authorizes the next AI for 30 minutes — no browser popup, no code.');
  console.log('Then call AgentLimb ping and tabs_context in this AI session, report success with say and tell the user they can start a browser task.');
  console.log('Client Trust/Enable and browser authorization are separate steps. A saved pairing alone does not prove a live connection.');
  console.log('A leftover runtime folder is not evidence that the current install completed.');
}

function printConfig() {
  console.log(JSON.stringify(makeMcpConfig({ ...clientOptions(), home: agentlimbHome() }), null, 2));
}

async function doctor() {
  const { diagnose } = await import('../host/diagnostics.mjs');
  const report = await diagnose(clientOptions());
  console.log(JSON.stringify(report, null, 2));
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
  for (const port of resolveBridgePorts()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 800);
      const res = await fetch(`http://${BRIDGE_HOST}:${port}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        console.log(JSON.stringify(await res.json(), null, 2));
        return;
      }
    } catch (_) { /* try next port */ }
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

/** Inspect (or relocate / toggle) 网站记忆 without opening the browser. */
async function memory() {
  const state = memoryState();
  if (options.memoryRoot) {
    writeMemoryConfig({ enabled: true, root: String(options.memoryRoot) }, {});
  }
  if (options.noMemory) {
    writeMemoryConfig({ enabled: false }, {});
  }
  const current = memoryState();
  const summary = memoryStats(current.root);
  console.log(JSON.stringify({
    enabled: current.enabled,
    configured: current.configured,
    root: current.root,
    exists: current.exists,
    sites: summary.sites,
    runs: summary.sessions,
    latest: summary.latest || null,
    sitesDetail: listSites(current.root).map((site) => ({
      domain: site.fm.domain || site.domain,
      status: site.fm.status || 'draft',
      lastVerified: site.fm.last_verified || null,
      runs: site.fm.runs || 0,
    })),
    changed: Boolean(options.memoryRoot || options.noMemory),
    before: state.root,
  }, null, 2));
}

async function bridge() {
  const { createBridge, loadOrCreateClientId } = await import('../host/bridge-server.mjs');
  const clientName = options.clientName || process.env.AGENTLIMB_CLIENT_NAME || 'AI Agent';
  const clientKind = options.clientKind || process.env.AGENTLIMB_CLIENT_KIND || 'standalone';
  const clientId = loadOrCreateClientId(clientName, clientKind);

  const instance = createBridge({
    clientId,
    clientName,
    clientKind,
    onLog: (level, msg) => console.log(`[${level}]`, msg),
  });

  const port = await instance.start();
  console.log(`AgentLimb Bridge Server running on port ${port} (client: ${clientName})`);
  setInterval(() => {}, 60000);
}

function printHelp() {
  console.log([
    `AgentLimb ${APP_VERSION}`,
    '',
    '  agentlimb install      install host files and print MCP setup JSON',
    '  agentlimb config       print MCP JSON for the installed host path',
    '  agentlimb doctor       print a JSON connection diagnostic report',
    '  agentlimb mcp          run the MCP server (stdio)',
    '  agentlimb bridge       run standalone HTTP bridge (HTTP RPC & SSE)',
    '  agentlimb status       probe the local bridge',
    '  agentlimb pair-status  show persisted pairings',
    '  agentlimb memory       show 网站记忆 location and what is recorded',
    '  agentlimb uninstall    remove ~/.agentlimb',
    '',
    '  --client-name NAME --client-kind KIND  set the target client identity labels',
    '  --memory-root DIR                      keep 网站记忆 in DIR (default ~/.agentlimb/memory)',
    '  --no-memory                            install without 网站记忆',
  ].join('\n'));
}
