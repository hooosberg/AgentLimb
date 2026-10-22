/**
 * AgentLimb MCP server (stdio)
 *
 * This is the process an AI agent spawns when its MCP config contains the
 * agentlimb entry (command: node, args: [<host>/mcp-server.mjs]). It embeds
 * the local bridge, speaks MCP over stdin/stdout, and forwards every tool
 * call to the paired browser extension over the local SSE/POST channel.
 *
 * stdout carries ONLY JSON-RPC. All diagnostics go to stderr / MCP logging
 * notifications.
 */

import readline from 'node:readline';

import { createBridge, loadOrCreateClientId } from './bridge-server.mjs';
import { HOST_TOOLS } from '../kernel/control/host/tools.js';
import { APP_NAME, APP_VERSION, APP_BUILD, MCP_PROTOCOL_VERSION } from '../kernel/shared/constants.js';

const CLIENT_NAME = process.env.AGENTLIMB_CLIENT_NAME || 'AI Agent';
const CLIENT_KIND = process.env.AGENTLIMB_CLIENT_KIND || 'generic';

const bridge = createBridge({
  clientId: loadOrCreateClientId(),
  clientName: CLIENT_NAME,
  clientKind: CLIENT_KIND,
  onLog: (level, message) => {
    notify('notifications/message', { level, logger: 'agentlimb', data: message });
  },
  onUserMessage: (text) => {
    // Panel chat → agent. Logged immediately AND attached to the next tool
    // result, so delivery is guaranteed even mid-turn.
    notify('notifications/message', {
      level: 'info',
      logger: 'agentlimb-chat',
      data: `User message from browser panel: ${text}`,
    });
  },
  onStop: () => {
    notify('notifications/message', {
      level: 'warning',
      logger: 'agentlimb',
      data: 'User pressed STOP in the browser — halt browser actions now.',
    });
  },
});

// ── MCP stdio plumbing ────────────────────────────────────────────────────────
function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleRequest(request) {
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    if (request && request.id != null) replyError(request.id, -32600, 'Invalid JSON-RPC request');
    return;
  }

  switch (request.method) {
    case 'initialize':
      reply(request.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {}, logging: {} },
        serverInfo: { name: 'agentlimb', version: `${APP_VERSION}-${APP_BUILD}` },
      });
      return;

    case 'notifications/initialized':
    case 'initialized':
      return; // notification — no response

    case 'ping':
      reply(request.id, {});
      return;

    case 'tools/list':
      reply(request.id, {
        tools: HOST_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
      return;

    case 'tools/call':
      await handleToolCall(request);
      return;

    default:
      if (request.id != null) replyError(request.id, -32601, `Unsupported method: ${request.method}`);
  }
}

async function handleToolCall(request) {
  const name = request.params?.name;
  const args = request.params?.arguments || {};
  const tool = HOST_TOOLS.find((t) => t.name === name);
  if (!tool) {
    replyError(request.id, -32602, `Unknown tool: ${name}`);
    return;
  }

  try {
    const { result, userMessages } = await bridge.callTool(name, args);
    const content = [];
    if (result && result.image && result.image.data) {
      content.push({ type: 'image', data: result.image.data, mimeType: result.image.mimeType });
      // Screenshots also get a tiny text anchor so the agent can label them.
      content.push({ type: 'text', text: `screenshot captured (${result.image.mimeType}, q=${result.image.quality ?? 'n/a'})` });
    } else {
      content.push({ type: 'text', text: JSON.stringify(result) });
    }
    for (const msg of userMessages || []) {
      content.push({ type: 'text', text: `User message (${msg.at}): ${msg.text}` });
    }
    reply(request.id, { content });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reply(request.id, {
      isError: true,
      content: [{ type: 'text', text: message }],
    });
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const port = await bridge.start();
  console.error(`[agentlimb] MCP server ready — bridge on 127.0.0.1:${port}, client=${CLIENT_NAME} (${CLIENT_KIND})`);
  console.error(`[agentlimb] paired: ${bridge.isPaired() ? 'yes (auto-reconnect)' : 'no — confirm in the browser pairing tab'}`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let request;
    try {
      request = JSON.parse(trimmed);
    } catch (_) {
      replyError(null, -32700, 'Parse error');
      return;
    }
    handleRequest(request).catch((error) => {
      if (request.id != null) {
        replyError(request.id, -32603, error instanceof Error ? error.message : String(error));
      }
    });
  });

  rl.on('close', () => {
    bridge.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => { bridge.stop(); process.exit(0); });
  process.on('SIGTERM', () => { bridge.stop(); process.exit(0); });
}

main().catch((error) => {
  console.error(`[agentlimb] fatal: ${error.message}`);
  process.exit(1);
});
