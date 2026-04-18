---
title: "Explicit Task Lifecycle: plan → step → complete"
date: "2026-04-18"
tag: "Protocol"
icon: "📋"
description: "Silence no longer equals success. AgentLimb's task lifecycle protocol makes AI progress visible and failures explicit — in real time."
readTime: "5 min"
difficulty: "Intermediate"
---

## The Problem with Silent AI

Without a lifecycle protocol, you can't tell the difference between:
- An AI that finished successfully
- An AI that's stuck on step 3 for the past 10 minutes
- An AI that crashed and doesn't know it

AgentLimb solves this with an explicit lifecycle that every task must follow. Every state is declared. Silence is treated as failure.

---

## The Four Tools

### `task_plan`

The AI declares its intent before touching the browser:

```json
task_plan({
  "title": "Post to Reddit r/entrepreneur",
  "steps": [
    "Navigate to subreddit",
    "Click 'New Post'",
    "Fill in title and body",
    "Submit and confirm"
  ]
})
```

The side panel immediately renders a live checklist with a **running** badge. You see the plan before the AI takes a single action.

### `task_step_done`

As each step completes, the AI marks it:

```json
task_step_done({ "index": 0, "ok": true })
task_step_done({ "index": 1, "ok": true })
task_step_done({ "index": 2, "ok": false, "note": "Submit button not found — retrying with alternate selector" })
```

Errors are immediately visible in the side panel. You can see exactly where the AI is in real time.

### `task_complete`

Explicit success:

```json
task_complete({ "summary": "Post published at reddit.com/r/entrepreneur/comments/xyz" })
```

Side panel enters **success** state (green). No ambiguity.

### `task_fail`

Explicit failure:

```json
task_fail({ "reason": "CAPTCHA appeared on step 3. Could not proceed." })
```

Side panel enters **failed** state (red). The reason is recorded.

---

## Automatic Failure Modes

You don't have to manually call `task_fail` for every edge case. AgentLimb handles these automatically:

| Condition | Result |
|---|---|
| No progress for 5 minutes | **timeout** state — task treated as failed |
| Bridge goes offline + 15s wait | **failed** state with reason "bridge offline" |

This means a stuck AI doesn't silently waste tokens forever. It times out, and you see it in the side panel.

---

## How It Connects to Muscle Memory

The lifecycle protocol and muscle memory are linked. The recommended pattern:

```
task_plan(...)
[business tool calls]
muscle_commit(status: "success", verification: "post appeared at URL")
task_complete(summary: "...")
```

`muscle_commit` runs *before* `task_complete`. This ensures:
1. Knowledge is saved while the AI still has the session context
2. The verification string becomes a note in the muscle file
3. If `muscle_commit(failed)` is called, the session is discarded *before* `task_fail` — no bad routes get saved

---

## What You See in the Side Panel

The side panel has three states for any task:

| Badge | Meaning |
|---|---|
| 🟡 **running** | Task declared, steps in progress |
| ✅ **success** | `task_complete` called |
| ❌ **failed** | `task_fail` called, or timeout, or bridge offline |
| ⏱ **timeout** | No progress for 5 minutes |

Each step in the checklist shows:
- ⬜ Pending
- 🔄 Active (current step being worked)
- ✅ Done
- ❌ Error (with note)

---

## Tips for Better Task Declarations

**Be specific in step labels.** Instead of "Do the thing", use "Click the 'New Post' button in r/entrepreneur". When a step errors, you want to know exactly which action failed.

**One logical action per step.** Don't bundle "fill form and submit" into one step. Keep them separate so the error granularity is useful.

**Always pair muscle_commit with task_complete.** Your AI should commit knowledge before declaring success. This is enforced in the prompt's behavior rules.

**Use `task_step_done` with `ok: false` for soft errors.** If the AI tried a path and it didn't work but recovery is possible, mark the step as error and continue. The partial failure is visible in the panel without aborting the whole task.
