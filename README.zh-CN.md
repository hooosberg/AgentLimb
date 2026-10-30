# AgentLimb

[![GitHub stars](https://img.shields.io/github/stars/hooosberg/AgentLimb?style=flat-square)](https://github.com/hooosberg/AgentLimb/stargazers)
[![GitHub](https://img.shields.io/badge/GitHub-hooosberg%2FAgentLimb-blue?style=flat-square&logo=github)](https://github.com/hooosberg/AgentLimb)

[English](./README.md) · **简体中文**

**官网 / 产品页（落地页）→ https://hooosberg.com/apps/agentlimb/** · [下载最新版](https://github.com/hooosberg/AgentLimb/releases/latest) · [旧版官网](https://agentlimb.com/)

当前源码版本：**0.7.0 / l19**（变更记录见 [CHANGELOG.md](./CHANGELOG.md)）。

通用浏览器控制插件：给任意支持 MCP 的智能体软件装上「手」，让它能控制你的 Chrome。

**复制提示词即完成首次授权，之后可自动重连。** 智能体软件里的 MCP 启用/信任仍由该软件处理；复制打开的 30 分钟窗口内，第一个连上来的 AI 自动受信，全程没有确认页也没有配对码。侧边栏没连接时提供接入提示，连接后变成聊天窗。
侧边栏开不开，AI 都能干活——它会在自己的后台标签页里操作，不打扰你当前看的页面。

---

## 快速开始

```bash
# 1. 检查 Node.js >=18，然后安装本地 MCP 宿主并生成配置 JSON
node --version
bash scripts/install.sh --client-name "WorkBuddy" --client-kind "workbuddy"
# Windows: powershell -ExecutionPolicy Bypass -File scripts/install.ps1 --client-name WorkBuddy --client-kind workbuddy

# 2. Chrome 加载插件
#    chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择本目录
#    Windows：本目录必须放在纯英文路径（如 C:\AgentLimb）
#    路径含中文会加载失败，详见下方说明

# 3. 点击插件侧栏的「复制连接提示词」，把提示词交给目标智能体
#    复制本身就授权了这次接入（30 分钟窗口），提示词里没有任何码要填进配置
#    在软件要求时启用/信任 MCP，并按需重载

# 4. 从当前智能体会话调用 AgentLimb ping 与 tabs_context 验收；不会出现任何确认页
```

安装器只负责安装宿主文件和打印 JSON，不会写入任何智能体软件配置。复制提示词打开的接入窗口 30 分钟有效、只授权一个 AI；窗口过期就再点一次复制，不需要改配置或重启。客户端配置格式、MCP 启用/信任入口由各软件决定；不要把通用 JSON 示例当成已启用。

> **Windows 用户注意：插件目录必须解压到纯英文路径**（如 `C:\AgentLimb`）。
> 路径含非 ASCII 字符——最常见的是中文用户名，如 `C:\Users\张三\Desktop`——会让 Chrome 拒绝加载，报
> `Could not load javascript 'kernel/control/content/a11y-tree.js' for script.`
> 含空格不影响；macOS / Linux 不受此限制。已在真实 Windows（Edge 155 / Chrome 156）实测确认。

本地调试（不装 Claude Code 也能跑）：

```bash
node bin/agentlimb.mjs mcp       # stdio MCP；收到 initialize 后启动桥接
node bin/agentlimb.mjs status    # 探测桥接是否在线
npm test                         # 协议端到端测试（含模拟扩展）
```

## 连不上时按顺序排查

每一步只排除一个阶段，前一阶段通过不代表后一阶段可用。

| 现象 | 含义 | 怎么办 |
|---|---|---|
| Windows 上扩展加载失败，报 `Could not load javascript …` | 插件目录路径含中文（非 ASCII 字符） | 把目录挪到纯英文路径（如 `C:\AgentLimb`）再加载；含空格不影响 |
| 工具调用返回「未授权」 | 30 分钟接入窗口过期，或已被另一个 AI 用掉 | 再点一次「复制连接提示词」，不用改配置或重启 |
| 软件里能看到 AgentLimb，但工具没反应 | 配置合并了，但该软件没启用/信任 MCP，或进程没起来 | 在软件里启用并信任 MCP，然后重启它的 MCP 进程 |
| 完全没有反应 | 宿主可能不在配置指向的位置 | `node bin/agentlimb.mjs status`，并确认 `~/.agentlimb/host/mcp-server.mjs` 存在 |
| 第二个 AI 接不过来 | 第一个 AI 忙时，controller 独占浏览器任务锁 | 等当前任务结束；忙碌时拒绝强切是设计如此 |
| 首次连接要等一会 | Service Worker 当时在休眠 | 打开侧栏即可唤醒，否则最长约 1 分钟自动连上 |

只有你真正要用的那个会话里 `ping` 与 `tabs_context` 成功，才算连接可用。端口可达、信任文件存在、别的客户端连上，都不能替代这一步。

---

## 架构

```
┌─────────────┐  stdio MCP   ┌──────────────────────┐  SSE(推送)  ┌─────────────────────┐
│ 智能体软件   │ ◄──────────► │  host/mcp-server.mjs │ ◄───────── │ 扩展 Service Worker  │
│ (任意客户端) │  JSON-RPC    │  host/bridge-server  │  POST(回传) │ debugger 持久会话     │
└─────────────┘              └──────────────────────┘            │ + content scripts    │
                        127.0.0.1:8765-8780(最多16个宿主)         └─────────────────────┘
```

三个角色，零依赖（纯 Node 内置模块 + 原生 JS，无 npm 包）：

| 层 | 文件 | 职责 |
|---|---|---|
| 扩展后台 | `kernel/control/background/` | 桥接客户端(SSE/POST)、CDP debugger 管理、工具路由 |
| 页面脚本 | `kernel/control/content/` | a11y 树生成（document_start 常驻）、控制指示器 |
| 侧栏 | `ui/sidepanel/` | 连接提示词、按 AI 隔离的聊天、客户端管理、设置（无确认页） |
| 本地宿主 | `host/` `bin/` | MCP stdio 服务器 + 本地 HTTP/SSE 桥接 |
| 共享 | `kernel/shared/constants.js` `kernel/control/host/tools.js` `kernel/prompt/` | 协议常量、工具目录（双端同源）、提示词生成 |

### 安装、客户端信任与浏览器授权是不同阶段

安装器部署 `~/.agentlimb` 并打印 `mcpServers.agentlimb` 配置。用户把它合并到目标软件的真实配置后，还需按软件要求启用/信任 MCP。侧栏的「复制连接提示词」同时完成授权：扩展打开一个 30 分钟窗口，窗口内第一个连上来的未知 AI 自动受信，**没有确认页、没有配对码**。窗口过期或已被用掉时，工具调用会立刻返回「未授权」，让用户再点一次复制即可，不用改配置或重启。只有当前目标会话调用 `ping` 和 `tabs_context` 成功，才证明连接可用。

宿主为客户端名称与类型组合建立稳定身份文件；旧版共享 `client-id.json` 不会继承信任。同身份已存信任可自动重连，且不会抢当前聊天窗；新身份需要一次接入窗口。运行时旧目录、可达端口、信任文件或其他客户端成功，都不能单独证明当前客户端已经连接。

扩展最多同时连接六个 MCP 宿主并保留各自 trust；`connectedClientId` 标记唯一 controller。已信任客户端握手不自动抢控制，显式切换仅在任务空闲时生效；忙碌时拒绝强切。其他客户端非 `ping` 工具按宿主 deadline 排队，过期不执行。

## 交互原则

- **侧边栏与控制彻底解耦**：工具调用走 SW ↔ 桥接，与侧栏是否打开无关。
- **未连接**：侧栏提供复制提示词；顶部还可打开设置。
- **已连接**：侧栏就是和当前 controller 的聊天窗。顶栏保留复制提示词和设置入口，并显示当前 AI 与已配对数量。每条消息自动带上
  当前标签的截图 + 标题/URL + 正文摘录 + 可交互元素 ref，所以「这页讲什么」「帮我点这个」
  都不需要先截图或先报标签。Enter 发送、Shift+Enter 换行。
- **AI 的回复回到同一个窗口**（`say` 工具），操作过程折叠成一行「执行了 N 步操作」，
  点开才展开——聊天流不被日志淹没。
- **页面内的控制反馈**：辉光边框 + 幽灵光标，用户在哪个标签都能看到 AI 在动哪个标签。
- **多客户端信任独立保留**：临时断线和 MCP 退出只标记离线；设置里的移除仅撤销所选客户端信任。
- **单 controller 串行执行**：另一个已信任客户端不会因启动或握手自动抢控制。用户可在空闲时切换；忙碌时不强切。新配对客户端等待当前任务结束后接管。`ping` 只检查，不抢控制。

## 效率设计（对照参考实现的关键优化）

旧版（已归档的 0.2 时代代码）的控制链路是 HTTP 轮询，每一跳都有损耗。本版逐项修正：

| # | 旧版问题 | 本版方案 |
|---|---|---|
| 1 | SW 每 300ms 轮询桥接队列，加 50ms 忙轮询；SW 挂起靠 alarm 重启 relay | SSE 长连接推送，host→ext 零延迟；POST 回传；alarm 只做兜底唤醒 |
| 2 | 每个动作 `debugger.attach` + `detach`（每次 10–50ms，且和 DevTools 抢锁） | **按标签持久 attach**，in-flight 去重，仅在被 Chrome 踢掉时重连 |
| 3 | 内容脚本按需注入，每次快照都问一遍 | manifest `document_start` 全帧常驻 a11y 脚本，ref 映射用 WeakMap 缓存 |
| 4 | 只能操作前台标签 | `Emulation.setFocusEmulationEnabled` 焦点模拟 + 自动静音，**后台标签可操控**，不抢用户焦点 |
| 5 | 截图固定 PNG，动辄超限 | JPEG 自适应质量（75→10 降级），base64 预算 ~1.2MB |
| 6 | 一步一个工具调用，来回 RTT 叠加 | `browser_batch` 一次提交最多 20 个动作 |
| 7 | task_plan / task_step_done / task_complete / task_fail 四个工具 + 侧栏进度渲染纯开销 | **整个进度机制移除**（14 个浏览器工具，另有本地 `say` 与 `ping`） |
| 8 | muscle 记忆三件套常驻工具列表 | 本版移除（需要时可从归档分支 `archive/cowork-local` 迁回，做成开关） |

其他细节：CDP 命令全部带超时；console/network 在持久会话上常驻捕获（环形缓冲 200 条）；
密码/敏感字段在 a11y 树里直接脱敏；同源 iframe 与 shadow DOM 可走入树并带坐标偏移。

## 工具清单（17 个，含本地 `say`、连通检查 `ping` 与 `site_memory`）

`tabs_context` `tab_new` `tab_close` `tab_activate` `read_page` `find` `computer`
`form_input` `navigate` `javascript_eval` `wait` `read_console_messages`
`read_network_requests` `browser_batch` `say` `site_memory` `ping`

目录定义在 `kernel/control/host/tools.js`，扩展和 MCP 宿主共用同一份——改一处，两端同步。
`site_memory` 不碰浏览器，只读写下面的网站记忆。

## 网站记忆（Site memory）

本机的一个纯 Markdown 文件夹，让任何接了 MCP 的 AI 复用「这个网站怎么操作」：直达 URL、元素锚点、坑、成功判定。

- **安装即带**：`agentlimb install` 默认在 `~/.agentlimb/memory` 建库（`--memory-root <目录>` 改位置，`--no-memory` 跳过）；`agentlimb memory` 查看位置与已记录站点。
- **以软提示词注入，不是插件功能**：开启时 MCP `initialize` 的 `instructions` 会带上「先查手册 → 再动手 → 按增量写回」。任何 MCP 客户端连上就收到，**不需要给每个 AI 工具单独装 skill**；在侧栏关掉，这段提示立刻消失。
- **一个网站一个文件，约 100 行**：入口、步骤、锚点、坑、成功判定。运行日志每次一行、不参与检索——`brief` 只读一个文件（433 站实测约 13ms），**记录再多也不会拖慢操作**。
- **不绑定 AgentLimb**：目录就是合法的 `kb` 库布局，换浏览器 MCP、换 AI 工具、或独立的 CLI 都能读同一份。
- **只记操作知识**：不记账号、密码、Cookie、Token、验证码，也不记网站上抓到的内容。连续失败 2 次自动标 `stale`，下次先验锚点再照做。

## 多浏览器 / 多账号路由（Multi-browser routing）

80% 的单浏览器用户完全零感知；当你同时打开 2 个及以上 Chrome 账号配置文件（均安装 AgentLimb，例如多账号运营场景）时，无需修改 MCP 配置即可同时或分别操控多个浏览器：

- **自动识别账号 + 侧栏一键复制与改名**：每个 Chrome 配置文件自动生成持久标识（`Profile-xxxxxx`），并尝试读取当前登录的 Google 账号邮箱作为默认名称。侧栏底部常驻极简「当前浏览器」标识条，**点击即可一键复制标识**发给 AI，点击「改名」（或进入「设置 → 高级」）可自定义简短备注名（如 `work`、`personal`），保存后实时同步给宿主。
- **工具层可选 `browser` 参数**：全部 16 个浏览器工具（含 `navigate`、`tabs_context`、`computer`、`say`、`ping` 等）均支持传入可选参数 `browser`（支持精确 ID、精确名称或无歧义子串匹配，如 `"work"` 自动匹配 `"work@example.com"`），可并行或顺序驱动不同浏览器。
- **双通道自动提示与消歧**：当同时有 2 个及以上浏览器在线时，工具返回结果会自动注入 `MULTI-BROWSER (auto)` 提示，列出所有在线浏览器的名称与 ID；若你的指令没有指明操作哪个浏览器，AI 会先向你确认目标浏览器再执行操作。

## 目录

```
manifest.json                  MV3（debugger / sidePanel / tabGroups / alarms）
kernel/shared/constants.js     协议常量、SSE 帧类型、storage keys
kernel/control/host/tools.js   工具目录（唯一事实源）
kernel/control/background/
  service-worker.js            入口：装配 + 消息路由 + alarm 保活
  bridge-client.js             端口发现、SSE、配对管理、user_message 队列
  debugger.js                  持久 attach / 焦点模拟 / 自适应截图 / 事件捕获
  router.js                    14 个浏览器工具的执行器
kernel/control/content/
  a11y-tree.js                 document_start 全帧注入：ref 映射 + 可访问性树
  indicator.js                 辉光边框 / 幽灵光标 / 停止按钮
kernel/prompt/build-prompt.js  侧栏复制的连接提示词（中英）
ui/sidepanel/                  连接引导、当前 AI 聊天和多客户端设置
host/bridge-server.mjs         HTTP+SSE 桥接、信任注册表、tool_call 关联
host/mcp-server.mjs            stdio MCP ↔ 桥接
bin/agentlimb.mjs              CLI：install / config / doctor / mcp / status / pair-status / uninstall
host/install.mjs               共享安装逻辑与 MCP JSON 配置生成
host/diagnostics.mjs           只读连接阶段诊断
scripts/install.sh|ps1         Node 版本检查后委托 CLI 安装
tests/                         Node 原生 test runner，含端到端协议测试
```

## 验收边界

- `npm test` 是自动化协议和模块测试；`node scripts/live-test.mjs` 使用独立临时 HOME、Chrome profile、扩展副本及端口进行浏览器/MCP 集成测试，并清理本轮临时数据，不触碰日常 `~/.agentlimb` 安装。
- 已有 81/81 的 live 报告属于此前单客户端基线，不代表当前 0.7.0/l19 的多客户端 Chrome 验收。当前自动化单元测试 Linux 侧 117/117、Windows 侧全绿守护；多客户端真实 Chrome 验收仍在进行，尚无结果可报告。
- 网站记忆有独立的真实模型冒烟（不需要浏览器）：`npm run smoke:memory`（czen/hy3，20/20）。它证明模型真的调用 `site_memory`、手册真的落盘（入口/锚点/坑齐全且无凭据）、**全新会话能读回来**、关掉开关后工具会明确拒绝。浏览器那一半（配对 → 点击 → 输入）仍在 `node scripts/ai-onboarding-test.mjs`。
- 真实智能体客户端中的配置加载/信任，以及指定模型和猴子测试仍需独立验收；没有观测证据时不宣称通过。

## 已知边界

- 同时最多发现 `BRIDGE_PORTS` 定义的候选 MCP 宿主（8765~8780，防 Winsock 端口枯竭）；一个 controller 独占当前浏览器任务锁。不同 AI 的信任、聊天记录与草稿隔离。
- 侧栏聊天是「留言」语义：消息随 Agent 下一次工具结果送达（Agent 空闲时不会主动推送）。
- `javascript_eval` 走 CDP，对 CSP 严格的页面仍可执行（debugger 权限）。
- 首次连接依赖 SW 被唤醒：装好后 Chrome 运行时 SW 基本常驻；若遇休眠，最长约 1 分钟内自动连上（打开侧栏可立即触发）。

## 与旧版的关系

本仓库 `main` 分支就是当前维护线（即此工作树的内容）。0.2 时代的旧版（cowork_local）
已归档到分支 [`archive/cowork-local`](https://github.com/hooosberg/AgentLimb/tree/archive/cowork-local)，
不再更新；它刻意保留的资产（任务进度机制、muscle 网页记忆、HTTP 轮询桥接、
12 语言 i18n、agentlimb.com 官网）需要时可按需迁回。

## 链接

| | |
|---|---|
| 官网 / 产品页（落地页） | https://hooosberg.com/apps/agentlimb/ |
| GitHub | https://github.com/hooosberg/AgentLimb |
| 旧版官网（0.2 时代，含教程 / 工具目录 / 新闻） | https://agentlimb.com/ |

**觉得 AgentLimb 好用，就请去 GitHub 点个 ⭐ Star**——这是对独立开发最大的鼓励，
也决定这个项目会不会继续更新：https://github.com/hooosberg/AgentLimb
