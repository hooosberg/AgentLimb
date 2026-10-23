# 路线图与已知边界

> 产品目标与「明确不做」见 [product.md](./product.md)。这里只排执行顺序。

## 当前状态（2026-10-22）

- 单元/协议/模块测试 11/11
- Chrome for Testing 149 真机自测 11/11：SW 注册、无确认页授权、工具链、**侧栏聊天闭环**
  （页面上下文 → agent → `say` 回显）
- 系统 Chrome 155 里的人工走查清单见 `development.md`（待跑）

## P0 — 你机器上的人工走查（阻塞「可用」结论）

- [ ] 按 `docs/development.md` 手动清单 1-9 过一遍
- [ ] 重点：`Emulation.setFocusEmulationEnabled` 在常用站点（视频站 / 表单站）的后台控制
- [ ] DevTools 打开时 debugger 冲突的错误提示是否可读

## P1 — 控制链路补强

- [ ] ref 失效的自动恢复：`unknown ref` 时 agent 要重读整页，考虑
      SW 侧缓存「上次 read_page 的 selector 路径」按路径重定位
- [ ] 跨域 iframe 内的元素（现在只读 URL，不可操作）：给每个 frame
      分配 frame 局部 ref 并在 tool_call 里带 frameId
- [ ] 截图带视口元数据（width/height/dpr），agent 做坐标换算时要用
- [ ] `read_console_messages` / `read_network_requests` 真机核对
- [ ] `computer.type` 逐字符路径在富文本编辑器（ProseMirror/Slate）里的行为

## P2 — 侧栏体验

- [ ] 标签栏级的运行指示（Claude Code 那种"沙漏"）：现在只有工具栏图标徽标 `…`
- [ ] AI 回复流式输出（`say` 多次调用 + 前端合并成一条）
- [ ] 操作日志可折叠（现在默认全显示）
- [ ] 多标签上下文一次带入（用户说"这几个标签分别是什么"时自动带 N 个快照）
- [ ] 聊天消息按 client 分节（多 agent 场景）

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
| 面板消息不主动唤醒 | agent 空闲时消息挂在队列里，等它下次调用工具才送达 |
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
