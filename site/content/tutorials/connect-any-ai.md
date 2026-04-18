---
title: "Connect Any AI Terminal: Claude Code, Codex, Cursor & More"
date: "2026-04-18"
tag: "Integration"
icon: "🔌"
description: "AgentLimb connects via HTTP — no MCP server, no config files. Copy one prompt and any AI terminal is ready to control your browser."
readTime: "4 min"
difficulty: "Beginner"
---

## How Connection Works

AgentLimb's bridge is a plain HTTP server at `127.0.0.1:7791`. Your AI connects by reading the onboard prompt you paste, which contains:

1. A `POST /api/mvp/terminal/connect` call to register
2. A list of 16 tools with names and one-line descriptions
3. `curl` commands to fetch full schemas on demand

The AI self-configures in a few seconds. You don't need to configure anything on either end.

**There is no MCP server.** No `mcpServers` config block needed. Any AI that can call HTTP endpoints works.

---

## Supported AI Terminals

| Terminal | Connection method | Notes |
|---|---|---|
| **Claude Code** | Paste onboard prompt | Works perfectly; Claude reads the environment block and auto-detects the bridge |
| **Codex** | Paste onboard prompt | Works with both `codex` CLI and OpenAI API direct |
| **Cursor** | Paste in chat | Works in Agent mode; no MCP config needed |
| **Windsurf** | Paste in chat | Same as Cursor |
| **Trae** | Paste in chat | Confirmed working |
| **Local models (Ollama, LM Studio)** | Paste onboard prompt | Needs a model with tool/function calling support |
| **Custom scripts** | Direct HTTP calls | Use `terminal-client.mjs` as reference, or call the API directly |

---

## Step by Step

### 1. Start the bridge

```bash
npm start
# or, if you ran install.sh: bridge is already running
```

Check: the side panel shows a green **Connected** badge.

### 2. Copy the prompt

Open the AgentLimb side panel → click **"Copy Onboard Prompt"**.

The prompt is generated fresh each time. It includes the current bridge status, your extension ID, and the list of sites already in your muscle library.

### 3. Paste and go

Paste the prompt into your AI terminal. That's the entire configuration step.

Your AI will:
- POST to `/api/mvp/terminal/connect` to register
- Fetch schemas for any tools it plans to use via `GET /api/mvp/docs/tools/:name`
- Call `task_plan` when it has a task to start
- Drive the browser using the 16 tools

---

## The 16 Tools Your AI Gets

| Category | Tools |
|---|---|
| Observe | `browser_session`, `tabs_context`, `page_snapshot` |
| Navigate/Execute | `navigate`, `computer` (9 actions), `form_input`, `wait`, `javascript_eval` |
| Muscle | `muscle_recall`, `muscle_remember`, `muscle_commit` |
| Connectivity | `ping` |
| Task lifecycle | `task_plan`, `task_step_done`, `task_complete`, `task_fail` |

Schemas are served on demand — your AI only fetches the ones it needs for the current task, keeping startup fast.

---

## Cross-AI Muscle Memory

One of AgentLimb's most useful properties: **muscle files are shared across all AI terminals**.

If Claude Code explored Reddit yesterday and saved a muscle, Codex can use that muscle today — same selectors, same workflow knowledge. The muscle files live in `~/Desktop/AgentLimb-muscle/` on your Desktop, not inside any specific AI's context. Any AI that connects to AgentLimb reads from the same knowledge base.

This means:
- Switch from Claude Code to Codex mid-project — no knowledge lost
- Let one AI do the exploration, another do the replay
- Share your muscle files with a colleague and their AI skips the cold start entirely

---

## Troubleshooting

**"Bridge not found" or no green badge:**
Make sure `npm start` is running in the extension folder. Check `127.0.0.1:7791/api/mvp/status` in your browser — it should return JSON.

**AI isn't calling the tools correctly:**
The minimal prompt (~45 lines) works for most capable models. If your local model is struggling, try the full prompt (bridge offline mode automatically switches to the 7,000-token version with all schemas embedded).

**Prompt is stale:**
Copy a fresh prompt from the side panel. Each copy includes current bridge status and muscle library state.
