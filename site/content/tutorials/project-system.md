---
title: "Using the Project System for Long-Term AI Collaboration"
date: "2025-06-07"
tag: "Projects"
icon: "📁"
description: "Set up a work project folder, organize planning docs, and let AI maintain context across sessions."
readTime: "5 min"
difficulty: "Intermediate"
---

## What is the Project System?

AgentLimb's project system lets you designate a local folder as your "work project". Your AI can read and write files in this folder, maintaining context across multiple sessions.

## Setting Up a Project

### 1. Create Your Project Folder

```bash
mkdir ~/projects/my-campaign
```

### 2. Select in AgentLimb

Open the side panel → Monitor tab → **Work Project** section → Click "Select Project Folder" → Choose your folder.

### 3. (Optional) Set the Full Path

Paste the full path in the input field so your AI can reference it:

```
/Users/yourname/projects/my-campaign
```

## How AI Uses the Project

Your AI can use the `project` tool to:

- **List files:** `project(action: "list")` — see what's in the folder
- **Read files:** `project(action: "read", path: "plan.md")` — read a document
- **Write files:** `project(action: "write", path: "results.md", content: "...")` — save results

## Recommended Folder Structure

```
my-campaign/
  plan.md           — goals, platforms, timeline
  content/
    post-template.md  — reusable content template
    assets/           — images, screenshots
  results/
    reddit-2025-06.md — execution results
    metrics.md        — tracking data
```

## Cross-Session Workflow

**Session 1:** Plan the campaign, write templates
**Session 2:** AI reads the plan, explores platforms, saves muscles
**Session 3:** AI reads the plan, runs muscles, saves results

Each session picks up where the last left off — because the context lives in files, not in AI memory.

## Tips

- **Keep files small and focused** — one topic per file
- **Use markdown** — AI reads and writes it naturally
- **Store muscle replay results** — build a history of what worked
- **Include platform rules** — remind AI about posting guidelines
