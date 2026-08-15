<p align="center">
  <img src="website/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>Stop watching your AI relearn the same task.</strong><br>
  The open-source alternative to CoWork — 90% fewer tokens on repeat browser tasks.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-Install_Free-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Install from Chrome Web Store">
  </a>
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/Website-agentlimb.com-F5A623?style=for-the-badge" alt="Website">
  </a>
  <a href="https://github.com/hooosberg/AgentLimb">
    <img src="https://img.shields.io/github/stars/hooosberg/AgentLimb?style=for-the-badge&logo=github&label=Star&color=24292f" alt="Star on GitHub">
  </a>
</p>

<p align="center">
  <em>If AgentLimb is useful to you, please ⭐ star this repo — it helps others discover the project and keeps us motivated!</em>
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

<p align="center">
  <img src="assets/demo.gif" alt="AgentLimb Demo — AI agent controlling the browser" width="720">
</p>

---

## About

**AgentLimb** is a Chrome extension — [now live on the Chrome Web Store](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — that lets any AI terminal — Claude Code, Cursor, Codex, Trae, Windsurf, or any local model — drive your browser with precision. Install the extension, copy one prompt, paste it to your AI, and it auto-configures in 10 seconds.

No headless browsers. No re-login. No invasive agents. Your real Chrome, your real cookies, your real sessions — plus muscle memory that makes repeat tasks dramatically cheaper every time you run them.

## Highlights

### 1. One-Prompt Setup

After the one-time local runtime install, copy a single prompt and paste it to any AI tool. No API keys or cloud account. If your AI can run commands, it can use AgentLimb.

### 2. Muscle Memory — 85% Fewer Tokens, 80–95% Less Waiting

The first time your AI hits a site, it explores the DOM and learns selectors / workflow. AgentLimb writes that knowledge to `~/Desktop/AgentLimb-muscle/<domain>.json`. Every future run on the same site skips the exploration and reuses what was learned.

Real regression data from a Reddit posting task (low-parameter Codex, 2026-04-18):

| | Cold start (first explore) | Hot start (muscle recall) | Savings |
|---|---|---|---|
| `page_snapshot` calls | 3 | **0** | 100% |
| Total tool calls | 23 | 10 | 56.5% |
| Estimated tokens | ~12,250 | **~1,750** | **↓ 85.7%** |
| Wall-clock time | 8–20 min | 30 s–2 min | **↓ ~80–95%** |

The more you reuse a site, the cheaper and faster it gets.

### 3. CDP-Native, Not Screenshot Guessing

AgentLimb drives the browser through Chrome Debugger Protocol. The AI receives a structured semantic list of interactive elements — not screenshots. Clicks hit the right node, form fills use native APIs, navigations return the new URL immediately.

### 4. Explicit Task Lifecycle

Silence no longer equals success. The AI explicitly declares `task_plan` → `task_step_done` → `task_complete` / `task_fail`. Timeouts and bridge drops are captured as real failures, not false positives. The side panel renders the live step list in real time.

### 5. 100% Local & Private

Bridge runs on `127.0.0.1:7791`. No analytics, no tracking, no cloud. Muscle knowledge is plain JSON on your desktop — you can read, diff, share, or delete it at any time.

### 6. Multi-Account Parallel Control — Run Multiple Chrome Profiles at Once

One AI command, every Chrome profile executes it. Whether you have two Twitter accounts, three company Google accounts, or a dozen test profiles — AgentLimb drives them all in a single task.

- **Explicit identity** — each side panel shows "This panel: Profile-xxxxxx"; the Bridge tracks which profile sent which result
- **Suspend / auto-suspend** — close a panel (or click Suspend) to opt that profile out; the rest continue without interruption
- **task_\* fan-out** — `task_plan`, `task_step_done`, `task_complete`, `task_fail` broadcast to every active profile; all side panels stay in sync
- **Window locking** — `navigate` targets the correct Chrome window automatically, even when the same profile has multiple windows open
- **Target routing** — point a tool call at a specific profile by label for surgical precision

## How It Works

```
Your AI Terminal  (Claude Code / Cursor / Codex / Trae / Windsurf / local model)
    ↕  HTTP + SSE  (16 standardized tools, auto-discoverable via /docs endpoints)
AgentLimb Bridge  (local Node.js · 127.0.0.1:7791)
    ↕  chrome.runtime message passing
AgentLimb Extension  (Chrome MV3 · side panel UI · task/muscle/log tabs)
    ↕  Chrome Debugger Protocol
Your Browser  (logged in, with cookies, your real sessions)
    ↓  knowledge persisted
~/Desktop/AgentLimb-muscle/<domain>.json  (durable, human-readable)
```

## Quick Start

1. **Install the extension in your Chromium browser**:
   - **Chrome Web Store** (recommended): [Install AgentLimb](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof). The same extension can be used in Edge, Brave, Vivaldi, Chromium, and other browsers that support Chrome extensions.
   - **Manual build**: [download `agentlimb-chrome-v0.2.1-b3.zip`](https://github.com/hooosberg/AgentLimb/releases/download/v0.2.1/agentlimb-chrome-v0.2.1-b3.zip), extract it, then load the extracted folder from your browser's extensions page with Developer Mode enabled.
2. **Copy the onboarding prompt** — Open the side panel and click "Copy Onboard Prompt". Node.js 18 or later is required for the one-time local runtime setup.
3. **Paste it into your AI terminal** — Any agent that can run local commands follows the same Windows or macOS protocol. After your explicit approval, it downloads the small Runtime at a fixed path in the matching GitHub version tag, verifies its SHA-256 file, installs the local Bridge and Native Messaging host, then verifies the health check. It does not scan browser profiles, folders, or extension sources.
4. **Use the browser** — Once the health check passes, the same prompt connects through the local Bridge and discovers tool schemas on demand.

   The Runtime download and installer are intentionally handled by a terminal-capable agent. A browser extension alone cannot register Native Messaging, write system configuration, or start a local service.

## Toolset — 16 Tools

16 standardized tools spanning five categories: observing browser state, navigating and interacting with page elements, reading and writing muscle memory, declaring task lifecycle events, and maintaining bridge connectivity. Full documentation is served on demand — the AI fetches schemas only when it needs them.

## Why Not Just Use X?

Every existing approach to browser automation has a real cost. Here's the honest comparison:

| | Browser Use / Playwright | BrowseAI / Browserbase | Codex / Claude Computer Use | **AgentLimb** |
|---|---|---|---|---|
| **Setup** | Write scripts, manage deps | SaaS config per workflow | Mac only, desktop env required | Copy one prompt |
| **Element targeting** | CSS/XPath — you maintain them | Visual AI — breaks on updates | Screenshot coordinates — ±1px miss | CDP reads live DOM — semantic |
| **Token cost / step** | None (pure script) | Cloud fees + AI tokens | 1,000–3,000/screenshot × every step | ~300/step, **85.7% less** on hot start |
| **Repeat task cost** | Fixed | Billed per run | Linear — re-explores every time | **Decreasing** — muscle memory compounds |
| **Login sessions** | Extra setup | Cloud — no local sessions | OS-level, unaware of browser state | Your real Chrome — already logged in |
| **When site updates** | Scripts break, rewrite | Model may degrade silently | Screenshot inference — expensive | AI self-heals muscle selectors |
| **Data privacy** | Local ✅ | Third-party servers ❌ | Local ✅ | 100% local, 127.0.0.1 ✅ |
| **AI choice** | Any (pure script) | Platform-dependent | Bundled with Codex / Claude | Any AI that speaks HTTP |
| **Shared knowledge** | Script = one AI only | Workflow = locked to platform | No persistent memory | Muscle files = cross-AI, transferable |
| **Multi-account parallel** | Manual orchestration | Platform-dependent | No | ✅ Multiple Chrome profiles, one command |

**The unique differentiator:** AgentLimb's muscle files live in `~/Desktop/AgentLimb-muscle/` as plain JSON. Knowledge explored by Claude Code today is available to Codex tomorrow — same files, zero re-exploration. Switch AI tools without losing a single learned workflow.

## Use Cases

- **Marketing** — Post to social media, manage campaigns across platforms
- **Research** — Scrape data, compare products, gather competitive intelligence
- **Automation** — Fill forms, submit applications, update profiles
- **Testing** — QA your web app on a real browser with real sessions

## Design Philosophy

- **Minimal surface** — 16 tools, each does one thing well, composable across any workflow
- **Non-invasive** — works inside your real browser, not a sandbox
- **Local-first** — privacy by architecture, not by promise
- **AI-agnostic** — any tool that can send HTTP can connect; no vendor lock-in

## Repository Layout

The public repository contains the complete product source:

```text
_locales/          Extension translations
icons/             Extension icons
kernel/            Bridge, CLI, prompt, browser control, and muscle runtime
scripts/           macOS and Windows installers plus release tooling
tests/             Node test suite
ui/                Chrome extension side panel and options UI
website/           Static agentlimb.com site deployed by Cloudflare Pages
忽略上传/           Local-only references, legacy worktrees, private material, and builds
```

Development commands:

```bash
npm test
npm run build                    # builds into 忽略上传/dist/
npm run release -- 0.2.1        # sets the version and builds release assets
```

Cloudflare Pages should use the repository root as its root directory and `website` as its build output directory. Release zips are generated in `忽略上传/dist/` and published through GitHub Releases; the entire `忽略上传/` directory is never committed.

## Resources

- **Website**: [agentlimb.com](https://agentlimb.com)
- **Windows test checklist**: [docs/windows-testing.md](docs/windows-testing.md)
- **Development notes**: [docs/development/README.md](docs/development/README.md)
- **Tutorials**: [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **AI Tools Directory**: [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
- **News**: [agentlimb.com/news.html](https://agentlimb.com/news.html)
- **Privacy Policy**: [agentlimb.com/privacy.html](https://agentlimb.com/privacy.html)
- **Terms of Service**: [agentlimb.com/terms.html](https://agentlimb.com/terms.html)
- **License**: [agentlimb.com/license.html](https://agentlimb.com/license.html)

## Contact

- **GitHub**: [hooosberg/AgentLimb](https://github.com/hooosberg/AgentLimb)
- **Email**: [zikedece@proton.me](mailto:zikedece@proton.me)

## Sibling projects

Built by [hooosberg](https://github.com/hooosberg):

- [BeRaw](https://hooosberg.github.io/BeRaw/) — Behance raw-image grabber
- [Packpour](https://hooosberg.github.io/Packpour/) — App Store Connect locale filler
- [WitNote](https://hooosberg.github.io/WitNote/) — local-first AI writing companion
- [GlotShot](https://hooosberg.github.io/GlotShot/) — perfect App Store preview images
- [TrekReel](https://hooosberg.github.io/TrekReel/) — outdoor trails, cinematic reels
- [DOMPrompter](https://hooosberg.github.io/DOMPrompter/) — visualize DOM for AI code
- [UIXskills](https://uixskills.com) — AI → JSON → Whiteboard → UI

## License

[Business Source License 1.1](LICENSE) — free for personal use. Commercial use requires a license. Converts to Apache 2.0 on 2030-04-12.

Copyright © 2025 hooosberg. All rights reserved.
