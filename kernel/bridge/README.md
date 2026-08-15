# kernel/bridge/ — 对外连接模块

提供 HTTP + SSE relay，让 AI 终端（Claude Code / Codex）通过标准 HTTP 控制浏览器。

## 架构

```
AI 终端（Claude Code）
    │  POST /api/mvp/browser-call
    ▼
kernel/bridge/mvp/server.js  (localhost:7791)
    │  chrome.runtime.sendMessage
    ▼
chrome extension SW (kernel/control)
    │  CDP
    ▼
浏览器标签页
```

## 端点清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mvp/status` | Bridge 健康检查 |
| POST | `/api/mvp/browser-call` | 提交浏览器工具调用 |
| GET | `/api/mvp/next-browser-call` | SSE：扩展轮询待执行调用 |
| POST | `/api/mvp/browser-call-result` | 扩展回传执行结果 |
| GET | `/api/mvp/muscle/list` | 列出所有已学习站点（只读） |

## 本地启动

```bash
# 启动 Host
node kernel/bridge/mvp/server.js

# 验证
curl http://localhost:7791/api/mvp/status

# 查看已学习站点
curl http://localhost:7791/api/mvp/muscle/list
```

## 目录结构

```
bridge/
├── mvp/
│   ├── server.js           # HTTP + SSE 主服务（端口 7791）
│   ├── terminal-client.mjs # 终端侧 CLI 客户端
│   ├── muscle-fs.js        # 桌面 JSON 文件读写（~/Desktop/AgentLimb-muscle/）
│   ├── store.js            # 内存任务队列
│   ├── client.js           # 插件侧 HTTP 客户端
│   ├── bootstrap-session.js
│   └── run-server.js       # 启动入口
└── relay/
    └── poll.js             # SSE 轮询逻辑（UI 层调用）
```

## 桌面文件路径

肌肉数据持久化到：`~/Desktop/AgentLimb-muscle/<domain>.json`

由 `muscle-fs.js` 管理读写，server.js 在启动时确保目录存在。
