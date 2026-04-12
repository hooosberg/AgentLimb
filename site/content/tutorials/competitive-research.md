---
title: "Competitive Intelligence: Scrape & Compare Products"
date: "2025-06-05"
tag: "Use Case"
icon: "🔍"
description: "Use AgentLimb to navigate competitor websites, extract pricing and features, and save structured data."
readTime: "8 min"
difficulty: "Intermediate"
---

## Why Use AgentLimb for Research?

Traditional scraping tools use headless browsers and get blocked by anti-bot systems. AgentLimb uses your real Chrome — logged in, with cookies, with your normal browser fingerprint. Websites see a normal user, not a bot.

## Example: Compare SaaS Pricing

### Step 1: Plan Your Research

Tell your AI:

```
I need to compare pricing for these tools:
- competitor-a.com/pricing
- competitor-b.com/pricing
- competitor-c.com/pricing

For each, extract: plan names, prices, and feature lists.
Save the results as a table in the project folder.
```

### Step 2: AI Navigates and Extracts

AgentLimb will:
1. `act(navigate)` to each pricing page
2. `observe()` to read the DOM structure
3. `eval()` to extract structured data from the page
4. `project(write)` to save results locally

### Step 3: Save as Muscle

After the first successful extraction, save the flow:

```
muscle(action: "save", name: "scrape-pricing-[competitor]")
```

Next time that competitor updates their pricing, just replay the muscle.

## Tips for Better Research

- **Use `observe` with screenshots** for pages with complex layouts
- **Use `eval` for dynamic content** — execute JS to extract data from React/Vue apps
- **Save to project files** — keep research organized and accessible across sessions
- **Build muscles per competitor** — each site has a different DOM structure

## Privacy Advantage

Since everything runs locally:
- Your research targets never know you're using automation
- No data goes through third-party scraping services
- Your competitive intelligence stays on your machine
