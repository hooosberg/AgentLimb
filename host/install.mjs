import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentlimbHome } from './bridge-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  ['host/mcp-server.mjs', 'host/mcp-server.mjs'],
  ['host/bridge-server.mjs', 'host/bridge-server.mjs'],
  ['host/diagnostics.mjs', 'host/diagnostics.mjs'],
  ['kernel/shared/constants.js', 'kernel/shared/constants.js'],
  ['kernel/control/host/tools.js', 'kernel/control/host/tools.js'],
  ['package.json', 'package.json'],
];

export async function installHost({ sourceRoot = root, home = agentlimbHome() } = {}) {
  for (const [from, to] of FILES) {
    const target = join(home, to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(sourceRoot, from), target);
  }
  return home;
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
