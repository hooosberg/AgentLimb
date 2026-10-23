# 变更记录

版本号规则：`APP_VERSION`（语义版本，用户可见）+ `APP_BUILD`（内部构建标记）。
两者定义在 `kernel/shared/constants.js`，`manifest.json` 与 `package.json` 必须同步镜像——
**改版本时只改这三个文件**，测试和文档都从这三个地方读，不需要逐处替换。

版本显示在侧栏「关于」页（`version_name`，形如 `0.5.7-l8`）和宿主 `/health` 的 `version` 字段。

> **改 manifest 的 `version` 有个额外好处**：Chrome 的扩展代码缓存键是「扩展 ID + 版本号 + 文件路径」，
> 所以每次 bump 都会顺带清掉缓存，避免「点了 ↻ 还在跑旧 SW」这类灵异问题。

---

## 0.5.7 / l8 — 2026-10-23

**全平台（macOS / Windows / Linux）与全类型智能体（IDE / 桌面 / 终端 CLI / 未来 Agent）配对提示词与通用性升级**

- **配对提示词新增 Fast Path（1 秒快速重连/切换）**：若当前会话工具列表中已加载 `agentlimb`（`ping`、`tabs_context`），直接跳过 Gate 0–2 进入 Gate 5（`ping` → `tabs_context` → `say`），无需重复查目录或读配置。
- **修复 Windows 下扩展 ID 路径哈希（UTF-16LE）与全平台浏览器 Profile 探测**：
  - Chromium 在 POSIX（macOS/Linux）下对路径 UTF-8 字节计算 SHA-256，而在 Windows 下对路径 UTF-16LE（`wchar_t`）字节计算 SHA-256。Gate 0 Step 2 的 `ID_FILTER` 现同时校验 UTF-8 与 UTF-16LE（含盘符大小写归一化），Windows PowerShell / Unix 均可精确反查源码目录。
  - Gate 0 Step 1 的 `PROFILE_LOOKUP` 扩展覆盖 macOS、Linux（含 Chromium / Snap / Brave / Edge）与 Windows（`%LOCALAPPDATA%` 下 Chrome / Canary / Chromium / Brave / Edge）的全部 Profile 目录，并对输出路径自动去重。
- **全格式 MCP 配置适配（JSON / JSONC / TOML / YAML / CLI 注册）**：Gate 1–2 明确兼容桌面软件、IDE 插件与终端 CLI 智能体（支持 `mcpServers` JSON、TOML `[mcp_servers.agentlimb]`、YAML、`servers`、`context_servers` 及 CLI `mcp add` 子命令）。
- **多智能体快速切换防死锁（`TASK_IDLE_MS = 15000`）**：修复长连接 MCP 客户端（如终端 CLI Agent、Cursor 等）在执行浏览器工具后若未调用 `say` 结束本轮，会导致 `taskChannels` 永久占锁、阻塞其他 AI 接手或侧栏手动切换的问题；工具执行完毕后空闲满 15 秒自动释放任务锁。
- **Windows 原子写入兼容与进程退出端口秒放**：`writeJson` 在 Windows `renameSync` 遇 `EPERM`/`EACCES` 时自动安全回退；`mcp-server.mjs` 监听 `stdin end/error`、`stdout error` 与 `SIGHUP`，终端关闭即刻释放桥接端口。

---

## 0.5.6 / l7 — 2026-10-23

**简化已配对侧边栏 UI：移除不等价的聊天输入框与「停止」按钮，专注展示连接状态与 AI 操作回复**

根因分析：AgentLimb 是 1 对多的通用 MCP stdio 服务端（`host/mcp-server.mjs`），在 MCP 协议中只能被动响应 AI 客户端发起的 `tools/call`，无法反向唤醒处于空闲态的 AI 客户端（且 WorkBuddy 等客户端会在单轮对话结束 1 秒后直接 `SIGTERM` 退出 MCP 子进程）。因此在侧栏保留聊天输入框与「发送 / 停止」按钮会造成「侧栏可等同于 AI 窗口主动发起任务或随时中断」的误解，导致用户在侧栏发消息苦等 60 秒超时。

改进：
- 已配对视图 `#state-paired` 隐藏输入框 `#chat-form` 与发送/停止按钮 `#btn-send`，只保留清晰的 AI 回复与状态流（`#chat-log`）及当前标签页提示（`#page-note`），引导用户直接在 AI 工具中下达浏览器指令。
- `syncChat()` 自动过滤历史遗留的超时系统提示（`AI 还没有回复…`）与未送达的旧用户气泡，只展示 AI 的操作回复与连接状态。

**对标 `claude-for-chrome-1.0.101` 优化浏览器控制 Harness**

- **`a11y-tree.js` 嵌套文本与无障碍名称提取**：修复 `<button><span>百度一下</span></button>`、`<a href="..."><span>贴吧</span></a>`、`<h2><span>标题</span></h2>` 及 `<label>` 因文本包裹在内层 `<span>` 中导致 `directText` 为空、`read_page` 输出无名节点且 `find` 无法匹配文字的问题；新增开放 Shadow DOM（`shadowRoot`）遍历、`<option selected>` 与 `placeholder` 属性标注，以及 `waitFor` 200ms 周期轮询兜底。
- **`debugger.js` CDP 自动重连与跨域缓冲清理**：`send()` 遇到页面跳转/渲染进程切换导致的 `"Debugger is not attached"` 时自动重新 attach 并重试一次；主框架跨域导航时自动清理旧域名的 console/network 缓冲。
- **`router.js` 截图自动隐藏光效、输入回车与裸域名补全**：`screenshot` 截图前自动隐藏 `#agentlimb-indicator` 橙色光圈与光标并在截图后恢复，避免污染视觉截图；`computer({ action: 'type' })` 遇到 `\n` 自动触发 `Enter` 按键提交搜索；`navigate` 与 `tab_new` 支持裸域名（如 `www.baidu.com`）自动补全 `https://`；补齐鼠标 `buttons` 位掩码与 `triple_click`。

---

## 0.5.5 / l6 — 2026-10-23

**修：顶栏直接显示当前连接 AI（不再弹下拉菜单）+ 配对列表同软件去重、最多保存最近 10 条**

真机报告：重连三次 WorkBuddy 后，顶栏下拉列表里出现三行「WorkBuddy AI · 已保存配对 · 离线」。

根因：客户端身份 id 存放在 `~/.agentlimb/client-<hash>.json`。这个目录一旦被重置
（重装、清理重配），id 就变，而软件名和 kind 不变——于是每次重连都多出一行。

改进：
- **顶栏不再弹下拉菜单**：左上角直接展示当前连接的 AI（如 `WorkBuddy AI · 已连接`），点击不再打开 `#manager-popover` 下拉列表，避免多余菜单干扰。
- **按软件去重 + 保存最近 10 条记录**：`visibleClients()` 按 `name + kind` 合并展示（在线身份优先，否则取最近配对）；存储最多保留最近 10 条记录（按 `pairedAt` 倒序，在线连接不淘汰）；「设置 → 已连接的 AI」中点「移除」会一并清理该软件的全部历史身份。

**修：连接完成后保持已连接聊天界面，不再跳回「复制连接提示词」**

真机报告：WorkBuddy 连上并打开百度（执行完 `ping` → `tab_new` → `tabs_context` → `say`）后，
右侧边栏过几秒又变回「复制连接提示词」首屏，看起来像自己断开了。

根因：WorkBuddy 等客户端按轮次（per-turn）启动 MCP stdio 子进程，本轮回复一结束（`stopReason: end_turn`）
就向 worker 发送 `SIGTERM`，导致 `mcp-server.mjs` 随轮次退出；原侧栏在 8 秒宽限期后只要检测不到活动 SSE 流，
就会隐藏聊天窗 `#state-paired` 并切回未配对首屏 `#state-unpaired`（「复制连接提示词」）。

改进：
- **一旦配对成功，除非用户主动在设置中「移除」断开，侧栏始终保持在已连接聊天视图（`#state-paired`）**，
  顶栏保持显示 `<AI 名称> · 已连接`，保留完整聊天记录（含跨轮次/重启恢复）。
- **轮次间隙仍可在侧栏直接发消息**：即使 AI 的单轮 MCP 子进程已退出，侧栏输入框保持可用，发出的消息会进入发送队列并写入聊天记录，在 AI 下一次调用工具时自动随结果送达。

**测试**：`npm test` 77/77 全绿；`npm run smoke:panel` 在**真实 Chrome** 中加载真实 `sidepanel.html` + `sidepanel.js` + `bridge-client.js`，端到端验证「三次重连合并为 1 个 WorkBuddy、点击顶栏不弹菜单、打开百度后 MCP 进程退出仍保持已连接聊天页、仅在主动移除后才回到复制提示词页」。

## 0.5.4 / l5 — 2026-10-23

**改：连接成功后 AI 自己知道**

真机接入时发现：配对和授权其实都成功了（重启后信任自动恢复），但 AI 不知道——
它还在跟用户走安装流程、要步骤。根因是**没有任何强信号在授权成功的那一刻到达 AI**：
扩展知道、侧栏显示着，但 AI 只能靠"碰运气调个工具"才发现。

现在有三层信号，任意一层就够：

1. **授权成功那一刻，宿主主动推一条 MCP 通知**（logger `agentlimb-status`，`CONNECTED` 开头，
   和普通桥接日志区分开），明确说"信任已保存、之后每次会话自动复用、调一次 ping 确认即可"。
2. **`ping` 的返回值自带连接证明**：除了 pong（端到端往返证据），还带
   `authorized` / `paired` / `pairedAt` / `client` / `extensionVersion` 和一句明确的下一步。
   一次调用就能完整回答"我连上了吗"。
3. **`ping` 的工具描述重写**：从"健康检查"改成"不确定是否连上、或用户问状态时，先调这个"。
   工具描述是 AI 选工具的主要依据，这句比任何文档都管用。

另外 `initialize` 的 instructions 重写，明确四件事：信任是持久的（重启自动恢复，永不需要重新配对）、
不确定或用户问状态就先 `ping`（别读安装文档、别跑 doctor、别重配）、ping 成功就说
"Connected" 然后停下、失败时各给一个动作。

**修**：`connectionStatus()` 引用了一个未导入的 `APP_BUILD`，在 ES module 里是 `ReferenceError`，
会连带把整个授权请求打挂。现在授权记录完成后才上报状态，且上报永不允许抛出。

**测试**：`npm test` 68 → 69/69。新增用例覆盖全部三层信号（instructions 措辞、授权通知、
ping 结果结构、重启后上报已保存配对）。

## 0.5.3 / l4 — 2026-10-23

**修：侧栏聊天永久卡死（真机接入时发现的死锁）**

- 在侧栏发消息后，如果 AI 当时空闲，面板会永远显示「等待回复」，输入框禁用，且无法切换 AI。
  根因：侧栏消息只能搭在 AI 的下一次工具结果上送达，AI 空闲时根本看不到；而「等待回复」
  这个状态同时锁了输入和控制权。
- 点「停止」后如果 AI 没有确认，会永远显示「已请求停止，等待 AI 确认…」。

现在聊天按「发件箱」对待，和「在 AI 自己的聊天框里打字」语义一致：

| 场景 | 之前 | 现在 |
| --- | --- | --- |
| 没等到回复 | 永久禁用输入 | 60 秒后自动解锁，并说明「消息已送到，AI 下次操作时会看到」 |
| 停止没被确认 | 永久卡住 | 20 秒后自动解锁，可以再发一次 |
| AI 正在操作时发消息 | 报错「AI busy」 | 排队，随下一次工具结果送达 |
| 断线后重连 | 聊天记录被清空、闪回未连接页 | 8 秒宽限期显示「正在重连…」，记录保留 |

**顺带修掉三个 bug**（都由新的猴子测试逼出来）：

- 控制权已经转移给另一个 AI 后，原 AI 掉线会让面板永远停在「正在操作」，且谁都不能切换 AI。
- 排队中的工具被丢弃时不再给宿主回结果，宿主的工具调用只能干等到自己的超时。
- 切换到有排队任务的 AI 时，排队的工作不会自动开始跑。

**改：连接提示词的启用顺序**

原来让 AI 先去「连接器 UI 点信任」，但多数软件只有重启后才会在列表里出现 MCP，
照着做只会看到空列表。现在改为：**先重启/重载 → 再看这个软件自己的 MCP 入口在哪里**，
并且明确要求 AI 按自己运行的环境报出确切位置，不套用别的产品的菜单路径。

**改：连接保持**：侧栏保温 20s → 10s，宿主心跳 15s → 10s。

**测试**：`npm test` 62 → 64/64；新增 `npm run monkey:panel`（侧栏聊天随机混沌 + 4 条不变量）。

## 0.5.2 / l3 — 2026-10-22

**改：配对速度（首次配对约 2 秒 → 约 0.27 秒）**

- 发现节奏改为自适应：什么都没连上时 300ms 扫一次（这就是首次配对延迟），已连上后 1000ms。
- 侧栏在等连接时每 250ms 主动唤醒一次扩展后台，解决 MV3 worker 睡眠期间「看不见新桥接」的问题。
- `/health` 不再每次同步读信任文件（那会阻塞宿主事件循环，包括它正在报告的那次握手）。
- 授权消息（GRANT）发送失败时改为重连重试，而不是显示一个假的「已连接」。

**改：删除配对确认页**，改为「复制提示词即授权」+ 30 分钟接入窗口（一次复制只授权一个 AI）。

**测试**：新增 `npm run bench`（9 场景配对速度基准）、`npm run monkey`（配对状态混沌 + 6 条不变量）。
