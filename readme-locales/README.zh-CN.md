<p align="center">
  <img src="../site/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>赋予你的 AI 一条浏览器机械臂</strong><br>
  一个提示词。任何 AI 工具。你现有的 Chrome 登录态。100% 本地运行，完全隐私。
</p>

<p align="center">
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

**AgentLimb** 是一款 Chrome 扩展，让任何 AI 编程工具 — Claude Code、Cursor、Codex、Trae、Windsurf，以及任何能执行命令的工具 — 都能驱动你的浏览器。安装扩展、复制一个提示词、粘贴给 AI，10 秒内自动配置完成。

无需无头浏览器。无需重新登录。无侵入式代理。你的真实 Chrome、真实 Cookie、真实登录会话。

## 核心亮点

### 1. 一键提示词配置

复制一个提示词，粘贴给任何 AI 工具。无需配置文件，无需终端命令，无需 API 密钥。只要你的 AI 能操作电脑，就能使用 AgentLimb。

### 2. 肌肉记忆 — 16 倍 Token 节省

AI 首次探索平台后，将操作序列保存为"肌肉"。下次回放，零 Token 消耗。

| | 首次探索 | 肌肉回放 |
|---|---|---|
| API 调用 | ~30 次 | 1 次 |
| Token 消耗 | ~5,000 | ~300 |
| 错误率 | 可能出错 | 0 |
| | | **~16 倍效率提升** |

### 3. 零侵入

在你现有的 Chrome 内运行。无无头浏览器、无独立会话。你的 Cookie、登录态和扩展 — 完整保留。

### 4. 100% 本地 & 隐私

Bridge 运行在 `127.0.0.1:7789`。无分析、无追踪、无云端服务器。隐私由架构保障，而非承诺。

## 工作原理

```
你的 AI 工具  (Claude Code / Cursor / Codex / Trae / Windsurf)
    ↕  MCP 工具 / HTTP API  (8 个标准化工具)
AgentLimb Bridge  (本地 Node.js · 127.0.0.1:7789)
    ↕  WebSocket
AgentLimb 扩展  (Chrome MV3 · 侧边栏 UI)
    ↕  DOM 操作
你的浏览器  (已登录，带 Cookie，真实会话)
```

## 快速开始

1. **安装** — [下载压缩包](https://github.com/hooosberg/AgentLimb/releases/latest/download/agentlimb-chrome-v0.0.1.zip)，解压后打开 `chrome://extensions`，开启**开发者模式**，点击**加载已解压的扩展程序**并选择解压后的文件夹
2. **复制** — 打开侧边栏，点击"复制接入提示词"
3. **粘贴** — 将提示词粘贴给任何 AI 工具 — 自动配置，立即开始工作

## 工具集

8 个标准化工具 — 遵循 Unix 哲学，每个只做一件事。最小接口，最大可组合性。AI 决定如何组合它们；AgentLimb 只提供原语。

## 使用场景

- **市场营销** — 多平台发帖、管理营销活动、社区互动
- **研究与数据** — 采集数据、对比产品、收集竞品情报
- **表单自动化** — 填写申请、提交表单、更新多平台资料
- **测试与质检** — 在真实浏览器和真实会话中测试网页应用

## 设计哲学

- **Unix 哲学** — 8 个精简工具，每个只做一件事
- **非侵入** — 在你的真实浏览器内运行，而非沙盒
- **本地优先** — 架构级隐私，而非策略级承诺
- **AI 无关** — 任何支持 MCP 或 HTTP 的工具都能接入

## 资源

- **官网**: [agentlimb.com](https://agentlimb.com)
- **教程**: [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **AI 工具导航**: [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
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
