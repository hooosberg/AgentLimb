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
│ ui/sidepanel     │  未配对：复制提示词 | 已配对：聊天窗 + 快捷操作
│ ui/pairing       │  配对确认标签页
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
`chrome.runtime.onMessage`（侧栏和配对页的入口）、`chrome.alarms`（保活）、
sidePanel 行为、命令快捷键。**无状态，所有状态在 bridge-client / router 里。**

### kernel/control/background/bridge-client.js
扩展侧的桥接客户端：
- `discoverPort()` 顺序探测 8765-8770 的 `/health`
- `EventSource` 长连接；URL 带 `?b=<browserId>` 令牌，POST 帧带回同一个令牌，
  host 才能把 `pairing_response` 归属到具体浏览器连接
- 配对状态机：`hello` → `pairing_request` →（已信任则自动 `pairing_response`，
  否则开配对页）→ 写入 `chrome.storage.local.pairedClients`
- `toolChain` promise 链：工具调用串行执行（agent 本身就是串行的）
- `userMessageQueues`：面板发来的聊天消息按 clientId 排队，随下一次
  `tool_result` 的 `userMessages` 字段送达（投递保证）

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
- 端口：从 8765 起找第一个空闲
- `sseClients` + `tokenIndex`：令牌 → 连接
- `activeBrowserId`：最后完成配对的浏览器；工具调用只发给它
- `pendingToolCalls`：tool_use_id → {resolve, reject, timer}
- `waitForPairing()`：未配对时 `callTool` 会阻塞等用户确认（最长 150s）；
  浏览器从未出现过则 20s 快速失败
- 心跳 25s 一个 `ping` 帧（同时起 SW 保活作用）

### host/mcp-server.mjs
stdio JSON-RPC。stdout **只出 JSON-RPC**，日志走 stderr + MCP
`notifications/message`（agent 端可见）。`tools/call` → `bridge.callTool`
→ 结果转 MCP content（截图转 image content block，userMessages 转 text block）。

## 配对状态机

```
[MCP 进程启动] ──bridge.start()──► [SSE 等待扩展连接]
      │                                  │ 扩展连上（SW 被 alarm/面板唤醒）
      │                                  ▼
      │                         host 发 hello + pairing_request
      │                                  │
      │              ┌───────────────────┴────────────────────┐
      │              ▼                                        ▼
      │     客户端 id 在 paired-clients.json          不在（首次）
      │              │                                        │
      │     扩展自动 pairing_response ok           开配对标签页等用户点
      │              │                                        │
      │              └──────────────► [paired] ◄──────────────┘
      │                              │
      ▼                              ▼
 tools/call ──► tool_call ──► 扩展执行 ──► tool_result ──► MCP 结果 ──► agent
```

持久化位置：宿主侧 `~/.agentlimb/paired-clients.json`（按 clientId），
扩展侧 `chrome.storage.local.agentlimb.pairedClients`。两边都记，
宿主决定「要不要请求配对」，扩展决定「要不要弹窗」。

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
