# AgentLimb

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-blue.svg)](LICENSE)
[![Website](https://img.shields.io/badge/Website-agentlimb.com-F5A623)](https://agentlimb.com)

**Give your AI a browser arm.**

AgentLimb is a Chrome extension that lets any AI coding tool — Claude Code, Cursor, Codex, Trae, Windsurf, or anything that can run commands — drive your browser. Copy one prompt, paste it to your AI, and it can see and control any webpage using your existing login sessions.

No headless browsers. No re-login. No invasive agents. Just your real Chrome, your real cookies, your real sessions.

## Why AgentLimb

| | Without AgentLimb | With AgentLimb |
|---|---|---|
| **Browser access** | AI can't see or interact with web pages | AI observes, clicks, types, navigates — any page |
| **Login sessions** | Need separate auth setup per service | Uses your existing Chrome logins — zero setup |
| **Repeated tasks** | AI explores from scratch every time | Muscle memory: explore once, replay forever |
| **Token cost** | ~5,000 tokens per web task | ~300 tokens with muscle replay (~16x savings) |
| **Privacy** | Cloud-based agents see your data | 100% local — nothing leaves your machine |

## Quick Start

**1. Install** — Add from [Chrome Web Store](#) or clone and load unpacked:

```bash
git clone https://github.com/hooosberg/AgentLimb.git
# Chrome → Extensions → Load unpacked → select the folder
```

**2. Start the bridge** — one command, runs locally:

```bash
cd AgentLimb/bridge && node bridge.js
```

**3. Connect your AI** — open the side panel, click **Copy Onboard Prompt**, paste to your AI. Done.

That's it. Your AI can now see and control your browser.

## How It Works

```
Your AI Tool  (Claude Code / Cursor / Codex / Trae / any script)
    ↕  MCP Tools / HTTP API  (8 standardized tools)
AgentLimb Bridge  (local Node.js · 127.0.0.1:7789)
    ↕  WebSocket
AgentLimb Extension  (Chrome MV3 · side panel UI)
    ↕  DOM operations
Your Browser  (logged in, with cookies, your real sessions)
```

Everything runs on localhost. Zero cloud dependency.

## 8 Tools

| Tool | What it does |
|------|-------------|
| `observe` | Read page state — title, URL, DOM, forms, optional screenshot |
| `act` | Click, type, select, navigate, scroll |
| `wait` | Wait for selector, text, or URL pattern |
| `eval` | Run JavaScript in the page and return the result |
| `muscle` | Save, list, run, delete action sequences (muscle memory) |
| `report` | Update the side panel monitoring UI |
| `ping` | Health check |
| `project` | Read/write local project files |

## Muscle Memory — The Core Innovation

When your AI completes a task on a website for the first time (e.g., posting to Reddit), AgentLimb saves the action sequence as a "muscle". Next time, just replay it — no exploration, no tokens wasted.

| | First Exploration | Muscle Replay |
|---|---|---|
| API calls | ~30 | 1 |
| Tokens | ~5,000 | ~300 |
| Errors | Possible | 0 |
| | | **~16x efficiency** |

Each platform needs one exploration, one save — then permanent reuse.

## Use Cases

- **Marketing** — Post to social media, manage campaigns across platforms
- **Research** — Scrape data, compare products, gather intelligence
- **Automation** — Fill forms, submit applications, update profiles
- **Testing** — QA your web app on a real browser with real sessions

Your AI subscriptions (Claude, GPT, Codex) already cost money. AgentLimb gives them a browser to work with — let them earn their keep.

## Design Philosophy

- **Unix philosophy** — 8 minimal tools, each does one thing well
- **Non-invasive** — works inside your real browser, not a sandbox
- **Local-first** — privacy by architecture, not by promise
- **AI-agnostic** — any tool that speaks MCP or HTTP can connect
- **Inspired by** Claude Code's dev philosophy and the Cowork project

## Links

- [Website](https://agentlimb.com)
- [Privacy Policy](PRIVACY_POLICY.md)
- [Issues](https://github.com/hooosberg/AgentLimb/issues)

## License

[Business Source License 1.1](LICENSE) — free for personal use. Commercial use requires a license. Converts to Apache 2.0 on 2030-04-12.
