import test from 'node:test';
import assert from 'node:assert/strict';

import { HOST_TOOLS, findTool } from '../kernel/control/host/tools.js';
import { buildConnectionPrompt } from '../kernel/prompt/build-prompt.js';

test('tool catalog: unique names and valid schemas', () => {
  const names = HOST_TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'duplicate tool names');
  for (const tool of HOST_TOOLS) {
    assert.ok(tool.description && tool.description.length > 10, `${tool.name} needs a description`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} schema must be an object`);
    assert.ok(tool.inputSchema.properties, `${tool.name} needs properties`);
    // required fields must exist in properties
    for (const req of tool.inputSchema.required || []) {
      assert.ok(tool.inputSchema.properties[req], `${tool.name}: required "${req}" missing from properties`);
    }
  }
});

test('tool catalog: the lean 16-tool set', () => {
  assert.deepEqual(
    HOST_TOOLS.map((t) => t.name).sort(),
    [
      'browser_batch', 'computer', 'find', 'form_input', 'javascript_eval',
      'navigate', 'ping', 'read_console_messages', 'read_network_requests',
      'read_page', 'say', 'tab_activate', 'tab_close', 'tab_new', 'tabs_context', 'wait',
    ].sort(),
  );
  assert.ok(findTool('computer'));
  assert.equal(findTool('nope'), null);
});

test('connection prompt: generic, English only, embeds host path', () => {
  const prompt = buildConnectionPrompt({ hostPath: '~/.agentlimb/host/mcp-server.mjs' });
  assert.match(prompt, /~\/\.agentlimb\/host\/mcp-server\.mjs/);
  assert.match(prompt, /mcpServers/);
  // The ~ placeholder must come with an explicit "expand it yourself" warning —
  // MCP servers are spawned without a shell, ~ is NOT expanded.
  assert.match(prompt, /expand `~` into the user's absolute home directory/);
  // Restart comes BEFORE any "look for it in a UI" instruction: most products
  // only read MCP config at startup, so asking the user to find a connector
  // first shows them an empty list and looks like a failed install.
  assert.match(prompt, /restart the software \(or run its "reload MCP servers" action\) first/i);
  assert.match(prompt, /Never quote a menu path that belongs to a different product/);
  assert.match(prompt, /no_matching_mcp/);
  assert.match(prompt, /Name the exact place for the software you are running in one sentence/);
  assert.match(prompt, /trusted automatically/);
  assert.match(prompt, /Connected\. You can now ask me directly/);
  assert.match(prompt, /Do not mechanically request another restart/);
  assert.match(prompt, /install --client-name/);
  assert.match(prompt, /tools\/call/);
  assert.match(prompt, /proves this agent can control Chrome/);
  // Product is vendor-neutral: no third-party agent brands anywhere in user-facing copy.
  for (const brand of ['claude', 'Claude', 'cursor', 'Cursor', 'windsurf', 'Windsurf']) {
    assert.ok(!prompt.includes(brand), `prompt must not mention ${brand}`);
  }
  assert.match(prompt, /agent software/);
  // The prompt is English-only by product decision (docs/product.md).
  assert.ok(!/[\u4e00-\u9fff]/.test(prompt), 'prompt must not contain CJK characters');
  assert.ok(!/[「」【】（）、，。：；]/.test(prompt), 'prompt must not contain CJK punctuation');
});

test('the prompt never sends the agent to an approval page or a pasted code', () => {
  // Even if a caller still passes a token, nothing secret may leak into the
  // prompt: authorization happens in the side panel, not in a config file.
  const prompt = buildConnectionPrompt({ pairingToken: 'f'.repeat(64) });
  assert.ok(!prompt.includes('f'.repeat(64)));
  assert.ok(!/AGENTLIMB_PAIRING_TOKEN|--pairing-token/.test(prompt));
  assert.match(prompt, /30-minute authorization window/);
  assert.match(prompt, /never wait for an approval page/);
  assert.match(prompt, /not authorized/);
  assert.match(prompt, /click the copy-prompt button/);
  assert.ok(!/pairing page/.test(prompt));
  assert.ok(!/[\u4e00-\u9fff]/.test(prompt));
});
