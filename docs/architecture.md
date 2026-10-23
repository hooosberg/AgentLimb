# 架构详解

## 三个端，一条环路

```
┌──────────────────┐   stdio (JSON-RPC 2.0)   ┌───────────────────────┐
│   智能体软件      │ ◄──────────────────────► │  host/mcp-server.mjs  │
│ (任意 MCP 客户端) │   逐行 JSON，一行一消息   │  + bridge-server.mjs  │
└──────────────────┘                          └──────────┬────────────┘
                                                          │
                              HTTP over 127.0.0.1         │
        ┌─────────────────────────────────────────────────┘
        │  GET  /events   SSE，host → 扩展（推送）
        │  POST /api/message         扩展 → host（回传）
        ▼
┌──────────────────┐        ┌──────────────────────────────┐
│ 扩展 Service      │ ─CDP─► │ 目标标签页（可后台，焦点模拟） │
│ Worker           │        │ content script 常驻：         │
│ bridge-client    │ ◄MSG─► │  a11y-tree.js / indicator.js │
│ debugger/router  │        └──────────────────────────────┘
└──────────────────┘
        │ chrome.runtime.sendMessage
        ▼
┌──────────────────┐
│ ui/sidepanel     │  连接引导 / 当前 AI 聊天 / 多客户端设置
└──────────────────┘
```

**关键性质：控制环路不经过侧栏。** 侧栏只是状态/聊天界面；SW 只要活着，
工具调用就在跑。用户关掉侧栏、切标签、看视频都不影响。

## 模块逐文件说明

### kernel/shared/constants.js
协议唯一事实源：`WIRE`（所有 SSE/POST 帧的 `t` 字段）、`BRIDGE_PORTS`、
`STORAGE_KEYS`、`MESSAGE_TYPES`（chrome.runtime 消息）。**加帧类型只改这里。**

### kernel/control/host/tools.js
工具目录唯一事实源。扩展的 `router.js` 按名字分发执行；宿主 `mcp-server.mjs`
直接把它序列化进 `tools/list`。**加/改工具只改这里**（别忘了 `router.js` 里加实现）。

### kernel/control/background/service-worker.js
装配入口：创建 debugger / router / bridge-client 三个单例，接好
`chrome.runtime.onMessage`（侧栏的入口）、`chrome.alarms`（保活）、
sidePanel 行为、命令快捷键。**无状态，所有状态在 bridge-client / router 里。**

### kernel/control/background/bridge-client.js
扩展侧的桥接客户端：
- `discoverPort()` 顺序探测 8765-8770 的 `/health`
- 同时发现并连接 `BRIDGE_PORTS` 中最多六个宿主；每个 MCP 身份独立维护在线状态与信任
- `EventSource` 长连接；URL 带 `?b=<browserId>` 令牌，POST 帧带回同一个令牌，
  host 才能把 `grant` 归属到具体浏览器连接
- 授权状态机：`hello` →（已有身份信任 → `grant{ok:true}` 但不抢聊天窗；`agentlimb.onboardUntil` 未过期 →
  消费窗口并接管；否则 `grant{ok:false}`）→ 写入 `chrome.storage.local.pairedClients`
- `toolChain` promise 链：工具调用串行执行（agent 本身就是串行的）
- `userMessageQueues`：面板发来的聊天消息按 clientId 排队，随下一次
  `tool_result` 的 `userMessages` 字段送达（投递保证）
- `GET_STATUS` 为侧栏提供 `clients:[{id,name,kind,paired,online,waiting}]` 与
  `connectedClientId`。`SELECT_CLIENT` 只在任务空闲时切换当前 controller；忙时返回 busy。
  `DISCONNECT_CLIENT` 只撤销指定客户端的信任。

### kernel/control/background/debugger.js
CDP 会话管理器，本插件效率的核心：
- `attach(tabId)` **持久 attach + in-flight 去重**（`attaching` promise 复用），
  不要改成「每次动作 attach/detach」
- `chrome.debugger.onDetach` 监听：被 DevTools 挤掉时标记 stale，下次自动重连
- `setFocusEmulation()` / `muteForControl()`：后台标签可控 + 不抢用户音频
- `screenshot()`：JPEG 质量 75 起步按 base64 预算（1.2MB）逐级降
- console/network 事件进环形缓冲（200 条），`Runtime.enable`/`Network.enable`
  只在 attach 后启用一次

### kernel/control/background/router.js
15 个工具的执行器。要点：
- `resolveTab()`：优先 `args.tabId`，否则活动标签（当前窗口优先，退化为任意窗口）
- `assertInjectable()`：拒绝 `chrome://` 等不可注入页面
- `pageMessage()`：`chrome.tabs.sendMessage(tabId, msg, {frameId: 0})`
  —— **永远显式 frameId 0**，否则多 frame 页面响应会串
- `computer` 的指针动作：先 `resolvePoint()`（ref → 内容脚本 scrollIntoView +
  实时量坐标）→ `prepareForInput()`（后台标签开焦点模拟+静音+显示指示器）
  → CDP `Input.dispatchMouseEvent`
- `browser_batch`：顺序执行，**失败即停**（后续步骤通常依赖前步）

### kernel/control/content/a11y-tree.js
`document_start`、`all_frames` 常驻（manifest 声明，无需按需注入）：
- ref 映射：`reverseMap`(WeakMap el→ref) + `elementMap`(ref→{el, frameOffset})
- 同源 iframe 走入树并累加坐标偏移；shadow root 直接走
- 密码/敏感字段（autocomplete 名单）在树里脱敏
- `interactive` 过滤器只保留可交互元素，`all` 出全树
- 预算保护：单次扫描 5000 节点、limit 默认 100

### kernel/control/content/indicator.js
仅 top frame：辉光边框 + 幽灵光标（SW 在每次指针动作前 `MOVE_CURSOR`）。
只负责「让你看见 AI 正在动哪个标签」，不带任何可点控件——对话都在侧栏。

### kernel/prompt/build-prompt.js
侧栏「复制提示词」生成。**产品定位是通用插件：文案里禁止出现任何第三方
品牌名**（tests/tools.test.mjs 有断言把守）。加语言时在这里加分号。

### host/bridge-server.mjs
零依赖 HTTP+SSE 服务器，嵌入在 MCP 进程里：
- 每个 MCP 进程从 `BRIDGE_PORTS` 中选择空闲端口；扩展可同时连接最多六个 MCP 宿主
- `sseClients` + `tokenIndex`：令牌 → 连接
- 浏览器连接按宿主和客户端身份分别跟踪；工具调用受扩展侧单 controller 锁约束
- `pendingToolCalls`：tool_use_id → {resolve, reject, timer}
- `waitForGrant()`：等待扩展对 `hello` 回 `grant`；新客户端在 controller 忙时等待空闲接手
- 心跳 25s 一个 `ping` 帧（同时起 SW 保活作用）
- controller 的任务锁从第一个非 `ping` 工具持续到最终 `say`；其余 AI 的非 `ping` 调用按宿主 deadline 排队，过期后拒绝且不执行。`ping` 仅探测连接，不取得控制权。

### host/mcp-server.mjs
stdio JSON-RPC。stdout **只出 JSON-RPC**，日志走 stderr + MCP
`notifications/message`（agent 端可见）。`tools/call` → `bridge.callTool`
→ 结果转 MCP content（截图转 image content block，userMessages 转 text block）。

启动时使用 `AGENTLIMB_CLIENT_NAME` / `AGENTLIMB_CLIENT_KIND` 标识目标客户端；未显式提供名称时才回退到 MCP `initialize.clientInfo.name`。`bin/agentlimb.mjs install` 与 `config` 生成带绝对 Node 可执行路径、绝对宿主入口及这两个环境变量的 JSON。安装器不改写客户端配置；各软件中的配置加载和 MCP Trust/Enable 是独立关卡。

## 授权状态机（无确认页）

```
[MCP 进程启动] ──bridge.start()──► [SSE 等待扩展连接]
      │                                  │ 扩展连上（SW 被 alarm/面板唤醒）
      │                                  ▼
      │                         host 发 hello
      │                                  │
      │              ┌───────────────────┴────────────────────┐
      │              ▼                                        ▼
      │      trust-<hash>.json 已有该身份            没有（新身份/首次）
      │              │                                        │
      │      grant{ok:true}，不抢聊天窗          agentlimb.onboardUntil 未过期？
      │              │                              是：消费窗口 + 写信任 + 接管
      │              │                              否：grant{ok:false}
      │              └──────────────► [browser authorized] ◄──┘
      │                              │
      ▼                              ▼
 tools/call ──► tool_call ──► 扩展执行 ──► tool_result ──► MCP 结果 ──► agent
```

持久信任按客户端隔离到 `~/.agentlimb/trust-<hash>.json`；`~/.agentlimb/paired-clients.json`
是兼容索引，不是并发写入时互相覆盖授权的共享权威源。扩展侧记录在
`chrome.storage.local.agentlimb.pairedClients`，授权窗口在 `agentlimb.onboardUntil`。
宿主每次浏览器连接只发 `hello`；扩展回 `grant{ok}` 决定是否放行。没有配对页、没有配对码、
没有需要写进 MCP 配置的密钥——窗口过期就再点一次复制，不用改配置或重启。
`grant{ok:false}` 会被翻译成可执行错误（让用户点复制再重试），而不是干等超时。身份文件与
浏览器授权是不同记录；单有身份文件或宿主信任记录都不能证明实时连接成功。

旧版共享 `client-id.json` 不作为新身份的回退来源；以客户端名称和类型组合生成稳定 hash，身份标签
变化会生成新信任文件并需要重新授权。临时断线或退出只标记该客户端离线，不撤销信任。名称与类型
需在客户端配置和诊断时保持一致。
MCP 客户端自身的 Trust/Enable 仍由各软件管理；接入窗口只省去 Chrome 侧的确认，
不替用户在智能体软件中启用 MCP。成功仍须当前会话实际调用工具 `ping` 与 `tabs_context`。

### 安装与只读诊断

`scripts/install.sh` 与 `scripts/install.ps1` 只检查 Node.js 18+，随后委托
`node bin/agentlimb.mjs install`。共享实现 `host/install.mjs` 复制宿主运行文件和根
`package.json`（`type: module`），不写入或覆盖其他客户端配置，不删除旧 runtime 目录；旧目录存在
不能证明当前版本安装完成。CLI `config` 只打印适配当前安装路径的 JSON，`doctor` 输出 JSON 诊断。

`doctor` 的阶段反映探测到的桥接进程：无匹配 MCP 时为 `no_matching_mcp`，这表示没有观察到目标
身份，不说明客户端是否信任；有目标进程但没有扩展连接时为 `awaiting_extension`；扩展连上但
还没获授权时为 `awaiting_authorization`；握手完成后为 `browser_ready_ping_required`。
最终仍必须在目标智能体会话调用 MCP 工具 `ping`，不能用端口探测或别的客户端会话替代。

live 集成测试使用独立临时 HOME、浏览器 profile、扩展副本和私有端口，并在运行后清理临时安装、
配对和浏览器数据；它不触碰日常 HOME 下的 AgentLimb 安装。该测试验证浏览器/MCP 链路，不验证
特定智能体软件中的真实 UI 信任步骤或模型行为。

## 多客户端控制模型

扩展在 `BRIDGE_PORTS` 的最多六个端口上并行探测和维持 SSE 连接。所有客户端的 trust 独立保留，
单一 `connectedClientId` 指向当前 controller。已信任 MCP 进程启动或完成握手不会自动取得控制权；
`ping` 仅检查状态。显式 `SELECT_CLIENT` 只在任务空闲时切换，忙时返回 busy。新身份通过一次复制窗口
完成配对后，空闲时接管；如果另一身份有正在运行的任务，新客户端留待任务结束再接手。

任务锁只由当前 controller 持有，从第一个非 `ping` 工具调用开始保持到 `say` 最终回复。其他客户端
的非 `ping` 工具按各自宿主 deadline 排队，deadline 到期即拒绝，绝不在过期后执行。聊天记录最多 20 条、
前端草稿均按 AI 隔离。移除单个客户端撤销其 trust；其余客户端和浏览器授权保持不变。

## 侧栏入口

未连接和已连接状态都提供设置入口。在线顶栏保留复制提示词与齿轮，显示当前 AI 和配对数量；设置分为
连接其他 AI、已连接 AI、语言（自动/简体中文/English）与关于。语言保存在扩展本地存储。UI 可参考
`main-legacy:cowork-extension/sidepanel/sidepanel.html` 的顶部 clipboard/gear 布局；只借鉴入口，不恢复旧版标签、技能库或任务面板。

## 工具调用时序（一次 click）

```
agent                MCP宿主              扩展SW              内容脚本/CDP
  │ tools/call        │                      │                    │
 │───────────────────►│ callTool             │                    │
 │                    │ tool_call ──SSE────► │                    │
 │                    │                      │ router.execute     │
 │                    │                      │ RESOLVE_REF ─────► │ scrollIntoView+量坐标
 │                    │                      │ ◄───── {x,y} ─────│
 │                    │                      │ setFocusEmulation │
 │                    │                      │ MOVE_CURSOR ─────► │ 幽灵光标
 │                    │                      │ Input.dispatch* ──►│ CDP
 │                    │ tool_result ◄─POST── │                    │
 │ ◄── MCP content ──│                      │                    │
```
