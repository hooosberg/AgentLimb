/** Read-only onboarding diagnosis. A bridge owned by another client is not proof of connection. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { resolveBridgePorts, BRIDGE_HOST } from '../kernel/shared/constants.js';
import { agentlimbHome, clientIdentityPath, persistedTrust } from './bridge-server.mjs';

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
function isFile(file) {
  try { return isAbsolute(file) && statSync(file).isFile(); } catch { return false; }
}

export function connectionDiagnosis(bridges, { clientName, clientKind } = {}) {
  if (!clientName) return { stage: 'target_required', next: 'Pass --client-name and --client-kind for the target software. The bridge inventory alone cannot identify which AI session is connected.' };
  const matching = bridges.filter((b) => (!clientName || b.client?.name === clientName)
    && (!clientKind || b.client?.kind === clientKind));
  const ready = matching.find((b) => b.activeBrowser === true);
  const waiting = matching.find((b) => b.browsers > 0);
  if (ready) return { stage: 'browser_ready_ping_required', next: 'Call the AgentLimb tools/call ping from the target AI session. Only its browser pong proves end-to-end success.' };
  if (waiting) return { stage: 'awaiting_authorization', next: 'The browser is connected but has not authorized this client. Ask the user to click the copy-prompt button in the AgentLimb side panel (it authorizes the next AI for 30 minutes), then retry. No config change or restart is needed.' };
  if (matching.length) return { stage: 'awaiting_extension', next: 'Keep Chrome running, enable the current AgentLimb extension and open its side panel to wake discovery. Check the extension error if it still cannot connect.' };
  return { stage: 'no_matching_mcp', next: 'The target MCP has not been observed. Check its exact config path, executable, client startup error and enabled/trusted state in the AI software. Restart or reload its MCP tools if required. Trust is UNKNOWN until verified in that software; an unrelated bridge does not prove this client is connected.' };
}

export async function diagnose({ clientName, clientKind } = {}) {
  const bridges = (await Promise.all(resolveBridgePorts().map(async (port) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 700);
    try {
      const response = await fetch(`http://${BRIDGE_HOST}:${port}/health`, { signal: controller.signal });
      const body = response.ok ? await response.json() : null;
      return body?.service === 'agentlimb-bridge' ? body : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }))).filter(Boolean);
  const home = agentlimbHome();
  const candidates = ['host/mcp-server.mjs', 'runtime/runtime/mcp-server.mjs', 'runtime/host/mcp-server.mjs']
    .map((path) => ({ path: join(home, path), exists: existsSync(join(home, path)) }));
  const identity = clientName ? readJson(clientIdentityPath(clientName, clientKind || 'generic')) : null;
  const result = {
    ...connectionDiagnosis(bridges, { clientName, clientKind }),
    target: { name: clientName || null, kind: clientKind || null },
    node: { path: process.execPath, version: process.version },
    installation: candidates,
    savedTrustForTarget: identity ? persistedTrust(identity.id) : false,
    clientMcpTrust: 'unknown — verify enabled/trusted state in the target AI software',
    bridges,
  };
  if (clientKind === 'workbuddy' || /workbuddy/i.test(clientName || '')) {
    const path = join(homedir(), '.workbuddy', 'mcp.json');
    const config = readJson(path);
    const entry = config?.mcpServers?.agentlimb;
    result.clientConfig = {
      path, validJson: config != null, hasAgentlimbEntry: !!entry,
      executableIsAbsoluteFile: typeof entry?.command === 'string' && isFile(entry.command),
      entrypointIsAbsoluteFile: typeof entry?.args?.[0] === 'string' && isFile(entry.args[0]),
      identityMatches: !!entry && entry.env?.AGENTLIMB_CLIENT_NAME === clientName
        && entry.env?.AGENTLIMB_CLIENT_KIND === clientKind,
      note: 'Config on disk does not prove the client loaded or trusted it. No other server configuration is included in this report.',
    };
  }
  return result;
}
