# kernel/prompt/ — 提示词模块

自动生成七段式系统提示词，注入 Claude Code 等 AI 终端。

## 生成链路

```
buildPrompt(context)
  ├── identity.js    → 身份声明段（AgentLimb 角色）
  ├── environment.js → 环境信息段（OS、浏览器版本、Host URL）
  ├── protocol.js    → 生命周期协议段（任务开始/结束协议）
  ├── tools.js       → 工具目录段（从 control/host/tools.js 渲染）
  ├── rules.js       → 行为规则段
  ├── mission.js     → 任务注入段（可选，由调用方传入）
  └── changes.js     → 本轮变更段（版本号 + changelog）
```

## context 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `hostBaseUrl` | string | Host HTTP 地址，默认 `http://localhost:7791` |
| `clientCommand` | string | AI 终端启动命令（用于提示词内说明） |
| `mission` | string? | 当前任务描述（可选） |
| `changes` | string? | 本轮变更说明（可选，覆盖默认） |
| `version` | string? | 版本号（默认读 package.json） |

## 使用方式

```js
import { buildPrompt } from './kernel/prompt/index.js';
const prompt = buildPrompt({ hostBaseUrl: 'http://localhost:7791' });
```

## 版本号与变更说明

- 版本号由 `changes.js` 维护，UI 层读取展示
- 每次 kernel 有协议变更时更新 `changes.js` 中的 `CURRENT_VERSION` 和 `CHANGELOG`
