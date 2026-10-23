import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentlimbHome } from './bridge-server.mjs';
import { defaultMemoryRoot, ensureMemory, readMemoryConfig, resolveMemoryRoot, writeMemoryConfig } from './memory.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  ['host/mcp-server.mjs', 'host/mcp-server.mjs'],
  ['host/bridge-server.mjs', 'host/bridge-server.mjs'],
  ['host/diagnostics.mjs', 'host/diagnostics.mjs'],
  ['host/memory.mjs', 'host/memory.mjs'],
  ['kernel/shared/constants.js', 'kernel/shared/constants.js'],
  ['kernel/control/host/tools.js', 'kernel/control/host/tools.js'],
  ['package.json', 'package.json'],
];

/**
 * Install the MCP host. Site memory is part of pairing, not a separate step the
 * user has to discover: unless `memory === false`, the folder is created here
 * and the config records where it lives.
 */
export async function installHost({ sourceRoot = root, home = agentlimbHome(), memory = true, memoryRoot } = {}) {
  for (const [from, to] of FILES) {
    const target = join(home, to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(sourceRoot, from), target);
  }
  let memoryInfo = null;
  if (memory) {
    const existing = readMemoryConfig({ home });
    // An explicit --memory-root wins; otherwise keep whatever was saved before,
    // so re-running install never silently moves the user's notes.
    const chosen = memoryRoot ? String(memoryRoot) : resolveMemoryRoot({ home, config: existing });
    writeMemoryConfig({ enabled: true, root: chosen === defaultMemoryRoot(home) ? '' : chosen }, { home });
    memoryInfo = ensureMemory(chosen);
    memoryInfo.enabled = true;
  } else {
    writeMemoryConfig({ enabled: false }, { home });
    memoryInfo = { root: resolveMemoryRoot({ home }), enabled: false, created: false };
  }
  return { home, memory: memoryInfo };
}

export function makeMcpConfig({ home = agentlimbHome(), clientName, clientKind = 'generic' } = {}) {
  return {
    mcpServers: {
      agentlimb: {
        command: process.execPath,
        args: [join(home, 'host', 'mcp-server.mjs')],
        env: {
          // Unlabelled installs let MCP initialize.clientInfo identify the software.
          ...(clientName ? { AGENTLIMB_CLIENT_NAME: clientName } : {}),
          AGENTLIMB_CLIENT_KIND: clientKind,
        },
      },
    },
  };
}
