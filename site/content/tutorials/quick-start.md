---
title: "Quick Start: From Zero to Browser Automation in 3 Steps"
date: "2026-04-18"
tag: "Getting Started"
icon: "🚀"
description: "Install the extension, copy one prompt, paste to your AI. That's it."
readTime: "2 min"
difficulty: "Beginner"
---

## The Whole Process Takes About 60 Seconds

AgentLimb is designed to get out of your way as fast as possible. There are no config files, no API keys, no headless browser setup. Just three steps.

---

## Step 1: Install the Extension

**Option A — Chrome Web Store (recommended):**

[Install AgentLimb](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — one click, auto-updates. Done.

**Option B — Load unpacked (developers only):**

Download the [latest release zip](https://github.com/hooosberg/AgentLimb/releases/latest), unzip it, then open `chrome://extensions`, toggle on **Developer mode** (top-right), click **Load unpacked**, and select the unzipped folder.

---

## Step 2: Start the Bridge

The bridge is a tiny local Node.js server that passes messages between your AI terminal and the Chrome extension. It runs entirely on your machine at `127.0.0.1:7791` — nothing leaves your computer.

**One-time setup (macOS — registers auto-start on login):**

```bash
bash scripts/install.sh
```

After that, the bridge starts automatically whenever you log in. You never need to think about it again.

**Or start manually for this session:**

```bash
npm start
```

When the bridge is running, the side panel shows a green **Connected** badge.

---

## Step 3: Copy Prompt → Paste to AI → Give a Task

1. Open the AgentLimb side panel (click the extension icon in Chrome toolbar)
2. Click **"Copy Onboard Prompt"**
3. Paste it into your AI terminal — Claude Code, Codex, Cursor, Windsurf, or any other tool
4. The AI self-configures in a few seconds (it fetches the tool schema automatically)
5. Give it a task:

> *"Go to reddit.com/r/test and post a text post with the title 'Hello from AgentLimb' and body 'Testing browser automation.'"*

The AI will call `task_plan`, navigate to Reddit, fill in the form, submit, and call `task_complete`. You'll see each step appear live in the side panel.

---

## What Happens Behind the Scenes

```
Your AI Terminal  →  copies prompt, auto-fetches 16 tool schemas
AgentLimb Bridge  →  running locally at 127.0.0.1:7791
Chrome Extension  →  connected to your real browser via CDP
Your Browser      →  logged in, cookies intact, no re-login needed
~/Desktop/AgentLimb-muscle/  →  knowledge is saved here after each task
```

AgentLimb reads the DOM directly — not screenshots. Your AI sees a clean list of interactive elements, clicks precisely, and navigates reliably.

---

## Muscle Memory Starts Automatically

After the first time your AI visits a site, AgentLimb silently records what it learned — selectors, workflows, page structure. This gets saved to `~/Desktop/AgentLimb-muscle/<domain>.json` on your Desktop.

**Don't delete that folder.** It's your AI's knowledge base. The more tasks it completes, the cheaper and faster repeat runs become. The second time your AI posts to Reddit, it skips the exploration entirely and goes straight to the submit button.

---

## Next Steps

- Try a real task: post to a site you actually use every day
- [How muscle memory works — and why it's automatic](/article.html?type=tutorials&slug=first-muscle)
- [Connect a different AI tool](/article.html?type=tutorials&slug=connect-any-ai)
