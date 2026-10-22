/**
 * AgentLimb tool catalog — the single source of truth shared by:
 *   - the extension service worker (executor)
 *   - host/mcp-server.mjs (tools/list advertisement to the AI agent)
 *
 * Keep this list LEAN. Every tool costs context tokens on every agent turn.
 */

export const HOST_TOOLS = [
  {
    name: 'tabs_context',
    description:
      'List browser tabs (id, title, url, active, windowId, muted). Without arguments lists all tabs; pass tabId for one. Call this first to learn which tab to operate.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Optional tab id to inspect.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tab_new',
    description:
      'Open a new tab (background by default — it does NOT steal focus from the user). Returns the new tab id for subsequent tool calls.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open. Defaults to about:blank.' },
        active: { type: 'boolean', description: 'Bring the new tab to front. Default: false.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tab_close',
    description: 'Close a tab by id.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab id to close.' },
      },
      required: ['tabId'],
      additionalProperties: false,
    },
  },
  {
    name: 'tab_activate',
    description: 'Focus the window and activate a tab (use only when the user should see it).',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab id to activate.' },
      },
      required: ['tabId'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_page',
    description:
      'Get the page accessibility tree with element refs (use refs with computer/form_input). filter "interactive" (default) returns only clickable/typeable elements; "all" returns the full tree. Refs stay valid until the next navigation.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Target tab. Defaults to the active tab.' },
        filter: { type: 'string', enum: ['interactive', 'all'], description: 'Default: interactive.' },
        depth: { type: 'number', description: 'Max tree depth. Default: 15.' },
        limit: { type: 'number', description: 'Max elements returned. Default: 100.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'find',
    description:
      'Find elements by visible text or CSS selector and return their refs — much cheaper than read_page when you know what you are looking for.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Target tab.' },
        query: { type: 'string', description: 'Visible text to match (case-insensitive substring).' },
        selector: { type: 'string', description: 'CSS selector (alternative to query).' },
        limit: { type: 'number', description: 'Max matches. Default: 20.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'computer',
    description:
      'Mouse/keyboard/screenshot actions via CDP. Target elements by ref (from read_page/find) or by viewport coordinates. Actions: click, double_click, right_click, hover, type, scroll, key, drag, screenshot, wait.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'click',
            'double_click',
            'right_click',
            'hover',
            'type',
            'scroll',
            'key',
            'drag',
            'screenshot',
          ],
        },
        tabId: { type: 'number', description: 'Target tab.' },
        ref: { type: 'number', description: 'Element ref from read_page/find.' },
        selector: { type: 'string', description: 'CSS selector fallback when no ref.' },
        x: { type: 'number', description: 'Viewport x (CSS px).' },
        y: { type: 'number', description: 'Viewport y (CSS px).' },
        text: { type: 'string', description: 'Text for "type" action.' },
        key: { type: 'string', description: 'Key for "key" action, e.g. "Enter", "Tab", "a".' },
        modifiers: { type: 'string', description: 'e.g. "ctrl", "shift", "ctrl+shift", "meta".' },
        deltaY: { type: 'number', description: 'Scroll delta in CSS px (negative = up).' },
        x2: { type: 'number', description: 'Drag target x.' },
        y2: { type: 'number', description: 'Drag target y.' },
        ref2: { type: 'number', description: 'Drag target element ref.' },
        format: { type: 'string', enum: ['jpeg', 'png'], description: 'Screenshot format. Default: jpeg.' },
        fullPage: { type: 'boolean', description: 'Screenshot beyond viewport. Default: false.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'form_input',
    description:
      'Set a form value directly (text inputs, textarea, select, checkbox, radio, contenteditable). More reliable than click+type. Use ref or selector.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Target tab.' },
        ref: { type: 'number', description: 'Element ref.' },
        selector: { type: 'string', description: 'CSS selector fallback.' },
        value: { description: 'String for text/select, boolean for checkbox/radio.' },
      },
      required: ['value'],
      additionalProperties: false,
    },
  },
  {
    name: 'navigate',
    description:
      'Navigate the target tab: open a URL, or go "back"/"forward" in history.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL, or "back"/"forward".' },
        tabId: { type: 'number', description: 'Target tab. Defaults to the active tab.' },
        waitForLoad: { type: 'boolean', description: 'Wait for load event. Default: true.' },
        timeout: { type: 'number', description: 'Load wait timeout ms. Default: 15000.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'javascript_eval',
    description:
      'Evaluate a JavaScript expression in the page context (awaitPromise supported). Returns the value of the last expression.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'JS expression to evaluate.' },
        tabId: { type: 'number', description: 'Target tab.' },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait',
    description:
      'Wait for a condition instead of polling snapshots: element visible/hidden/exists, url_contains, page_contains, or page_load.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Target tab.' },
        selector: { type: 'string', description: 'CSS selector to wait for.' },
        text: { type: 'string', description: 'Text for url_contains / page_contains.' },
        condition: {
          type: 'string',
          enum: ['visible', 'hidden', 'exists', 'url_contains', 'page_contains', 'page_load'],
          description: 'Default: "visible" when selector given, else "page_load".',
        },
        timeout: { type: 'number', description: 'Max wait ms. Default: 10000, max: 30000.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_console_messages',
    description: 'Read recent console messages captured from the target tab (requires the tab to have been debugger-attached at least once).',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Target tab.' },
        limit: { type: 'number', description: 'Max messages. Default: 50.' },
        level: { type: 'string', enum: ['all', 'error', 'warning', 'info', 'log'], description: 'Default: all.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_network_requests',
    description: 'Read recent network requests captured from the target tab.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Target tab.' },
        limit: { type: 'number', description: 'Max requests. Default: 50.' },
        urlFilter: { type: 'string', description: 'Substring filter on request URL.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_batch',
    description:
      'Execute several browser actions in ONE round trip (max 20). Use for predictable sequences to cut latency.',
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: 'Tool name, e.g. "computer", "navigate", "wait".' },
              args: { type: 'object', description: 'Tool arguments.' },
            },
            required: ['tool'],
          },
        },
      },
      required: ['actions'],
      additionalProperties: false,
    },
  },
  {
    name: 'ping',
    description: 'Health check between the MCP host and the browser extension.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export function findTool(name) {
  return HOST_TOOLS.find((tool) => tool.name === name) || null;
}
