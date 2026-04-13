#!/usr/bin/env node
/**
 * AgentLimb MCP Server v3
 *
 * 5 tools for browser automation via MCP protocol (Unix philosophy: fewest tools, maximum power).
 * Claude Code / Cursor / any MCP client can control Chrome through these tools.
 *
 * Install in ~/.claude.json:
 *   {
 *     "mcpServers": {
 *       "agentlimb": {
 *         "command": "node",
 *         "args": ["/path/to/bridge/mcp-server.js"]
 *       }
 *     }
 *   }
 *
 * Prerequisites: bridge server running (node server.js)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BRIDGE = `http://127.0.0.1:${process.env.BRIDGE_PORT || 7789}`;
let _terminalToken = null;

async function ensureTerminalRegistered() {
  if (_terminalToken) return _terminalToken;
  try {
    const res = await fetch(`${BRIDGE}/api/terminal/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: process.env.AGENTLIMB_TERMINAL_NAME || 'Claude Code / MCP',
        type: process.env.AGENTLIMB_TERMINAL_TYPE || 'mcp',
        cwd: process.cwd(),
      }),
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    if (data.ok && data.token) _terminalToken = data.token;
  } catch {}
  return _terminalToken;
}

// ── 5 Tool Definitions (Unix philosophy) ─────

const TOOLS = [
  {
    name: 'browser_observe',
    description: 'Get current page state: URL, title, and DOM accessibility tree with ref_id for each interactive element. ref_ids are integers that expire after navigation — call observe again after act(type:"navigate"). Pass screenshot:true to include a JPEG screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['interactive', 'all'], description: 'Element filter. Default: interactive' },
        screenshot: { type: 'boolean', description: 'Include JPEG screenshot in response. Default: false' },
      },
    },
  },
  {
    name: 'browser_act',
    description: 'Execute ONE page mutation: click, type text, select option, navigate to URL, or press key. Use ref_id (number) from observe tree, or fallback to CSS selector. For irreversible actions (posting, submitting, deleting), set confirm:true — blocks until user approves in side panel.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['click', 'type', 'select', 'navigate', 'press_key'], description: 'Action type' },
        ref_id: { type: 'number', description: 'Element ref_id from observe tree (integer, not string)' },
        selector: { type: 'string', description: 'CSS selector fallback if ref_id unavailable' },
        url: { type: 'string', description: 'Target URL (for type:"navigate" only)' },
        value: { type: 'string', description: 'Text to type, option to select, or key name (Enter/Escape/Tab/etc)' },
        confirm: { type: 'boolean', description: 'Block until user approves in side panel. Use for irreversible actions.' },
      },
      required: ['type'],
    },
  },
  {
    name: 'browser_eval',
    description: 'Execute arbitrary JavaScript in the page (MAIN world). Full DOM access, no restrictions. With timeout_ms: polls code every 500ms until result is truthy or timeout — this replaces the old wait tool. Examples: eval("document.title"), eval("document.querySelector(\'.btn\')?.click()"), eval("!!document.querySelector(\'.loaded\')", timeout_ms: 10000).',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute in page context' },
        timeout_ms: { type: 'number', description: 'If set, polls code every 500ms until truthy result or timeout. Use for waiting conditions.' },
      },
      required: ['code'],
    },
  },
  {
    name: 'browser_muscle',
    description: 'Muscle memory CRUD and replay. Muscles are reusable DOM action sequences that execute without AI — zero tokens. list returns compact summaries; save prefers desc/site/params/steps; run replays by id.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'save', 'run', 'delete'], description: 'Operation to perform' },
        id: { type: 'string', description: 'Muscle ID (for save/run/delete)' },
        desc: { type: 'string', description: 'One-line intent summary used by AI to choose a muscle (for save)' },
        site: { type: 'string', description: 'Host / wildcard / regex this muscle applies to, e.g. tieba.baidu.com or *.baidu.com (for save)' },
        params: { type: 'array', description: 'Runtime parameter names required by this muscle (for save)', items: { type: 'string' } },
        steps: { type: 'array', description: 'Canonical muscle steps: { do, el?, param?, value?, url?, pattern?, code?, text?, delay?, timeout?, property? }', items: { type: 'object' } },
        name: { type: 'string', description: 'Legacy alias for desc/id (optional)' },
        url_pattern: { type: 'string', description: 'Legacy alias for site (optional)' },
        actions: { type: 'array', description: 'Legacy action steps (optional)', items: { type: 'object' } },
        fields: { type: 'object', description: 'Field values for parameterized actions (for run)' },
        url: { type: 'string', description: 'Filter muscles by URL match (for list)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'browser_report',
    description: 'Update the human-facing monitoring UI in Chrome side panel. Steps array replaces (not appends) — include ALL steps each time.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        status: { type: 'string', enum: ['running', 'done', 'error', 'clear'], description: 'Task status' },
        steps: { type: 'array', description: 'Progress steps: { id, text, status }', items: { type: 'object' } },
        log: { type: 'string', description: 'Append one log entry' },
        log_type: { type: 'string', enum: ['info', 'error', 'success'] },
      },
    },
  },
];

// ── MCP Server ────────────────────────────

const server = new Server(
  { name: 'agentlimb', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  await ensureTerminalRegistered();

  try {
    switch (name) {
      case 'browser_observe':  return await handleObserve(args);
      case 'browser_act':      return await handleAct(args);
      case 'browser_eval':     return await handleEval(args);
      case 'browser_muscle':   return await handleMuscle(args);
      case 'browser_report':   return await handleReport(args);
      default:                 return text(`Unknown tool: ${name}. Available: browser_observe, browser_act, browser_eval, browser_muscle, browser_report`);
    }
  } catch (e) {
    return text(`Error: ${e.message}\n\nIs the bridge running? Start with: cd bridge && node server.js`);
  }
});

// ── Tool Handlers ─────────────────────────

async function handleObserve(args) {
  const data = await bridgeCmd('observe', {
    filter: args?.filter || 'interactive',
    screenshot: args?.screenshot || false,
  });
  if (!data.ok) return text(`Failed: ${data.error}`);

  const parts = [`URL: ${data.url}`, `Title: ${data.title}`, `Elements (${data.element_count}):`, data.tree || '(none)'];

  if (data.screenshot?.data_url) {
    const base64 = data.screenshot.data_url.replace(/^data:image\/\w+;base64,/, '');
    return {
      content: [
        { type: 'text', text: parts.join('\n') },
        { type: 'image', data: base64, mimeType: 'image/jpeg' },
      ],
    };
  }

  return text(parts.join('\n'));
}

async function handleAct(args) {
  if (args.type === 'navigate') {
    const data = await bridgeCmd('act', args, 20000);
    if (!data.ok) return text(`Navigate failed: ${data.error}`);
    return text(`Navigated to: ${data.final_url || args.url}`);
  }
  const data = await bridgeCmd('act', args);
  if (!data.ok) {
    if (data.requires_human) return text(`Requires user action: ${data.error}`);
    return text(`Action failed: ${data.error}`);
  }
  const desc = args.type === 'click' ? `Clicked ${args.selector || `ref_${args.ref_id}`}`
    : args.type === 'type' ? `Typed "${(args.value || '').slice(0, 40)}" into ${args.selector || `ref_${args.ref_id}`}`
    : args.type === 'select' ? `Selected "${args.value}" in ${args.selector || `ref_${args.ref_id}`}`
    : `${args.type} done`;
  return text(desc);
}

async function handleEval(args) {
  if (!args.code) return text('Error: code is required. Example: eval("document.title")');
  const timeout = args.timeout_ms || 0;
  const data = await bridgeCmd('eval', { code: args.code, timeout_ms: timeout }, timeout ? timeout + 5000 : 15000);
  if (!data.ok) return text(`Eval failed: ${data.error}${data.last_result !== undefined ? `\nLast result: ${JSON.stringify(data.last_result)}` : ''}`);
  const result = data.result !== null && data.result !== undefined ? JSON.stringify(data.result, null, 2) : '(null)';
  return text(result);
}

async function handleMuscle(args) {
  const data = await bridgeCmd('muscle', args, args.action === 'run' ? 65000 : 15000);
  if (!data.ok) return text(`Muscle ${args.action} failed: ${data.error}${data.supported ? `\nSupported types: ${data.supported.join(', ')}` : ''}`);

  if (args.action === 'list') {
    const muscles = data.muscles || [];
    if (!muscles.length) return text('No muscles saved. Use muscle(action:"save") after successful exploration.');
    const list = muscles.map(r =>
      `[${r.id}] ${r.desc || r.name || r.id}${r.site ? ` | site: ${r.site}` : ''}${r.params?.length ? ` | params: ${r.params.join(', ')}` : ''}`
    ).join('\n');
    return text(`${muscles.length} muscles:\n${list}`);
  }

  if (args.action === 'save') {
    const r = data.muscle;
    return text(`Muscle saved: ${r.id} (${r.desc || r.name || r.id}) v${r.version} — ${(r.steps || r.actions || []).length} steps`);
  }

  if (args.action === 'run') {
    return text(`Muscle completed: ${data.message || data.muscle_id}${data.steps ? ` (${data.steps.length} steps)` : ''}`);
  }

  if (args.action === 'delete') {
    return text('Muscle deleted');
  }

  return text(JSON.stringify(data, null, 2));
}

async function handleReport(args) {
  const data = await bridgeCmd('report', args, 5000);
  if (!data.ok) return text(`Report failed: ${data.error}`);
  const parts = [];
  if (args.title) parts.push(`Task: ${args.title}`);
  if (args.steps) parts.push(`Steps: ${args.steps.filter(s => s.status === 'done').length}/${args.steps.length}`);
  if (args.log) parts.push(`Log: ${args.log}`);
  if (args.status) parts.push(`Status: ${args.status}`);
  return text(parts.join(' | ') || 'UI updated');
}

// ── Bridge HTTP ───────────────────────────

async function bridgeCmd(tool, args = {}, timeoutMs = 15000) {
  const headers = { 'Content-Type': 'application/json' };
  if (_terminalToken) headers['X-AgentLimb-Terminal'] = _terminalToken;

  const res = await fetch(`${BRIDGE}/browser/${tool}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...args, timeout_ms: timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 3000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bridge HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function text(t) {
  return { content: [{ type: 'text', text: t }] };
}

// ── Start ─────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
