---
title: "Connecting AgentLimb to Claude Code via MCP"
date: "2025-06-08"
tag: "Integration"
icon: "🔌"
description: "Step-by-step MCP configuration for Claude Code. How the 8 tools map to MCP protocol."
readTime: "4 min"
difficulty: "Beginner"
---

## What is MCP?

Model Context Protocol (MCP) is a standard created by Anthropic for connecting AI models to external tools. AgentLimb's bridge natively speaks MCP — no adapters needed.

## How AgentLimb Maps to MCP

Each of AgentLimb's 8 tools becomes an MCP tool:

| AgentLimb Tool | MCP Tool Name | Purpose |
|---|---|---|
| observe | `observe` | Read page state |
| act | `act` | Browser interactions |
| wait | `wait` | Wait for conditions |
| eval | `eval` | Run JavaScript |
| muscle | `muscle` | Action sequence CRUD |
| report | `report` | Update side panel UI |
| ping | `ping` | Health check |
| project | `project` | File operations |

## Connecting Claude Code

### Method 1: Onboard Prompt (Simplest)

1. Start the bridge: `node bridge.js`
2. Copy the onboard prompt from AgentLimb's side panel
3. Paste to Claude Code

Claude Code will auto-detect the tools and start using them.

### Method 2: MCP Configuration

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "agentlimb": {
      "url": "http://127.0.0.1:7789"
    }
  }
}
```

This auto-connects on every Claude Code session — no prompt needed.

## Verifying the Connection

After connecting, tell Claude Code:

```
Use the ping tool to check if AgentLimb is connected.
```

You should see the bridge respond with status information, and the side panel should show a green dot.

## Troubleshooting

- **Bridge not running:** Make sure `node bridge.js` is active in a terminal
- **Port conflict:** Check that nothing else uses port 7789
- **Extension not installed:** The bridge needs the Chrome extension to be loaded and active
- **Side panel closed:** Open the side panel by clicking the AgentLimb icon in Chrome
