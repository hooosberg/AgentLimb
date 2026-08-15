# kernel/muscle/ — 肌肉模块

自动学习站点操作经验，持久化到桌面 JSON 文件，下次任务自动注入。

## 三层存储生命周期

```
session（临时）  →  hot（chrome.storage.local）  →  truth（桌面 JSON）
  任务执行中          muscle_commit 后写入             永久保存
  muscle_v1_session_* muscle_v1_hot_*              ~/Desktop/AgentLimb-muscle/
```

## 四种沉淀模式

| 模式 | 触发条件 | 沉淀内容 |
|------|---------|---------|
| `success` | 工具调用成功 | selectors + workflow step |
| `partial` | 部分成功（有错误但恢复） | selectors（降权） |
| `failed` | 最终失败 | 失败记录（不写 selectors） |
| `manual` | `muscle_commit` 工具手动触发 | 全量 flush session → hot |

## 文件结构

```
muscle/
├── store.js        # 三层存储 CRUD（session/hot/truth）
├── schema.js       # SiteProfile 数据结构 + normalizeDomain()
├── merge.js        # profile patch 合并（避免覆盖旧记录）
├── serializer.js   # profileToMarkdown() + isEmpty()
├── query.js        # 查询入口（getProfile / listProfiles）
└── auto-capture.js # flushSession()（四模式自动沉淀）
```

## 调试

```bash
# 查看所有已学习站点
node -e "
import('./kernel/muscle/query.js').then(m => m.listProfiles().then(console.log))
"

# 清空数据
# 1. 在 DevTools Console: chrome.storage.local.clear()
# 2. 删除桌面目录: rm -rf ~/Desktop/AgentLimb-muscle/
```

## 桌面文件格式

`~/Desktop/AgentLimb-muscle/<domain>.json` — 标准 SiteProfile JSON，可直接阅读编辑。
