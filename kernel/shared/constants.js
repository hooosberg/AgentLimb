/**
 * AgentLimb Lite — shared constants
 *
 * Single source of truth for the wire protocol between three peers:
 *   AI agent  ──stdio MCP──  host/bridge-server.mjs  ──HTTP+SSE──  extension SW
 */

export const APP_ID = 'agentlimb.chrome';
export const APP_NAME = 'AgentLimb';
export const APP_VERSION = '0.4.6';
export const APP_BUILD = 'l1';

/** Local bridge defaults. The host picks the first free port in the range. */
export const BRIDGE_PORTS = [8765, 8766, 8767, 8768, 8769, 8770];
export const BRIDGE_HOST = '127.0.0.1';
export const BRIDGE_BASE_PORT = 8765;

/** ~/.agentlimb — stable install location referenced by the copy-prompt. */
export const HOME_DIR_NAME = '.agentlimb';

export const MCP_PROTOCOL_VERSION = '2025-03-26';

/** chrome.storage.local keys */
export const STORAGE_KEYS = {
  pairedClients: 'agentlimb.pairedClients', // { [clientId]: {id,name,kind,pairedAt} }
  lastClient: 'agentlimb.lastClient',
  hostPath: 'agentlimb.hostPath', // user-overridable MCP command path
  lang: 'agentlimb.lang',
  chatLog: 'agentlimb.chatLog', // recent panel chat (survives panel close / SW restart)
};

/** chrome.runtime message types (panel/pairing ↔ SW) */
export const MESSAGE_TYPES = {
  GET_STATUS: 'AGENTLIMB_GET_STATUS',
  PAIRING_RESPONSE: 'AGENTLIMB_PAIRING_RESPONSE',
  COPY_PROMPT: 'AGENTLIMB_COPY_PROMPT',
  OPEN_PANEL: 'AGENTLIMB_OPEN_PANEL',
  CHAT_SEND: 'AGENTLIMB_CHAT_SEND',
  QUICK_ACTION: 'AGENTLIMB_QUICK_ACTION',
  DISCONNECT_CLIENT: 'AGENTLIMB_DISCONNECT_CLIENT',
  STOP_AGENT: 'AGENTLIMB_STOP_AGENT',
  // SW → pages (broadcast)
  NOTIFY_STATUS: 'AGENTLIMB_NOTIFY_STATUS',
  NOTIFY_CHAT: 'AGENTLIMB_NOTIFY_CHAT',
  NOTIFY_ACTIVITY: 'AGENTLIMB_NOTIFY_ACTIVITY',
};

/**
 * Wire protocol over the local bridge (SSE host→ext, POST ext→host).
 * Every frame is JSON: { t: <type>, ... }.
 */
export const WIRE = {
  // host → extension (SSE)
  HELLO: 'hello', // {t, client:{id,name,kind}, bridgeVersion}
  PAIRING_REQUEST: 'pairing_request', // {t, request_id, client}
  PAIRING_REVOKED: 'pairing_revoked', // {t, client_id}
  TOOL_CALL: 'tool_call', // {t, tool_use_id, tool, args, tabId?}
  AGENT_MESSAGE: 'agent_message', // {t, text, at}  (agent → panel chat)
  PING: 'ping',
  // extension → host (POST /api/message)
  PAIRING_RESPONSE: 'pairing_response', // {t, request_id, ok, name}
  TOOL_RESULT: 'tool_result', // {t, tool_use_id, ok, result?, error?, userMessages?}
  PONG: 'pong',
  USER_MESSAGE: 'user_message', // {t, text, at, page?}  (panel chat → agent)
  STOP_AGENT: 'stop_agent', // {t}  (user pressed stop in-page)
  STATUS: 'status', // {t, paired:[...], pending:[...]}  (ext → host, on connect)
};

export const CAPABILITIES = [
  'browser_host',
  'computer_control',
  'page_snapshot',
  'tab_management',
  'mcp_bridge',
];
