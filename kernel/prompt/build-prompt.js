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

**IMPORTANT — replace \`~\` with the user's absolute home directory path.** JSON configs are passed to the process directly (no shell), so \`~\` is NOT expanded and \`node\` will fail with MODULE_NOT_FOUND. Examples: macOS \`/Users/<username>/.agentlimb/host/mcp-server.mjs\`, Linux \`/home/<username>/...\`, Windows \`C:\\Users\\<username>\\.agentlimb\\host\\mcp-server.mjs\`. If you cannot determine the home directory, ask the user for it.

After editing the config, restart the agent software so the new MCP server is picked up.

Optional env vars \`AGENTLIMB_CLIENT_NAME\` / \`AGENTLIMB_CLIENT_KIND\` identify you during pairing.

## 2. Connect & pair
- Starting the MCP server automatically connects to the browser extension over a local channel (127.0.0.1).
- The FIRST connection requires the user to confirm pairing — a pairing tab pops up in their browser. Wait for them to confirm.
- After the first pairing, reconnections are automatic.

## 3. Tools
${tools}

## 4. Rules
- Call \`tabs_context\` first to see tabs; use \`tab_new\` to open a background tab for your work so the user's current tab is never disturbed.
- Use \`read_page\` / \`find\` to understand the page, then \`computer\` / \`form_input\` to act. Prefer \`browser_batch\` for predictable sequences.
- The user can talk to you from the side panel. Each such message arrives with the page they are looking at (title, URL, visible text excerpt and interactive refs) — answer from that context; call \`read_page\` only if you need more.
- Reply to panel messages with the \`say\` tool: it renders in their chat window, which is a real conversation with you. Keep replies short and in the user's language.
- If the user presses STOP in the browser, halt browser actions immediately.
- Never ask the user to click things you can do yourself with the tools above.

## 5. Verify
Run the \`ping\` tool once.
- If it returns pong, the link is live — wait for the user's mission.
- If it fails with \`no paired browser\`, ask the user to open the ${appName} side panel and confirm the pairing popup.
- If it fails with \`no browser extension connected\`, the ${appName} Chrome extension is not installed or Chrome is not running — ask the user to check chrome://extensions.`;
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

**重要：把 \`~\` 替换成用户主目录的绝对路径。** JSON 配置是直接传给进程的（不过 shell），\`~\` 不会被展开，node 会报 MODULE_NOT_FOUND。示例：macOS \`/Users/<用户名>/.agentlimb/host/mcp-server.mjs\`，Linux \`/home/<用户名>/...\`，Windows \`C:\\Users\\<用户名>\\.agentlimb\\host\\mcp-server.mjs\`。拿不到主目录路径就问用户。

改完配置后重启智能体软件，新 MCP 才会生效。

（可选环境变量 \`AGENTLIMB_CLIENT_NAME\` / \`AGENTLIMB_CLIENT_KIND\` 用于在配对时标识自己）

## 2. 连接与配对
- 启动 MCP 后会通过本地通道（127.0.0.1）自动连接浏览器扩展。
- 首次连接需要用户在浏览器中确认配对（会自动弹出配对标签页），请等待用户确认。
- 首次配对成功后，后续重连全自动，无需重复确认。

## 3. 工具
${tools}

## 4. 规则
- 先用 \`tabs_context\` 查看标签；用 \`tab_new\` 开一个后台标签干活，不要打扰用户当前标签。
- 用 \`read_page\` / \`find\` 理解页面，再用 \`computer\` / \`form_input\` 操作；连续动作用 \`browser_batch\` 一次提交。
- 用户会从插件侧栏跟你说话。这类消息自带他眼前的页面（标题、URL、可见文本摘录、可交互元素 ref）——直接用这些回答；需要更多细节再调 \`read_page\`。
- 回复侧栏消息要用 \`say\` 工具：你的话会显示在用户的聊天窗里，那是一个真正的对话窗口。回复简短、用用户的语言。
- 用户在浏览器里按了「停止」时，立即停止浏览器操作。
- 能用工具做的事，不要麻烦用户手动点。

## 5. 验证
调用一次 \`ping\`。
- 返回 pong：链路就绪——等待用户下达任务。
- 报错 \`no paired browser\`：请用户打开 ${appName} 侧栏，确认弹出的配对页。
- 报错 \`no browser extension connected\`：${appName} 扩展没装或 Chrome 没运行——请用户检查 chrome://extensions。`;
}

export function detectLang() {
  try {
    const ui = chrome.i18n.getUILanguage() || '';
    return ui.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch (_) {
    return 'zh';
  }
}
