# 开发工作流

当前源码版本为 **0.5.7 / l8**（变更记录见 [../CHANGELOG.md](../CHANGELOG.md)）。当前自动化单元测试为 82/82（另加 npm run smoke:panel 真实 Chrome 冒烟）（含 5 条配对速度预算、12 条侧栏聊天状态机、3 条侧栏文案与接线）；
`npm run bench` 九场景全绿，`npm run monkey` 与 `npm run monkey:panel` 随机混沌不变量全绿。多客户端真实 Chrome 验收仍在进行，
不要把尚未完成的 run 记录为通过。此前 live 数字属于旧版/单客户端基线。

## 日常循环

```bash
cd cowork_lite

# 1. 改代码（无构建步骤，纯 ES module，存盘即生效）
# 2. 跑协议测试（2-3 秒，不需要 Chrome）
npm test
# 3. chrome://extensions → 点本扩展的 ↻（重新加载已解压扩展）
# 4. 侧栏点开验证
```

**扩展没有打包/编译环节。** SW 和内容脚本改动后必须在 chrome://extensions
点刷新；刷新侧栏即可。

## 三种植入验证方式

### A. 协议测试（CI 级，全自动）
`npm test` —— `tests/protocol.test.mjs` 会 spawn 真的 MCP 子进程，再用一个
「模拟扩展」（Node fetch SSE + POST）把配对、工具调用、user_message 全链路跑完。
**不需要装插件、不需要 Chrome。** 改协议/桥接/配对逻辑后必须跑。

### A2. 提示词与安装源自测（CI 级，全自动）
```bash
npm test                                    # 含 tests/prompt.test.mjs
node scripts/verify-install-discovery.mjs   # 只看 Gate 0 的发现结果
```

`tests/prompt.test.mjs` 守住这些事：提示词只有英文（无 CJK 字符、无中文标点，
且不受界面语言影响）、Gate 0 给出扩展 ID 指纹与可执行的定位命令、保存过安装源目录时
该路径被写进提示词且仍要求哈希校验、Chrome ID 算法与真机记录一致。

`scripts/verify-install-discovery.mjs` 会造一个「装过好几次」的临时 HOME——完整仓库、
一份**完全相同的拷贝**、同名但 `package.json` 不匹配的旧项目、`.agentlimb.backup-*` 备份、
`node_modules` 副本，以及一个模拟的 Chrome profile（`Secure Preferences` 里按扩展 ID 记着路径）——
然后执行**提示词里发布的两条命令原文**（从 markdown 里提取，不是另写一份）。三段结果：

- Step 1 profile 反查：应返回被"加载"的那个目录（`PASS`）
- Step 2 扫描 + 哈希兜底：应只命中一个目录（`PASS`）
- 无 ID 时的 `package.json` 规则：应命中两个（相同副本分不开）——这条 `PASS` 是**故意的**，
  用来证明为什么必须把 ID 放在第一位

`--keep` 保留现场。

### B. 无浏览器链路验证
```bash
node bin/agentlimb.mjs mcp        # 起到 MCP + 桥接
node bin/agentlimb.mjs status     # 另一个终端探测
```
此时没有任何浏览器连接，`tools/call` 会在 20s 后报
`no browser extension connected` —— 这是预期，用来验证「没扩展时报错路径」。

### C. 真机验证（需要你亲自加载插件）
见下方「真机验证清单」。

### D. 自动化真机验证（Chrome for Testing + CDP）

**日常只需要一条命令**（已入库，可反复跑）：

```bash
node scripts/live-test.mjs          # 按当前测试内容报告断言数，约 40s
node scripts/live-test.mjs --keep   # 失败时留着浏览器窗口看现场
```

它自己做完这些事：清掉上一轮残留 → 起一个本地测试页（带按钮/输入框/折叠线以下元素）
→ 用隔离 profile 起 Chrome for Testing 装扩展 → 用一个**真的 MCP 客户端**（和 AI 软件
完全同一条 stdio 路径）走完：配对 → `tab_new`（后台）→ `read_page` → `find` →
`computer click`（含折叠线以下）→ `form_input` → `computer screenshot` →
`browser_batch` → 侧栏发消息（Enter 发送）→ agent 收到页面上下文 + 截图 →
`say` 最终回复 → 不可读页面诚实告知 → `tab_close` → 断开。侧栏聊天态须由存活 SSE
连接与匹配的受信任 `connectedClientId` 共同确认；状态由扩展后台 `chrome.runtime` 广播给 UI，
单独记住信任时仍应显示复制提示。

产物：`/tmp/agentlimb-verify/live/summary.json` + `shots/*.png`。

**为什么不用系统 Chrome**：Chrome 155 已移除 `--load-extension`（传了也被静默忽略，
`--disable-features=DisableLoadExtensionCommandLineSwitch` 也救不回来）。
要用 Playwright 缓存的 **Chrome for Testing 149**：

```bash
CFT="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
"$CFT" --user-data-dir=/tmp/agentlimb-verify/profile \
       --load-extension=/tmp/agentlimb-ext \
       --remote-debugging-port=9333 \
       --no-first-run --no-sandbox --disable-gpu about:blank
```

- 沙箱环境里 Chrome 必须加 `--no-sandbox --disable-gpu`，否则
  `sandbox initialization failed` → GPU 进程 FATAL → 主进程直接退出
- 验证点按顺序：`/json/list` 出现 `service_worker` 且 URL 含
  `kernel/control/background/service-worker.js`（**这就是 SW 注册成功的硬证据**）
  → `/health` 的 `browsers>=1` → 点复制授权 → `activeBrowser:true` → `tools/call`

## 配对速度自测（bench + monkey）

配对是**唯一**会让用户觉得「这插件坏了」的环节：装完、点复制、粘贴，如果两三秒内没有反馈，
用户就会怀疑要填码、要改配置、要重启。所以配对速度不是一个感觉，而是三个可测的数字：

| 指标 | 含义 | 预算 |
| --- | --- | --- |
| `discover` | 桥接开始监听 → 浏览器完成授权 | < 1000 ms |
| `handshake` | SSE 建连 → 宿主收到 GRANT | < 400 ms |
| `tool` | `callTool()` → 浏览器执行完 | < 50 ms |

### 三个决定速度的数字

| 位置 | 常量 | 值 | 作用 |
| --- | --- | --- | --- |
| `kernel/shared/constants.js` | `DISCOVERY.HUNT_MS` | 300 ms | **什么都没连上时的扫描间隔——这就是首次配对延迟** |
| 同上 | `DISCOVERY.IDLE_MS` | 1000 ms | 已有一个 AI 在线时的扫描间隔（工具调用是推送，不需要快扫） |
| 同上 | `DISCOVERY.PANEL_HUNT_MS` | 250 ms | 侧栏等待连接时的唤醒间隔 |
| 同上 | `DISCOVERY.PANEL_WARM_MS` | 20 s | 已连接时侧栏仅用来防止 MV3 SW 睡死 |

MV3 的 service worker 空闲约 30 秒就被杀，**被杀掉的 worker 看不见新起来的桥接**——这是「配对慢」
的另一半原因。因此侧栏（一个不会被挂起的普通页面）承担唤醒职责：没连上就每 250 ms 发一次
`AGENTLIMB_ENSURE`（收到消息这件事本身就会唤醒 worker，并顺带跑一次扫描），已连接就每 20 s 发一次
保温。侧栏关闭时只剩 `chrome.alarms`（30 s，Chrome 的下限）兜底，那条路径的恢复上限就是 30 秒。

### 跑法

```bash
npm run bench                     # 9 个场景 × 3 轮，输出中位数表
npm run bench -- --runs 10        # 更多轮次
npm run bench -- --json           # 机器可读
npm run bench -- --only cold-pair,second-ai
npm run bench -- --cadence 2000   # 复现旧的固定 2 秒扫描，用来看前后对比

npm run monkey                    # 30 轮随机混沌 + 不变量检查
npm run monkey -- --iterations 200 --seed 7 --verbose
```

两个脚本都在 `scripts/` 下，共用 `scripts/lib/pairing-harness.mjs`：宿主用真的
`host/bridge-server.mjs`，浏览器侧用真的 `kernel/control/background/bridge-client.js`，
只补 Node 缺的两个 API（`EventSource`、`chrome.*`）。所以量出来的就是扩展真实看到的数字，
不需要装插件、不需要 Chrome。

### 实测（本机 macOS，各 6 / 5 轮，单位 ms）

| 场景 | 说明 | 现在 discover | 旧 2 s 扫描 |
| --- | --- | --- | --- |
| `cold-pair` | 全新安装：窗口已开、面板在等、AI 刚启动 | **257** | 1970 |
| `wake-then-pair` | 桥接先起来，worker 之后被唤醒 | **211** | 226 |
| `warm-reconnect` | 已受信的 AI 重启，不点复制 | **300** | 2011 |
| `no-window-then-copy` | 没授权 → 快速拒绝 → 点一次复制即放行 | **195**（copy 128） | 1892 |
| `window-expired` | 30 分钟窗口过期 | **191** | 1886 |
| `second-ai` | 第一个 AI 在线时启动第二个 | **285** | 1991 |
| `port-contention` | 28765–28767 被占，落到 28768 | **258** | 1968 |
| `impostor-port` | 28765 上有个非 AgentLimb 的 200 服务 | **253** | 1963 |
| `stream-drop-recovery` | 流被掐断后自动恢复 | **48** | 49 |

握手本身稳定在 50–60 ms（Node 测试台的噪声），与扫描节奏无关——也就是说配对快慢几乎全部
由「多久扫一次」决定，而不是协议本身。`wake-then-pair` / `stream-drop-recovery` 两行新旧几乎一样，
因为那两条路径本来就立刻扫一次，不依赖定时器。

**测试和基准必须用 `TEST_BRIDGE_PORTS`（28765–28770），不能用默认的 8765–8770。**
你日常 Chrome 里装着这个扩展，它的发现循环会持续扫描默认端口段；测试宿主一旦起在那里，
几百毫秒内就会被真实浏览器连上并回一句 `grant{ok:false}`——看起来完全像被测代码有 bug。
`createBridge` / `createBridgeClient` 都接受 `ports`，宿主还支持
`AGENTLIMB_BRIDGE_PORTS=28765,28766` 环境变量。

`tests/pairing-speed.test.mjs` 把其中 5 条固化成 CI 断言（首次配对 < 1000 ms、
第二个 AI < `IDLE_MS + 800`、一次复制只授权一个 AI、GRANT 丢失会重试而不是假连接、过期窗口不留死码）。
**改 `DISCOVERY` 里任何数字都会直接让这些断言变红**，这是故意的。

### 加一个场景

在 `scripts/pairing-bench.mjs` 里加一个 `scenario('名字', async () => ({ ok, ms, notes }))` 即可，
harness 会负责起临时 HOME、起宿主、装 mock chrome、算 p50/p95。要复现「旧的慢」就传
`--cadence`；要复现「worker 睡着」就 `client.stop()` 再 `start()`。

### 猴子测试检查什么

`scripts/pairing-monkey.mjs` 不验证某个特定顺序，它验证**无论发生什么，状态仍然是自洽的**。
每轮随机造一个世界（0–3 个 AI 宿主、随机预置信任、随机窗口），再随机施加操作
（起停宿主、掐流、复制、取消、撤销、发工具调用、空转），每一步之后检查：

1. 不报「在线」的客户端，其宿主必须真的在跑
2. 面板显示的已配对，必须在 `chrome.storage.local` 里真的有记录（不许只显示）
3. `unauthorized` 列表里不能出现已配对的客户端
4. `connectedClientId` 必须是已配对且在线的
5. 宿主与浏览器对「谁能驱动」的判断必须一致（在线+已配对 ⇒ 宿主侧 `activeBrowser` 为真）
6. `callTool` 必须在自己的 timeout 内结束，不许挂死

用 `--seed` 可以复现任何一次失败。

## 侧栏聊天猴子测试（`npm run monkey:panel`）

配对猴子测「连上」。这个测「连上之后别卡死」——它存在的理由是一次真机死锁：
在侧栏发消息后面板永远显示「等待回复」，点停止永远显示「已请求停止」。根因是侧栏消息
只能搭在 agent 的下一次工具结果上送达，agent 空闲时根本看不到，而面板在等一个永不会来的回复，
并且这个「等待」同时锁了输入和控制权。

每轮随机对两个 AI 施加 send / stop / say / tool_call / drop / reconnect / switch / warp（把时钟推过所有期限）/ reject，
每步之后检查：

1. `getStatus()` 不抛错
2. **输入只可能被「消息正在飞」锁住**，永不被「等待回复」或「工具在执行」锁住
3. **没有任何等待超过自己的期限**（回复 60 s、停止 20 s；期限在 `getStatus()` 里按读取时间结算，
   所以 worker 睡眠也不会漏掉）
4. **状态最终收敛**：每个被派发的工具都有答案，每条被接受的消息都被送达或随 `say` 正常结帖

`--seed` 可复现；`--verbose` 看每一步。已跑过 7 个种子 × 30 轮全绿。

## 真机验证清单

在 Chrome 加载 `cowork_lite`（开发者模式 → 加载已解压）后：

1. **未连接态**：点扩展图标 → 侧栏有复制提示词和设置入口，并说明侧栏与控制运行无关 → 点复制 → 粘贴到
   任意文本编辑器，确认提示词含生成 `mcpServers` 配置的安装命令和 `~/.agentlimb/host/mcp-server.mjs`
   以及「替换 ~ 为绝对路径」的警告
2. **图标开关**：侧栏开着时再点一次扩展图标 → 侧栏关闭（开/关切换，Cmd/Ctrl+E 同效）
3. **首次授权**：点复制提示词即打开 30 分钟接入窗口，启用 MCP 后匹配的首次身份应自动受信，全程不应出现任何确认页；窗口过期后应得到「未授权 + 让用户点复制」的可执行错误，而不是长时间等待。
4. **多 AI 管理**：并行启动两个以上不同身份 MCP，确认最多六个宿主可同时在线，已配对信任各自保留；聊天顶栏显示当前 AI 与配对数量。新身份点一次复制即完成授权；已信任软件启动/握手不自动抢 controller。管理器只允许选在线客户端，选中后当前 controller 改变。
5. **聊天（带页面上下文）**：侧栏四态为未连接、已连接、正在操作、等待回复，优先级依次为
   未连接 > 正在操作 > 等待回复 > 已连接。页面采集/发送和浏览器工具工作时显示「正在操作」，
   工具调用间保持该状态；任务完成后 agent 必须调用 `say` 给出最终回复，不要用 `say` 播报进度；它是明确的结束信号。
   智能体不用调 `tabs_context`/`read_page` 就能答；采集或发送失败时草稿保留。
   侧栏仅保留最近 20 条用户/agent/system 记录，不记录操作步骤，也不向 AI 重放记录。
   输入框按模式显示 placeholder，Enter 发送、Shift+Enter 换行。空闲时组合按钮显示「发送」；正在操作或等待回复时显示「停止」。点击停止只发送普通 `user_message`：
   `用户请求停止当前任务：请停止后续浏览器操作，并用 say 回复确认。` 不附页面上下文或截图，也不触发页面采集；没有 `stop_agent` 帧或宿主强制取消。重复点击只请求一次；输入保持禁用，显示「已请求停止，等待 AI 确认…」，收到最终 `say` 才清除请求及操作/等待状态。断开或重连会清除这些状态。本轮已验证隔离 Chrome 与真 MCP stdio 的消息投递及确认状态；是否停止后续行为由收到消息的 AI 执行。
6. **操作状态与标签分组**：工具工作期间只显示单一「正在操作」状态。`tab_new` 将本次新建标签
   加入当前窗口橙色 AgentLimb 分组，后续新建标签复用该组，默认仍在后台打开。
7. **agent 侧工具调用**：用任意 MCP 客户端连上后调用 `ping`，应返回 pong
8. **控制锁与排队**：当前 controller 正在执行任务时，`SELECT_CLIENT` 返回 busy，不强切；其他客户端的非 ping 工具排队，宿主 deadline 到期后必须拒绝且不能执行；`ping` 不抢控制。当前任务完成 `say` 后新客户端才接管。
9. **信任生命周期**：关闭或临时断开某 host 只标离线，不撤销 trust；设置里的移除只删除所选 AI 信任，其他客户端不变。用原名称/类型重启后应自动恢复该身份在线状态，不要求重新配对。

## 调试技巧

- **SW 日志**：chrome://extensions → 本扩展「Service Worker」链接 → DevTools Console
- **侧栏日志**：侧栏右键 → 检查
- **内容脚本日志**：页面 F12 → Console（a11y-tree / indicator 的日志在这）
- **宿主日志**：MCP 进程的 stderr，同时以 `notifications/message` 推给 agent
- **协议抓包**：host 侧所有帧都有 log；扩展侧在 bridge-client.js 的
  `handleFrame` 里加 `console.log(JSON.stringify(frame))`
- **配对状态文件**：`~/.agentlimb/trust-<hash>.json` 是每客户端的权威信任记录；`paired-clients.json` 是兼容索引。隔离测试使用独立 HOME/profile，不删除日常用户记录
- **扩展侧配对存储**：DevTools → Application → Storage → Extension → local storage
  （key: `agentlimb.pairedClients`）

## 已知坑（踩过）

1. **相对导入层级**：`host/*.mjs` 导入 kernel 是 `../kernel/...`（一层），
   `bin/agentlimb.mjs` 也是 `../kernel/...`。安装到 `~/.agentlimb` 时**必须保持
   目录镜像**（install.sh 已处理），否则 ERR_MODULE_NOT_FOUND。
2. **`chrome.tabs.sendMessage` 必须显式 `{frameId: 0}`**：不传则多 iframe 页面
   响应来源不确定。
3. **测试里别提前 await `mcp.request('tools/call')`**：模拟扩展还没回
   tool_result 就 await 会死锁 20s 超时。正确姿势：先拿 promise，等 SSE 上出现
   tool_call 帧，回结果，再 await。
4. **manifest 有 `default_locale` 就必须有 `_locales/<lang>/messages.json`**，
   否则扩展加载失败。本版移除完整 `_locales` 框架；侧栏自身支持自动/简中/English。
5. **CSP**：manifest 的 `extension_pages` 必须放行 `http://127.0.0.1:*`，
   否则 SW 的 fetch/EventSource 全被拦。
6. **MV3 SW 休眠**：空闲约 30 s 就被杀，SSE 随之断流，而**被杀掉的 worker 看不见新起来的桥接**。
   现在有两层：侧栏在等连接时每 250 ms 发一次 `AGENTLIMB_ENSURE`（消息本身会唤醒 worker），
   已连接时每 20 s 保温；侧栏关闭时靠 `chrome.alarms` 的 0.5 min 兜底（Chrome 会把周期钳到 30 s，
   这是下限）。宿主侧 `waitForGrant` 因此放宽到「曾经连过就等 35 s」，避免 worker 睡醒前就报错。
   别再靠 `setInterval` 保活——它跟着 worker 一起消失。
7. **多 MCP 客户端**：扩展最多同时连接 `BRIDGE_PORTS` 中六个 host，但一个 `connectedClientId`
   controller 持有任务锁。已信任握手不自动切换；忙时拒绝强切，排队任务按宿主 deadline 过期后不执行。
8. **SW 注册失败（Errors 页 `Status code: 15` + `Unexpected token '{'`）**：
   模块语法错误或 import 路径错误，SW 整个起不来，插件所有功能全灭。
   两个教训：① `node --check` 只查语法、**不解析 import 路径**；
   ② 早先一次「全文件语法检查」把输出接进管道，退出码被 `head` 吞掉，
   误报全绿——查语法必须看退出码。现在 `tests/extension-modules.test.mjs`
   用 chrome 桩真正 import 全部扩展模块（含 SW 的 bootstrap），这类错误
   在 `npm test` 里就会挂。
9. **`--load-extension` 在系统 Chrome 155 已失效**：命令行传了也不报错、也不加载
   （`--disable-features=DisableLoadExtensionCommandLineSwitch` 无效）。想自动化
   起浏览器验扩展，只能用 Chrome for Testing（见「D. 自动化真机验证」）。
   另外沙箱里跑 Chrome 必须 `--no-sandbox --disable-gpu`，否则 GPU 进程 FATAL。
10. **改完 SW 代码、点 ↻ 后仍报同样的旧错误（错误页代码片段却是新的）**：
   这是**扩展代码缓存**（Extension Code Cache 按 `扩展ID + 版本号 + 文件路径` 缓存
   编译产物，不含内容哈希）在起作用——解析用的是旧脚本，而错误页的代码片段
   是 `developerPrivate.requestFileSource` 从磁盘读的**当前**文件。判断依据：
   「片段看着完全正确，报错却指向它」。解法按顺序试：
   ① 错误页点 **Clear all** 再 ↻；② **bump `manifest.json` 的 version**
   （缓存键变化，最可靠）；③ 彻底重启 Chrome。若三条都做完还复现，才是真错误。
11. **自动化测试里不要用 CDP `Target.createTarget('chrome://…')`**：在本机
   `--no-sandbox` 的 CfT 里创建 chrome://extensions 目标（或把它 `Page.bringToFront`）
   会让整个测试进程组被 SIGKILL——日志停在那一行、连 `finally` 都不执行。
   要测「不可读页面」这条分支，用扩展页（`chrome-extension://<id>/…`）当当前标签即可，
   走的是同一段 `restricted` 代码。功能本身人工验证过：在 chrome://extensions 上
   发消息，AI 收到的是「Chrome does not allow reading or controlling this page type」。
12. **真机测试要在后台跑**：`node scripts/live-test.mjs` 会弹出 CfT 窗口并切前台，
   在受管的 shell 里前台跑容易被整组杀掉；用 `run_in_background` 或
   `sh -c '... > log 2>&1; echo exit=$?' &` 再读日志。
13. **测试宿主不能用默认端口段**：日常 Chrome 里的扩展一直在扫 8765–8770，测试桥接起在那里会在
   几百毫秒内被真实浏览器连上、握手、然后被拒（`grant{ok:false}`），于是 `deniedReason` 被设上，
   未授权用例全挂。用 `TEST_BRIDGE_PORTS`（28765–28770）或 `AGENTLIMB_BRIDGE_PORTS`。
   症状很好认：日志里出现「browser connected (2 total)」而你只开了一个 SSE。
14. **`node --test` 默认按文件并行**：本项目所有集成测试都要真端口，并行会把 6 个端口用光，
   表现为随机几个用例失败。`npm test` 已固定 `--test-concurrency=1`。
15. **`--virtual-time-budget` 遇到循环定时器不会结束**：侧栏未配对时每 250 ms 唤醒一次，
   虚拟时间永远不前进，headless 截图会挂住。要么用 CDP 截图，要么在预览副本里把
   `PANEL_HUNT_MS` 调大。

## 改代码的检查单

- [ ] 改工具 → 同步 `tools.js`（schema）+ `router.js`（实现）+ 文档
- [ ] 改协议 → 同步 `constants.js` WIRE + `bridge-client.js` + `bridge-server.mjs`
      + `docs/protocol.md` + `tests/protocol.test.mjs`
- [ ] 改用户可见文案 → 保持通用定位，**不出现第三方品牌名**（有测试断言）
- [ ] 动到发现节奏 / 配对路径 → `npm run bench` 看数字、`npm run monkey` 看状态自洽
- [ ] 动到侧栏聊天 / 控制锁 → `npm run monkey:panel` 看有没有新的死锁
- [ ] 跑 `npm test`
- [ ] 动到侧栏/工具链路 → 跑 `node scripts/live-test.mjs`；多客户端真实 Chrome 行为须由对应检查实际验证后再标为通过
- [ ] 真机清单过一遍（至少 1/2/3/7）

## 2026-10-22 状态输入与停止请求验证

- `npm test`：24/24；`node scripts/live-test.mjs`：73/73。
- 删除侧栏右上角断开按钮；操作中灰色输入框显示「AI 正在操作浏览器，完成后可继续聊天…」，右侧按钮显示「停止」。等待回复也可发停止请求；采集原消息上下文期间短暂禁用，避免抢先投递。
- 点击停止使用既有 `user_message`，不采集页面或截图；UI/后台均去重，保持配对和忙碌状态。聊天记录只显示「请停止当前操作。」，工具回复约定仅附在发给 AI 的消息中。
- 收到请求后显示「已请求停止，等待 AI 确认…」，最终 `say` 后恢复输入与「发送」；停止发送失败可重试，不丢原问题或草稿。
- 实测覆盖停止消息即时通知、随正在执行的工具结果送达、无图片、未撤销配对、草稿临时收起/恢复，以及原有 20 条记录、分组、断线重连等回归。这里的停止是协作请求，不代表宿主任务被强制中断。
- 日常 Chrome 已重载扩展。当前图片和结果保存在 `忽略上传/验证/2026-10-22-stop-ui/`，不入库。

## 2026-10-22 简化版最终验证（早于停止按钮改动）

- `npm test`：22/22；`node scripts/live-test.mjs`：62/62。包含工具间持续锁定、徽标持续显示、最终回复解除禁用并清理页面指示、侧栏发起多步本地发帖、同时提问被拒绝、内存/存储/重开均为最近 20 条、标签组复用与原用户标签不变。
- 测试宿主和测试扩展副本使用独立的 18765–18767 端口，避免日常 Chrome 发现测试宿主而误授权。`--public` 可另做真实网站访问检查，遇验证码记录为 blocked，不冒充业务通过。
- 日常 Chrome 经本插件 MCP 完成一次真实发帖：测试吧，作者 MistMatter，标题「浏览器自动化操作功能测试」，勾选 AI 内容声明。只提交一次，在最新列表与独立详情页分别回读标题和完整正文：[帖子](https://tieba.baidu.com/p/11127669035)。
- 日常 Chrome 原有标签保持前台，新建工作标签后台加入橙色 AgentLimb 组；原生侧栏读回「正在操作」及禁用输入。结束回复后读回「已连接」及可输入；侧栏问题送达 MCP，带当前页面和一张截图，无旧聊天重放。
- 日常 Chrome 已重新加载最终代码，并实际确认最终回复清除页面辉光/光标。临时验证 MCP 会关闭，保留配对；这不会承诺 AI 软件自行启动新一轮对话。
- 上述验证记录早于停止按钮交互，不能作为停止消息、等待确认 UI 或其宿主响应的测试证据。
- 本机证据保存在 `忽略上传/验证/2026-10-22-simple-panel/`（不入库），含 live-summary.json、real-browser.json 与 400px 侧栏截图。
- 测试端需要按首个 text block 解析工具 JSON：同一结果还可能附带侧栏消息的 text/image block。`say` 回执表示 SSE 已写出，测试须等 UI 恢复可输入后再模拟输入。

## 2026-10-22 侧栏状态控制验证（上一版行为）

- 上一版实现记录：`npm test` 19/19，覆盖在线身份、发送前锁定、重复发送、工具排队/失败、等待回复、断开期间采集失效。该结果不验证当前四态、操作 latch、20 条记录、无历史重放或标签分组行为。
- 上一版实现记录：`node scripts/live-test.mjs` 44/44。隔离 Chrome for Testing + 真 MCP stdio，覆盖灰色禁用、后台拒收、侧栏重载保留等待、`say` 解锁、离线复制提示、免配对重连与草稿保留，以及原有点击、输入、截图与批量操作。该结果不代表本轮文档描述的新行为已验证。
- 400px 实际截图已检查：`/tmp/agentlimb-verify/live/shots/panel-waiting-400w.png` 与 `panel-offline-400w.png`；完整结果在同目录上一级的 `summary.json`（本机临时产物）。
- 测试客户端按行缓冲 stdio，避免截图载荷跨 chunk 时丢帧；断言失败返回非零退出码。
- 断开时 UI 回退先于宿主通知，测试须等待通知到达后断言，不能在界面回退后立即结束宿主。
- 以上证明浏览器与 MCP 链路；实际 AI 软件是否自动处理侧栏通知，仍需在对应软件里验收，不能据此声称已成为宿主原生聊天的等价入口。
