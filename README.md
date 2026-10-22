# AgentLimb (Lite)

通用浏览器控制插件：给任意支持 MCP 的智能体软件装上「手」，让它能控制你的 Chrome。

**一次配对，长期自动化。** 侧边栏只做两件事：没连接时复制提示词，连接后变成聊天窗。
侧边栏开不开，AI 都能干活——它会在自己的后台标签页里操作，不打扰你当前看的页面。

---

## 快速开始

```bash
# 1. 安装本地宿主（~/.agentlimb，镜像仓库目录结构）
bash scripts/install.sh          # Windows: powershell scripts/install.ps1

# 2. Chrome 加载插件
#    chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择本目录

# 3. 点击插件图标打开侧栏 → 「复制连接提示词」→ 粘贴给你的智能体软件
#    （提示词里含 MCP 配置 JSON，任何 MCP 客户端都能用）

# 4. 首次连接：浏览器自动弹出配对标签页 → 点「允许连接」
#    之后同一智能体重连全自动，无需再确认
```

本地调试（不装 Claude Code 也能跑）：

```bash
node bin/agentlimb.mjs mcp       # 直接以 stdio 模式启动 MCP + 桥接
node bin/agentlimb.mjs status    # 探测桥接是否在线
npm test                         # 协议端到端测试（含模拟扩展）
```

---

## 架构

```
┌─────────────┐  stdio MCP   ┌──────────────────────┐  SSE(推送)  ┌─────────────────────┐
│ 智能体软件   │ ◄──────────► │  host/mcp-server.mjs │ ◄───────── │ 扩展 Service Worker  │
│ (任意客户端) │  JSON-RPC    │  host/bridge-server  │  POST(回传) │ debugger 持久会话     │
└─────────────┘              └──────────────────────┘            │ + content scripts    │
                        127.0.0.1:8765(自动选端口)                └─────────────────────┘
```

三个角色，零依赖（纯 Node 内置模块 + 原生 JS，无 npm 包）：

| 层 | 文件 | 职责 |
|---|---|---|
| 扩展后台 | `kernel/control/background/` | 桥接客户端(SSE/POST)、CDP debugger 管理、工具路由 |
| 页面脚本 | `kernel/control/content/` | a11y 树生成（document_start 常驻）、控制指示器 |
| 侧栏 | `ui/sidepanel/` `ui/pairing/` | 未配对=复制提示词；已配对=聊天窗；配对确认页 |
| 本地宿主 | `host/` `bin/` | MCP stdio 服务器 + 本地 HTTP/SSE 桥接 |
| 共享 | `kernel/shared/constants.js` `kernel/control/host/tools.js` `kernel/prompt/` | 协议常量、工具目录（双端同源）、提示词生成 |

### 配对即 MCP 安装

用户复制提示词 → 智能体把 MCP 配置加进自己的客户端 → 智能体启动时 spawn
`mcp-server.mjs` → 桥接在 127.0.0.1 起来 → 扩展连上 → 首次弹配对页 → 用户点允许
→ 写入 `~/.agentlimb/paired-clients.json` + 扩展 `chrome.storage` → **之后全自动**。

## 交互极简原则

- **侧边栏与控制彻底解耦**：工具调用走 SW ↔ 桥接，与侧栏是否打开无关。
- **未配对**：整个侧栏只有一个按钮——复制提示词。没有进度条、没有日志、没有步骤。
- **已配对**：侧栏变成聊天窗。发消息 = 给 Agent 下指令（随下一次工具结果送达）；
  另有「截图 / 标签列表 / 读取页面」三个本地快捷操作，不经过 Agent。
- **页面内的控制反馈**：辉光边框 + 幽灵光标 + 「停止智能体」按钮（参考主流
  agent 浏览器的做法），用户在哪个标签都能看到 AI 在动哪个标签。

## 效率设计（对照参考实现的关键优化）

旧版（`workspace` 分支）的控制链路是 HTTP 轮询，每一跳都有损耗。本版逐项修正：

| # | 旧版问题 | 本版方案 |
|---|---|---|
| 1 | SW 每 300ms 轮询桥接队列，加 50ms 忙轮询；SW 挂起靠 alarm 重启 relay | SSE 长连接推送，host→ext 零延迟；POST 回传；alarm 只做兜底唤醒 |
| 2 | 每个动作 `debugger.attach` + `detach`（每次 10–50ms，且和 DevTools 抢锁） | **按标签持久 attach**，in-flight 去重，仅在被 Chrome 踢掉时重连 |
| 3 | 内容脚本按需注入，每次快照都问一遍 | manifest `document_start` 全帧常驻 a11y 脚本，ref 映射用 WeakMap 缓存 |
| 4 | 只能操作前台标签 | `Emulation.setFocusEmulationEnabled` 焦点模拟 + 自动静音，**后台标签可操控**，不抢用户焦点 |
| 5 | 截图固定 PNG，动辄超限 | JPEG 自适应质量（75→10 降级），base64 预算 ~1.2MB |
| 6 | 一步一个工具调用，来回 RTT 叠加 | `browser_batch` 一次提交最多 20 个动作 |
| 7 | task_plan / task_step_done / task_complete / task_fail 四个工具 + 侧栏进度渲染纯开销 | **整个进度机制移除**（工具 15 个，对标主流 agent 浏览器工具集） |
| 8 | muscle 记忆三件套常驻工具列表 | 本版移除（需要时可从 `workspace` 分支迁回，做成开关） |

其他细节：CDP 命令全部带超时；console/network 在持久会话上常驻捕获（环形缓冲 200 条）；
密码/敏感字段在 a11y 树里直接脱敏；同源 iframe 与 shadow DOM 可走入树并带坐标偏移。

## 工具清单（15 个）

`tabs_context` `tab_new` `tab_close` `tab_activate` `read_page` `find` `computer`
`form_input` `navigate` `javascript_eval` `wait` `read_console_messages`
`read_network_requests` `browser_batch` `ping`

目录定义在 `kernel/control/host/tools.js`，扩展和 MCP 宿主共用同一份——改一处，两端同步。

## 目录

```
manifest.json                  MV3（debugger / sidePanel / tabGroups / alarms）
kernel/shared/constants.js     协议常量、SSE 帧类型、storage keys
kernel/control/host/tools.js   工具目录（唯一事实源）
kernel/control/background/
  service-worker.js            入口：装配 + 消息路由 + alarm 保活
  bridge-client.js             端口发现、SSE、配对管理、user_message 队列
  debugger.js                  持久 attach / 焦点模拟 / 自适应截图 / 事件捕获
  router.js                    15 个工具的执行器
kernel/control/content/
  a11y-tree.js                 document_start 全帧注入：ref 映射 + 可访问性树
  indicator.js                 辉光边框 / 幽灵光标 / 停止按钮
kernel/prompt/build-prompt.js  侧栏复制的连接提示词（中英）
ui/sidepanel/                  双状态侧栏
ui/pairing/                    配对确认标签页
host/bridge-server.mjs         HTTP+SSE 桥接、配对注册表、tool_call 关联
host/mcp-server.mjs            stdio MCP ↔ 桥接
bin/agentlimb.mjs              CLI：install / mcp / status / pair-status / uninstall
scripts/install.sh|ps1         安装宿主到 ~/.agentlimb
tests/                         Node 原生 test runner，含端到端协议测试
```

## 已知边界

- 同一时刻只有一个「活跃浏览器」：多个 Chrome 配置文件同时连接时，最后完成配对的获胜。
- 侧栏聊天是「留言」语义：消息随 Agent 下一次工具结果送达（Agent 空闲时不会主动推送）。
- `javascript_eval` 走 CDP，对 CSP 严格的页面仍可执行（debugger 权限）。
- 首次连接依赖 SW 被唤醒：装好后 Chrome 运行时 SW 基本常驻；若遇休眠，最长约 1 分钟内自动连上（打开侧栏可立即触发）。

## 与 workspace 分支的关系

本工作树（`lite` 分支）是重写的精简版，刻意放弃了：任务进度机制、muscle 记忆、
HTTP 轮询桥接、终端任务队列、12 语言 i18n、官网。这些资产保留在 `workspace` 分支，
需要时可按需迁回。
