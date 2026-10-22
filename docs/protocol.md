# 线协议参考

所有帧都是 JSON。字段 `t` 区分类型，常量定义在 `kernel/shared/constants.js` 的 `WIRE`。

## HTTP 端点（host 侧，127.0.0.1:8765-8770）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | 端口探测。返回 `{ok, service:"agentlimb-bridge", version, port, browsers, paired, client:{id,name,kind}}` |
| GET | `/events?b=<token>` | SSE 长连接。`b` 为扩展生成的浏览器令牌，POST 帧须带回 |
| POST | `/api/message` | 扩展 → host 的帧。body 必须带 `b` 令牌 |
| OPTIONS | * | CORS 预检（`*` 放行） |

SSE 帧格式：`data: <json>\n\n`，连接时先发 `retry: 2000\n\n`。

## 帧类型一览

### host → 扩展（SSE）

| t | 字段 | 语义 |
|---|---|---|
| `hello` | `client:{id,name,kind}` | 连接建立后第一条，介绍 MCP 宿主身份 |
| `pairing_request` | `request_id`, `client` | 请求配对。已信任客户端扩展会自动确认 |
| `tool_call` | `tool_use_id`, `tool`, `args`, `tabId?`, `client_id` | 执行工具，必须回 `tool_result` |
| `ping` | — | 心跳（25s）。回 `pong` |
| `pairing_revoked` | `client_id` | 宿主侧撤销了配对 |
| `user_message` | `text`, `at` | 转发：面板聊天 → 扩展入队，随下次 tool_result 送达 |

### 扩展 → host（POST）

| t | 字段 | 语义 |
|---|---|---|
| `b` | (所有帧必带) | 浏览器令牌，host 用它找到对应 SSE 连接 |
| `pairing_response` | `request_id`, `ok`, `name` | 用户在配对页点了允许/忽略 |
| `tool_result` | `tool_use_id`, `ok`, `result?`, `error?`, `userMessages?[]` | 工具执行结果 |
| `pong` | `at` | 心跳回应 |
| `user_message` | `text`, `at` | 侧栏聊天发出（host 转发给 agent + 广播给扩展） |
| `stop_agent` | — | 用户点了页面内「停止智能体」 |
| `pairing_revoked` | `client_id` | 侧栏点「断开」 |
| `status` | `paired:[id...]` | 扩展上报自己信任的客户端列表 |

## MCP（stdio，JSON-RPC 2.0，一行一消息）

支持的方法：

| method | 行为 |
|---|---|
| `initialize` | 返回 protocolVersion `2025-03-26`、`capabilities:{tools,logging}`、serverInfo |
| `notifications/initialized` | 通知，无响应 |
| `ping` | 返回 `{}` |
| `tools/list` | 返回 `HOST_TOOLS` 全量（15 个） |
| `tools/call` | `params:{name, arguments}` → 桥接 round-trip → content blocks |

错误码：`-32700` 解析失败 / `-32600` 非法请求 / `-32601` 方法不存在 /
`-32602` 工具不存在 / `-32603` 内部错误。工具执行失败**不走 error**，
走 `result:{isError:true, content:[{type:'text',text}]}`（MCP 惯例）。

`tools/call` 结果映射：
- `result.image` 存在 → `[{type:'image',data,mimeType}, {type:'text',text:'screenshot captured…'}]`
- 其余 → `[{type:'text', text: JSON.stringify(result)}]`
- `userMessages[]` → 每个追加一个 text block：`User message (<at>): <text>`

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
| `no paired browser…` | 没配对/浏览器没连 | 让用户看侧栏 |
| `tool X timed out after Nms` | 页面卡死或 SW 挂了 | 重试或换 tab |

## 环境变量（host 侧）

| 变量 | 默认 | 说明 |
|---|---|---|
| `AGENTLIMB_CLIENT_NAME` | `AI Agent` | 配对页显示的名字 |
| `AGENTLIMB_CLIENT_KIND` | `generic` | 类型标识（任意字符串，仅展示用） |
| `HOME` | — | 决定 `~/.agentlimb` 位置（测试用它隔离） |
