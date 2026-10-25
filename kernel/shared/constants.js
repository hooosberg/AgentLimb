/**
 * AgentLimb Lite — shared constants
 *
 * Single source of truth for the wire protocol between three peers:
 *   AI agent  ──stdio MCP──  host/bridge-server.mjs  ──HTTP+SSE──  extension SW
 */

export const APP_ID = 'agentlimb.chrome';
export const APP_NAME = 'AgentLimb';
/** Display version. `manifest.json`, `package.json` and the docs mirror these two. */
export const APP_VERSION = '0.6.6';
export const APP_BUILD = 'l15';
export const USER_STOP_MESSAGE = '用户请求停止当前任务：请停止后续浏览器操作，并用 say 回复确认。';

/** Local bridge defaults. The host picks the first free port in the range. */
export const BRIDGE_PORTS = [8765, 8766, 8767, 8768, 8769, 8770];
export const BRIDGE_HOST = '127.0.0.1';
export const BRIDGE_BASE_PORT = 8765;

/**
 * Private range for tests, the bench and the monkey.
 *
 * A real Chrome with the extension loaded scans BRIDGE_PORTS forever. If a test
 * host listened there, that browser would attach to it within a few hundred
 * milliseconds and answer `grant{ok:false}` — which looks exactly like a bug in
 * the code under test. Keeping the two ranges apart makes tests deterministic
 * without weakening what they test.
 */
export const TEST_BRIDGE_PORTS = [28765, 28766, 28767, 28768, 28769, 28770];

/**
 * Host-side override, so a developer can point a real host at another range:
 *   AGENTLIMB_BRIDGE_PORTS=30000,30001 node bin/agentlimb.mjs mcp
 * The extension always scans BRIDGE_PORTS, so only use this for isolated runs.
 */
export function resolveBridgePorts(raw = typeof process === 'undefined' ? null : process.env.AGENTLIMB_BRIDGE_PORTS) {
  if (!raw) return BRIDGE_PORTS;
  const ports = String(raw)
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((port) => Number.isInteger(port) && port > 1024 && port < 65536);
  return ports.length ? ports : BRIDGE_PORTS;
}

/** ~/.agentlimb — stable install location referenced by the copy-prompt. */
export const HOME_DIR_NAME = '.agentlimb';

export const MCP_PROTOCOL_VERSION = '2025-03-26';

/**
 * How long a copied prompt authorizes the next unknown AI client. Copying is
 * the authorization gesture; there is no confirmation page. A client that was
 * authorized once keeps its trust forever and never needs this window again.
 */
export const ONBOARD_WINDOW_MS = 30 * 60 * 1000;

/**
 * Discovery cadence.
 *
 * Pairing feels slow or fast almost entirely because of these two numbers. The
 * full-featured build polled its relay every 300 ms, which is why pairing felt
 * instant; a 2 s discovery loop makes the panel sit on "not connected" long
 * enough for the user to think something is broken. The handshake itself is
 * only a few milliseconds.
 *
 *   HUNT_MS — nothing is connected yet. This IS the first-pairing latency.
 *   IDLE_MS — at least one AI is connected. Tool calls are pushed over the SSE
 *             stream, so this only has to notice a *second* AI starting.
 */
export const DISCOVERY = {
  HUNT_MS: 300,
  IDLE_MS: 1000,
  /** Back-off before re-opening a stream that just errored. */
  RETRY_MS: 400,
  /** A refused localhost port fails immediately; this only bounds a hung one. */
  PROBE_TIMEOUT_MS: 400,
  /** The panel is a live page and cannot be suspended, so it drives the hunt. */
  PANEL_HUNT_MS: 250,
  /** While connected the panel only has to keep the worker from sleeping. */
  PANEL_WARM_MS: 10000,
};

/** chrome.storage.local keys */
export const STORAGE_KEYS = {
  onboardUntil: 'agentlimb.onboardUntil', // epoch ms; while in the future, the next unknown client is trusted
  autoTrust: 'agentlimb.autoTrust', // default ON: any local MCP host that says hello is trusted; false restores the copy-prompt window
  pairedClients: 'agentlimb.pairedClients', // { [clientId]: {id,name,kind,pairedAt} }
  lastClient: 'agentlimb.lastClient',
  hostPath: 'agentlimb.hostPath', // user-overridable MCP command path
  sourcePath: 'agentlimb.sourcePath', // absolute path of the repo that contains bin/agentlimb.mjs
  browserIdentity: 'agentlimb.browserIdentity', // { id, label } per-profile identity for multi-browser routing
  lang: 'agentlimb.lang',
  chatLogs: 'agentlimb.chatLogs', // per-client display-only transcripts
  chatLog: 'agentlimb.chatLog', // recent panel chat (survives panel close / SW restart)
};

/** chrome.runtime message types (panel ↔ SW) */
export const MESSAGE_TYPES = {
  GET_STATUS: 'AGENTLIMB_GET_STATUS',
  // Wake the worker and run one discovery scan. The side panel sends this while
  // it is looking for a bridge, so discovery never depends on the MV3 worker
  // being awake on its own schedule.
  ENSURE: 'AGENTLIMB_ENSURE',
  COPY_PROMPT: 'AGENTLIMB_COPY_PROMPT',
  CANCEL_COPY: 'AGENTLIMB_CANCEL_COPY',
  OPEN_PANEL: 'AGENTLIMB_OPEN_PANEL',
  CHAT_SEND: 'AGENTLIMB_CHAT_SEND',
  CHAT_STOP: 'AGENTLIMB_CHAT_STOP',
  SELECT_CLIENT: 'AGENTLIMB_SELECT_CLIENT',
  DISCONNECT_CLIENT: 'AGENTLIMB_DISCONNECT_CLIENT',
  SET_BROWSER_LABEL: 'AGENTLIMB_SET_BROWSER_LABEL',
  // SW → pages (broadcast)
  NOTIFY_STATUS: 'AGENTLIMB_NOTIFY_STATUS',
  NOTIFY_CHAT: 'AGENTLIMB_NOTIFY_CHAT',
};

/**
 * Wire protocol over the local bridge (SSE host→ext, POST ext→host).
 * Every frame is JSON: { t: <type>, ... }.
 *
 * Handshake: the host says HELLO, and the extension answers GRANT once it has
 * decided whether this client may drive the browser. There is no browser-side
 * approval page — the decision is trust saved from an earlier session, or the
 * 30-minute window opened by clicking Copy in the side panel.
 */
export const WIRE = {
  // host → extension (SSE)
  HELLO: 'hello', // {t, client:{id,name,kind}, bridgeVersion}
  TOOL_CALL: 'tool_call', // {t, tool_use_id, tool, args, tabId?}
  AGENT_MESSAGE: 'agent_message', // {t, text, at}  (agent → panel chat)
  PING: 'ping',
  // extension → host (POST /api/message)
  GRANT: 'grant', // {t, ok, name?, reason?}  answer to HELLO
  REVOKED: 'revoked', // {t, client_id}  the user removed this AI in the panel
  TOOL_RESULT: 'tool_result', // {t, tool_use_id, ok, result?, error?, userMessages?}
  PONG: 'pong',
  USER_MESSAGE: 'user_message', // {t, text, at, page?}  (panel chat → agent)
};

export const CAPABILITIES = [
  'browser_host',
  'computer_control',
  'page_snapshot',
  'tab_management',
  'mcp_bridge',
];
