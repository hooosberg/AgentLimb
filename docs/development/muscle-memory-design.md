# Muscle Memory Design

> Status: Current design rationale. Implementation details live in `kernel/muscle/` and are covered by the repository test suite.

A muscle is a domain-scoped record of browser knowledge accumulated while an agent works. It exists to avoid repeatedly rediscovering stable page structure, but it is deliberately not a macro recorder or an autonomous replay script.

## Problem

Repeated browser tasks often spend time re-identifying controls, understanding forms, and checking navigation outcomes. Those discoveries can be useful on a later task, but a raw action log is too brittle: a changed layout, different account state, or missing permission can turn a previously successful sequence into an unsafe instruction.

## Design goals

- Keep knowledge local to the user's machine.
- Organize knowledge by domain so unrelated sites do not contaminate each other.
- Store reusable observations, selectors, workflow hints, and notes rather than opaque command recordings.
- Preserve successful and explicitly partial work without turning failure into trusted knowledge.
- Let an agent inspect and override learned knowledge as the live page requires.

## Knowledge model

The runtime keeps a compact profile for each domain. A profile may include:

| Field | Purpose |
|---|---|
| Domain | Stable key for retrieval and isolation. |
| Notes | Human- or agent-readable observations about the site's interaction model. |
| Selectors | Candidate element references with enough context to evaluate them again. |
| Workflows | High-level task hints and outcomes, not fixed replay scripts. |

The exact schema is intentionally owned by the runtime. Documentation should explain the contract, while `kernel/muscle/` and tests define the fields and merge behavior that the current release supports.

## Lifecycle

```text
Observe a live page
        |
        v
Perform and verify work
        |
        v
Capture reusable observations in the current session
        |
        +--> success or partial: merge useful knowledge into the domain profile
        |
        +--> failure: discard unverified session knowledge
        |
        +--> manual persistence: preserve a useful intermediate result explicitly
```

This separation prevents a failed or abandoned attempt from silently polluting future work. It also preserves the distinction between a completed workflow and a useful partial discovery.

## Retrieval and use

When a browser task enters a domain, the system can attach relevant learned context to the browser result. The agent should treat that context as an orientation aid:

1. Confirm the current page and user state.
2. Compare the learned anchors with the live interface.
3. Use the knowledge when it still matches.
4. Record a correction only after the new behavior has been meaningfully verified.

A muscle never grants authority to act outside the user's task. It is local context, not a permission model.

## Storage and privacy

Profiles are stored locally and can be inspected, backed up, edited, moved, or deleted by the user. They can contain information inferred from browser interaction, so they must not be committed to the public repository, attached to bug reports, or included in release archives. The repository ignores local runtime records and keeps public example material separate from actual user data.

## Tradeoffs

| Choice | Benefit | Cost |
|---|---|---|
| Structured hints over macro replay | Better resilience to layout and state changes. | Requires live inspection before use. |
| Domain-scoped profiles | Limits cross-site contamination. | Shared subdomains may need explicit handling. |
| Success and partial persistence | Preserves useful work without claiming full completion. | Requires a clear lifecycle decision from the agent. |
| Local storage | Keeps browser knowledge under user control. | No automatic cloud sharing or synchronization. |

## Validation

Changes to muscle behavior should test normalization, atomic writes, retrieval, merge behavior, and the distinct success, partial, failure, and manual paths. Manual browser validation should use non-sensitive tasks and should never commit real site records or user data to the repository.
