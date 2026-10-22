# 设计决策记录

按时间倒序。每条记录「当时为什么这么定」，想推翻之前先读这里。

## D1. 本地通道用 SSE+POST，不用 WebSocket（2026-10-22）

**背景**：参考实现（Claude for Chrome）用 WebSocket 连云端 bridge；本地
Claude Code 场景也走 `ws://localhost`。

**决策**：host 用 Node 内置 `http` 模块搭 SSE（host→ext 推送）+ POST
（ext→host 回传）。

**理由**：
- 推送延迟在 loopback 上与 WS 等同，都是内核缓冲区直投
- Node 无内置 WS 服务器；手写 RFC6455 要处理分片、64KB+ 大帧（截图 base64
  经常 >1MB）、掩码——风险与收益完全不成比例
- EventSource 断线重连由浏览器自动完成，少写一个状态机
- 零依赖，`~/.agentlimb` 里就四个 .mjs 文件，拷走即用

**代价**：SSE 单向，回传必须配 POST（多一次 HTTP 建连，loopback 上可忽略）。

## D2. 去掉 task_plan / task_step_done / task_complete / task_fail（2026-10-22）

**背景**：旧版有四个工具专门驱动侧栏的「第几步第几步」进度显示。

**决策**：整条进度机制移除。

**理由**：用户明确要求「右侧完全只有一个责任」；进度渲染对控制链路零价值，
但每个工具都在消耗 agent 的 context 预算，还诱导 agent 在步骤本身上浪费轮次。
参考实现的工具集里也没有对应物。

**代价**：用户看不到 agent 的任务规划。替代方案是页面内辉光边框+幽灵光标
（实时但无步骤语义）。如果将来要恢复，建议做成 opt-in 模块而非默认工具。

## D3. debugger 持久 attach，不随动作装卸（2026-10-22）

**背景**：旧版每个动作 `withDebuggerSession`（attach→执行→detach）。

**决策**：按 tabId 持久 attach + in-flight 去重；仅在 Chrome 踢掉
（onDetach）时重连。

**理由**：attach/detach 单次 10-50ms，且和 DevTools 争抢同一把锁
（"Another debugger" 错误）。参考实现同样保持长会话，并在此之上启用
Page/Runtime/Network 域各一次。

## D4. 焦点模拟驱动后台标签（2026-10-22）

**背景**：需求是「AI 自己新建标签干活，用户在看视频不被打扰」。

**决策**：目标非活动标签时 `Emulation.setFocusEmulationEnabled{enabled:true}`
+ `chrome.tabs.update{tabId, muted:true}`（记原状态，detach 时恢复）。

**理由**：大量页面用 `document.hasFocus()` 门控交互/渲染；不模拟焦点，
后台标签里的点击/输入会被页面忽略。静音是参考实现同款细节——
AI 操作的标签突然出声非常惊悚。

## D5. 配对 = 信任一个 clientId，而不是每次会话（2026-10-22）

**背景**：参考实现每次连接都弹 pairing_request（靠扩展记住名字免弹）。

**决策**：host 侧 `~/.agentlimb/paired-clients.json` 按 clientId 持久化；
首次连接弹配对页，之后同 clientId 自动确认（扩展侧 storage 也记一份）。

**理由**：用户原话「配对完成后，其实就是给 agent 软件安装了一个 MCP，
后期调用就会自动化」。每次弹窗会把「长期自动化」打回「一次性工具」。

**安全边界**：clientId 是 host 首次启动生成的 UUID；换机器/删
`~/.agentlimb` 需重新配对；侧栏「断开」即时撤销。

## D6. 侧栏聊天是「留言」语义，不是双向即时通讯（2026-10-22）

**背景**：用户要求已配对侧栏变聊天窗，「从 agent 发布指令是等价的」，
「做不做都无所谓」。

**决策**：面板消息经 `user_message` 帧到 host：① 立即以 MCP
`notifications/message` 推给 agent；② 入队，随 agent 下一次 `tool_result`
的 `userMessages` 字段投递（双保险）。agent→面板方向本期不做。

**理由**：MCP 是 request/response 协议，没有 server→client 的自由推送通道
（notifications 是日志语义）。留言+工具结果搭载是零协议扩展的可靠投递。
agent→面板需要 agent 主动调工具（如将来的 `say_to_user`），等有真实需求再加。

## D7. UI 硬编码中文 + 两个内容脚本常驻，不上 i18n 框架（2026-10-22）

**背景**：旧版有 12 语言 _locales + 侧栏 i18n 运行时。

**决策**：本版 UI 中文硬编码（提示词生成支持中英），manifest 移除
default_locale；a11y-tree 与 indicator 用 manifest content_scripts 常驻。

**理由**：精简版目标用户是开发者本人+早期用户；i18n 是纯资产不带逻辑。
常驻内容脚本替代「按需注入」是 ref 映射可缓存的前提（参考实现同款）。

## D8. muscle 记忆移除，不设 flag（2026-10-22）

**背景**：旧版核心卖点是 muscle memory（三个工具 + 桌面 JSON 存储 + 合并逻辑）。

**决策**：lite 分支整体移除，不做 feature flag。

**理由**：flag 会让「默认工具列表」依然臃肿（agent 看不到 flag，只会看到
15+3 个工具）。需要时从 `workspace` 分支整体迁回并默认关闭。

## D9. 传输层 browser 令牌（2026-10-22）

**背景**：SSE 连接与 POST 帧是两条独立 HTTP 事务，host 无法天然知道
「这条 pairing_response 来自哪个浏览器连接」。

**决策**：扩展生成 `browserId`，SSE URL `?b=` 带上，POST 帧原样带回；
host 维护 tokenIndex。

**理由**：多 Chrome profile 场景下，配对应归属到具体连接，否则
activeBrowserId 会错连到另一个 profile。
