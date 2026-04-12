---
title: "Writing the Perfect Onboard Prompt for Your AI"
date: "2025-06-03"
tag: "Configuration"
icon: "📋"
description: "How to customize the onboard prompt for different AI tools to get the best results."
readTime: "3 min"
difficulty: "Beginner"
---

## What is the Onboard Prompt?

The onboard prompt is the text you paste to your AI that tells it about AgentLimb's 8 tools. It's the one-step configuration — no config files, no API keys, just text.

## The Default Prompt

Click **"Copy Onboard Prompt"** in the AgentLimb side panel. This gives you a pre-built prompt that describes all 8 tools with their parameters.

## Tips for Different AI Tools

### Claude Code

Claude Code works perfectly with the default prompt. Just paste it at the beginning of your session. Claude will automatically detect the MCP tools and start using them.

**Pro tip:** Add project context after the prompt:

```
[paste onboard prompt]

My goal today: Post our product update to Reddit, Twitter, and Product Hunt.
Content is in the project folder under /posts/update-v2.md
```

### Cursor

Cursor supports MCP natively. You can either:
- Paste the prompt in chat, or
- Configure MCP in Cursor settings to auto-connect on startup

### Codex / Trae / Windsurf

These tools work with the standard prompt. Just paste and go.

### Custom Scripts

Any tool that can send HTTP POST requests to `http://127.0.0.1:7789` can use AgentLimb. The 8 tools are standard HTTP endpoints — no special SDK needed.

## Customizing the Prompt

You can edit the prompt to focus on your use case:

- **Marketing focus:** Add "Prioritize social media operations. Always save muscles after successful posts."
- **Research focus:** Add "Use observe() extensively. Extract structured data. Save results to project files."
- **Testing focus:** Add "Verify each action result before proceeding. Report any UI inconsistencies."

The prompt is just text — make it work for your workflow.
