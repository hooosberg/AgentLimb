# Development History

> Curated technical history. Dates identify completed design iterations; current implementation is defined by the root source tree and tests.

## 1. Establishing a local browser-control boundary

The initial design separated a terminal-facing Bridge from the Chrome extension. This made it possible to keep browser interaction in the user's existing Chrome profile while exposing a small local HTTP contract to terminal-based coding agents. The decision established the product's local-first boundary: no hosted orchestration service is required for browser control.

## 2. Moving from actions to a tool contract

Browser operations were consolidated into a structured tool catalog rather than a collection of UI-specific commands. The architecture then separated browser control, prompt generation, Bridge/CLI transport, and durable browser knowledge. This separation keeps tool schemas, prompt documentation, and runtime behavior aligned through shared source rather than duplicated descriptions.

## 3. Introducing lifecycle visibility

A browser action sequence is not a task model. The project introduced explicit plan, step, completion, and failure events so the side panel can present task state without inferring success from an arbitrary number of tool calls. This was paired with terminal and Bridge contracts that represent asynchronous work honestly.

## 4. Treating learned browser knowledge as a product boundary

The muscle-memory work explored how a successful workflow can be retained without turning it into a fragile macro. The resulting model favors structured notes, selectors, and workflow hints, with separate outcomes for success, partial completion, failure, and intentional intermediate persistence. The important constraint is that knowledge reduces exploration cost but does not remove the need to observe the current page.

## 5. Adding guidance and guardrails

Real browser work showed that a capable agent can still skip verification, over-trust prior knowledge, or fail to close a task cleanly. The guidance-loop work paired prompt-level principles with runtime guardrails: observe before repeated writes, preserve meaningful knowledge before completion, and make task termination explicit. This combination lets normal work remain flexible while giving the system defensible failure modes.

## 6. Making multi-profile behavior explicit

The project later made Chrome-profile participation, targeting, suspension, and lifecycle fan-out explicit. The engineering lesson was that technically correct dispatch is not sufficient when its visible destination differs from the operator's expectation. Browser scope is therefore treated as a user-facing contract, not merely routing metadata.

## 7. Preparing a reproducible public release

The public repository was consolidated around the complete extension, Bridge, CLI, scripts, tests, and documentation. The release path builds one user-facing extension archive with checksums and embeds a small companion Runtime at a fixed source path; after explicit approval, the first-connection prompt downloads and verifies that Runtime without scanning local folders or browser profiles. CI covers PowerShell parsing and the Native Messaging executable source. Private worktrees, generated artifacts, operating records, and credentials remain under an ignored local archive.

## What this history is for

These notes show how the project arrived at its constraints and interfaces. They are intentionally selective: they retain architectural tradeoffs and verification practices while excluding raw browsing activity, local setup details, private references, and historical test evidence that cannot be reproduced safely.
