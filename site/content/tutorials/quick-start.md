---
title: "Quick Start: Install & Connect in 2 Minutes"
date: "2025-06-01"
tag: "Getting Started"
icon: "🚀"
description: "Install the extension, start the bridge, and connect your first AI tool."
readTime: "2 min"
difficulty: "Beginner"
---

## Step 1: Install the Extension

Two options:

**Option A — Chrome Web Store** (recommended):
Search "AgentLimb" in the Chrome Web Store and click "Add to Chrome".

**Option B — Load unpacked** (for developers):

```bash
git clone https://github.com/hooosberg/AgentLimb.git
```

Then open `chrome://extensions/`, enable "Developer mode", click "Load unpacked", and select the cloned folder.

## Step 2: Start the Bridge

The bridge is a tiny local Node.js server that connects your AI to the extension.

```bash
cd AgentLimb/bridge
node bridge.js
```

You should see:

```
AgentLimb Bridge running on 127.0.0.1:7789
```

The green dot in the extension's side panel will light up.

## Step 3: Connect Your AI

1. Open Chrome's side panel (click the AgentLimb icon)
2. Click **"Copy Onboard Prompt"**
3. Paste it into your AI tool (Claude Code, Cursor, Codex, Trae, etc.)

That's it. Your AI can now observe, click, type, and navigate any page in your browser.

## What's Next?

- Try telling your AI: *"Open Twitter and show me the trending topics"*
- Save your first muscle: [Save Your First Muscle](/article.html?type=tutorials&slug=first-muscle)
- Learn about the project system: [Using the Project System](/article.html?type=tutorials&slug=project-system)
