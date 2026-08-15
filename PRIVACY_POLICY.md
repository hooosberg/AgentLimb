# Privacy Policy

**AgentLimb**
Last updated: 2026-08-15

## Overview

AgentLimb is a Chrome extension that lets a terminal-based AI coding assistant (such as Claude Code, Cursor, Codex, or any tool that can send HTTP) observe and control the user's active Chrome tab. Every browser-automation component — the extension, the Node.js bridge, the AI agent, and the stored "muscle" files — runs on the user's own machine. AgentLimb operates no backend servers. Browser content and automation commands communicate only over the loopback address `127.0.0.1`; the side panel separately reads public release metadata from GitHub to check for a newer AgentLimb version.

## Data Handling — What AgentLimb Does Not Do

- **No telemetry.** AgentLimb does not send any analytics, crash reports, usage metrics, or diagnostics anywhere.
- **No accounts, no login.** There is no sign-up flow and no remote user identifier.
- **No cloud backend or analytics.** Browser content, automation commands, muscle files, and diagnostics stay local. The only routine remote request is a version check against GitHub's public Releases API; it does not include browsing data, prompts, muscle data, or an AgentLimb account identifier.
- **No sale or sharing of user data.** We do not sell, transfer, or share any user data with third parties.
- **No use of data for unrelated purposes.** User data is used only to fulfill the automation request the user issued.
- **No use of data for creditworthiness or lending decisions.**

## Data Handling — What AgentLimb Reads and Where It Goes

To let the AI reason about the current page, AgentLimb reads the following when — and only when — the AI requests it:

| Read | Purpose | Where it goes |
|---|---|---|
| Active tab URL and title | So the AI knows which page it is on | Sent to the local bridge on `127.0.0.1:7791` |
| DOM tree / element attributes of the active tab | So the AI can identify clickable and fillable elements | Sent to the local bridge |
| Screenshots of the active tab (`Page.captureScreenshot` via CDP, with `chrome.tabs.captureVisibleTab` as fallback) | So the AI can see page state when DOM is ambiguous | Sent to the local bridge |
| Short JavaScript expressions supplied by the AI | Evaluated in the target page's MAIN world via `chrome.scripting.executeScript` so the AI can probe page state | Executes in-page; result returned to the local bridge |
| Installed AgentLimb version | Compare with the latest public release | GitHub Releases API; no browser or muscle data is included |

Browser page values are transmitted **only** to the local bridge on `127.0.0.1:7791` over loopback HTTP and WebSocket. The bridge does not forward them anywhere outside the user's machine.

## Data Handling — What AgentLimb Stores Locally

| Storage | Contents | Location |
|---|---|---|
| `chrome.storage.local` | User preferences (language, theme), the local bridge connection token, cached muscle pointers, and the configured project directory path | Inside the extension's Chrome profile |
| Desktop folder | "Muscle" files — the AI's learned workflows and selectors — written as plain JSON by the bridge, one file per domain | `~/Desktop/AgentLimb-muscle/<domain>.json` |
| `IndexedDB` | Persistent `FileSystemDirectoryHandle` reference (from the File System Access API) so the extension can reopen the user's chosen project folder across sessions | Inside the extension's Chrome profile |

All of these are on-device only. The user may inspect, edit, back up, move, or delete any of them at any time.

## Remote Code Disclosure

AgentLimb does not fetch JavaScript or WebAssembly from any remote server. The only code executed at runtime that is not bundled in the extension package is short expressions supplied by the user's own local AI agent over the loopback bridge. These are passed to `chrome.scripting.executeScript` with `world: 'MAIN'` and evaluated inside the target page's context — similar in spirit to a DevTools console command, except the command is issued by the AI the user is collaborating with. These strings never originate from, and never travel to, an external server.

## Permissions

| Permission | Why AgentLimb requests it |
|---|---|
| `tabs` | Read the id, URL, and title of the user's active tab so the extension can report current page context to the local AI agent, and navigate that tab to URLs the AI requests. |
| `activeTab` | Act only on the tab the user currently has focused — the minimum surface needed for every browser-control operation. |
| `scripting` | Inject a content script to read the DOM, dispatch click / type / select interactions the AI requested, and evaluate AI-supplied expressions in the page's MAIN world. |
| `storage` | Persist user preferences, the local bridge connection token, and cached muscle pointers via `chrome.storage.local`. Nothing is transmitted off-device. |
| `sidePanel` | Display the AgentLimb control panel: bridge connection status, approve/deny UI for AI actions, muscle list, and activity logs. |
| `debugger` | Attach to the user's active tab briefly to simulate realistic keyboard input via the Chrome DevTools Protocol (`Input.dispatchKeyEvent`, `Input.insertText`) for rich-text editors (Google Docs, Notion, Slack, etc.) that ignore synthetic DOM events. Detaches immediately after the typing operation. |
| `nativeMessaging` | Read a single configuration value — the absolute filesystem path of the user's project directory — from the companion native host `com.agentlimb.bridge` that the user installs during setup. No other messages are exchanged. |
| `alarms` | Create a periodic wake-up alarm so Chrome's MV3 service worker remains resident while a local bridge session is active; otherwise the WebSocket would drop mid-operation. The alarm is cleared when the bridge disconnects. |
| `clipboardWrite` | Let the user click "Copy" in the side panel to copy setup commands or paths. Writes happen only on explicit user click; AgentLimb never reads the clipboard. |
| `host_permissions: <all_urls>` | AgentLimb is a general-purpose browser automation bridge; it cannot predict which sites the user will ask the AI to operate on. The extension activates only on the user's active tab, and only in response to a request that came from the local bridge on `127.0.0.1`. |

## Compliance Disclosures

In accordance with the Chrome Web Store Developer Program Policies:

- AgentLimb does **not** sell or transfer user data to third parties.
- AgentLimb does **not** use or transfer user data for purposes unrelated to its single purpose (local browser automation for the user's own AI agent).
- AgentLimb does **not** use or transfer user data to determine creditworthiness or for lending purposes.

## Changes to This Policy

If we update this policy, the new version will be posted at:
- https://github.com/hooosberg/AgentLimb (repository — this file)
- https://agentlimb.com/privacy (website mirror)

## Contact

- Email: zikedece@proton.me
- GitHub issues: https://github.com/hooosberg/AgentLimb/issues
