---
title: "Multi-Account Parallel Control: One Command, Every Profile"
date: "2026-04-20"
tag: "New in v0.1.3"
icon: "👥"
description: "Run one AI task across multiple Chrome profiles simultaneously. Different accounts, same command — window locking, automatic suspend detection, and per-profile identity built in."
readTime: "8 min"
difficulty: "Intermediate"
---

## What This Feature Does

AgentLimb v0.1.3 lets your AI drive multiple Chrome profiles at the same time — in parallel, with one command.

If you have three Twitter accounts, two company Google Workspace logins, or a dozen test profiles, you no longer need to run the same task three times. One instruction reaches every open side panel simultaneously.

Each profile:
- Has an **explicit identity** shown in its side panel header (e.g. `Profile-a3f2`)
- Locks its AI actions to the **correct Chrome window** automatically
- Can be **suspended** (opted out) without stopping the others
- Receives the **full task lifecycle** — plan, step updates, and the final success or failure result

---

## Setting It Up

You don't need to configure anything new. The multi-profile behavior is automatic as long as you have more than one side panel open.

**Step 1 — Create multiple Chrome profiles**

Open Chrome → click your profile avatar → **Add** → create as many profiles as you need. Each profile gets its own cookies, sessions, and login state.

**Step 2 — Open the side panel in each profile**

In each Chrome profile window, click the AgentLimb icon or open the side panel from the Extensions menu. You should see the profile's identity label in the header of each panel.

**Step 3 — Connect your AI**

Copy the onboard prompt from any one side panel and paste it to your AI terminal. The Bridge automatically discovers all connected profiles.

That's it. Your AI is now connected to all open profiles.

---

## Running a Task Across All Profiles

Give your AI a single instruction as usual. For example:

> Post "Our new feature is live — check it out at agentlimb.com" to Twitter.

The AI will:
1. Declare a `task_plan` — all side panels show the same step list simultaneously
2. Execute the task on each active profile in parallel
3. Report `task_complete` when all active profiles finish, noting which profiles were skipped if any were suspended

You watch the progress in each side panel independently. One might finish faster than the other — they don't wait for each other.

---

## Window Locking: Navigate Goes to the Right Place

Each Chrome profile can have multiple windows open. Without window locking, the AI's `navigate` command might land in the wrong window.

AgentLimb solves this automatically. When you open a side panel, it registers the Chrome window it lives in. Every `navigate` call for that profile targets that specific window — not whichever one Chrome considers "active" at the moment.

If you close the window and reopen the side panel in a different one, the lock updates automatically. The AI follows your focus.

---

## Suspending a Profile (Opting Out)

Sometimes you want to run a task on two of your three profiles, not all of them.

**Method 1 — Close the side panel.** A closed panel means "this profile is not participating." The AI skips it silently and reports it in the final summary.

**Method 2 — Click Suspend.** The Suspend button inside the panel opts that profile out without closing the panel. Useful if you want to keep the panel visible but temporarily exclude it.

Either way, the AI does not fail the overall task because of a suspended profile. It continues with the remaining active ones. Only if *all* profiles are suspended will the AI declare `task_fail(no_active_profile)`.

**To resume:** just reopen the panel or click Resume. The Bridge detects the change within 300ms and includes the profile in the next task automatically.

---

## Targeting a Specific Profile

For some tasks you want to control one profile precisely rather than broadcasting to all.

Use the `target` parameter in your instruction:

> Using Profile-a3f2 only: update the bio on LinkedIn.

The AI passes this label to the Bridge, which routes the tool call to that profile exclusively. Other profiles are unaffected.

You can find each profile's label in the header of its side panel.

---

## A Practical Example

You run a product with accounts on X, Weibo, and Threads across three Chrome profiles.

**Old workflow:** run the post task three times, switching profiles manually each time.

**With multi-profile parallel control:**

1. Open all three profiles, open a side panel in each
2. Give your AI one instruction: "Post today's build update to all accounts"
3. All three side panels show the plan; all three execute in parallel
4. Task completes in roughly the same time as running it once

If one account is rate-limited or suspended, that profile is skipped. The other two still complete. The final summary tells you exactly what happened on each.

---

## Summary

| | Before v0.1.3 | v0.1.3 |
|---|---|---|
| Running on 3 profiles | 3 separate tasks | 1 command |
| Profile identity | None — AI guesses | Explicit label shown in panel |
| Window targeting | Unreliable across windows | Locked to correct window automatically |
| Opting a profile out | No mechanism | Close panel or click Suspend |
| Task result | One result per run | Per-profile status in a single summary |

Multi-profile parallel control is most powerful when combined with muscle memory — the AI already knows the selectors for each site, so each profile's task runs at full hot-start speed.
