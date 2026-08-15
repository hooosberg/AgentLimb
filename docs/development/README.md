# Development Notes

This directory documents the technical decisions that shaped AgentLimb and the current workflow used to maintain it. It is designed to make the project reviewable without publishing local worktrees, browser execution records, credentials, or private reference material.

## Current design documents

- [Architecture](architecture-snapshot.md) explains the browser-control, prompt, Bridge, and muscle-memory boundaries.
- [AI guidance loop](ai-guidance-loop.md) explains why browser work alternates observation, action, and verification.
- [Muscle memory design](muscle-memory-design.md) explains how reusable browser knowledge is retained without becoming a macro recorder.
- [Development workflow](development-workflow.md) describes the current implementation, validation, packaging, and cross-platform handoff loop.

## Curated history

- [Development history](development-history.md) records the major design iterations that led to the current architecture. It is a curated decision record, not a raw activity log.

## Authority and privacy

The repository root and its test suite are authoritative for executable behavior. These documents explain intent and tradeoffs; code and tests define current contracts.

The original working notes, early test checklists, local build output, private references, and browser records remain under the ignored `忽略上传/` directory. They are intentionally excluded from the public repository.
