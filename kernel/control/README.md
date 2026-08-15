# kernel/control/ — 操控模块

负责所有浏览器自动化操作，通过 Chrome DevTools Protocol（CDP）执行 11 种工具。

## 工具清单

| # | 工具名 | 动作 |
|---|--------|------|
| 1 | browser_navigate | 导航到指定 URL |
| 2 | browser_click | 点击元素（支持 refId/selector/coordinate） |
| 3 | browser_type | 输入文本 |
| 4 | browser_scroll | 滚动页面 |
| 5 | browser_screenshot | 截图 |
| 6 | browser_snapshot | 获取页面 DOM 快照 |
| 7 | browser_wait | 等待（元素出现/时间） |
| 8 | browser_evaluate | 执行 JS |
| 9 | browser_select | 下拉选择 |
| 10 | browser_tab_new | 新开标签页 |
| 11 | browser_tab_close | 关闭标签页 |

## 目录结构

```
control/
├── background/
│   ├── service-worker.js      # SW 入口，注册消息监听
│   ├── computer/controller.js # 9 种 CDP 动作实现
│   ├── snapshot/controller.js # 页面快照 + 目标解析
│   ├── permissions/controller.js # 权限管理
│   └── runtime/               # CDP/tabs 通用封装
│       ├── browser.js
│       ├── debugger.js
│       └── bootstrap.js
├── content/
│   └── injector.js            # 注入 data-ref-id 到 DOM
└── host/
    ├── controller.js          # 工具分发路由（11 工具 → 对应 handler）
    └── tools.js               # 11 工具 schema 定义（单一真相源）
```

## 新增工具流程（3 步）

1. 在 `host/tools.js` 添加 JSON schema 定义
2. 在 `host/controller.js` 添加路由分支
3. 在 `background/computer/controller.js` 实现具体 CDP 调用

## 调试方法

- Chrome DevTools：`chrome://inspect` → 找 service worker → 打开 Console
- SW 日志：`console.log('[SW]', ...)` 在 SW 内统一前缀
- CDP 抓包：`background/runtime/debugger.js` 会 log 每次 attach/detach
