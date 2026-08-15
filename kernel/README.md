# kernel/ — 内核总览

AgentLimb ClaudeCode 的四个核心模块均在此目录。UI 层(`ui/`)通过 `chrome.runtime.sendMessage` 与内核通信，内核不引用 UI。

## 模块关系

```
Claude Code 终端
      │  HTTP/SSE
      ▼
kernel/bridge/          ← 对外连接：HTTP relay + SSE 推送
      │  chrome.runtime.sendMessage
      ▼
kernel/control/         ← 操控模块：11 种浏览器工具（CDP）
      │
kernel/prompt/          ← 提示词模块：自动生成注入提示词
      │
kernel/muscle/          ← 肌肉模块：站点知识持久化
```

## 模块清单

| 模块 | 目录 | 职责 |
|------|------|------|
| 操控 | `control/` | 9 种 CDP 动作 + injector + 11 工具 schema |
| 提示词 | `prompt/` | buildPrompt() 拼接七段式提示词 |
| 对外连接 | `bridge/` | HTTP server(7791) + SSE relay + 桌面文件读写 |
| 肌肉 | `muscle/` | 三层存储 + 四模式沉淀 + 桌面 JSON 持久化 |

## 调试指南

```bash
# 启动 Host（bridge）
node kernel/bridge/mvp/server.js

# 验证 bridge 连通
curl http://localhost:7791/api/mvp/status

# 运行所有单元测试
node --test tests/**/*.test.mjs
```

## 单向依赖规则

- `kernel` 不引用 `ui/` 任何文件
- `kernel/shared/constants.js` 只放跨模块常量，禁止业务逻辑
- 各模块内部自洽，改 muscle 不影响 control 编译
