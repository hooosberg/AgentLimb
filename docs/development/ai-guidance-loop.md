# AI Guidance Loop

> Status: Design rationale for the interaction rules between an agent and a live browser.

Browser automation fails most often through gradual loss of context: an agent acts before observing the current page, treats prior knowledge as an infallible script, or reports completion without preserving or verifying what happened. AgentLimb addresses this with a guidance loop that combines prompt instructions with runtime checks.

## The operating model

```text
Observe -> Orient -> Decide -> Act -> Verify -> Observe again
```

The loop applies to every meaningful browser transition. A successful action changes page state; the next decision should be made from the resulting state rather than from assumptions held before the action.

## Principles

### Learned knowledge is a map, not a script

A muscle can identify likely anchors, form fields, and workflow steps. It cannot establish that the page still has the same layout, user state, validation rules, or scope. Agents should use learned knowledge to reduce exploration, then inspect the live page before performing consequential work.

### Repeated writes need observation points

A sequence of clicks, typing, selections, or navigation can drift from the intended task. The control layer tracks the distinction between observation and write-like operations so an agent must return to page state before continuing a long interaction sequence.

### Completion has a knowledge boundary

When a task creates useful, reusable knowledge, the agent should preserve it before declaring success or partial completion. A failure should not automatically turn an incomplete or incorrect workflow into durable knowledge.

### Failure is a valid terminal state

The protocol distinguishes successful completion, partial persistence, and failure. This gives the user and the side panel a truthful state rather than interpreting silence, a disconnected Bridge, or a timed-out operation as success.

## Guardrail layers

| Layer | Purpose | Example |
|---|---|---|
| Product principle | Explains the intent to a human reviewer. | Previous knowledge guides inspection; it does not replace inspection. |
| Prompt rule | Gives an agent an actionable instruction. | Inspect the page before relying on an old selector. |
| Runtime guardrail | Prevents a repeated, high-cost failure mode. | Reject or redirect an invalid transition until the agent observes or closes the lifecycle correctly. |

Prompt rules make expected behavior legible to capable agents. Runtime guardrails define the minimum behavior that remains necessary when a prompt is skipped, compressed, or interpreted poorly. Neither layer should try to encode an entire workflow: excessive blocking creates brittle automation and hides the real page state from the agent.

## Task lifecycle

A task follows an explicit lifecycle:

1. Establish the local connection and inspect the relevant browser context.
2. Declare a task plan when there is a user mission to execute.
3. Alternate between browser actions and verification.
4. Record reusable knowledge only when it reflects a meaningful result.
5. End with an explicit success or failure state.

This lifecycle is separate from a tool's transport success. For example, a click can execute correctly while the product-level task still fails because a required field is missing or a page changed unexpectedly.

## Review questions

When changing browser tools, prompts, or memory behavior, ask:

- Does this change make it easier to act without seeing the current page?
- Can a failed action accidentally become persistent knowledge?
- Does the side panel have enough information to distinguish progress from completion?
- Can the local Bridge or extension disconnect without producing a misleading success state?
- Is a proposed guardrail protecting a real failure mode, or only encoding one website's current layout?

The answers should be reflected in code, focused tests, and, where behavior is user-visible, a manual browser check.
