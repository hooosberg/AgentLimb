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
// An explicit env name wins; otherwise we adopt initialize.clientInfo.name so
// the side panel can say exactly which software connected.
const EXPLICIT_CLIENT_NAME = !!process.env.AGENTLIMB_CLIENT_NAME;

let bridge;
let starting;
async function startBridge(clientInfo) {
  const name = EXPLICIT_CLIENT_NAME ? CLIENT_NAME : String(clientInfo?.name || CLIENT_NAME).trim() || CLIENT_NAME;
  bridge = createBridge({
    clientId: loadOrCreateClientId(name, CLIENT_KIND),
    clientName: name,
    clientKind: CLIENT_KIND,
    onLog: (level, message) => {
      notify('notifications/message', { level, logger: 'agentlimb', data: message });
    },
    onAuthorized: ({ client, at, status }) => {
      // The moment the browser grants trust. Without this the agent has no way
      // to learn it is connected except by calling a tool and guessing, which
      // is why it kept re-running installation after every restart even though
      // trust is persistent. Distinct logger + `CONNECTED` prefix so it stands
      // out from routine bridge logs.
      notify('notifications/message', {
        level: 'info',
        logger: 'agentlimb-status',
        data: [
          `CONNECTED — the browser authorized this AI as "${client}" at ${at}.`,
          'Trust is saved and will be reused automatically in every later session; nothing needs to be re-paired, restarted or approved.',
          'Call the ping tool once to confirm end-to-end. When it returns a pong, tell the user "Connected" and stop any setup steps.',
        ].join(' '),
      });
    },
    onUserMessage: (text, page) => {
      // Panel chat → agent. Logged immediately AND attached to the next tool
      // result, so delivery is guaranteed even mid-turn.
      notify('notifications/message', {
        level: 'info',
        logger: 'agentlimb-chat',
        data: formatUserMessage({ text, at: new Date().toISOString(), page }),
      });
    },
  });
  const port = await bridge.start();
  console.error(`[agentlimb] MCP server ready — bridge on 127.0.0.1:${port}, client=${name} (${CLIENT_KIND})`);
  console.error(`[agentlimb] saved trust: ${bridge.isPaired() ? 'yes' : 'no'}; live browser authorization is verified by the GRANT reply and tools/call ping`);
  // A restart restores trust silently. If the browser is already there, the
  // agent should hear about it now rather than discovering it by accident.
  if (bridge.isPaired()) {
    notify('notifications/message', {
      level: 'info',
      logger: 'agentlimb-status',
      data: `Saved pairing found for "${name}". Trust is persistent — if the browser authorizes this session you will not need to pair again. Call ping to check the live connection state.`,
    });
  }
}

// ── MCP stdio plumbing ────────────────────────────────────────────────────────
/**
 * A panel message always carries the page the user was looking at, so the agent
 * can answer "translate this" / "what is this" without a single round trip.
 */
function formatUserMessage(msg) {
  const lines = [`User message from the browser side panel (${msg.at || ''}): ${msg.text}`];
  const page = msg.page;
  if (page) {
    lines.push('');
    lines.push(`Current tab: ${page.title || '(untitled)'} — ${page.url}`);
    if (page.restricted) {
      lines.push('(Chrome does not allow reading or controlling this page type — chrome://, the Web Store, PDF viewer, etc. Answer from the url/title only.)');
    }
    if (page.image) lines.push('(a screenshot of this exact tab is attached to this message)');
    if (page.text) {
      lines.push('Visible page text (excerpt):');
      lines.push(page.text);
    }
    if (Array.isArray(page.interactive) && page.interactive.length) {
      lines.push('Interactive elements (these refs work with computer/form_input):');
      for (const el of page.interactive) lines.push(`- ref=${el.ref} ${el.role} "${el.name}"`);
    }
  }
  return lines.join('\n');
}

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
      // The agent software tells us its own name here — the side panel then shows
      // "正在与 <name> 驱动浏览器" with no user input. Identify the actual MCP
      // client BEFORE the extension sees the first HELLO.
      starting ||= startBridge(request.params?.clientInfo);
      await starting;
      reply(request.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {}, logging: {} },
        serverInfo: { name: 'agentlimb', version: `${APP_VERSION}-${APP_BUILD}` },
        instructions: [
          'AgentLimb controls the user\'s Chrome through a local bridge.',
          '',
          'Connection state — read this before anything else:',
          '- Trust is PERSISTENT. Once the user has paired this AI, every later session (including after a restart of your software) is authorized automatically. There is no approval page and no code to paste, ever.',
          '- Therefore: whenever you are unsure whether you are connected, or the user asks anything like "are you connected", "连接", "did it work", "is it ready" — call the `ping` tool FIRST. Do not read install docs, do not run a doctor command, do not re-do configuration. One ping answers it.',
          '- A pong means end-to-end success: you can control Chrome. Reply "Connected. You can now ask me directly, for example to summarize the current page or open a webpage." and stop. Never ask for another restart, approval, or re-pairing after a successful ping.',
          '- If ping reports not authorized, ask the user to click the copy-prompt button in the AgentLimb side panel and retry the same call. If it reports no browser, ask them to keep Chrome running with the extension enabled and open the side panel once.',
          '',
          'Using the tools:',
          '- On your first browser task in a session, call `ping` then `tabs_context` once to confirm the link, then get to work.',
          '- Reply to side-panel messages with `say`; finish every browser task with `say` so the panel shows your answer.',
          '- Panel messages arrive on your next tool result and already carry the user\'s current page context.',
          '- If the user presses STOP, halt further browser actions and acknowledge with `say`.',
          '- Reply in the user\'s language.',
        ].join('\n'),
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
  if (!starting) {
    replyError(request.id, -32002, 'Initialize MCP before calling tools.');
    return;
  }
  await starting;
  const name = request.params?.name;
  const args = request.params?.arguments || {};
  const tool = HOST_TOOLS.find((t) => t.name === name);
  if (!tool) {
    replyError(request.id, -32602, `Unknown tool: ${name}`);
    return;
  }

  // `say` never touches the browser — it writes into the side panel chat, which
  // is what makes the panel a real conversation with the agent.
  if (name === 'say') {
    const ok = bridge.sayToUser(args.text);
    reply(request.id, {
      content: [{ type: 'text', text: ok ? 'Delivered to the user\'s side panel.' : 'Empty message ignored.' }],
    });
    return;
  }

  try {
    const { result, userMessages } = await bridge.callTool(name, args);
    // `ping` is the connection self-check. The pong proves the round trip; the
    // host-side snapshot proves the pairing, so one call answers "am I
    // connected?" without the agent having to infer anything.
    if (name === 'ping' && result && typeof result === 'object') {
      result.connection = bridge.connectionStatus();
    }
    const content = [];
    if (result && result.image && result.image.data) {
      content.push({ type: 'image', data: result.image.data, mimeType: result.image.mimeType });
      // Screenshots also get a tiny text anchor so the agent can label them.
      content.push({ type: 'text', text: `screenshot captured (${result.image.mimeType}, q=${result.image.quality ?? 'n/a'})` });
    } else {
      content.push({ type: 'text', text: JSON.stringify(result) });
    }
    for (const msg of userMessages || []) {
      // Screenshot of the tab the user was looking at — worth more than any text.
      if (msg.page?.image) {
        content.push({ type: 'image', data: msg.page.image, mimeType: msg.page.imageMime || 'image/jpeg' });
      }
      content.push({ type: 'text', text: formatUserMessage(msg) });
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
    bridge?.stop();
    process.exit(0);
  });

  process.stdin.on('end', () => { bridge?.stop(); process.exit(0); });
  process.stdin.on('error', () => { bridge?.stop(); process.exit(0); });
  process.stdout.on('error', () => { bridge?.stop(); process.exit(0); });
  process.on('SIGINT', () => { bridge?.stop(); process.exit(0); });
  process.on('SIGTERM', () => { bridge?.stop(); process.exit(0); });
  if (process.platform !== 'win32') {
    process.on('SIGHUP', () => { bridge?.stop(); process.exit(0); });
  }
}

main().catch((error) => {
  console.error(`[agentlimb] fatal: ${error.message}`);
  process.exit(1);
});
