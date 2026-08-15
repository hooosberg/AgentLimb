import { HOST_TOOLS } from '../../control/host/tools.js';
import { buildRulesSection } from '../../prompt/rules.js';
import { buildProtocolSection } from '../../prompt/protocol.js';
import { APP_NAME, APP_VERSION, CAPABILITIES } from '../../shared/constants.js';
import { getMuscleDir, listDomains } from './muscle-fs.js';
import process from 'node:process';

const BRIDGE_STARTED_AT = Date.now();

// ── Shared helpers ─────────────────────────────────────────────────────────────

function respondMarkdown(response, statusCode, body) {
  response.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  response.setHeader('Cache-Control', 'max-age=60');
  response.writeHead(statusCode);
  response.end(body);
}

function toolToMarkdown(tool) {
  const lines = [`### ${tool.name}`, '', tool.description];
  const schema = tool.inputSchema;
  if (schema?.properties) {
    const props = Object.entries(schema.properties);
    if (props.length > 0) {
      const required = new Set(schema.required || []);
      lines.push('', '| Param | Type | Required | Description |');
      lines.push('|-------|------|----------|-------------|');
      for (const [name, prop] of props) {
        const req = required.has(name) ? '✓' : '';
        const type = prop.enum
          ? prop.enum.map((v) => `\`${v}\``).join(' \\| ')
          : prop.type || 'any';
        const desc = (prop.description || '').replace(/\|/g, '\\|');
        lines.push(`| \`${name}\` | ${type} | ${req} | ${desc} |`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ── Route handlers ─────────────────────────────────────────────────────────────

export async function handleDocsTools(_request, response) {
  const lines = [
    `# AgentLimb Tool Catalog (${HOST_TOOLS.length} tools)`,
    '',
    'Fetch details: `curl -s http://127.0.0.1:7791/api/mvp/docs/tools/<name>`',
    '',
  ];
  for (const tool of HOST_TOOLS) {
    const summary = tool.description.split('\n')[0].slice(0, 80);
    lines.push(`- **${tool.name}** — ${summary}`);
  }
  respondMarkdown(response, 200, lines.join('\n'));
}

export async function handleDocsToolByName(_request, response, name) {
  const tool = HOST_TOOLS.find((t) => t.name === name);
  if (!tool) {
    const known = HOST_TOOLS.map((t) => t.name).join(', ');
    respondMarkdown(
      response,
      404,
      `# Unknown tool: ${name}\n\nKnown tools: ${known}\n\nFull list: \`curl -s http://127.0.0.1:7791/api/mvp/docs/tools\``,
    );
    return;
  }
  respondMarkdown(response, 200, toolToMarkdown(tool));
}

export async function handleDocsRules(_request, response) {
  respondMarkdown(response, 200, buildRulesSection());
}

export async function handleDocsProtocol(_request, response) {
  const note =
    '> **Note**: in the examples below, `agentlimb` is a placeholder. The actual client command is the `Client` field in the initial prompt you received.\n\n';
  respondMarkdown(
    response,
    200,
    note + buildProtocolSection({
      clientCommand: 'agentlimb',
      terminalName: 'Terminal',
      terminalType: 'claude-code',
      extensionOnline: true,
    }),
  );
}

export async function handleMeta(_request, response, context) {
  const uptimeMs = Date.now() - BRIDGE_STARTED_AT;
  const domains = await listDomains();
  const muscleDir = getMuscleDir();
  const baseUrl = context?.baseUrl || 'http://127.0.0.1:7791';

  const meta = {
    schemaVersion: 1,
    app: {
      name: APP_NAME,
      version: APP_VERSION,
    },
    platform: {
      os: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
    bridge: {
      url: baseUrl,
      startedAt: new Date(BRIDGE_STARTED_AT).toISOString(),
      uptimeMs,
    },
    capabilities: CAPABILITIES,
    tools: HOST_TOOLS.map((t) => ({
      name: t.name,
      description: t.description.split('\n')[0],
    })),
    muscle: {
      learnedDomains: domains.length,
      storagePath: muscleDir,
    },
    endpoints: {
      docs: `${baseUrl}/api/mvp/docs/*`,
      docsTool: `${baseUrl}/api/mvp/docs/tools/:name`,
      docsRules: `${baseUrl}/api/mvp/docs/rules`,
      docsProtocol: `${baseUrl}/api/mvp/docs/protocol`,
      muscleList: `${baseUrl}/api/mvp/muscle/list`,
      muscleRead: `${baseUrl}/api/mvp/muscle/read?domain=:domain`,
      status: `${baseUrl}/api/mvp/status`,
      meta: `${baseUrl}/api/mvp/meta`,
    },
  };

  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.writeHead(200);
  response.end(JSON.stringify(meta, null, 2));
}
