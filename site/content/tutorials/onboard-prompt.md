---
title: "The Onboard Prompt: What It Is and How It Works"
date: "2026-04-18"
tag: "Configuration"
icon: "📋"
description: "One copy, any AI terminal. The onboard prompt auto-configures your AI with 16 browser tools via HTTP — no MCP, no config files."
readTime: "3 min"
difficulty: "Beginner"
---

## One Prompt. Any AI. Zero Config.

The onboard prompt is the text you copy from AgentLimb's side panel and paste to your AI. That single paste is all the configuration needed. No YAML files, no API keys, no tool registration steps.

---

## What the Prompt Contains

The prompt is dynamically generated each time you copy it. It includes:

- **Environment block** — Bridge status, extension ID, platform, number of sites already learned
- **Protocol** — How to start a task (`task_plan`), advance steps, and close with `task_complete` or `task_fail`
- **Tool list** — Names and one-line descriptions of all 16 tools
- **Docs pointer** — A `curl` command the AI can run to fetch the full schema for any tool on demand

The prompt is designed to be short (~45 lines). Your AI doesn't need to read 7,000 tokens of documentation upfront — it fetches what it needs via:

```
GET 127.0.0.1:7791/api/mvp/docs/tools         # all 16 tool schemas
GET 127.0.0.1:7791/api/mvp/docs/tools/:name   # one tool's full schema
GET 127.0.0.1:7791/api/mvp/docs/rules         # behavior rules
```

---

## AgentLimb Uses HTTP, Not MCP

AgentLimb's bridge is a plain HTTP server at `127.0.0.1:7791`. Your AI makes HTTP calls — no Model Context Protocol server setup, no `mcpServers` config block, no special client library.

This means it works with **any AI terminal that can run commands**: Claude Code, Codex, Cursor, Windsurf, Trae, local Ollama models, custom scripts. If your AI can call `curl`, it can use AgentLimb.

---

## Paste and Go: The Full Flow

```
1. Bridge running at 127.0.0.1:7791
2. You click "Copy Onboard Prompt" in the side panel
3. Paste to your AI terminal
4. AI reads the prompt (~2 seconds)
5. AI auto-connects (POST /api/mvp/terminal/connect)
6. AI fetches tool schemas it needs (GET /api/mvp/docs/tools/...)
7. AI declares task_plan and starts working
```

You don't initiate the connection. The AI handles all of that when it reads the prompt.

---

## Tips for Different AI Tools

### Claude Code

Paste the prompt in a new Claude Code session. Claude reads the environment block, confirms the bridge is online, and immediately knows which sites it has already learned. No extra config needed.

Add context after pasting if you want:

```
[paste onboard prompt]

Today's goal: post our product update to Reddit r/entrepreneur and Hacker News.
The post content is in ~/Desktop/posts/update-april.md
```

### Codex (OpenAI)

Paste the prompt at the start of your Codex session. Codex works best with the minimal prompt format (Bridge online mode) — the tools are self-describing so it ramps up quickly.

### Cursor, Windsurf, Trae

These tools support tool calling. Paste the prompt in chat, or include it in your system context. The AI fetches tool schemas on demand, so startup is fast.

### Local Models (Ollama, LM Studio)

Works with any model that supports tool/function calling. Smaller models may need the `full` prompt mode (7,000 tokens with all schemas embedded) — the side panel switches automatically if the bridge is offline.

---

## If the Connection Drops

If the bridge restarts mid-session, just copy and paste the prompt again. The AI will reconnect in one step and continue where it left off. Muscle knowledge is stored on disk and is never lost between connections.
