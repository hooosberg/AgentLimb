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

# 起 MCP + 桥接（模拟智能体接入，浏览器未连时会报 no paired browser）
node bin/agentlimb.mjs mcp

# Chrome 加载插件
# chrome://extensions → 开发者模式 → 加载已解压 → 选择本目录（cowork_lite）
```

## 当前状态（2026-10-22）

- [x] MV3 扩展骨架：SW / 侧栏双状态 / 配对页 / 两个内容脚本
- [x] 本地桥接：HTTP+SSE、端口发现、配对注册表（`~/.agentlimb/paired-clients.json`）
- [x] MCP stdio 服务器 + 15 工具目录（扩展/宿主同源）
- [x] 持久 CDP debugger、焦点模拟、自适应截图、console/network 捕获
- [x] 测试 9/9 通过（协议端到端 + 扩展模块冒烟/图标开关行为）
- [x] **SW 注册已在真实 Chrome 内核验证**：Chrome for Testing 149 用
      `--load-extension` 加载后，`/json/list` 出现
      `service_worker → kernel/control/background/service-worker.js`，
      即 SW 注册成功、无语法/import 错误（见 development.md 的 D 节）
- [ ] **完整链路真机走查**：系统 Chrome 155 里手动加载后的配对 / 工具调用 /
      侧栏聊天窗（development.md 手动验证清单 1-9）。注意 Chrome 155 已移除
      `--load-extension`，只能人工在 chrome://extensions 里「加载已解压」
- [ ] Windows 安装脚本实机验证

## 代码结构速查

```
manifest.json                  MV3 声明（注意 content_scripts 两个 + CSP 放行 127.0.0.1）
kernel/shared/constants.js     ★ 协议常量唯一来源（WIRE 帧类型在这）
kernel/control/host/tools.js   ★ 工具目录唯一来源（改工具只改这里）
kernel/control/background/     SW：service-worker(装配) / bridge-client(SSE) / debugger(CDP) / router(执行)
kernel/control/content/        a11y-tree(document_start 常驻) / indicator(辉光+幽灵光标)
kernel/prompt/build-prompt.js  侧栏「复制提示词」内容生成
ui/sidepanel/  ui/pairing/     双状态侧栏 / 配对确认页
host/bridge-server.mjs         HTTP+SSE 桥接（配对注册表、tool_call 关联）
host/mcp-server.mjs            stdio MCP ↔ 桥接
bin/agentlimb.mjs              CLI
tests/                         node:test，protocol.test.mjs 是端到端核心
```

带 ★ 的两个文件是「改一处两端生效」的共享模块，改动时注意同时影响扩展和 Node 宿主。
