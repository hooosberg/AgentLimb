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

**AgentLimb** 是一款[已上架 Chrome 应用商店](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof)的浏览器扩展，让任何 AI 终端都能精准控制你的浏览器。**所有谷歌（Chromium）内核浏览器均可使用**（Chrome、Edge、Brave、Vivaldi、Chromium 等），并支持所有主流 AI 终端 — Claude Code、Codex、Cursor、Trae、Windsurf、腾讯 WorkBuddy、阿里千问办公、字节 TRAE Work、Cola、Kimi Work，以及任何本地模型。安装扩展、复制一个提示词、粘贴给 AI，10 秒内自动配置完成。

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

### 6. 多账号并行控制 — 同时操作多个 Chrome Profile

一条 AI 命令，每个 Chrome Profile 同时执行。无论是两个 Twitter 账号、三个公司 Google 账号，还是十几个测试 Profile——AgentLimb 都能在一次任务中全部驱动。

- **显式身份** — 每个侧边面板显示「本面板：Profile-xxxxxx」；Bridge 知道哪个 Profile 返回了哪个结果
- **挂起 / 自动挂起** — 关闭面板（或点击挂起按钮）即可让该 Profile 退出当前任务，其余 Profile 照常运行
- **task\_\* 广播** — `task_plan`、`task_step_done`、`task_complete`、`task_fail` 广播到每个活跃 Profile；所有侧边面板保持同步
- **窗口锁定** — `navigate` 自动定向到侧边面板所在的 Chrome 窗口，即使同一 Profile 开了多个窗口也不会走错
- **精准路由** — 需要只操作某个 Profile 时，可在工具调用中用 label 指定

## 工作原理

```
你的 AI 终端  (Claude Code / Codex / Cursor / TRAE Work / WorkBuddy / 千问办公 / Kimi Work / 本地模型)
    ↕  HTTP + 16 个标准化工具（通过 /docs 端点自动发现）
AgentLimb Bridge  (本地 Node.js · 127.0.0.1:7791)
    ↕  chrome.runtime 消息传递
AgentLimb 扩展  (Chrome MV3 · 侧边栏 UI · 任务/肌肉/日志三 Tab)
    ↕  Chrome Debugger Protocol
你的浏览器  (已登录，带 Cookie，真实会话)
    ↓  知识持久化
~/Desktop/AgentLimb-muscle/<domain>.json  (永久，人类可读)
```

## 支持的 AI 终端与平台

AgentLimb 天生与 Agent 无关：只要你的 AI 能发 HTTP 请求或执行本机命令，就能控制浏览器。**全平台支持（Windows 和 macOS）**，**所有谷歌（Chromium）内核浏览器均可使用**。

**国际主流终端** — Claude Code、Codex、Cursor、Trae、Windsurf，以及任何本地模型。

**国产 Agent 平台** — 全面支持：

| | 平台 | 亮点 |
|---|---|---|
| TOP 1 | **腾讯 WorkBuddy** | 腾讯出品的 AI 生产力专家，编程、数据分析、办公自动化样样精通 — 配合 AgentLimb 实现端到端网页控制 |
| TOP 2 | **阿里千问办公** | 阿里通义千问驱动的办公智能体；一个提示词，即可通过你的真实浏览器会话操作网页 |
| TOP 3 | **字节 TRAE Work** | 字节跳动 AI 原生工作终端；接入 AgentLimb，让对话直接变成精准的浏览器操作 |
| TOP 4 | **Cola** | 轻量国产 Agent 客户端，终端集成能力强 — 粘贴一个接入提示词即可就绪 |
| TOP 5 | **Kimi Work** | 月之暗面的 Kimi Work 擅长长周期网页任务；配合肌肉记忆，重复任务成本断崖式下降 |

> 全平台、全软件、全浏览器 — 让每一个 Agent 都能控制网页，这就是我们的目标。

## 快速开始

### 下载哪个安装包？

每次 GitHub Release 提供**两个安装包** — 请确认下载正确的那个：

| 安装包 | 是什么 | 谁来安装 |
|---|---|---|
| `agentlimb-chrome-v0.2.1-b7.zip` | **浏览器扩展** | **你本人** — 安装到你的 Chromium 浏览器 |
| `agentlimb-runtime-v0.2.1-b7.zip` | **本地 Runtime**（Bridge + CLI） | **你的 AI agent** — 经你授权后自动下载 |

> 一般情况下你完全不需要手动碰 Runtime 包。接入提示词会让你的 AI 自动完成下载、SHA-256 校验和安装。

### 第 1 步 — 安装扩展（Windows 和 macOS 操作相同）

- **Chrome 应用商店**（推荐）：[安装 AgentLimb](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof)。Chrome、Edge、Brave、Vivaldi、Chromium 等所有谷歌内核浏览器均可使用。
- **手动安装**：从 [Releases](https://github.com/hooosberg/AgentLimb/releases) 页面下载 [`agentlimb-chrome-v0.2.1-b7.zip`](https://github.com/hooosberg/AgentLimb/releases/download/v0.2.1/agentlimb-chrome-v0.2.1-b7.zip)，解压后在浏览器的扩展管理页开启开发者模式并加载解压后的文件夹。

### 第 2 步 — 复制接入提示词

打开 AgentLimb 侧边栏，点击**「复制接入提示词」**。本机需要 Node.js 18 或更高版本。

### 第 3 步 — 粘贴给你的 AI 终端（Windows 或 macOS）

任何能执行本机命令的 agent 都遵循同一套协议：先征得你的明确安装授权，再从 GitHub Release 下载小型 Runtime、校验 SHA-256、安装本地 Bridge 与 Native Messaging，最后运行健康检查。它不会扫描浏览器 Profile、目录或扩展源码。

各平台幕后流程：

- **macOS** — agent 解压 `agentlimb-runtime-v0.2.1-b7.zip` 后执行
  `scripts/install.sh --extension-id <你的扩展ID>`。
  如果 AgentLimb 已安装过，agent 会直接通过 `launchctl` 启动现有 Runtime，**无需重新下载**。
- **Windows** — agent 解压同一个包后执行
  `powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -ExtensionId <你的扩展ID>`。

两个安装器都会注册 Native Messaging、安装 `agentlimb` CLI，并在 `127.0.0.1:7791` 启动本地 Bridge。浏览器扩展自身无法完成这些系统级操作 — 这正是 Runtime 安装特意交由有终端能力的 agent 完成的原因。

### 第 4 步 — 开始使用

健康检查通过后，侧边栏显示 **ONLINE**，你的 AI 即可通过本地 Bridge 驱动每一个 Chromium 浏览器窗口，并按需获取工具 Schema。

## 工具集 — 16 个工具

16 个标准化工具，覆盖五大类：观察浏览器状态、导航与页面交互、读写肌肉记忆、声明任务生命周期、维持 Bridge 连通。工具文档按需从 Bridge 获取，AI 只在需要时拉取对应 Schema。

## 为什么不直接用 X？

每一种现有的浏览器自动化方案都有真实的代价。这是诚实的对比：

| | Browser Use / Playwright | BrowseAI / Browserbase | Codex / Claude Computer Use | **AgentLimb** |
|---|---|---|---|---|
| **配置** | 编写脚本、管理依赖、处理无头模式 | SaaS 配置，按工作流单独设置 | 仅支持 Mac（需桌面环境），需要沙盒 | 复制一个提示词，搞定 |
| **元素定位** | CSS/XPath——由你编写和维护 | 视觉 AI 识别——网站更新时不稳定 | 截图坐标——偏差 ±1 像素就可能点错 | CDP 直读实时 DOM——语义化，精准 |
| **每次动作 Token 成本** | 零（纯脚本） | 云服务费 + AI token | 1,000–3,000 token/截图 × 每一步 | 约 300 token/步，热启动再省 **85.7%** |
| **重复任务成本** | 固定（脚本重跑） | 线性增长——按次计费 | 线性增长——每次都重新探索，无记忆 | **递减**——肌肉记忆越用越省 |
| **登录会话** | 额外配置 Cookie/会话 | 云端——无法使用你本地的登录态 | 操作系统级别，感知不到浏览器状态 | 你的真实 Chrome——已经登录 |
| **网站更新时** | 选择器失效——重写脚本 | 视觉模型可能悄无声息地退化 | 截图推理能调整，但开销很大 | AI 检测到不匹配，找新选择器，自动修复肌肉 |
| **数据隐私** | 本地 ✅ | 经过第三方服务器 ❌ | 本地 ✅ | 100% 本地——仅 127.0.0.1 ✅ |
| **AI 终端选择** | 任意（纯脚本） | 因平台而异 | 与 Codex / Claude 捆绑 | 任何会说 HTTP 的 AI |
| **知识共享** | 脚本 = 绑死一个 AI | 工作流 = 绑死平台 | 无持久记忆 | 肌肉文件 = 跨 AI、可迁移、永久 |
| **多账号并行** | 需手动编排 | 因平台而异 | 不支持 | ✅ 多 Chrome Profile，一条命令 |

**独特之处**：AgentLimb 的肌肉文件以纯 JSON 形式存放在 `~/Desktop/AgentLimb-muscle/`。今天用 Claude Code 探索出来的知识，明天 Codex 直接拿来用——同一组 JSON 文件，同一个桌面文件夹。换 AI 工具，不丢任何已学会的工作流。

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
- **博客**: [hooosberg.com/apps/agentlimb](https://hooosberg.com/apps/agentlimb/)
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
