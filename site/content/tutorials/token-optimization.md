---
title: "Token Optimization: 12,250 → 1,750 — Real Data"
date: "2026-04-18"
tag: "Advanced"
icon: "⚡"
description: "How AgentLimb's three-layer muscle memory reduces token cost by 85.7% on repeat tasks — with real regression numbers."
readTime: "6 min"
difficulty: "Advanced"
---

## Where Tokens Actually Go

When your AI operates a browser without muscle memory, most tokens are spent on **re-exploration** — figuring out what's on the page, where the buttons are, which path leads to success.

A Reddit posting task with a cold browser:
- 3× `page_snapshot` calls to understand the DOM
- Multiple click attempts to locate the right selector
- AI reasoning at each step
- **Total: ~12,250 tokens, 8–20 minutes**

With muscle memory on the second run:
- 0 `page_snapshot` calls — selectors are already known
- Direct navigation to the right elements
- **Total: ~1,750 tokens, 30 seconds to 2 minutes**

**85.7% reduction** — verified in a real regression test (low-parameter Codex, Reddit r/test, 2026-04-18).

---

## How the Three-Layer System Works

```
Session layer  →  Chrome storage, lives for one task
               auto-captured: every successful click appends a selector entry

Hot layer      →  Chrome storage, persists across tasks
               written on muscle_commit

Truth layer    →  ~/Desktop/AgentLimb-muscle/<domain>.json
               permanent, human-readable, survives Chrome reinstalls
```

Every time your AI clicks something, the selector is silently appended to the session buffer. At task end, `muscle_commit` merges the buffer into hot and truth layers. Zero overhead for your AI.

---

## Auto-Recall on Navigate

When your AI navigates to a domain it has visited before, AgentLimb automatically reads the muscle file and delivers the site knowledge as part of the tool result. Your AI sees:

```
reddit.com knowledge (v3, updated 2026-04-17):
- submit button → .submit-link-button
- title input → textarea[name="title"]
- Workflow: text post → 4 steps (90% success)
- Note: shadow DOM on new reddit — title selector is the React wrapper
```

`page_snapshot` is never called unless a stored selector fails.

---

## Real Regression Data

| Metric | Cold start | Hot start | Savings |
|---|---|---|---|
| `page_snapshot` calls | 3 | **0** | **100%** |
| Total tool calls | 23 | 10 | 56.5% |
| Estimated tokens | ~12,250 | **~1,750** | **↓ 85.7%** |
| Wall-clock time | 8–20 min | **30s–2 min** | **↓ ~80–95%** |
| Selector hit rate | — | 2/3 (1 auto-healed) | — |

The hit rate shows self-healing: one stored selector had gone stale. The AI detected the mismatch, used `page_snapshot` for that one element, found the new selector, finished the task, then wrote the corrected selector back to the muscle file.

---

## Four Commit Modes

| Status | What gets saved |
|---|---|
| `success` | Full session buffer merged |
| `partial` | Buffer merged, workflow marked incomplete |
| `failed` | Session discarded — bad paths never pollute the knowledge base |
| `manual` | Partial save, session stays open for more accumulation |

The `failed` mode is crucial: CAPTCHA hits, error loops, broken pages — all discarded. Only verified routes compound.

---

## Cost at Scale

100 repeat tasks/month on sites with established muscles:

| | Without muscle memory | With muscle memory |
|---|---|---|
| Tokens per task | ~12,250 | ~1,750 |
| Monthly tokens | ~1,225,000 | ~175,000 |
| **Savings** | — | **↓ 85.7%** |

The savings are permanent — the muscle files don't expire or reset. The more you run the same sites, the more the cost asymptote approaches zero.
