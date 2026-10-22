/**
 * AgentLimb connection prompt builder
 *
 * This prompt is the plugin's whole "unpaired" interface: the user copies it
 * into their AI agent, and the agent installs the MCP, connects, and pairs.
 * Pure data + string building — shared by the side panel, importable in Node.
 */

import { HOST_TOOLS } from '../control/host/tools.js';

const DEFAULT_HOST_PATH = '~/.agentlimb/host/mcp-server.mjs';

function toolLines() {
  return HOST_TOOLS.map((t) => `- \`${t.name}\` — ${firstSentence(t.description)}`).join('\n');
}

function firstSentence(text) {
  const idx = text.indexOf('. ');
  return idx > 0 && idx < 160 ? text.slice(0, idx + 1) : text.slice(0, 160);
}

/**
 * @param {{hostPath?:string, lang?:'zh'|'en', appName?:string, version?:string}} ctx
 * @returns {string} markdown prompt
 */
export function buildConnectionPrompt(ctx = {}) {
  const hostPath = ctx.hostPath || DEFAULT_HOST_PATH;
  const lang = ctx.lang === 'en' ? 'en' : 'zh';
  const tools = toolLines();
  const appName = ctx.appName || 'AgentLimb';

  if (lang === 'en') {
    return `# ${appName} — Browser Control Setup

You can control the user's Chrome browser through ${appName}'s MCP server.

## 1. Install the MCP (one time)
Add this MCP server config to your agent software (any MCP-capable client):

\`\`\`json
{
  "mcpServers": {
    "agentlimb": {
      "command": "node",
      "args": ["${hostPath}"]
    }
  }
}
\`\`\`

(\`~\` expands to the user's home directory. Optional env vars \`AGENTLIMB_CLIENT_NAME\` / \`AGENTLIMB_CLIENT_KIND\` identify you during pairing.)

## 2. Connect & pair
- Starting the MCP server automatically connects to the browser extension over a local channel (127.0.0.1).
- The FIRST connection requires the user to confirm pairing — a pairing tab pops up in their browser. Wait for them to confirm.
- After the first pairing, reconnections are automatic.

## 3. Tools
${tools}

## 4. Rules
- Call \`tabs_context\` first to see tabs; use \`tab_new\` to open a background tab for your work so the user's current tab is never disturbed.
- Use \`read_page\` / \`find\` to understand the page, then \`computer\` / \`form_input\` to act. Prefer \`browser_batch\` for predictable sequences.
- The user may send you messages from the extension's side panel; they arrive attached to your next tool result as \`userMessages\`. Treat them as new instructions.
- If the user presses STOP in the browser, halt browser actions immediately.
- Never ask the user to click things you can do yourself with the tools above.

## 5. Verify
Run the \`ping\` tool once. If it returns pong, the link is live — wait for the user's mission.`;
  }

  return `# ${appName} — 浏览器控制接入

你现在可以通过 ${appName} 的 MCP 服务器控制用户的 Chrome 浏览器。

## 1. 安装 MCP（一次性）
把下面的 MCP 服务器配置添加进你的智能体软件（任何支持 MCP 的客户端）：

\`\`\`json
{
  "mcpServers": {
    "agentlimb": {
      "command": "node",
      "args": ["${hostPath}"]
    }
  }
}
\`\`\`

（\`~\` 表示用户主目录；可选环境变量 \`AGENTLIMB_CLIENT_NAME\` / \`AGENTLIMB_CLIENT_KIND\` 用于在配对时标识自己）

## 2. 连接与配对
- 启动 MCP 后会通过本地通道（127.0.0.1）自动连接浏览器扩展。
- 首次连接需要用户在浏览器中确认配对（会自动弹出配对标签页），请等待用户确认。
- 首次配对成功后，后续重连全自动，无需重复确认。

## 3. 工具
${tools}

## 4. 规则
- 先用 \`tabs_context\` 查看标签；用 \`tab_new\` 开一个后台标签干活，不要打扰用户当前标签。
- 用 \`read_page\` / \`find\` 理解页面，再用 \`computer\` / \`form_input\` 操作；连续动作用 \`browser_batch\` 一次提交。
- 用户可以从插件侧栏给你发消息，会随你下一次工具结果以 \`userMessages\` 字段返回，视为新指令。
- 用户在浏览器里按了「停止」时，立即停止浏览器操作。
- 能用工具做的事，不要麻烦用户手动点。

## 5. 验证
调用一次 \`ping\`，返回 pong 即链路就绪——然后等待用户下达任务。`;
}

export function detectLang() {
  try {
    const ui = chrome.i18n.getUILanguage() || '';
    return ui.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch (_) {
    return 'zh';
  }
}
