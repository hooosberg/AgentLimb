import readline from 'node:readline';

import { HOST_TOOLS } from '../kernel/control/host/tools.js';
import { createMvpHttpClient } from '../kernel/bridge/mvp/client.js';

const PROTOCOL_VERSION = '2025-03-26';

export async function runMcpServer({ host = 'http://127.0.0.1:7791' } = {}) {
  const client = createMvpHttpClient({ baseUrl: host });
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of input) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
      const response = await handleRequest(request, client);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      const id = request?.id ?? null;
      process.stdout.write(`${JSON.stringify(errorResponse(id, -32603, error instanceof Error ? error.message : String(error)))}\n`);
    }
  }
}

async function handleRequest(request, client) {
  if (request?.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return errorResponse(request?.id ?? null, -32600, 'Invalid JSON-RPC request.');
  }

  if (request.method === 'notifications/initialized') return null;
  if (request.method === 'initialize') {
    return success(request.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'agentlimb', version: '0.2.1-b2' },
    });
  }
  if (request.method === 'tools/list') {
    return success(request.id, {
      tools: HOST_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }
  if (request.method === 'tools/call') {
    const name = request.params?.name;
    const tool = HOST_TOOLS.find((entry) => entry.name === name);
    if (!tool) return errorResponse(request.id, -32602, `Unknown AgentLimb tool: ${name}`);
    try {
      const response = await client.callBrowserTool({
        tool: name,
        params: request.params?.arguments || {},
        source: 'mcp',
        timeoutMs: 30000,
      });
      const result = response.completed?.call?.result ?? response.completed;
      return success(request.id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      });
    } catch (error) {
      return success(request.id, {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      });
    }
  }

  return errorResponse(request.id, -32601, `Unsupported MCP method: ${request.method}`);
}

function success(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
