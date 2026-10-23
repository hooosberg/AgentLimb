# 线协议参考

所有帧都是 JSON。字段 `t` 区分类型，常量定义在 `kernel/shared/constants.js` 的 `WIRE`。

## HTTP 端点（host 侧，127.0.0.1:8765-8770）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | 单个宿主端口探测。返回该进程的健康、端口和客户端身份信息；它不表示该客户端是当前 controller |
| GET | `/events?b=<token>` | SSE 长连接。`b` 为扩展生成的浏览器令牌，POST 帧须带回 |
| POST | `/api/message` | 扩展 → host 的帧。body 必须带 `b` 令牌 |
| OPTIONS | * | CORS 预检（`*` 放行） |

SSE 帧格式：`data: <json>\n\n`，连接时先发 `retry: 2000\n\n`。

扩展同时探测 `BRIDGE_PORTS` 中最多六个端口，并可维持多条 SSE 连接；每个端口对应一个 MCP 进程及
客户端身份。所有已批准身份都保留 trust，但浏览器操作由一个 `connectedClientId` controller 串行执行。

## 帧类型一览

### host → 扩展（SSE）

| t | 字段 | 语义 |
|---|---|---|
| `hello` | `client:{id,name,kind}` | 连接建立后第一条，介绍 MCP 宿主身份；扩展据此回 `grant` |
| `tool_call` | `tool_use_id`, `tool`, `args`, `tabId?`, `client_id` | 执行工具，必须回 `tool_result` |
| `ping` | — | 心跳（25s）。回 `pong` |
| `user_message` | `text`, `at`, `page?` | 面板消息转发给 agent，并由扩展入队随下次 `tool_result` 送达 |
| `agent_message` | `text`, `at` | 智能体经 `say` 工具回话 → 扩展写进侧栏聊天流 |

### 扩展 → host（POST）

| t | 字段 | 语义 |
|---|---|---|
| `b` | (所有帧必带) | 浏览器令牌，host 用它找到对应 SSE 连接 |
| `grant` | `ok`, `name?`, `reason?` | 对 `hello` 的答复：`ok:false` 表示这个 AI 还没获授权 |
| `tool_result` | `tool_use_id`, `ok`, `result?`, `error?`, `userMessages?[]` | 工具执行结果 |
| `pong` | `at` | 心跳回应 |
| `user_message` | `text`, `at`, `page?` | 侧栏聊天发出（host 转发给 agent + 广播给扩展） |
| `revoked` | `client_id` | 用户在设置里移除了这个 AI，宿主撤销其持久信任 |

### 聊天状态与记录

侧栏通过 `chrome.runtime` 状态广播读取 `clients:[{id,name,kind,paired,online,waiting}]`、
`connectedClientId`、`sending`、`busy`、`operating` 和 `pendingReplyAt`。只有当前 controller 在线且
身份受信任时才显示对应聊天；管理器仍列出其他在线或已保存离线的 AI。线协议中的 `status` 帧用于
扩展 → host 上报信任列表；UI 状态由扩展后台广播，不轮询。已保存的信任本身不表示在线；临时断线
或 MCP 退出只标离线，不撤销信任。

侧栏有四种状态，优先级从高到低为未连接、正在操作、等待回复、已连接。状态由扩展后台通过
`chrome.runtime` 广播；正在操作 latch 在相邻工具调用之间保持，直到最终 `say` 回复或连接变更。
controller 的聊天、最近 20 条记录和侧栏草稿按 AI 隔离。实际执行或排队中的工具仍阻止该 AI 发送。
成功投递的消息由扩展排队，并在后续
`tool_result.userMessages[]` 中交付给 agent。页面采集或发送失败时保留输入草稿。

操作状态只表达当前浏览器工作阶段，不推断 AI 的内部思考状态。浏览器操作及错误处理完成后，
agent 工具说明要求调用一次 `say` 提供最终答复，禁止把 `say` 用作进度播报；收到 `say` 就按任务结束处理。此约定使用
现有 `agent_message` 帧，不新增完整 host turn API。

侧栏只保留最近 20 条 user/agent/system 记录，字段为 from、text、at 和可选 page 摘要
（title、url、restricted）。截图、正文、交互 refs 不进入记录；记录也不会重放给 AI。
活动步骤不写入聊天记录或持久存储，UI 只显示实时操作状态。`tab_new` 只把本次新建标签加入
该窗口橙色 AgentLimb 标签组；后续新标签复用该组，仍默认后台打开。连接断开或重连时清除
当前操作/回复/停止请求状态，不会停止 AI 宿主流程；host 进程关闭只会断开连接，不会撤销配对。

### 停止按钮语义

输入框按模式显示对应 placeholder。右侧组合按钮在空闲时显示「发送」；正在操作或等待回复时显示「停止」。点击「停止」发送既有 `user_message`，文本固定为：

```text
用户请求停止当前任务：请停止后续浏览器操作，并用 say 回复确认。
```

这条普通消息不带 `page` 字段，也不触发截图或页面上下文采集；协议没有 `stop_agent` 帧，host 不会据此强制取消正在执行的操作。扩展以 `stopRequested` 布尔状态合并重复停止请求，保持输入禁用并显示「已请求停止，等待 AI 确认…」。收到最终 `say`（`agent_message`）后，清除停止请求、操作 latch 与等待状态。断开或重连也会清除这些状态。停止消息沿既有 user_message 入队路径交付；发送失败时依既有消息发送错误处理，不伪造完成状态。

停止只请求智能体停止后续浏览器操作并确认。连接断开或 host 进程退出只标记离线，不撤销 trust；设置里的移除操作撤销所选 AI 的 trust，其他配对不受影响，撤销通过 `revoked` 帧告知宿主。

### 多客户端控制与扩展消息

以下是扩展内部 `chrome.runtime` 消息，不是 HTTP/SSE wire frame：

| 消息 | 字段 | 语义 |
|---|---|---|
| `GET_STATUS` | — | 返回全部客户端 `{id,name,kind,paired,online,waiting}`、当前 `connectedClientId` 和当前 AI 的聊天/忙碌状态 |
| `SELECT_CLIENT` | `clientId` | 用户显式切换当前 controller；仅当当前任务空闲时成功，忙时返回 `ok:false,error:'busy'`，不强切 |
| `DISCONNECT_CLIENT` | `clientId` | 移除并撤销指定客户端的 trust；其余 AI 的 trust 保留 |

MCP 启动、握手或身份已信任不会自动抢占 controller。新 AI 只有在侧栏复制提示词打开的接入窗口内连上来时
才会新增 trust；若浏览器任务空闲，新 AI 可接管，若当前有任务则等待该任务结束。已受信身份重连只恢复在线，
不抢聊天窗。`ping` 只检查连通性，不会取得或改变 controller。

当前 controller 的锁从非 `ping` 工具任务开始保持到该 AI 的最终 `say`。其他客户端的非 `ping` 工具
进入各自宿主 deadline 队列；到期请求拒绝且绝不执行。已信任客户端重新连接只恢复在线，不自动更换
controller。移除单个身份不会影响其余客户端。

## MCP（stdio，JSON-RPC 2.0，一行一消息）

支持的方法：

| method | 行为 |
|---|---|
| `initialize` | 返回 protocolVersion `2025-03-26`、`capabilities:{tools,logging}`、serverInfo |
| `notifications/initialized` | 通知，无响应 |
| `ping` | 返回 `{}` |
| `tools/list` | 返回 `HOST_TOOLS` 全量（16 个） |
| `tools/call` | `params:{name, arguments}` → 桥接 round-trip → content blocks |

错误码：`-32700` 解析失败 / `-32600` 非法请求 / `-32601` 方法不存在 /
`-32602` 工具不存在 / `-32603` 内部错误。工具执行失败**不走 error**，
走 `result:{isError:true, content:[{type:'text',text}]}`（MCP 惯例）。

`tools/call` 结果映射：
- `result.image` 存在 → `[{type:'image',data,mimeType}, {type:'text',text:'screenshot captured…'}]`
- 其余 → `[{type:'text', text: JSON.stringify(result)}]`
- `userMessages[]` → 每个追加一个 text block，内容见下（带页面上下文）

### 面板消息的 `page` 载荷

普通聊天消息带当前标签页上下文（见 `docs/product.md` 核心承诺 3），host 把它格式化进 MCP
通知与 tool_result 的 userMessages。停止按钮复用 `user_message` 但省略 `page`，不采集页面信息：

```json
{
  "t": "user_message", "text": "这个页面讲什么", "at": "2026-10-22T09:00:00Z",
  "page": {
    "tabId": 123,
    "url": "https://example.com/",
    "title": "Example Domain",
    "text": "可见文本摘录（≤2500 字）",
    "interactive": [{ "ref": 12, "role": "link", "name": "Learn more" }]
  }
}
```

`interactive[].ref` 是**可直接用**的：`computer{ref:12}` / `form_input{ref:12}` 立即可执行，
不需要先 `read_page`。这就是"默认看得见眼前页面"的实现方式。

### `say` 工具是宿主本地的

`say` 不发给扩展执行：host 直接把 `agent_message` 帧广播给浏览器，
扩展写进侧栏聊天流（最多 20 条，持久化到 `chrome.storage.local`）。
所以智能体说一句话不需要经过 CDP，也不占一次浏览器往返。

## 接入授权（无确认页）

握手只有两步：宿主在 SSE 建连时发 `hello`，扩展决定后回 `grant`。

```
host  ──hello {client:{id,name,kind}}──▶  扩展
host  ◀──grant {ok:true|false}──────────  扩展
```

扩展的判断顺序：

1. `agentlimb.pairedClients` 里已有这个 `clientId` → `grant{ok:true}`，且**不抢**当前聊天窗（用户正在跟别的 AI 说话时，后台 AI 重连不该跳走）。
2. 存储里的 `agentlimb.onboardUntil` 还在未来 → 一次性消费该窗口，写入信任，`grant{ok:true}` 并接管聊天窗。
3. 两者都不满足 → `grant{ok:false,reason:"not_authorized"}`，不打开任何页面，只在状态里留一条 `unauthorized` 供侧栏提示。

`agentlimb.onboardUntil` 由侧栏「复制连接提示词」写入（`COPY_PROMPT`），默认 30 分钟。它是纯时间戳，不是密钥：没有原码、没有 HMAC 证明、没有任何东西需要写进 MCP 配置。窗口过期不会留下死码，用户再点一次复制即可，不需要改配置或重启。

宿主侧把 `ok:false` 记成 `deniedReason`，`tools/call` 立刻以可执行错误返回（而不是干等 150 秒）：

```
This AI is not authorized by the browser yet. Ask the user to click the copy-prompt
button in the AgentLimb side panel — that authorizes the next AI for 30 minutes.
No MCP config change or restart is needed; just retry after the user clicks.
```

侧栏「移除」发 `revoked`，宿主撤销持久信任并给 agent 一句大白话；该 AI 想再接入必须重新走一次复制窗口。

## 工具参数速查

完整 schema 以 `kernel/control/host/tools.js` 为准（双端同源）。常用约定：

- 所有工具接受可选 `tabId`；缺省 = 当前窗口活动标签
- `computer`：`ref`（来自 read_page/find）或 `selector` 或 `x/y` 三选一定位；
  `action` ∈ click/double_click/right_click/hover/type/scroll/key/drag/screenshot
- `read_page`：`filter` ∈ interactive(默认)/all；`depth` 默认 15；`limit` 默认 100
- `wait`：`condition` ∈ visible/hidden/exists/url_contains/page_contains/page_load，
  timeout 默认 10s 上限 30s
- `browser_batch`：`actions:[{tool,args}]` 最多 20 个，失败即停

## 错误语义（扩展执行层）

| 错误文本 | 含义 | agent 应对 |
|---|---|---|
| `tab N not found` | tabId 失效 | 重新 `tabs_context` |
| `tab is not an http(s) page: …` | chrome:// 等页面 | 先 navigate |
| `unknown ref N — call read_page/find again` | DOM 变了 ref 失效 | 重新 read_page |
| `element is no longer in the document` | 节点被移除 | 重新 read_page |
| `Another debugger is attached…` | DevTools 占着 | 让用户关 DevTools |
| `no browser extension connected…` | 扩展从未连上 | 检查扩展启用状态与 Chrome 是否在跑 |
| `This AI is not authorized…` | 复制窗口不在有效期 | 让用户点一次侧栏「复制连接提示词」后重试，不改配置 |
| `the browser has not taken control yet…` | 已连上但授权还没到 | 打开侧栏唤醒发现循环后重试 |
| `tool X timed out after Nms` | 页面卡死或 SW 挂了 | 重试或换 tab |

## 环境变量（host 侧）

| 变量 | 默认 | 说明 |
|---|---|---|
| `AGENTLIMB_CLIENT_NAME` | `initialize.clientInfo.name`，缺省 `AI Agent` | 与 kind 组合确定稳定身份；初始化后才启动桥接 |
| `AGENTLIMB_CLIENT_KIND` | `generic` | 与 name 组合确定稳定身份，改值等于换一个身份、需要重新授权 |

> 这里没有授权类变量，是刻意为之：授权状态只活在浏览器扩展里，配置里不存任何密钥。
| `HOME` | — | 决定 `~/.agentlimb` 位置（测试用它隔离） |
