/**
 * Copyable onboarding instructions (English only, by product decision).
 *
 * The prompt must answer three questions before an agent touches anything:
 *   1. Where is the installer?  (Gate 0 — extension-ID fingerprint)
 *   2. Is the host installed?   (Gate 1 — absolute paths, no shell expansion)
 *   3. Is this session really connected? (Gates 2–5 — trust, authorization, ping)
 *
 * Gate 0 is the part that used to stall. An agent cannot read an extension's
 * folder from the browser (no API exposes it), and "find the folder" without a
 * target is how it ended up installing from a stale `.agentlimb.backup-*`.
 *
 * The fix: for an unpacked extension Chrome derives the ID from the folder
 * path — SHA-256(path) → first 16 bytes → each hex digit mapped 0-f → a-p.
 * So the ID *is* a fingerprint of the folder. The prompt hands that ID to the
 * agent, which lists candidates and keeps the one that hashes to it. Verified
 * against two real Chrome profiles (`cowork_lite`, `cowork_local`).
 *
 * When the extension was installed as a CRX package the ID is signature-based,
 * not path-based, so the fingerprint cannot match; the prompt says so and falls
 * back to the user's saved install source.
 */
import { HOST_TOOLS } from '../control/host/tools.js';

function toolLines() {
  return HOST_TOOLS.map((t) => `- \`${t.name}\` — ${t.description.split('. ')[0]}`).join('\n');
}

/**
 * Chrome derives an unpacked extension's ID from the absolute path of the
 * folder it was loaded from: SHA-256(path) → first 16 bytes → hex digits
 * mapped 0-f → a-p. Two independent ways to turn that ID back into a path:
 *
 *   1. Ask Chrome: every profile's `Secure Preferences` records
 *      `extensions.settings[<id>].path`. ~0.3s, no disk scan, authoritative.
 *   2. Scan + hash: find `bin/agentlimb.mjs`, keep the folder whose path hashes
 *      to the ID. Slower, but works for profiles in unusual locations.
 *
 * Both were verified on this machine against two real profiles.
 */
const PROFILE_LOOKUP = `node -e 'const{readdirSync,readFileSync,existsSync}=require("fs"),{join,isAbsolute}=require("path"),{homedir}=require("os");const home=process.env.HOME||process.env.USERPROFILE||homedir(),local=process.env.LOCALAPPDATA||join(home,"AppData/Local"),id=process.argv[1],seen=new Set();const roots=[join(home,"Library/Application Support/Google/Chrome"),join(home,"Library/Application Support/Google/Chrome Canary"),join(home,"Library/Application Support/Google/Chrome Beta"),join(home,"Library/Application Support/Chromium"),join(home,"Library/Application Support/BraveSoftware/Brave-Browser"),join(home,"Library/Application Support/Microsoft Edge"),join(home,".config/google-chrome"),join(home,".config/google-chrome-beta"),join(home,".config/chromium"),join(home,".config/BraveSoftware/Brave-Browser"),join(home,".config/microsoft-edge"),join(home,"snap/chromium/common/chromium"),join(local,"Google/Chrome/User Data"),join(local,"Google/Chrome SxS/User Data"),join(local,"Chromium/User Data"),join(local,"BraveSoftware/Brave-Browser/User Data"),join(local,"Microsoft/Edge/User Data")].filter(existsSync);for(const root of roots)for(const prof of readdirSync(root))for(const name of ["Secure Preferences","Preferences"]){const f=join(root,prof,name);if(!existsSync(f))continue;try{const s=JSON.parse(readFileSync(f,"utf8")).extensions?.settings?.[id];if(s&&s.path&&isAbsolute(s.path)&&!seen.has(s.path)){seen.add(s.path);console.log(s.path)}}catch{}}'`;

/** One-liner: for each `.../bin/agentlimb.mjs` file, print its repo folder if the folder hashes to the ID (POSIX UTF-8 or Windows UTF-16LE). */
const ID_FILTER = `node -e 'const c=require("crypto"),p=require("path");const id=process.argv[1],h=b=>[...c.createHash("sha256").update(b).digest("hex").slice(0,32)].map(x=>String.fromCharCode(97+parseInt(x,16))).join("");for(const f of process.argv.slice(2)){const d=p.dirname(p.dirname(f)),u=d.replace(/^([a-z]):/,(_,l)=>l.toUpperCase()+":");if(h(d)===id||h(Buffer.from(d,"utf16le"))===id||h(Buffer.from(u,"utf16le"))===id)console.log(d)}'`;

function profileLookup(id) {
  return `${PROFILE_LOOKUP} '${id}'`;
}

function unixDiscovery(id) {
  return `find "$HOME" -maxdepth 8 -type f -path '*/bin/agentlimb.mjs' \\
  -not -path '*/node_modules/*' -not -path '*/Library/*' -not -path '*/.Trash/*' -not -path '*/.cache/*' -not -path '*/.local/share/Trash/*' -print0 2>/dev/null \\
| xargs -0 ${ID_FILTER} '${id}'`;
}

function winDiscovery(id) {
  return `$root = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$files = Get-ChildItem -Path $root -Filter agentlimb.mjs -Recurse -Depth 8 -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\\\bin\\\\agentlimb\\.mjs$' -and $_.FullName -notmatch 'node_modules|AppData\\\\Local\\\\Temp' } |
  Select-Object -ExpandProperty FullName
if ($files) { ${ID_FILTER.replace(/'/g, '"').replace(/"/g, (m, off, s) => (off === 8 || off === s.length - 1 ? "'" : '"'))} '${id}' @files }`;
}

/** Used only when the extension ID is unknown (e.g. a packaged CRX build). */
function fallbackDiscovery() {
  return `Find it with one command, then keep only folders that also contain \`host/mcp-server.mjs\` and a \`package.json\` whose \`name\` is \`agentlimb\`:

macOS / Linux:

\`\`\`sh
find "$HOME" -maxdepth 6 -type f -path '*/bin/agentlimb.mjs' \\
  -not -path '*/node_modules/*' -not -path '*/Library/*' -not -path '*/.Trash/*' 2>/dev/null
\`\`\`

Windows (PowerShell):

\`\`\`powershell
Get-ChildItem -Path $HOME -Filter agentlimb.mjs -Recurse -Depth 6 -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -like '*\\bin\\*' -and $_.FullName -notlike '*node_modules*' } |
  Select-Object -ExpandProperty FullName
\`\`\`

If several qualify, use the newest \`package.json\` modification time. Never install from \`.agentlimb.backup-*\`, a bare \`runtime/\` folder, or a \`node_modules\` copy.`;
}

function gateZero(sourcePath, extensionId) {
  const id = String(extensionId || '').trim();
  const saved = sourcePath
    ? `Install source saved by the user: \`${sourcePath}\`

Verify it before use: it must hash to the extension ID above and must still contain \`bin/agentlimb.mjs\` and \`host/mcp-server.mjs\`. If either check fails, the saved path points at a copy — run the discovery command below instead. Quote the path in shell commands; real paths may contain spaces or non-ASCII characters.

`
    : '';

  if (!id) {
    return `## Gate 0 — Install source (resolve this before anything else)

The extension ships as a repository folder that contains the CLI. You need its absolute path. Do not guess it and do not download anything.

${saved}${fallbackDiscovery()}`;
  }

  return `## Gate 0 — Install source (resolve this before anything else)

This extension is loaded unpacked from a folder on this machine, and Chrome derives the extension ID from that folder's absolute path. The ID below is therefore a fingerprint of the exact folder to install from — no guessing, and no picking a backup that looks similar.

Extension ID: \`${id}\`

${saved}Step 1 — ask Chrome where it loaded this extension from. Each profile records the folder in \`Secure Preferences\`, keyed by extension ID. This takes about a third of a second and never scans the disk.

\`\`\`sh
${profileLookup(id)}
\`\`\`

One or more absolute paths may be printed (one per profile that loaded the extension). Use one that still contains \`bin/agentlimb.mjs\` and \`host/mcp-server.mjs\`.

Step 2 — only if Step 1 printed nothing (a profile in an unusual location, or a Chromium-based browser not covered above): scan for candidate folders and keep the one whose path hashes to the same ID.

\`\`\`sh
${unixDiscovery(id)}
\`\`\`

Windows (PowerShell) equivalent for Step 2:

\`\`\`powershell
${winDiscovery(id)}
\`\`\`

Chrome's rule, if you want to verify by hand: \`id = SHA-256(absolute folder path)\`, first 16 bytes, each hex digit mapped \`0-f\` to \`a-p\`. That is why the ID identifies this folder and a look-alike backup does not.

The folder that matches is the exact one this browser loaded. It must still contain \`bin/agentlimb.mjs\` and \`host/mcp-server.mjs\` — the ID proves identity, not completeness.

If both steps print nothing, this extension was installed as a package (CRX) rather than unpacked, so no source folder exists on disk. Then use the saved install source if the user provided one, or ask the user exactly one question: "Where is the AgentLimb source folder?" Never install from a folder that did not match the ID — in particular \`.agentlimb.backup-*\`, a bare \`runtime/\` folder, or a \`node_modules\` copy.`;
}

export function buildConnectionPrompt(ctx = {}) {
  const path = ctx.hostPath || '~/.agentlimb/host/mcp-server.mjs';
  const app = ctx.appName || 'AgentLimb';
  const sourcePath = typeof ctx.sourcePath === 'string' ? ctx.sourcePath.trim() : '';
  const extensionId = typeof ctx.extensionId === 'string' ? ctx.extensionId.trim() : '';

  return `# ${app} — Browser Control Setup

Work through these gates in order. Report the stage you actually observed and the next action. A JSON file, a running process, an open port or a saved pairing is not success on its own. Copying this prompt is the authorization step, so never ask the user to approve a browser popup.

**Fast path**: if the ${app} tools (\`ping\`, \`tabs_context\`) are ALREADY available in your tool list in this conversation, skip Gates 0–2 and go directly to Gate 5 (\`ping\` -> \`tabs_context\` -> \`say\`).

${gateZero(sourcePath, extensionId)}

## Gate 1 — Verify installation
- Identify the current agent software (desktop app, IDE extension, or terminal/CLI agent) and its real MCP configuration file, schema (JSON, JSONC, TOML, YAML, or CLI registration command) and entry point. Preserve every existing server.
- Check Node.js >= 18 and resolve the absolute path of the \`node\` executable (\`command -v node\` on macOS/Linux, or \`where.exe node\` / \`(Get-Command node).Source\` on Windows; follow a symlink to its target).
- Check that the host file exists. Suggested path: \`${path}\` (or \`%USERPROFILE%\\.agentlimb\\host\\mcp-server.mjs\` on Windows); it is a candidate, not proof of installation.
- IMPORTANT: expand \`~\` into the user's absolute home directory yourself (and expand \`%USERPROFILE%\` on Windows). MCP servers are spawned without a shell; neither \`~\` nor \`$HOME\` nor \`%USERPROFILE%\` is expanded.
- If the host is missing or outdated, run this inside the install source folder from Gate 0:
  \`node bin/agentlimb.mjs install --client-name "<current software>" --client-kind "<stable software key>"\`
  (\`scripts/install.sh\` on macOS/Linux and \`scripts/install.ps1\` on Windows PowerShell are equivalent wrappers.)
- Use the JSON printed by the installer as-is — it is an \`mcpServers\` object, so merge only the \`agentlimb\` entry (or adapt its exact \`command\`, \`args\`, and \`env\` values if this software uses TOML \`[mcp_servers.agentlimb]\`, YAML, \`servers\`, \`context_servers\`, or a CLI \`mcp add\` command). \`command\` and \`args\` must both be absolute paths. Set AGENTLIMB_CLIENT_NAME / AGENTLIMB_CLIENT_KIND to this software and keep them stable across runs. Never borrow another client's identity or saved pairing. Re-run \`node bin/agentlimb.mjs config\` with the same flags to regenerate it.
- The generated config carries no authorization code. Trust is granted in the browser side panel (Gate 3), not by anything you write into this file.

## Gate 2 — Load it in the agent software
- Merge only the agentlimb entry into the correct configuration; validate the syntax and read the entry back, checking both file paths. Do not overwrite other servers or expose their secrets.
- Order matters: **restart the software (or run its "reload MCP servers" action) first** — for terminal/CLI agents, restart the CLI session or reload its MCP servers first. Nearly every product reads MCP configuration only at startup, so asking the user to look for agentlimb in a UI before that shows them an empty list and makes them think the install failed.
- Only after the restart, look at what this software exposes for MCP: a connectors/extensions page, a server list with a Trust/Enable switch, a CLI status command, or nothing at all. That surface differs per product and you must not assume it. Name the exact place for the software you are running in one sentence; if you genuinely cannot determine it, say "in your software's MCP or connector settings" and let the user correct you. Never quote a menu path that belongs to a different product.
- If this conversation cannot pick up the new tools, open a new conversation (or a new terminal session) after the restart; no further restart is needed once the tools are listed.
- Report what you actually observed. If the tools are not in your tool list, this gate is incomplete: stop and name the one step that is still missing (restart, trust/enable, or a new conversation). Do not ask the user to approve a browser popup, and do not start a separate terminal MCP as a substitute for the agent's own connection.

## Gate 3 — Authorize in Chrome
- Keep Chrome running with the current ${app} extension enabled. Open its side panel once so its discovery loop is running.
- Copying this prompt already opened a 30-minute authorization window inside the extension, so the next AI that connects is trusted automatically. There is no popup and no code to paste: never wait for an approval page and never tell the user to confirm one.
- If a tool call returns "not authorized", the window had expired or had already been used. Ask the user to click the copy-prompt button in the ${app} side panel again, then retry the same tool call. Do not edit the MCP config, reinstall, or restart the agent software for this.
- A client that was authorized once reconnects automatically; its saved pairing is reused in every later session.
- The AI software's own Trust/Enable gate is separate and still applies.

## Gate 4 — Diagnose from evidence
Run \`node bin/agentlimb.mjs doctor --client-name "<current software>" --client-kind "<stable software key>"\` in the install source folder if needed. The read-only report separates:
- no_matching_mcp: inspect this client's actual config, startup error, enabled/trusted state and tool reload. An old bridge (including port 7791) may belong to another installation; a reachable port does not prove this connection.
- awaiting_extension: the target MCP initialized but no browser is connected; check Chrome, the extension's enabled/error state and the side panel.
- awaiting_authorization: the browser connected but this client is not authorized; ask the user to click the copy-prompt button in the side panel and retry. A missing popup does not prove rejection — report what you can see.
- browser_ready_ping_required: the browser handshake finished; you still must call ping from this agent session.
If it still fails, include the exact error and the stage you proved. Never delete the user's installation, client configuration, browser data or pairings in order to retry.

## Gate 5 — Verify and use
Call the ${app} \`ping\` tool (MCP tools/call, not the protocol-level ping), then \`tabs_context\`. Only a browser pong plus a tab list proves this agent can control Chrome. After both succeed, call \`say\` with a brief success note for the browser side panel, then tell the user in this AI conversation: "Connected. You can now ask me directly, for example to summarize the current page or open a webpage." Do not mechanically request another restart, approval or new conversation after this proof.
- If ${app} tools are unavailable in this AI session, say clearly that ${app} MCP is not enabled in this session, and give only the next action that evidence supports: user authorization if the software asks for Trust/Enable, reload/restart only if changed config must be loaded, or a new conversation only if the tools are already available elsewhere. Never claim the connection succeeded, and never let a terminal or another client stand in for this session.

${toolLines()}

Read the page with read_page/find before calling computer/form_input, use fresh refs, and use browser_batch for predictable sequences. Work in a background tab via tab_new. Finish every browser task with say so the panel shows your answer and the user can see it without opening your window. Panel messages already carry the user's current page context; they are delivered on your next tool call, so answer one with say as soon as you see it. If the user presses STOP, halt further browser actions and acknowledge with say. If multiple Chrome profiles are connected simultaneously, every browser tool accepts an optional \`browser\` argument (profile label or ID shown in the side panel) to route commands to a specific browser; if the user's instruction is ambiguous across multiple connected browsers, ask which browser profile to operate first.`;
}
