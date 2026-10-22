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
| `user_message` | `text`, `at`, `page?` | 转发：面板聊天 → 扩展入队，随下次 tool_result 送达 |
| `agent_message` | `text`, `at` | 智能体经 `say` 工具回话 → 扩展写进侧栏聊天流 |

### 扩展 → host（POST）

| t | 字段 | 语义 |
|---|---|---|
| `b` | (所有帧必带) | 浏览器令牌，host 用它找到对应 SSE 连接 |
| `pairing_response` | `request_id`, `ok`, `name` | 用户在配对页点了允许/忽略 |
| `tool_result` | `tool_use_id`, `ok`, `result?`, `error?`, `userMessages?[]` | 工具执行结果 |
| `pong` | `at` | 心跳回应 |
| `user_message` | `text`, `at`, `page?` | 侧栏聊天发出（host 转发给 agent + 广播给扩展） |
| `pairing_revoked` | `client_id` | 侧栏点「断开」——撤销信任，host 用一句明文告诉 agent 浏览器已断开 |
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
- `userMessages[]` → 每个追加一个 text block，内容见下（带页面上下文）

### 面板消息的 `page` 载荷

侧栏发出的每条 `user_message` 都带当前标签页上下文（见 `docs/product.md` 核心承诺 3），
host 把它格式化进 MCP 通知与 tool_result 的 userMessages：

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
扩展写进侧栏聊天流（并持久化到 `chrome.storage.local`）。
所以智能体说一句话不需要经过 CDP，也不占一次浏览器往返。

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
