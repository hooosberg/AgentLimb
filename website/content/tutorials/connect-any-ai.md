---
title: "Use AgentLimb with Any AI Tool"
date: "2026-04-18"
tag: "Getting Started"
icon: "🔌"
description: "Claude Code, Codex, Cursor, local models — one prompt connects them all. No special setup required."
readTime: "3 min"
difficulty: "Beginner"
---

## One Prompt, Any AI

AgentLimb doesn't need to be installed inside your AI tool. It doesn't require any configuration in Claude Code or Cursor or Codex. The connection is established entirely through the prompt you paste.

Copy the onboard prompt from the AgentLimb side panel. Paste it into your AI tool. Your AI reads it, connects to the bridge running on your computer, and is immediately ready to control the browser.

---

## Supported AI Tools

**Claude Code** — Paste the prompt at the start of a session. Claude reads the environment details and connects automatically.

**Codex** — Paste the prompt. Codex connects and starts working.

**Cursor** — Paste in the chat window. Works in Agent mode without extra configuration.

**Windsurf, Trae** — Same as Cursor. Paste and go.

**Local AI models (Ollama, LM Studio, etc.)** — Works with any model that supports tool use. Smaller models work well for straightforward tasks.

**Any other AI tool** — If your AI can follow instructions and use external tools, it works with AgentLimb. The connection is standard HTTP, the most universal format possible.

---

## Switching Between AI Tools

You can use different AI tools for different tasks, or switch from one to another mid-project. The knowledge your AI has accumulated doesn't belong to any specific tool — it lives in the muscle files on your Desktop.

If Claude Code explored Reddit yesterday, Codex can use that knowledge today. Switch AI tools whenever you like without losing any of the learned workflows.

---

## The Prompt Updates Automatically

Each time you click "Copy Onboard Prompt" in the side panel, the prompt reflects the current state: which sites your AI has learned, whether the bridge is connected, and the full list of available tools. Copy fresh each time you start a new session for the most accurate information.

---

## What Your AI Can Do

Once connected, your AI has access to 16 tools for controlling the browser:

- **Reading** — See what's on the current page, what tabs are open, the current URL
- **Navigating** — Go to any URL, go back, go forward
- **Clicking and typing** — Click buttons, fill in forms, scroll, take screenshots
- **Waiting** — Wait for a page to load, wait for an element to appear
- **Memory** — Read and update the knowledge saved about any website

Your AI combines these tools to complete whatever task you give it, in whatever order makes sense.

---

## Troubleshooting

**AI says it can't connect:** Make sure the bridge is running. Open the AgentLimb side panel — if you see a green "Connected" badge, the bridge is active. If not, start it from the extension folder.

**AI seems confused about what tools are available:** Copy a fresh onboard prompt from the side panel and paste it again. The fresh prompt includes the latest tool list and connection details.
