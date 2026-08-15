# ui/ — UI 层

AgentLimb 的侧边栏界面。UI 层只负责**展示 + 复制提示词 + 设置**，不直接操作浏览器。

## 定位原则：只看不动

用户 99% 时间是"看"而不是"操作"：
- 复制提示词 → 粘贴到 AI 终端（唯一主动操作）
- 侧边栏被动展示任务进度、肌肉状态
- 设置入口（齿轮）清晰但不抢戏

## 目录结构

```
ui/
├── sidepanel/
│   ├── sidepanel.html   # 主界面（四 tab：监控/肌肉/日志/设置）
│   ├── sidepanel.css    # 完整主题系统（dark/light + 组件库）
│   ├── sidepanel.js     # 主逻辑（复制提示词 + 状态展示）
│   ├── monitor.js       # 监控面板（任务卡片 + 进度 + 会话列表）
│   ├── skills.js        # 肌肉面板（纯展示，无操作按钮）
│   ├── settings.js      # 设置面板（主题/语言/帮助）
│   └── logs.js          # 日志面板
├── _locales/            # 12 种语言（zh_CN, en, ja, ko, de, fr, es, pt_BR, it, ru, ar, hi）
└── assets/
    └── icons/           # UI 专用图标
```

## 与内核通信

UI 层通过 `chrome.runtime.sendMessage` 与内核交互，不直接 import 内核文件：

```js
// 查询 bridge 状态
chrome.runtime.sendMessage({ type: 'bridge_status' }, (res) => { ... });

// 获取肌肉数据
chrome.runtime.sendMessage({ type: 'muscle_list' }, (res) => { ... });
```

## 移植来源

CSS 和整体布局位于 `ui/sidepanel/`，包含主题系统和组件库。
肌肉面板已按 claudecode 版架构重写（移除所有操作按钮）。
