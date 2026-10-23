# AgentLimb (Lite) 开发文档

本目录是 `lite` 分支（精简版插件）的持续开发文档。与根目录 `README.md`（产品视角）不同，
这里的一切都面向「继续写代码的人」。

## 文档地图

| 文档 | 内容 | 什么时候读 |
|---|---|---|
| [product.md](./product.md) | **产品目标、交互原则、明确不做、验收标准** | 决定「该不该加这个功能」之前 |
| [architecture.md](./architecture.md) | 三端架构、模块逐文件说明、控制链路时序 | 改任何代码之前 |
| [protocol.md](./protocol.md) | HTTP 端点、SSE/POST 帧格式、MCP 方法、错误语义 | 动协议/加工具时 |
| [development.md](./development.md) | 本地开发工作流、手动验证清单、调试技巧、已知坑 | 每天开发时 |
| [decisions.md](./decisions.md) | 设计决策记录（为什么这样做、不那样做） | 想改架构时先读 |
| [roadmap.md](./roadmap.md) | 已知边界、未完成项、下一步计划 | 规划迭代时 |

## 30 秒上手

```bash
# 跑协议测试（不需要装插件，模拟扩展自动配对）
# 也会真正 import 全部扩展模块——SW 注册类错误在这里就会暴露
npm test

# 配对速度基准：9 个场景的毫秒数（--cadence 2000 可对比旧行为）
npm run bench

# 配对状态混沌 + 侧栏聊天混沌（不变量检查，不是顺序断言）
npm run monkey
npm run monkey:panel

# 起 MCP + 桥接（模拟智能体接入，浏览器未连时会报 no paired browser）
node bin/agentlimb.mjs mcp

# Chrome 加载插件
# chrome://extensions → 开发者模式 → 加载已解压 → 选择本目录（cowork_lite）
```

## 当前状态（2026-10-22）

- [x] MV3 扩展骨架：SW / 侧栏双状态 / 两个内容脚本
- [x] 本地桥接：HTTP+SSE、端口发现、配对注册表（`~/.agentlimb/paired-clients.json`）
- [x] MCP stdio 服务器 + **16 工具**（含 `say`，扩展/宿主同源）
- [x] 持久 CDP debugger、焦点模拟、自适应截图、console/network 捕获
- [x] 测试 62/62 通过（协议端到端 + 扩展模块冒烟 + 图标开关 + 信任持久化 + tab_new 竞态 + 配对速度预算 + 侧栏文案接线）
- [x] **配对速度有实测基线**：`npm run bench` 九场景（首次配对 ~257 ms，旧固定 2 s 扫描 ~1970 ms）；
      `npm run monkey` 配对状态混沌 + 六条不变量，`npm run monkey:panel` 侧栏聊天混沌 + 四条不变量
- [x] **SW 注册已在真实 Chrome 内核验证**（Chrome for Testing 149 + `--load-extension`）
- [x] **侧栏聊天闭环自测 11/11**（CfT）：面板发消息 → agent 收到页面上下文（url/title/正文/refs）
      → `say` 回话 → 侧栏出现 AI 气泡（截图见 `docs/product.md` 验收标准 3/4）
- [ ] **在你自己的 Chrome 里走一遍**（development.md 手动清单 1-9）
- [ ] Windows 安装脚本实机验证

## 代码结构速查

```
manifest.json                  MV3 声明（注意 content_scripts 两个 + CSP 放行 127.0.0.1）
kernel/shared/constants.js     ★ 协议常量唯一来源（WIRE 帧类型在这）
kernel/control/host/tools.js   ★ 工具目录唯一来源（改工具只改这里）
kernel/control/background/     SW：service-worker(装配) / bridge-client(SSE) / debugger(CDP) / router(执行)
kernel/control/content/        a11y-tree(document_start 常驻) / indicator(辉光+幽灵光标)
kernel/prompt/build-prompt.js  侧栏「复制提示词」内容生成
ui/sidepanel/                  双状态侧栏（无确认页）
host/bridge-server.mjs         HTTP+SSE 桥接（信任注册表、tool_call 关联）
host/mcp-server.mjs            stdio MCP ↔ 桥接
bin/agentlimb.mjs              CLI
tests/                         node:test，protocol.test.mjs 是端到端核心
```

带 ★ 的两个文件是「改一处两端生效」的共享模块，改动时注意同时影响扩展和 Node 宿主。
