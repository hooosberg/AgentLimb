---
title: "Unix Philosophy in the Age of AI: Do One Thing Well"
date: "2025-05-05"
tag: "Philosophy"
description: "The best AI tools follow Unix principles — small, composable, and focused."
---

In 1978, Doug McIlroy described the Unix philosophy: "Make each program do one thing well." Nearly 50 years later, this principle is more relevant than ever in AI tool design.

## The Problem with Bloat

Many AI tools try to do everything: code editing, browser automation, file management, deployment, testing, documentation — all in one monolithic application. The result is complexity, slow performance, and features that are mediocre at everything.

## AgentLimb's Approach: 8 Tools, Each Focused

AgentLimb follows Unix philosophy strictly:

- `observe` — reads page state. That's all it does.
- `act` — performs browser interactions. Nothing more.
- `wait` — waits for conditions. Single purpose.
- `eval` — runs JavaScript. Clean and simple.
- `muscle` — manages action sequences. One concern.
- `report` — updates the UI. Separated from logic.
- `ping` — health check. Trivial but essential.
- `project` — file operations. Scoped and clear.

Each tool does one thing. They compose together through the AI's reasoning. The AI decides how to combine them — AgentLimb just provides the primitives.

## Why This Works for AI

AI models excel at composing simple tools. Give an AI 8 well-defined tools and it can solve complex problems by chaining them. Give it 80 overlapping features and it gets confused about which to use.

Simplicity isn't a limitation — it's a feature. The best tools are the ones that are easy to reason about, both for humans and for AI.
