---
title: "Multi-Platform Social Media Marketing with AI"
date: "2025-06-04"
tag: "Use Case"
icon: "📣"
description: "Automate posting to Reddit, Twitter, Product Hunt, and V2EX. Create muscles for each platform and batch-execute campaigns."
readTime: "10 min"
difficulty: "Intermediate"
---

## The Problem

You have a product to promote. You need to post to 5+ platforms. Each platform has different UI, different flows, different rules. Doing it manually takes hours.

## The AgentLimb Approach

1. **Explore once** — Let AI learn each platform's posting flow
2. **Save as muscles** — One muscle per platform
3. **Batch replay** — Run all muscles with your content

## Platform-by-Platform Setup

### Reddit

```
Navigate to reddit.com/r/[subreddit]. Create a text post 
with the given title and body. Save as muscle "reddit-post".
```

Key considerations:
- Different subreddits have different post types (text, link, image)
- Some subreddits require flair selection
- Save separate muscles for different subreddit types

### Twitter / X

```
Navigate to twitter.com. Click the compose button. 
Type the tweet content. Post it. Save as muscle "tweet".
```

For thread posting, the muscle captures the "Add another tweet" flow.

### Product Hunt

```
Navigate to producthunt.com/posts/new. Fill in the product 
details. Save as muscle "ph-launch".
```

Product Hunt launches are one-time events — but the muscle helps you practice the flow before launch day.

### V2EX

```
Navigate to v2ex.com/new. Select the node. Fill in title 
and body. Save as muscle "v2ex-post".
```

## Batch Execution

Once you have muscles for each platform, create a simple campaign:

```
Run these muscles in sequence:
1. reddit-post with title "..." body "..."
2. tweet with content "..."
3. v2ex-post with title "..." body "..."
```

Your AI executes all three with minimal tokens — each platform replay costs ~300 tokens instead of ~5000.

## Content Templates

Use the **project system** to store content templates:

```
project(action: "write", path: "campaigns/launch-v2.md", content: "...")
```

Your AI can read the template and customize it for each platform automatically.

## Results

A typical 5-platform campaign:

| | Manual | AI (first time) | AI (with muscles) |
|---|---|---|---|
| Time | 2-3 hours | 30 min | 5 min |
| Tokens | — | ~25,000 | ~1,500 |
| Errors | Possible | Possible | Zero |
