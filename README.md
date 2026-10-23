# AgentLimb

[![GitHub stars](https://img.shields.io/github/stars/hooosberg/AgentLimb?style=flat-square)](https://github.com/hooosberg/AgentLimb/stargazers)
[![GitHub](https://img.shields.io/badge/GitHub-hooosberg%2FAgentLimb-blue?style=flat-square&logo=github)](https://github.com/hooosberg/AgentLimb)

**English** · [简体中文](./README.zh-CN.md)

**Landing page → https://hooosberg.com/apps/agentlimb/** · [Download latest](https://github.com/hooosberg/AgentLimb/releases/latest) · [Legacy site](https://agentlimb.com/)

Current source version: **0.6.4 / l13** (see [CHANGELOG.md](./CHANGELOG.md)).

A universal browser-control extension: it gives any MCP-capable agent hands, so it can drive your Chrome.

**Copying the prompt is the whole first-time authorization.** Enabling and trusting MCP stays with the agent's own software. Inside the 30-minute window that Copy opens, the first AI to connect is trusted automatically — no confirmation page, no pairing code. The side panel teaches you the copy step while unpaired, and becomes the chat window once connected.
The panel is optional: the agent works either way, in its own background tab, without disturbing the page you are reading.

---

## Quick start

```bash
# 1. Check Node.js >=18, then install the local MCP host and print the config JSON
node --version
bash scripts/install.sh --client-name "WorkBuddy" --client-kind "workbuddy"
# Windows: powershell -ExecutionPolicy Bypass -File scripts/install.ps1 --client-name WorkBuddy --client-kind workbuddy

# 2. Load the extension in Chrome
#    chrome://extensions → Developer mode → Load unpacked → select this folder

# 3. Click "Copy connection prompt" in the side panel and hand it to your agent
#    Copying is itself the authorization (30-minute window); no code to paste anywhere
#    Enable/trust MCP when the software asks, and reload as needed

# 4. Call AgentLimb ping and tabs_context from the agent session to verify; no confirmation page appears
```

The installer only places the host files and prints JSON — it never writes another app's own configuration. The intake window opened by Copy lasts 30 minutes and authorizes exactly one AI; if it expires, click Copy again — no config change, no restart. Config format and the MCP enable/trust entry point are decided by each client; never read the generic JSON example as "already enabled".

Local debugging (works without Claude Code):

```bash
node bin/agentlimb.mjs mcp       # stdio MCP; starts the bridge after initialize
node bin/agentlimb.mjs status    # probe whether the bridge is online
npm test                         # end-to-end protocol tests (with a simulated extension)
```

## When it does not connect

Check in this order. Each step rules out one stage, and passing one stage says nothing about the next.

| Symptom | What it means | What to do |
|---|---|---|
| A tool call returns "not authorized" | The 30-minute intake window expired, or another AI already used it | Click Copy connection prompt again — no config change, no restart |
| The app lists AgentLimb but tools never answer | The MCP entry is merged but not enabled/trusted by that app, or its process is not running | Enable and trust MCP in the app, then restart its MCP process |
| Nothing happens at all | The host may not be where the config points | `node bin/agentlimb.mjs status`, then confirm `~/.agentlimb/host/mcp-server.mjs` exists |
| A second AI cannot take over | One controller holds the browser task lock while the first AI is busy | Wait for the current task; a switch while busy is refused by design |
| The first connection takes a while | The service worker was asleep | Open the side panel to wake it; otherwise expect up to about a minute |

`ping` and `tabs_context` succeeding in the session you actually care about is the only proof the connection works. A reachable port, a trust file, or another client's success never substitutes for it.

---

## Architecture

```
┌─────────────┐  stdio MCP   ┌──────────────────────┐  SSE (push)  ┌─────────────────────┐
│  AI client   │ ◄──────────► │  host/mcp-server.mjs │ ◄─────────── │ Extension service    │
│ (any client) │  JSON-RPC    │  host/bridge-server  │  POST (back) │ worker: persistent   │
└─────────────┘              └──────────────────────┘              │ debugger session +   │
                        127.0.0.1:8765-8770 (up to six hosts)       │ content scripts      │
                                                                    └─────────────────────┘
```

Three roles, zero dependencies (Node built-ins and plain JS only — no npm packages):

| Layer | Files | Responsibility |
|---|---|---|
| Extension background | `kernel/control/background/` | Bridge client (SSE/POST), CDP debugger management, tool routing |
| Page scripts | `kernel/control/content/` | Accessibility tree (resident from `document_start`), control indicator |
| Side panel | `ui/sidepanel/` | Connection prompt, per-AI isolated chat, client management, settings (no confirmation page) |
| Local host | `host/` `bin/` | MCP stdio server + local HTTP/SSE bridge |
| Shared | `kernel/shared/constants.js` `kernel/control/host/tools.js` `kernel/prompt/` | Protocol constants, tool catalog (one source for both sides), prompt generation |

### Install, client trust, and browser authorization are separate stages

The installer deploys `~/.agentlimb` and prints the `mcpServers.agentlimb` block. After merging it into the target app's real config, the user still has to enable/trust MCP as that app requires. Copy connection prompt in the side panel performs the authorization in the same gesture: the extension opens a 30-minute window and the first unknown AI to connect inside it is trusted — **no confirmation page, no pairing code**. If the window expired or was already consumed, tool calls immediately return "not authorized" so the user can copy again, with no config change and no restart. Only a successful `ping` and `tabs_context` from the current target session proves the connection works.

The host keeps a stable identity file per client name + kind combination; the old shared `client-id.json` does not inherit trust. A known identity with saved trust reconnects automatically and never steals the current chat window; a new identity needs one intake window. An old runtime directory, a reachable port, a trust file, or another client's success can never prove, on their own, that the current client is connected.

The extension connects up to six MCP hosts at once and keeps their trust separately; `connectedClientId` marks the single controller. A trusted client's handshake never takes control automatically — an explicit switch only applies while the task is idle, and a switch while busy is refused. Non-`ping` tools from other clients queue until the host deadline and are dropped if they expire.

## Interaction principles

- **The side panel and control are fully decoupled**: tool calls travel service worker ↔ bridge, whether or not the panel is open.
- **Unpaired**: the panel offers the copy prompt; settings stay reachable from the top bar.
- **Paired**: the panel is the chat window with the current controller. The top bar keeps the copy prompt and settings, and shows the current AI and the number of saved pairings. Every message automatically carries
  a screenshot of the current tab, its title/URL, a body excerpt, and refs for interactive elements — so "what is this page about" or "click this for me" needs no separate screenshot or tab report. Enter sends, Shift+Enter adds a newline.
- **The AI's replies come back to the same window** (the `say` tool); the work in between folds into one "ran N steps" row that expands on click, so the transcript is never flooded with logs.
- **In-page control feedback**: a glowing outline plus a ghost cursor, so whichever tab you are in, you can see which tab the agent is touching.
- **Per-client trust is kept separately**: a dropped connection or an exiting MCP process only marks the client offline; removing it in settings is what revokes that client's trust.
- **One controller, serial execution**: another trusted client never takes control just by starting up or handshaking. The user can switch while idle; a busy switch is refused. A newly paired client waits for the current task to finish before taking over. `ping` only checks, it never takes control.

## Efficiency design (the key fixes against the reference implementation)

The archived 0.2 line used HTTP polling for its control path, and every hop cost something. This line fixes each one:

| # | Old problem | This line |
|---|---|---|
| 1 | The service worker polled the bridge queue every 300ms, with a 50ms busy-poll; alarms restarted the relay after suspension | SSE long-lived push, zero latency host→ext; POST for replies; alarms only as a last-resort wake-up |
| 2 | `debugger.attach` + `detach` per action (10–50ms each, fighting DevTools for the lock) | **Persistent per-tab attach**, in-flight deduplication, reattach only when Chrome kicks it |
| 3 | Content scripts injected on demand, re-asked on every snapshot | `document_start` all-frame resident a11y script; ref map cached in a WeakMap |
| 4 | Only the foreground tab could be operated | `Emulation.setFocusEmulationEnabled` plus auto-mute, so **background tabs are operable** without stealing focus |
| 5 | Fixed-quality PNG screenshots, frequently over the size limit | Adaptive JPEG quality (75→10), ~1.2MB base64 budget |
| 6 | One tool call per step, RTT stacking up | `browser_batch` submits up to 20 actions in one call |
| 7 | Four task tools (`task_plan` / `task_step_done` / `task_complete` / `task_fail`) plus side-panel progress rendering, all overhead | **The whole progress mechanism is gone** (14 browser tools, plus local `say` and `ping`) |
| 8 | Three muscle-memory tools permanently in the catalog | Removed here (recoverable from `archive/cowork-local` as an opt-in switch) |

Other details: every CDP command has a timeout; console/network are captured continuously on the persistent session (200-entry ring buffer); password and sensitive fields are redacted inside the a11y tree; same-origin iframes and shadow DOM are walked into the tree with coordinate offsets.

## Tool catalog (17, including local `say`, `ping` and `site_memory`)

`tabs_context` `tab_new` `tab_close` `tab_activate` `read_page` `find` `computer`
`form_input` `navigate` `javascript_eval` `wait` `read_console_messages`
`read_network_requests` `browser_batch` `say` `site_memory` `ping`

`site_memory` never touches the browser: it reads and writes the per-site playbooks described below.

## Site memory (网站记忆)

A folder of plain Markdown files that lets any MCP-connected AI reuse what it already learned about a website — the direct URL, the element anchors, the pitfalls, and how to tell success from "looks like it worked".

- **On by default after `agentlimb install`**, at `~/.agentlimb/memory` (`--memory-root <dir>` to move it, `--no-memory` to skip). `agentlimb memory` prints the location and what is recorded.
- **Delivered as a soft prompt, not a plugin feature**: when enabled, the MCP `initialize` instructions carry "read the playbook first → do the work → write back what was new". Every MCP client receives it on connect, so nothing has to be installed per AI tool; turn it off in the side panel and the block disappears.
- **One file per site, ~100 lines**: entry URL, steps, selectors, pitfalls, success criteria. The run log is one small file per run and is never read on the hot path — `brief` is a single file read (~13 ms with 433 sites), so recording more never slows an operation down.
- **Not tied to AgentLimb**: the folder is a valid `kb` library layout, so another browser MCP, another AI client, or the standalone CLI can use the same notes.
- **Operation knowledge only**: never accounts, passwords, cookies, tokens, verification codes, or data copied from the site. Two consecutive failures mark a playbook `stale` so the next run re-verifies anchors instead of trusting a stale selector.

The catalog lives in `kernel/control/host/tools.js` and is shared by the extension and the MCP host — change it once, both sides follow.

## Layout

```
manifest.json                  MV3 (debugger / sidePanel / tabGroups / alarms)
kernel/shared/constants.js     protocol constants, SSE frame types, storage keys
kernel/control/host/tools.js   tool catalog (single source of truth)
kernel/control/background/
  service-worker.js            entry: wiring + message routing + alarm keepalive
  bridge-client.js             port discovery, SSE, pairing, user_message queue
  debugger.js                  persistent attach / focus emulation / adaptive screenshots / event capture
  router.js                    executor for the 14 browser tools
kernel/control/content/
  a11y-tree.js                 document_start all-frame injection: ref map + accessibility tree
  indicator.js                 glowing outline / ghost cursor / stop button
kernel/prompt/build-prompt.js  the connection prompt the side panel copies (zh/en)
ui/sidepanel/                  onboarding, current-AI chat, multi-client settings
host/bridge-server.mjs         HTTP+SSE bridge, trust registry, tool_call correlation
host/mcp-server.mjs            stdio MCP ↔ bridge
bin/agentlimb.mjs              CLI: install / config / doctor / mcp / status / pair-status / uninstall
host/install.mjs               shared install logic and MCP JSON generation
host/diagnostics.mjs           read-only connection-stage diagnostics
scripts/install.sh|ps1         Node version check, then delegate to the CLI
tests/                         Node's native test runner, including end-to-end protocol tests
```

## What is actually verified

- `npm test` covers the protocol and modules automatically; `node scripts/live-test.mjs` runs a browser/MCP integration pass with its own temporary HOME, Chrome profile, extension copy, and ports, then cleans up — it never touches your daily `~/.agentlimb` install.
- The existing 81/81 live report belongs to an earlier single-client baseline and does **not** represent multi-client Chrome acceptance for 0.6.4/l13. Automated unit tests currently pass 107/107; real multi-client Chrome acceptance is still in progress and has no result to report yet.
- Site memory has its own real-model smoke test that needs no browser: `npm run smoke:memory` (czen/hy3, 20/20). It proves the model calls `site_memory`, the playbook lands on disk with entry/selector/pitfall and no secrets, a **fresh session** reads it back, and the off switch makes the tool refuse. The browser half (pair → click → type) still lives in `node scripts/ai-onboarding-test.mjs`.
- Loading the config and trusting MCP inside real agent clients, plus specific models and monkey testing, still need independent acceptance. Nothing is claimed to pass without observed evidence.

## Known boundaries

- At most six MCP hosts (as defined by `BRIDGE_PORTS`) are discovered at once; one controller holds the current browser task lock. Trust, chat history, and drafts are isolated per AI.
- Side-panel chat is "leave a message" semantics: a message is delivered with the agent's next tool result (it is not pushed while the agent is idle).
- `javascript_eval` goes through CDP, so it still works on pages with a strict CSP (debugger permission).
- The first connection depends on the service worker being awake: once installed it stays resident while Chrome runs; after a sleep, expect up to about a minute to reconnect (opening the panel triggers it immediately).

## Relationship to the old version

`main` in this repository is the maintained line (the contents of this working tree). The 0.2 era version (cowork_local) is archived on the
[`archive/cowork-local`](https://github.com/hooosberg/AgentLimb/tree/archive/cowork-local) branch and is no longer updated. The assets it deliberately kept (task progress mechanism, muscle web memory, HTTP polling bridge, 12-language i18n, the agentlimb.com site) can be brought back on demand.

## Links

| | |
|---|---|
| Landing page | https://hooosberg.com/apps/agentlimb/ |
| GitHub | https://github.com/hooosberg/AgentLimb |
| Legacy site (0.2 era: tutorials, tool directory, news) | https://agentlimb.com/ |

**If AgentLimb is useful to you, please ⭐ star it on GitHub** — it is the biggest encouragement for an independent developer, and it decides whether this project keeps shipping: https://github.com/hooosberg/AgentLimb
