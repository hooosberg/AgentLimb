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

test('connection prompt: generic, no vendor branding, embeds host path', () => {
  const prompt = buildConnectionPrompt({ hostPath: '~/.agentlimb/host/mcp-server.mjs', lang: 'zh' });
  assert.match(prompt, /~\/\.agentlimb\/host\/mcp-server\.mjs/);
  assert.match(prompt, /mcpServers/);
  // The ~ placeholder must come with an explicit "replace with absolute path"
  // warning — JSON configs are spawned without a shell, ~ is NOT expanded.
  assert.match(prompt, /替换成用户主目录的绝对路径/);
  assert.match(prompt, /重启智能体软件/);
  // Product is vendor-neutral: no third-party agent brands anywhere in user-facing copy.
  for (const brand of ['claude', 'Claude', 'cursor', 'Cursor', 'windsurf', 'Windsurf']) {
    assert.ok(!prompt.includes(brand), `prompt must not mention ${brand}`);
  }
  assert.match(prompt, /智能体软件/);
  const en = buildConnectionPrompt({ lang: 'en' });
  assert.match(en, /agent software/);
  assert.match(en, /replace `~` with the user's absolute home directory path/i);
  assert.match(en, /restart the agent software/i);
  assert.ok(!en.includes('claude'));
});
