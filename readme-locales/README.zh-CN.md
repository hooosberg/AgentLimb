<p align="center">
  <img src="../site/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>停止让你的 AI 重复学习同一个任务。</strong><br>
  CoWork 的开源替代方案 — 重复浏览器任务减少 85% Token 消耗。
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof">
    <img src="https://img.shields.io/badge/Chrome_应用商店-免费安装-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="从 Chrome 应用商店安装">
  </a>
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/官网-agentlimb.com-F5A623?style=for-the-badge" alt="官网">
  </a>
  <a href="https://github.com/hooosberg/AgentLimb">
    <img src="https://img.shields.io/github/stars/hooosberg/AgentLimb?style=for-the-badge&logo=github&label=Star&color=24292f" alt="GitHub Star">
  </a>
</p>

<p align="center">
  <em>如果 AgentLimb 对你有帮助，请给我们 ⭐ 加星 — 这能帮助更多人发现这个项目，也是对我们最大的鼓励！</em>
</p>

<p align="center">
  <strong>
    <a href="../README.md">English</a> &nbsp;|&nbsp;
    <a href="./README.zh-CN.md">中文</a> &nbsp;|&nbsp;
    <a href="./README.ja-JP.md">日本語</a> &nbsp;|&nbsp;
    <a href="./README.ko-KR.md">한국어</a> &nbsp;|&nbsp;
    <a href="./README.es-ES.md">Español</a> &nbsp;|&nbsp;
    <a href="./README.fr-FR.md">Français</a> &nbsp;|&nbsp;
    <a href="./README.de-DE.md">Deutsch</a> &nbsp;|&nbsp;
    <a href="./README.pt-BR.md">Português</a> &nbsp;|&nbsp;
    <a href="./README.ru-RU.md">Русский</a> &nbsp;|&nbsp;
    <a href="./README.ar-SA.md">العربية</a> &nbsp;|&nbsp;
    <a href="./README.it-IT.md">Italiano</a> &nbsp;|&nbsp;
    <a href="./README.hi-IN.md">हिन्दी</a>
  </strong>
</p>

<p align="center">
  <img src="../assets/demo.gif" alt="AgentLimb Demo — AI agent controlling the browser" width="720">
</p>

---

## 关于

**AgentLimb** 是一款[已上架 Chrome 应用商店](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof)的 Chrome 扩展，让任何 AI 终端 — Claude Code、Cursor、Codex、Trae、Windsurf，以及任何能执行命令的工具 — 都能精准控制你的浏览器。安装扩展、复制一个提示词、粘贴给 AI，10 秒内自动配置完成。

无需无头浏览器。无需重新登录。无侵入式代理。你的真实 Chrome、真实 Cookie、真实登录会话 — 加上肌肉记忆，让重复任务的成本越来越低。

## 核心亮点

### 1. 一键提示词配置

复制一个提示词，粘贴给任何 AI 工具。无需配置文件，无需终端命令，无需 API 密钥。只要你的 AI 能执行命令，就能使用 AgentLimb。

### 2. 肌肉记忆 — 85% 减少 Token，80–95% 减少等待时间

AI 首次访问网站时，探索 DOM 并记录选择器、工作流、备注。AgentLimb 将这些知识写入 `~/Desktop/AgentLimb-muscle/<domain>.json`。后续每次访问同一网站，直接复用记忆，跳过探索。

真实回归数据（低参数 Codex，Reddit 发帖任务，2026-04-18）：

| | 冷启动（首次探索） | 热启动（肌肉复用） | 节省 |
|---|---|---|---|
| `page_snapshot` 次数 | 3 | **0** | 100% |
| 工具调用总次数 | 23 | 10 | 56.5% |
| 估算 Token | ~12,250 | **~1,750** | **↓ 85.7%** |
| 任务完成时间 | 8–20 分钟 | 30 秒–2 分钟 | **↓ ~80–95%** |

复用次数越多，成本越低。

### 3. CDP 直连，非截图猜坐标

AgentLimb 通过 Chrome Debugger Protocol 直接读取 DOM。AI 拿到的是结构化语义列表，不是图片。点击精准到元素，表单填写通过原生 API，导航后立即返回新页 URL。

### 4. 显式任务生命周期

沉默不再等于成功。AI 显式声明 `task_plan` → `task_step_done` → `task_complete` / `task_fail`。超时和 Bridge 掉线都被捕获为真实失败，侧边栏实时渲染步骤列表。

### 5. 100% 本地 & 隐私

Bridge 运行在 `127.0.0.1:7791`。无分析、无追踪、无云服务器。肌肉知识是桌面上的纯文本 JSON — 你可以随时读取、对比、分享或删除。

## 工作原理

```
你的 AI 终端  (Claude Code / Cursor / Codex / Trae / Windsurf / 本地模型)
    ↕  HTTP + 16 个标准化工具（通过 /docs 端点自动发现）
AgentLimb Bridge  (本地 Node.js · 127.0.0.1:7791)
    ↕  chrome.runtime 消息传递
AgentLimb 扩展  (Chrome MV3 · 侧边栏 UI · 任务/肌肉/日志三 Tab)
    ↕  Chrome Debugger Protocol
你的浏览器  (已登录，带 Cookie，真实会话)
    ↓  知识持久化
~/Desktop/AgentLimb-muscle/<domain>.json  (永久，人类可读)
```

## 快速开始

1. **安装** — 两种方式：
   - **Chrome 应用商店**（推荐）：[安装 AgentLimb](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — 一键安装，自动更新
   - **手动安装（最新构建）**：[下载最新 zip](https://github.com/hooosberg/AgentLimb/releases/latest)，解压后打开 `chrome://extensions`，开启**开发者模式**，点击**加载已解压的扩展程序**
2. **启动 Bridge** — 在扩展目录执行 `npm start`（或运行 `scripts/install.sh` 一次，在 macOS 上注册 LaunchAgent，开机自动启动）
3. **复制** — 打开侧边栏，点击"复制接入提示词"
4. **粘贴** — 将提示词粘贴给任何 AI 终端，自动连接、按需获取工具 Schema，立即开始工作

## 工具集 — 16 个工具

最小接口，最大可组合性。分为五类：

| 类别 | 工具 |
|---|---|
| 观察 | `browser_session` · `tabs_context` · `page_snapshot` |
| 导航 / 执行 | `navigate` · `computer`（9 种动作）· `form_input` · `wait` · `javascript_eval` |
| 肌肉 | `muscle_recall` · `muscle_remember` · `muscle_commit`（success / partial / failed / manual）|
| 连通 | `ping` |
| 任务生命周期 | `task_plan` · `task_step_done` · `task_complete` · `task_fail` |

Bridge 按需提供文档 — AI 可随时 `curl /api/mvp/docs/tools` 或 `/docs/tools/<name>` 获取 Schema。

## 使用场景

- **营销** — 多平台发帖、管理营销活动、社区互动
- **研究** — 采集数据、对比产品、收集竞品情报
- **自动化** — 填写申请、提交表单、更新多平台资料
- **测试** — 在真实浏览器和真实会话中 QA 测试

## 设计哲学

- **最小接口** — 16 个工具，每个只做一件事，可自由组合
- **非侵入** — 在你的真实浏览器内运行，而非沙盒
- **本地优先** — 架构级隐私，而非策略级承诺
- **AI 无关** — 任何能发送 HTTP 的工具都能接入，无厂商绑定

## 资源

- **官网**: [agentlimb.com](https://agentlimb.com)
- **教程**: [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **AI 工具导航**: [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
- **新闻**: [agentlimb.com/news.html](https://agentlimb.com/news.html)
- **隐私政策**: [agentlimb.com/privacy.html](https://agentlimb.com/privacy.html)
- **服务条款**: [agentlimb.com/terms.html](https://agentlimb.com/terms.html)

## 联系

- **GitHub**: [hooosberg/AgentLimb](https://github.com/hooosberg/AgentLimb)
- **邮箱**: [zikedece@proton.me](mailto:zikedece@proton.me)

## 更多项目

<table>
  <tr>
    <td align="center">
      <a href="https://hooosberg.github.io/WitNote/">
        <b>✍️ WitNote</b><br>
        <sub>AI 写作伙伴</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/DOMPrompter/">
        <b>🎯 DOMPrompter</b><br>
        <sub>可视化 AI 提示词生成器</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/GlotShot/">
        <b>📸 GlotShot</b><br>
        <sub>应用商店截图工具</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/TrekReel/">
        <b>🏔️ TrekReel</b><br>
        <sub>3D 路线故事</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://uixskills.com/">
        <b>🎨 UIXskills</b><br>
        <sub>设计协议层</sub>
      </a>
    </td>
  </tr>
</table>

## 许可

[Business Source License 1.1](../LICENSE) — 个人使用免费。商业使用需授权。2030-04-12 后转为 Apache 2.0。

Copyright © 2025 hooosberg. All rights reserved.
