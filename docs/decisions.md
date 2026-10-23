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

## D5. 持久信任按身份隔离，首次配对可用一次性码（2026-10-22）

> 一次性码与 `AGENTLIMB_PAIRING_TOKEN` 部分已被 **D12** 取代；身份隔离与持久信任仍有效。

**背景**：单一共享 `client-id.json` 会让不同智能体软件复用相同身份，可能静默继承彼此的浏览器信任。

**当时决策**：MCP 宿主以 `AGENTLIMB_CLIENT_NAME` 与 `AGENTLIMB_CLIENT_KIND` 组合生成稳定 identity；
当时身份文件为 `~/.agentlimb/client-<sha256(name,kind)>.json`，配对索引写入
`~/.agentlimb/paired-clients.json`。相同身份重连可自动确认；新身份需用户
在 Chrome 中单独批准，或使用用户本次点击复制提示词签发的 32 字节随机码自动批准。配对码放入
`AGENTLIMB_PAIRING_TOKEN`，有效 30 分钟、只消费一次，缺码或无效时保留手动配对兜底。安装器输出
带该环境变量的 MCP JSON，但不写入智能体软件配置。

**授权边界**：智能体软件是否 Trust/Enable MCP，由软件本身管理；配对码只免去 Chrome 配对页的
第二次点击，不会替用户在智能体软件中启用 MCP。`doctor` 找不到目标进程时只能报告未观察到该身份，不能推断
客户端拒绝信任。必须从目标会话调用工具 `ping` 才验证在线控制链路。

**成功反馈**：当前会话的 `ping` 和 `tabs_context` 均成功后，agent 先用 `say` 回报浏览器侧栏，
再在当前 AI 对话明确告诉用户可以直接提出任务；成功后不再机械要求重启、再次授权或新开会话。

**迁移边界（后续已更新）**：旧共享 `client-id.json` 不用于初始化新身份。后续版本将独立信任文件
定为权威，见 D10；不要按本条旧文件名推断当前落盘布局。

## D6. 侧栏聊天是「留言」语义，不是双向即时通讯（2026-10-22）

**背景**：用户要求已配对侧栏变聊天窗，「从 agent 发布指令是等价的」，
「做不做都无所谓」。

**决策**：面板消息经 `user_message` 帧到 host：① 立即以 MCP
`notifications/message` 推给 agent；② 入队，随 agent 下一次 `tool_result`
的 `userMessages` 字段投递（双保险）。当时关于 agent→面板方向“本期不做”的判断已被 `say`
工具取代：当前 agent 可通过宿主本地 `say` 工具把最终答复写回侧栏。

**理由**：MCP 是 request/response 协议，没有 server→client 的自由推送通道
（notifications 是日志语义）。留言+工具结果搭载是零协议扩展的可靠投递。
agent→面板需要 agent 主动调工具（如将来的 `say_to_user`），等有真实需求再加。

## D7. UI 硬编码中文 + 两个内容脚本常驻，不上 i18n 框架（2026-10-22）

**背景**：旧版有 12 语言 _locales + 侧栏 i18n 运行时。

**当时决策**：本版 UI 中文硬编码（提示词生成支持中英），manifest 移除
default_locale；a11y-tree 与 indicator 用 manifest content_scripts 常驻。语言选择已由后续版本补充，
见 D11；目前 UI 支持自动、简体中文和 English，并把选择保存在扩展本地存储。12 语言 `_locales`
框架仍未迁回。

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

## D10. 多客户端信任保留，单 controller 串行控制（2026-10-22）

**取代**：D5 中“配对索引文件作为登记位置”的旧实现假设，以及 README/旧架构中“最后配对的身份
自动成为唯一 active 客户端”的描述。D5 对身份名称/类型、一次性配对码和旧 `client-id.json` 不继承
信任的原则仍有效。

**决策**：扩展可同时发现并连接 `BRIDGE_PORTS` 中最多六个 MCP 宿主。每个 AI 的信任独立保存于
`~/.agentlimb/trust-<hash>.json`；`paired-clients.json` 仅作兼容索引，不作为并发授权写入的权威源。
Chrome 扩展保留多 AI 信任，但同时只有一个 `connectedClientId` controller 能操作浏览器。

已信任软件启动或握手不会自动抢控制；`ping` 仅作探测。用户通过 `SELECT_CLIENT` 显式切换时，当前
任务忙则返回 busy，不强切。新 AI 使用当前复制码配对后，当前空闲时接管；当前任务未结束时等待。
controller 的任务锁从非 `ping` 工具开始持续到 `say`，其他客户端非 `ping` 调用按宿主 deadline 排队，
过期调用拒绝且绝不执行。聊天 20 条记录和侧栏草稿按 AI 隔离。临时退出/断线只标离线；UI 的移除
操作只撤销所选 AI 的信任。

**理由**：用户可保留多个智能体的独立授权而不让后台握手改变当前任务归属；单 controller 和 deadline
约束避免并发浏览器操作及过期命令事后执行。

## D11. 侧栏设置与精简三语选择（2026-10-22）

**取代**：D7 中“UI 只支持中文”的表述；内容脚本常驻与不恢复完整 12 语言框架仍适用。

**决策**：旧版 `main-legacy:cowork-extension/sidepanel/sidepanel.html` 的顶部 clipboard/gear 仅作布局参考。
当前侧栏在线/离线均可打开设置，分为连接其他 AI、已连接 AI、语言、关于；聊天顶栏保留复制与齿轮，
展示当前 AI 和已保存配对数量。语言为自动、简体中文或 English，选择写入扩展本地存储。

**理由**：为多客户端信任和日常切换提供可发现入口，同时保持与旧版技能库、任务面板等功能的边界。

## D12. 删除配对确认页：复制即授权，靠 30 分钟接入窗口（2026-10-22）

**取代**：D5 中的一次性配对码与 `AGENTLIMB_PAIRING_TOKEN` 全链路，以及所有“手动配对页兜底”的描述。

**背景**：真实接入时 AI 连上来会弹「XX 希望连接浏览器 / 允许 / 忽略」。用户点过复制提示词，
这个页面只是把同一个意图再确认一遍；它还是唯一一处“用户必须回来点一下”的中断点。

**决策**：删掉整条确认链路——`ui/pairing/` 页面、`pairing_request` / `pairing_response` 帧、
`pairing_proof` 的 HMAC 证明、扩展里的 `pending` 队列与 `openPairingTab`、`AGENTLIMB_PAIRING_TOKEN`
环境变量与 `--pairing-token` CLI 参数。改成：

1. 复制提示词 → 扩展写入 `agentlimb.onboardUntil = now + 30min`（一次复制只授权一个 AI）。
2. 宿主发 `hello`，扩展回 `grant`：已受信 → `ok:true`（但不抢聊天窗）；窗口内 → 消费窗口、写信任、
   `ok:true` 并接管；都不满足 → `ok:false, reason:"not_authorized"`，不开任何页面。
3. 宿主把 `ok:false` 变成可执行错误：让用户点一次复制再重试。不改配置、不重启、不重装。

**为什么不把授权放进配置**：MCP env 里的码一旦过期就是死码，用户只能改配置重启才能恢复，
这是最坏的失败形态。授权状态只活在扩展私有存储里，过期就再点一次复制。

**权衡**：没有确认页意味着本机任何能起 MCP 进程的程序，只要恰好在 30 分钟窗口内连上来就会被
信任一次。这与旧版 cowork_local 一致（那里根本没有确认流程，native messaging 安装本身就是授权）；
窗口外则一律拒绝。侧栏仍可随时「移除」撤销信任，撤销后必须重新复制才能回来。

**回归守卫**：`tests/onboarding-window.test.mjs` 断言未授权时**不创建任何标签页**、只回
`grant{ok:false}`；`tests/protocol.test.mjs` 断言握手帧里不存在 `pairing_request`，且未授权
工具调用立刻返回可执行错误；`tests/tools.test.mjs` 断言提示词里没有任何码或确认页指引。

## D13. 配对速度：自适应扫描 + 侧栏当唤醒器 + 明确「自动接管」语义（2026-10-22）

**取代**：`createBridgeClient({ discoveryIntervalMs = 2000 })` 的固定 2 秒扫描；D10 中「已信任握手
不自动切换」表述需要更精确的说法（见下）。

**背景**：装完插件、点复制、粘贴提示词之后，用户要等 2 秒左右才看到「已连接」。握手本身只有几十
毫秒，慢的是「多久扫一次」。老版 cowork_local 的 relay 是 300 ms 轮询（`POLL_INTERVAL_MS`），
所以那版配对感觉是即时的——这是唯一值得照抄的地方。另一半原因是 MV3：worker 空闲约 30 s 被杀，
**被杀掉的 worker 看不见新起来的桥接**，只能等 `chrome.alarms`（下限 30 s）。

**决策**：

1. **扫描节奏自适应**（`DISCOVERY`）：什么都没连上时 300 ms（这就是首次配对延迟），已有一个 AI
   在线时 1000 ms（工具调用是 SSE 推送，不需要快扫）。工具调用延迟与扫描节奏无关。
2. **侧栏当唤醒器**：侧栏是普通页面，不会被挂起。等待连接时每 250 ms 发一次
   `AGENTLIMB_ENSURE`（收到消息这件事本身就会唤醒 worker，并顺带跑一次扫描）；已连接时每 20 s
   发一次保温，避免流被睡死的 worker 一起带走。侧栏关闭时只剩 30 s alarm 兜底。
3. **不再用 `setInterval` 保活**：它跟着 worker 一起消失。`scheduleScan()` 用自调度
   `setTimeout`，每轮按当前状态重新决定间隔。
4. **`/health` 缓存信任状态**：`/health` 每秒被探测 3–4 次 × 6 个端口，原来每次都同步读两个
   trust 文件，会阻塞宿主事件循环——包括它正在报告的那次握手。现在只在 `markPaired` /
   `revokePairing` 时更新缓存。
5. **GRANT 没送到就重连，而不是假装已连接**：`trust()` 里 POST 失败会 `dropChannel()`，让下一轮
   扫描重新握手；否则面板显示「已连接」而 agent 永远被卡住。
6. **宿主心跳 15 s、`waitForGrant` 35 s**：15 s 远低于 30 s 空闲上限，能防止活着的 worker 睡死；
   35 s 覆盖「worker 已睡死 → alarm 唤醒」的最坏情况，避免在用户无从操作的情况下报错。

**「自动接管」的准确语义**（这是 D10 没写清的部分）：

- **别的 AI 发来任务**（`tool_call`）且当前空闲 → **自动接管**聊天窗。这是用户要的：正在用 A，
  突然要 B 干活，B 一开口就该是 B 的窗口，不需要手动切。
- **已受信的 AI 只是重连/启动**（`hello` 命中历史信任）→ **不抢窗**。它只是回到「在线待命」，
  聊天窗留在当前 AI 上。
- **用户刚点了复制**（窗口内首次授权）→ **接管**。用户刚为这个 AI 做了动作，意图明确。
- **当前 AI 忙**（有工具在跑 / 等待回复 / 正在发送）→ 一律不抢，排队到 `say` 之后。

**权衡**：300 ms 扫描意味着「什么都没连上」时每秒约 20 次 localhost `/health`（6 端口 × 3.3 次）。
每次都是瞬时 ECONNREFUSED，实测开销可忽略；换来的是首次配对从 ~2 s 降到 ~270 ms。已连接后立刻
退回 1000 ms，所以稳态开销和以前差不多。

**回归守卫**：`tests/pairing-speed.test.mjs` 五条预算断言（首次配对 < 1000 ms、第二个 AI <
`IDLE_MS + 800`、一次复制只授权一个 AI、GRANT 丢失会重试、过期窗口不留死码）；
`scripts/pairing-bench.mjs` 九个场景出实测表（`--cadence 2000` 可复现旧行为）；
`scripts/pairing-monkey.mjs` 随机混沌 + 六条不变量。

测试与基准一律使用 `TEST_BRIDGE_PORTS`（28765–28770）：日常 Chrome 里的扩展会持续扫描默认的
8765–8770，测试宿主起在那里会在几百毫秒内被真实浏览器连上并拒掉，看起来就像被测代码有 bug。

## D14. 侧栏聊天是「发件箱」，不是「对话」：所有等待都有期限（2026-10-23）

**取代**：D10 / 旧面板状态机里「等待回复」也锁输入、也锁控制权的设计。

**背景**：真机接入时发现死锁——在侧栏发「打开新浪」，面板显示「等待回复」然后永远卡住；
点「停止」显示「已请求停止，等待 AI 确认…」也永远卡住。根因有两层：

1. **侧栏消息只能搭在 agent 的下一次工具结果上送达**（`userMessages` 挂在 `tool_result` 里）。
   agent 空闲时不会调工具，所以它根本看不到这条消息——而面板一直在等一个永远不会来的回复。
2. `pendingReplyAt` 同时进了 `locked()`（输入禁用）和 `chooseAvailable()`/`selectClient()` 的控制锁，
   于是不仅输入卡死，连切换 AI、跑排队的工具都卡死。

**决策**：聊天是发件箱，语义与「在 agent 自己的聊天框里打字」对齐。

1. **只有「消息正在飞」才锁输入**（毫秒级）。等待回复只是提示，不是锁。
2. **所有等待都有期限**：回复 60 秒、停止确认 20 秒。到期后状态不再声称「有人在等」，
   并留一条系统说明告诉用户为什么解锁了。期限在 `getStatus()` 里按读取时间结算，
   不用定时器——MV3 worker 睡眠时会丢定时器，而「worker 睡着」恰恰是这件事最常发生的时刻。
3. **`pendingReplyAt` 不再参与控制锁**。欠一个回复不该冻结控制权。
4. **发件箱跨断线保留**。绝大多数掉线是暂时的（worker 被挂起、SSE 断流），用户打了字就必须
   在 agent 回来时还能送到；只有显式「移除这个 AI」才清空队列。
5. **工具执行中发消息改为排队**，不再抛「AI busy」——和 agent 自己聊天框的行为一致。

**顺带修掉的三个真 bug**（都由猴子测试逼出来）：

- `operating` 原来是单个布尔，控制权已经转移后再掉线就不会被清零，面板从此永远显示「正在操作」，
  且谁都不能切换 AI。改成按通道派生：`taskChannels`（任务开着，从工具开始到 `say` 结束）
  + `operatingChannels`（工具真的在飞）。
- 排队中的工具在 `drainWaiting()` 里被丢弃时**不给宿主回结果**（`clearTimeout` 把报错的定时器也清了），
  宿主的 `callTool` 只能等到自己的超时。改成丢弃时立刻回一条 `ok:false`。
- `selectClient()` 切到一个有排队任务的 AI 时不会 `drainWaiting()`，排队的工作要等下一次事件才跑。

**回归守卫**：`tests/panel-state.test.mjs` 重写为 12 条（未回复到期解锁、停止到期、欠回复不阻塞切换、
工具中发消息排队、GRANT 丢失重试……）；`scripts/panel-monkey.mjs` 随机混沌 + 四条不变量
（输入永不被永久锁死 / 没有等待超过自己的期限 / 状态最终收敛 / 消息不丢也不重复）。
