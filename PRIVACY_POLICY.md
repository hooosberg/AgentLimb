# Privacy Policy

**AgentLimb**
Last updated: 2026-04-12

## Overview

AgentLimb is a Chrome extension that enables terminal AI tools to interact with your browser. This policy explains what data AgentLimb accesses and how it is handled.

## Data Collection

AgentLimb does **not** collect, transmit, or store any personal data on external servers.

All data stays on your local machine:

- **Muscle data** (saved action sequences) is stored locally in `chrome.storage` and `~/.agentlimb/muscles.json`
- **Project data** is stored locally in `chrome.storage` and IndexedDB
- **Bridge communication** occurs only between the Chrome extension and a local Node.js process on `127.0.0.1:7789` via WebSocket — no data leaves your machine

## Permissions

AgentLimb requests the following Chrome permissions:

| Permission | Why |
|---|---|
| `tabs` | To read current tab URL and title for the `observe` tool |
| `scripting` | To execute JavaScript on pages via the `eval` and `act` tools |
| `activeTab` | To interact with the currently active tab |
| `storage` | To persist muscle and project data locally |
| `sidePanel` | To display the monitoring UI in Chrome's side panel |
| `host_permissions: <all_urls>` | To operate on any webpage the user navigates to |

## Third-Party Services

AgentLimb does not integrate with any third-party analytics, tracking, or advertising services.

The extension communicates only with:
- A **local bridge process** (`127.0.0.1:7789`) that you run on your own machine
- Your **terminal AI tool** (e.g., Claude Code, Cursor) which connects to the bridge

## Data Sharing

AgentLimb does not share any data with third parties. All operations are local.

## Changes to This Policy

If we update this policy, the new version will be posted at:
- https://github.com/hooosberg/AgentLimb (repository)
- https://agentlimb.com/privacy (website, when available)

## Contact

For questions about this privacy policy:
- Email: zikedece@proton.me
- GitHub: https://github.com/hooosberg/AgentLimb/issues
