<p align="center">
  <img src="site/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>Give Your AI a Browser Arm</strong><br>
  One prompt. Any AI tool. Your existing Chrome sessions. 100% local and private.
</p>

<p align="center">
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/Website-agentlimb.com-F5A623?style=for-the-badge" alt="Website">
  </a>
  <a href="https://github.com/hooosberg/AgentLimb">
    <img src="https://img.shields.io/badge/Source-GitHub-24292f?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
  </a>
</p>

<p align="center">
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/License-BSL%201.1-blue?style=flat-square" alt="License">
  </a>
  <img src="https://img.shields.io/badge/Platform-Chrome-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Platform">
  <img src="https://img.shields.io/badge/Privacy-100%25%20Local-34C759?style=flat-square" alt="Privacy">
  <img src="https://img.shields.io/badge/Languages-12-AF52DE?style=flat-square" alt="Languages">
</p>

<p align="center">
  <strong>
    <a href="./README.md">English</a> &nbsp;|&nbsp;
    <a href="./readme-locales/README.zh-CN.md">中文</a> &nbsp;|&nbsp;
    <a href="./readme-locales/README.ja-JP.md">日本語</a> &nbsp;|&nbsp;
    <a href="./readme-locales/README.ko-KR.md">한국어</a> &nbsp;|&nbsp;
    <a href="./readme-locales/README.es-ES.md">Español</a> &nbsp;|&nbsp;
    <a href="./readme-locales/README.fr-FR.md">Français</a> &nbsp;|&nbsp;
    <a href="./readme-locales/README.de-DE.md">Deutsch</a> &nbsp;|&nbsp;
    <a href="./readme-locales/README.pt-BR.md">Português</a> &nbsp;|&nbsp;
    <a href="./readme-locales/README.ru-RU.md">Русский</a> &nbsp;|&nbsp;
    <a href="./readme-locales/README.ar-SA.md">العربية</a> &nbsp;|&nbsp;
    <a href="./readme-locales/README.it-IT.md">Italiano</a> &nbsp;|&nbsp;
    <a href="./readme-locales/README.hi-IN.md">हिन्दी</a>
  </strong>
</p>

---

## About

**AgentLimb** is a Chrome extension that lets any AI coding tool — Claude Code, Cursor, Codex, Trae, Windsurf, or anything that can run commands — drive your browser. Install the extension, copy one prompt, paste it to your AI, and it auto-configures in 10 seconds.

No headless browsers. No re-login. No invasive agents. Your real Chrome, your real cookies, your real sessions.

## Highlights

### 1. One-Prompt Setup

Copy a single prompt, paste it to any AI tool. No config files, no terminal commands, no API keys. If your AI can operate your computer, it can use AgentLimb.

### 2. Muscle Memory — 16x Token Savings

AI explores a platform once, saves the action sequence as a "muscle". Next time, replay with zero tokens.

| | First Exploration | Muscle Replay |
|---|---|---|
| API Calls | ~30 | 1 |
| Tokens | ~5,000 | ~300 |
| Errors | Possible | 0 |
| | | **~16x efficiency** |

### 3. Zero Intrusion

Works inside your existing Chrome. No headless browsers, no separate sessions. Your cookies, logins, and extensions — all intact.

### 4. 100% Local & Private

Bridge runs on `127.0.0.1:7789`. No analytics, no tracking, no cloud servers. Privacy guaranteed by architecture, not by policy.

## How It Works

```
Your AI Tool  (Claude Code / Cursor / Codex / Trae / Windsurf)
    ↕  MCP Tools / HTTP API  (8 standardized tools)
AgentLimb Bridge  (local Node.js · 127.0.0.1:7789)
    ↕  WebSocket
AgentLimb Extension  (Chrome MV3 · side panel UI)
    ↕  DOM operations
Your Browser  (logged in, with cookies, your real sessions)
```

## Quick Start

1. **Install** — Add AgentLimb from the Chrome Web Store
2. **Copy** — Open the side panel, click "Copy Onboard Prompt"
3. **Paste** — Paste the prompt to any AI tool — it auto-configures and starts working

## Toolset

8 standardized tools — following Unix philosophy, each does one thing well. Minimal surface, maximum composability. The AI decides how to combine them; AgentLimb just provides the primitives.

## Use Cases

- **Marketing** — Post to social media, manage campaigns across platforms
- **Research** — Scrape data, compare products, gather competitive intelligence
- **Automation** — Fill forms, submit applications, update profiles
- **Testing** — QA your web app on a real browser with real sessions

## Design Philosophy

- **Unix philosophy** — 8 minimal tools, each does one thing well
- **Non-invasive** — works inside your real browser, not a sandbox
- **Local-first** — privacy by architecture, not by promise
- **AI-agnostic** — any tool that speaks MCP or HTTP can connect

## Resources

- **Website**: [agentlimb.com](https://agentlimb.com)
- **Tutorials**: [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **AI Tools Directory**: [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
- **News**: [agentlimb.com/news.html](https://agentlimb.com/news.html)
- **Privacy Policy**: [agentlimb.com/privacy.html](https://agentlimb.com/privacy.html)
- **Terms of Service**: [agentlimb.com/terms.html](https://agentlimb.com/terms.html)
- **License**: [agentlimb.com/license.html](https://agentlimb.com/license.html)

## Contact

- **GitHub**: [hooosberg/AgentLimb](https://github.com/hooosberg/AgentLimb)
- **Email**: [zikedece@proton.me](mailto:zikedece@proton.me)

## More Projects

<table>
  <tr>
    <td align="center">
      <a href="https://hooosberg.github.io/WitNote/">
        <b>✍️ WitNote</b><br>
        <sub>AI Writing Companion</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/DOMPrompter/">
        <b>🎯 DOMPrompter</b><br>
        <sub>Visual AI Prompt Generator</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/GlotShot/">
        <b>📸 GlotShot</b><br>
        <sub>App Store Screenshots</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/TrekReel/">
        <b>🏔️ TrekReel</b><br>
        <sub>3D Trail Stories</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://uixskills.com/">
        <b>🎨 UIXskills</b><br>
        <sub>Design Protocol Layer</sub>
      </a>
    </td>
  </tr>
</table>

## License

[Business Source License 1.1](LICENSE) — free for personal use. Commercial use requires a license. Converts to Apache 2.0 on 2030-04-12.

Copyright © 2025 hooosberg. All rights reserved.
