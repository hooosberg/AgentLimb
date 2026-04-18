---
title: "Muscle Memory Is Automatic — Here's What That Means"
date: "2026-04-18"
tag: "Muscle Memory"
icon: "💪"
description: "You don't configure muscle memory. AgentLimb builds it silently while your AI works. This article explains what's happening and why the folder on your Desktop matters."
readTime: "4 min"
difficulty: "Beginner"
---

## You Don't Have to Do Anything

Muscle memory in AgentLimb is fully automatic. There's no "save muscle" command to learn. You give your AI a task, it completes it, and AgentLimb quietly records what it learned.

That's it. The next time your AI visits the same site, it already knows the layout.

---

## What Gets Recorded

Every time your AI clicks an element, AgentLimb captures the selector and context. When the task ends and the AI calls `muscle_commit`, all the captured knowledge is merged into a structured profile for that domain.

The profile includes:
- **Selectors** — which CSS paths reliably point to which buttons and inputs
- **Workflows** — the sequence of steps that successfully completed the task
- **Notes** — things the AI found unusual (e.g. "this editor needs a 2-second wait before typing")

This knowledge is saved as a plain JSON file on your Desktop:

```
~/Desktop/AgentLimb-muscle/
  reddit.com.json
  github.com.json
  your-company-saas.json
  ...
```

---

## The One Thing You Need to Do: Don't Delete That Folder

The `~/Desktop/AgentLimb-muscle/` folder is your AI's long-term memory. If you delete it, your AI goes back to exploring from scratch on the next run.

Keep the folder. Back it up if you want. You can even open the JSON files and read them — they're plain text, fully human-readable.

---

## Cold vs Hot Start: Real Numbers

The first time your AI visits a site, it needs to explore. The second time, it reads the muscle file and skips most of that work.

Real data from a Reddit posting task (low-parameter Codex, 2026-04-18):

| | Cold start (first explore) | Hot start (muscle recall) | Savings |
|---|---|---|---|
| `page_snapshot` calls | 3 | **0** | **100%** |
| Total tool calls | 23 | 10 | 56.5% |
| Estimated tokens | ~12,250 | **~1,750** | **↓ 85.7%** |
| Wall-clock time | 8–20 min | 30 s–2 min | **↓ ~80–95%** |

The savings are real and they compound. The third and fourth run stay fast because the knowledge is already there.

---

## What Happens if a Site Changes Its Layout?

AgentLimb doesn't break. If a selector in the muscle file stops working, the AI falls back to a fresh `page_snapshot`, finds the new selector, and continues. At the end of the task, the new selector gets merged into the muscle file automatically.

This is called **self-healing**: the knowledge improves over time instead of going stale.

---

## Four Commit Modes

When the AI finishes a task, it calls `muscle_commit` with one of four statuses:

| Status | What happens |
|---|---|
| `success` | Full knowledge saved to desktop JSON |
| `partial` | Partial knowledge saved, workflow marked incomplete |
| `failed` | Session discarded — bad paths don't pollute the knowledge base |
| `manual` | Saves current progress, keeps session open for more accumulation |

The `failed` mode is important: if your AI hits a CAPTCHA or a broken page, that failure path is *not* written to the muscle file. Only successful routes get saved.

---

## Sharing Muscles

Because muscle files are plain JSON, you can:
- Copy a domain's `.json` file to another machine and paste it into the same Desktop folder — instant knowledge transfer
- Share a file with a colleague so their AI skips the cold start on a platform you've already explored
- Version-control the folder in git if you want history

---

## Summary

1. Give your AI a task. It explores, completes, and saves.
2. Give it the same task again. It skips the exploration.
3. The knowledge lives in `~/Desktop/AgentLimb-muscle/`. Don't delete it.
4. Everything else is automatic.
