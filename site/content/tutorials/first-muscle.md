---
title: "Save Your First Muscle: Automate Reddit Posting"
date: "2025-06-02"
tag: "Muscle Memory"
icon: "💪"
description: "Walk through a complete workflow: AI explores Reddit, posts content, and saves the action sequence as a reusable muscle."
readTime: "5 min"
difficulty: "Beginner"
---

## What is a Muscle?

A muscle is a saved action sequence — like muscle memory for your AI. When your AI completes a task for the first time, AgentLimb can save every step. Next time, it replays the exact sequence with zero token cost.

## Step-by-Step: Post to Reddit

### 1. Tell Your AI What to Do

Paste this to your AI after connecting AgentLimb:

```
Navigate to reddit.com/r/test, create a new text post with the title 
"Testing AgentLimb" and body "This is an automated test post". 
After posting, save this as a muscle called "reddit-post".
```

### 2. Watch the AI Explore

Your AI will:
1. Call `act(action: "navigate", url: "https://reddit.com/r/test")`
2. Call `observe()` to read the page structure
3. Call `act(action: "click", selector: "...")` to find the post button
4. Call `act(action: "type", ...)` to fill in the title and body
5. Submit the post

This first run uses ~30 API calls and ~5000 tokens.

### 3. Save as Muscle

The AI calls:

```
muscle(action: "save", name: "reddit-post", steps: [...])
```

AgentLimb saves the complete action sequence to `chrome.storage` and `~/.agentlimb/muscles.json`.

### 4. Replay Anytime

Next time you want to post to Reddit, just tell your AI:

```
Run the "reddit-post" muscle with title "My New Post" and body "Content here"
```

The AI calls `muscle(action: "run", name: "reddit-post")` — one API call, ~300 tokens, zero errors.

## The Math

| | First Run | Muscle Replay |
|---|---|---|
| API calls | ~30 | 1 |
| Tokens | ~5,000 | ~300 |
| Time | ~2 min | ~10 sec |
| Errors | Possible | 0 |

**~16x efficiency gain.** And it gets better — you only explore once per platform, then reuse forever.
