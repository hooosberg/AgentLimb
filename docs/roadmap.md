# 路线图与已知边界

## 当前状态（2026-10-22）

协议层 6/6 测试通过；浏览器内行为**未经真机验证**。按优先级排下一步。

## P0 — 真机验证（阻塞「可用」结论）

- [ ] 按 `docs/development.md` 真机清单过 8 项
- [ ] 重点验证：`Emulation.setFocusEmulationEnabled` 在常用站点
      （YouTube / GitHub / 表单页）的后台控制是否真的生效
- [ ] 验证 DevTools 打开时 debugger 冲突的错误提示是否可读

## P1 — 控制链路补强

- [ ] `computer.type` 对 React/Vue 受控输入：`Input.insertText` 是否触发
      框架的合成事件；不生效则退化为「聚焦 + dispatchKeyEvent 逐字符」
- [ ] ref 失效的自动恢复：`unknown ref` 时 agent 要重读整页，考虑
      SW 侧缓存「上次 read_page 的 selector 路径」按路径重定位
- [ ] 跨域 iframe 内的元素（现在只读 URL，不可操作）：考虑给每个 frame
      分配 frame 局部 ref 并在 tool_call 里带 frameId
- [ ] 截图带视口元数据（width/height/dpr），agent 做坐标换算时要用
- [ ] `read_console_messages` / `read_network_requests` 真机验证
      （依赖 Runtime/Network 域常驻捕获）

## P2 — 侧栏体验

- [ ] 已配对态的「AI 正在操作第 N 个标签」轻提示（无步骤语义，一行字）
- [ ] 聊天消息按 client 分色/分节（多 agent 场景）
- [ ] agent→面板消息：加 `say_to_user` 工具（D6 里预留的方向）
- [ ] 侧栏主题跟随系统（CSS 已用 prefers-color-scheme，需真机核对）

## P3 — 分发与生态

- [ ] Chrome Web Store 上架材料（截图、权限说明、隐私声明）
      —— 注意权限里有 `debugger`，需要向审核解释用途
- [ ] `npx` 分发宿主：`npx agentlimb-mcp`（把四个 .mjs 打成一个包发布）
- [ ] Windows 安装脚本实机验证（install.ps1 只做过语法检查）
- [ ] 从 `workspace` 分支迁回 muscle 记忆作为 opt-in 模块（D8）

## 已知边界（非 bug，设计使然）

| 边界 | 说明 |
|---|---|
| 单活跃浏览器 | 多 Chrome profile 同连，最后配对的胜出 |
| 聊天是留言语义 | agent 空闲时面板消息不主动触达（D6） |
| 首次连接有唤醒延迟 | SW 休眠时最长 ~1 分钟自动连上；开侧栏可立即触发 |
| 仅 frameId 0 | 跨域 iframe 内容当前只读不可操作（P1 有解） |
| 工具上限 20/批 | browser_batch 防 agent 把整任务塞一帧 |
| 无云端通道 | 纯本地；远程控制不在本期范围 |

## 从 workspace 分支可迁回的资产

需要时按需搬，不要整体合：
- muscle 记忆三件套（`kernel/muscle/` + 三个工具 + 桌面 JSON 存储）
- 任务进度机制（`kernel/prompt/` 旧版 + 侧栏进度渲染）
- 12 语言 i18n（`_locales/`）
- 官网（`website/`，独立部署，与插件代码无耦合）
