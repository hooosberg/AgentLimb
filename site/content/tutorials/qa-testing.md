---
title: "Automated QA Testing with Real Browser Sessions"
date: "2026-04-18"
tag: "Use Case"
icon: "🧪"
description: "Test your web app in the browser you actually use — with your extensions, your sessions, and your real data. Catches issues that isolated test runners miss."
readTime: "7 min"
difficulty: "Intermediate"
---

## Why Test with AgentLimb

Playwright and Cypress run in isolated browser contexts. They don't have your extensions, your cookies, your logged-in state. Issues that only happen for authenticated users, or only in specific browser configurations, slip through.

AgentLimb tests in your real Chrome — same browser, same session, same extensions as production use. The test runs exactly as a real user would experience it.

---

## A Basic Test Flow

Give your AI a test plan:

```
Test the checkout flow on staging.my-app.com:

task_plan steps:
1. Navigate to the product page
2. Click "Add to cart"
3. Verify cart badge shows "1"
4. Click "Checkout"
5. Verify the order summary shows the correct item and price
6. Report results

Use task_step_done to mark each step, task_complete if all pass, 
task_fail with the failing step if anything is wrong.
```

### What the AI does

1. **`task_plan`** — Declares the 5 test steps; side panel renders a live checklist
2. **`navigate`** — Goes to the product page
3. **`computer`** (click) — Clicks "Add to cart"
4. **`page_snapshot`** — Reads the DOM to verify cart badge
5. **`javascript_eval`** — Extracts the cart count from the DOM for assertion
6. **`task_step_done`** — Marks step as done or error, one by one
7. **`task_complete`** or **`task_fail`** — Closes the task with result

The side panel shows each step turning green (done) or red (error) as the test runs.

---

## Using `javascript_eval` for Assertions

The `javascript_eval` tool lets you run real JavaScript in the page context — ideal for precise assertions:

```
Use javascript_eval to check:
- document.querySelector('.cart-count').textContent === "1"
- document.querySelector('.order-total').textContent includes "$"
- !!document.querySelector('.success-confirmation')
```

Return values come back to your AI, which evaluates them and reports pass/fail.

---

## Muscle-Backed Regression Tests

After the first successful test run, the selectors for your app's UI are stored in the muscle file. Future test runs skip the DOM exploration:

- **First run:** AI explores, discovers selectors, runs test — ~8,000 tokens, ~5 min
- **Repeat runs:** AI recalls selectors from muscle file, runs assertions — ~1,200 tokens, ~30 sec

This makes regression testing practical: you can run it before every deploy without worrying about token cost.

---

## Testing Logged-In Flows

This is where AgentLimb has a unique advantage. Testing user-specific features — dashboards, account settings, billing flows — normally requires complex session setup in Playwright or Cypress. With AgentLimb, you're already logged in.

```
Navigate to my-app.com/account/billing.
Verify the current plan name is displayed.
Verify the "Upgrade" button is visible.
Verify clicking "Upgrade" opens the plan selection modal.
```

No cookies to configure, no auth tokens to inject. It just works because it's your real browser.

---

## Advantages Over Traditional Testing

| | Playwright / Cypress | AgentLimb |
|---|---|---|
| Browser context | Isolated | Your real browser |
| Login sessions | Requires setup | Already logged in |
| Extensions active | No | Yes |
| Repeat run cost | Fixed compute | Drops 85%+ with muscles |
| Test definition | Code (JS/TS) | Natural language |
| Setup time | Config + code | One prompt |
| Self-healing selectors | Manual update needed | Automatic via muscle_commit |

---

## Limitations

AgentLimb is best for **exploratory and regression testing** — catching real-world issues with real sessions. For **CI/CD pipelines**, Playwright with headless Chrome is still a better fit (it runs without a display). Think of AgentLimb as the tool you reach for when you want to test the way a real user experiences your product.
