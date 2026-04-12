---
title: "Automated QA Testing with Real Browser Sessions"
date: "2025-06-09"
tag: "Use Case"
icon: "🧪"
description: "Use AgentLimb to test your web app on a real browser. Click through user flows, check states, and report results."
readTime: "7 min"
difficulty: "Intermediate"
---

## Why Test with AgentLimb?

Traditional testing frameworks (Playwright, Cypress) use isolated browser contexts. AgentLimb tests in your real browser — with your extensions, your settings, your logged-in sessions. This catches issues that isolated tests miss.

## Setting Up a Test Flow

### 1. Define Your Test Case

Tell your AI:

```
Test the checkout flow on my-app.com:
1. Navigate to my-app.com
2. Add a product to cart
3. Go to checkout
4. Verify the cart total
5. Report results
```

### 2. AI Executes with Verification

AgentLimb's tools make testing natural:

```
observe()   → Read page state, verify elements exist
act()       → Click buttons, fill forms
wait()      → Wait for page transitions
eval()      → Run assertions in JavaScript
report()    → Update the side panel with test status
```

### 3. Save as a Test Muscle

After a successful test run, save it:

```
muscle(action: "save", name: "checkout-test")
```

Now you can replay this test anytime with one command.

## Writing Assertions with eval()

Use `eval()` to run JavaScript assertions directly in the page:

```javascript
// Check cart total
eval({ code: "document.querySelector('.cart-total').textContent" })
// Returns: "$29.99"

// Verify element exists
eval({ code: "!!document.querySelector('.success-message')" })
// Returns: true
```

## Using report() for Test Dashboards

The `report` tool updates AgentLimb's side panel in real-time:

```
report(title: "Checkout Test", status: "running", steps: [
  { label: "Navigate to app", status: "done" },
  { label: "Add to cart", status: "running" },
  { label: "Verify total", status: "pending" }
])
```

Your side panel becomes a live test dashboard.

## Advantages Over Traditional Testing

| | Playwright/Cypress | AgentLimb |
|---|---|---|
| Browser context | Isolated | Your real browser |
| Login sessions | Need setup | Already logged in |
| Extensions | Not available | Your extensions active |
| Muscle replay | Not available | Zero-token re-testing |
| Setup time | Config files needed | One prompt |
