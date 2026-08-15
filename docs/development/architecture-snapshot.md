# Architecture

> Status: Current design overview. For executable behavior, read the source tree and run `npm test`.

AgentLimb connects a terminal-based coding agent to the user's active Chrome context through a local Bridge. The architecture keeps browser control, prompt generation, local transport, and learned browser knowledge separate so each can evolve without duplicating contracts.

## System boundary

```text
Terminal-based AI
        |
        | local HTTP on 127.0.0.1
        v
AgentLimb Bridge and CLI
        |
        | extension relay messages
        v
Chrome extension service worker
        |
        | Chrome APIs, CDP, and page-scoped execution
        v
Active browser tab
```

The system is local-first. Browser context and automation results move between the extension and the local Bridge; the Bridge is not a public network service. The Bridge rejects ordinary web origins so a normal webpage cannot use it as a browser-control endpoint.

## Four modules

| Module | Source area | Responsibility |
|---|---|---|
| Browser control | `kernel/control/` | Defines browser tools and performs tab, page, form, and CDP-backed operations. |
| Prompt | `kernel/prompt/` | Builds the agent onboarding prompt, protocol rules, and self-service documentation. |
| Bridge and CLI | `kernel/bridge/` | Runs the local HTTP service, queues requests, exposes health and documentation endpoints, and provides terminal commands. |
| Muscle memory | `kernel/muscle/` | Stores and retrieves domain-scoped browser knowledge accumulated through completed work. |

The side panel in `ui/` bridges the extension runtime and the local Bridge. Installation and release tooling live in `scripts/`; regression coverage lives in `tests/`.

## Control flow

1. The user starts the local runtime and opens the extension side panel.
2. The side panel supplies an onboarding prompt to a compatible terminal agent.
3. The agent uses the local CLI or Bridge contract to request a browser tool call.
4. The Bridge queues the call for the extension, which executes it only within Chrome.
5. The extension returns a structured result through the Bridge to the agent.
6. Explicit lifecycle events let the side panel display planned work, progress, success, and failure without inferring them from raw tool-call count.

## Design decisions

### One tool catalog

Browser-tool schemas are defined in the control layer and used to produce runtime documentation. This avoids maintaining separate, diverging descriptions for the prompt, CLI, UI, and HTTP surface.

### Observe before acting

Browser work is stateful. A prior selector or workflow can assist orientation, but each task must inspect the current page before depending on it. The control and prompt layers make observation, action, and verification distinct concerns.

### Explicit lifecycle over implied success

A completed HTTP request is not evidence that a user task succeeded. The protocol distinguishes planning, step completion, successful completion, and failure so the UI can remain honest when the browser, Bridge, or agent stops mid-task.

### Local runtime rather than a remote service

The extension uses the user's existing Chromium profile and local login state. The Bridge binds to loopback and is installed as a local runtime on supported platforms. The extension supplies the current ID and version; after explicit approval, onboarding downloads the matching GitHub tag source archive, extracts it in a temporary directory, and installs it without scanning local folders or browser profiles.

### Public source and private artifacts stay separate

The root repository contains source, tests, documentation, and release automation. Build outputs, local worktrees, credentials, execution records, and other machine-specific material are kept under the ignored `忽略上传/` directory and never belong in a public commit.

## Validation

Use the automated suite for shared contracts:

```bash
npm test
```

For packaging changes, build the versioned artifacts and inspect the resulting archives:

```bash
node scripts/build-release.mjs 0.2.1
```

Browser permissions, native messaging, OS process management, and task scheduling require manual verification on the target platform. The Windows procedure is documented in [Windows 0.2.1 test checklist](../windows-testing.md).
