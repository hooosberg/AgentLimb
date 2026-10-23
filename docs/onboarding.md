# AgentLimb 接入与故障排查

当前源码版本为 **0.5.7 / l8**（变更记录见 [../CHANGELOG.md](../CHANGELOG.md)）。

接入要完成三件事：安装本地 MCP 宿主、在目标智能体软件中加载并按需启用 MCP、从当前智能体会话验证浏览器工具。侧栏「复制连接提示词」本身就是授权动作：它打开一个 30 分钟、只授权一个 AI 的接入窗口，窗口内第一个连上来的身份自动受信，没有确认页也没有需要填进配置的码。窗口过期就再点一次复制。配置文件、进程或信任记录都不能替代目标会话验收。

## 1. 安装宿主并生成配置

需要 Node.js 18 或更新版本。先在终端确认版本：

```sh
node --version
```

在可信的 AgentLimb 源码目录运行安装器，为目标软件提供稳定的名称和类型标签：

```sh
bash scripts/install.sh --client-name "WorkBuddy" --client-kind "workbuddy"
```

Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 --client-name WorkBuddy --client-kind workbuddy
```

也可以直接调用共享 CLI：

```sh
node bin/agentlimb.mjs install --client-name "WorkBuddy" --client-kind "workbuddy"
```

安装器检查 Node.js 版本，然后把 MCP 宿主文件安装到 `~/.agentlimb`（Windows 为 `%USERPROFILE%\.agentlimb`），并打印 `mcpServers.agentlimb` 配置 JSON。输出中的 `command` 和 `args` 是绝对路径，配置还含 `AGENTLIMB_CLIENT_NAME` 与 `AGENTLIMB_CLIENT_KIND`。若需重新生成同一客户端的配置：

```sh
node bin/agentlimb.mjs config --client-name "WorkBuddy" --client-kind "workbuddy"
```

安装器不会编辑任何智能体软件的配置，也不会覆盖其他 MCP 服务或删除旧 runtime 目录。将输出中的 `agentlimb` 服务项合并到目标软件实际使用的 MCP 配置中，并确认 Node 可执行文件和入口文件仍存在。JSON 配置由客户端直接启动进程，不经过 shell；不要把 `~`、`$HOME` 或未展开的变量当作路径。安装器给出的绝对路径可直接用于配置。

复制连接提示词不需要额外操作：提示词里没有配对码，也没有需要写进配置的密钥。点击复制本身就在扩展里打开了一个 30 分钟的接入窗口，窗口内第一个连上来的未知 AI 自动受信。安装器输出的 MCP JSON 只含 `AGENTLIMB_CLIENT_NAME` 与 `AGENTLIMB_CLIENT_KIND`。

`client-name` 与 `client-kind` 组合是这个客户端的稳定身份标签。每次配置和诊断都要使用相同的值；不要复制另一客户端的身份变量或配对记录。它们用于区分软件身份，并不表示该软件已经启用了 MCP。最多六个 MCP 进程可使用 `BRIDGE_PORTS` 中的独立端口同时接入；每个客户端接入前各点一次复制即可。

## 2. 在目标智能体软件中加载 MCP

按目标软件实际支持的格式合并配置，保留其他服务，然后在该软件中启用或信任 AgentLimb MCP（如果软件要求这一步）。重新加载 MCP 或按软件要求重启，使新配置生效。配置格式、设置入口和信任操作因软件而异；本说明不推测 WorkBuddy 或其他软件的具体菜单位置。

以下观察可以证明配置已写入磁盘，但不能单独证明目标软件已加载或信任它：配置 JSON 存在、`mcp-server.mjs` 文件存在、某个 AgentLimb 进程运行、端口可达，或 `trust-<hash>.json` / `paired-clients.json` 有记录。每个 `trust-<hash>.json` 是单客户端独立信任记录；`paired-clients.json` 是兼容索引。只有目标软件显示连接状态/工具，或目标会话实际调用到 AgentLimb 工具，才证明软件端已经接入。

## 3. 自动完成 Chrome 授权（无确认页）

确认目标智能体软件已经启动它自己的 AgentLimb MCP 后，保持 Chrome 运行并启用当前 AgentLimb 扩展。必要时打开扩展侧栏唤醒发现。只要复制提示词打开的接入窗口还在有效期内，扩展就会自动完成首次授权，不会弹出任何页面。

智能体软件内的 MCP Trust/Enable 仍需按该软件的真实状态处理；接入窗口只省去 Chrome 侧的确认，不会替用户在智能体软件里启用 MCP。不要猜测 WorkBuddy 或其他客户端的具体信任 UI，也不要把配置写入或终端启动当成已信任证据。

窗口过期或已被别的 AI 用掉时，扩展当场回一句 `not_authorized`，宿主把工具调用变成可执行错误：让用户点一次侧栏「复制连接提示词」再重试。不需要改 MCP 配置、不需要重启软件、也不需要重装。侧栏同时会显示「有一个 AI 想接入，但还没获授权」，点复制即放行已经连着的那一个。

宿主以名称和类型组合创建稳定身份。旧版共享 `client-id.json` 不会迁移成新身份；升级后每个新身份首次连接需要一次接入窗口。同一身份信任会保留并可自动重连，即使其他 AI 曾经接管；更换名称或类型会形成新身份并需单独授权。打开已信任软件或完成握手不会自动抢控制。

Chrome 可同时保留多个 AI 的信任，但浏览器任务由单一 controller 串行执行。侧栏顶栏显示当前 AI 和已配对数量；点击数量可打开管理器查看在线、等待接手或已保存离线的客户端。只有在线客户端可被选择。`SELECT_CLIENT` 在当前任务空闲时切换，忙时返回 busy，不会中断任务。新 AI 经一次复制窗口授权后可在空闲时接管；如果当前 AI 正在执行任务，它会等到当前任务结束。`ping` 只检查当前链路，不抢占 controller。聊天记录和草稿按 AI 隔离。

设置在在线和离线状态都能打开，包含「连接其他 AI」「已连接 AI」「语言」「关于」。语言可选自动、简体中文或 English，选择会保存在扩展本地存储。移除操作只撤销所选 AI 的 trust；host 退出或网络临时断开只标离线，不撤销任何 trust。

## 4. 用 `doctor` 读取当前阶段

在源码目录执行只读诊断，并传入当前目标软件的同一组标签：

```sh
node bin/agentlimb.mjs doctor --client-name "WorkBuddy" --client-kind "workbuddy"
```

也可以设置 `AGENTLIMB_CLIENT_NAME` 和 `AGENTLIMB_CLIENT_KIND` 后运行 `doctor`。CLI 输出 JSON，包含目标身份、Node 路径/版本、本机安装路径检查、配对记录检查和探测到的桥接状态。WorkBuddy 标记还会包含本机配置文件的只读检查结果；配置文件存在仍不证明 WorkBuddy 已加载或信任 MCP。

按 `stage` 处理：

| 阶段 | 已观察到什么 | 下一步 |
|---|---|---|
| `target_required` | 未指定诊断对象 | 传入目标软件的 `--client-name` 和 `--client-kind`，不能把任意在线桥接当成当前会话。 |
| `no_matching_mcp` | 当前没有探测到匹配名称/类型的 MCP 桥接 | 检查目标软件的实际 MCP 配置、启动错误、启用/信任状态和工具刷新。若没有目标进程，信任状态仍是未知；不能据此断言软件拒绝信任。其他名称的桥接或旧端口也不能证明当前软件已连接。 |
| `awaiting_extension` | 目标 MCP 桥接已启动，但没有浏览器扩展连接 | 检查 Chrome 是否运行、当前扩展是否启用/报错，并打开侧栏触发发现。 |
| `awaiting_authorization` | 已有浏览器连接，但这个 AI 还没获授权 | 让用户点一次侧栏「复制连接提示词」再重试；不要改配置、不要重启。没有弹窗是正常的——这套流程里没有确认页。 |
| `browser_ready_ping_required` | 目标桥接与浏览器握手已就绪 | 从目标智能体会话实际调用 AgentLimb `ping`。 |

若诊断结果与软件 UI 不一致，保留原始输出和软件显示的状态，按尚未证实的阶段继续排查。没有目标 MCP 进程时，`doctor` 只能说明未观察到该身份，不能推断是未信任。不要猜测不信任的原因，不要删除 `~/.agentlimb`、客户端配置、浏览器资料或配对数据来试错，也不要从 `runtime` 等旧目录挑选可执行文件冒充当前安装。

## 5. 完成验收

从正在配置的智能体会话调用 AgentLimb 的 `ping` 工具，再调用 `tabs_context`。注意，MCP 协议自身的 `ping` 只检查协议响应，不是浏览器验收。目标会话收到 AgentLimb 浏览器 `pong` 并取得标签列表，才证明当前会话能使用浏览器链路。此时先调用 `say` 向浏览器侧栏发送简短配对成功状态，然后在当前 AI 对话告诉用户：「配对成功，现在可以直接告诉我你想做什么，例如总结当前网页或打开一个网页。」成功后不要机械要求重启、再次授权或开新会话。终端手动启动的 MCP、其他智能体软件或自动化测试中的成功不能替代这一项。

MCP 初始化响应也包含同样的成功与下一步说明，供重启后或新开会话的 AI 使用。

如果当前 AI 会话没有 AgentLimb 工具，明确说明「当前会话尚未启用 AgentLimb MCP」，并按已观察证据只给必要动作：AI 软件明确要求 Trust/Enable 时由用户授权；刚修改配置且软件要求刷新时才重载或重启；仅当 MCP 工具在另一个会话可用时才开新会话。工具缺失时不能宣称配对成功，也不能因缺少 MCP 进程就断言用户拒绝信任。

连接后侧栏可以关闭；浏览器控制不依赖侧栏保持打开。侧栏用于聊天和状态显示。

## 自动化测试范围

`node scripts/live-test.mjs` 使用独立临时 HOME、Chrome profile、扩展副本和私有端口；默认运行结束后清理临时宿主安装、配对和浏览器数据，不碰日常用户 HOME 下的 AgentLimb 安装。不要把这项清理与卸载用户的日常安装混为一谈。

此前 81/81 的 live 报告是单客户端链路基线，不能视为 0.5.7/l8 多客户端验收。当前自动化单元测试为 82/82；多客户端真实 Chrome 验收仍在进行，尚无结果可报告。目标软件真实 UI 的配置加载、Trust/Enable 和指定模型行为也必须分别验收。


## 本地模型实测与随机测试

```sh
# 用 czen 的 hy3 模型从空 HOME 安装，下一会话加载 MCP 并操作真实 Chrome
node scripts/ai-onboarding-test.mjs
# 可通过 AGENTLIMB_TEST_MODEL / CZEN_PATH / CHROME_PATH 指定本机已有模型和工具

# 随机动作可用 seed 重放；默认 120 步，每步验证工具恢复及聊天输入恢复
node scripts/live-test.mjs --monkey
AGENTLIMB_MONKEY_SEED=42 AGENTLIMB_MONKEY_STEPS=120 node scripts/live-test.mjs --monkey
```

模型实测需要本机已有可用的 czen/Zen Gate 与 Chrome for Testing。测试分为安装会话和加载 MCP 的新会话，使用独立客户端配置；新版测试直接点击隔离侧栏的复制按钮取得本次授权；后续不会代点任何确认页，因为流程里已经没有确认页——若出现页面即为回归。模型必须用 MCP 工具完成点击和输入，程序独立读取页面结果，不能用模型自己的「成功」描述作为验收。

随机测试覆盖点击、输入、滚动、导航、无效标签/元素、未知工具、忙碌时重复消息、侧栏重载和并发工具。报告包含随机种子和逐步轨迹，失败的原始报告应保留。两种测试都只清理本轮拥有的进程、安装与浏览器目录；保留 summary、日志和截图供复核。


2026-10-22 改造前基线（0.5.0，历史记录）：czen/hy3 从空安装到真实 MCP 操作共 12/12 检查通过，独立读取网页确认按钮点击一次且输入文本匹配；模拟用户批准发生在隔离浏览器。随机 seed 20261022 与 42 各 120 步，完整集成检查分别 82/82 通过。单元与协议测试 34/34 通过。这些是旧版本指定环境的功能验证，不是跨模型成功率统计，也不替代 WorkBuddy 软件内的信任入口验收或当前多客户端测试。
