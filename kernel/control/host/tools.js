export const HOST_TOOLS = [
  {
    name: 'browser_session',
    description:
      'Inspect the current AgentLimb browser runtime session, capabilities, and module readiness.',
    inputSchema: {
      type: 'object',
      properties: {
        includeModules: {
          type: 'boolean',
          description: 'Include detailed module status. Default: true',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tabs_context',
    description:
      'Get active-tab context including URL, title, readyState, viewport, and scroll position.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Optional target tab id. Defaults to the active tab.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'page_snapshot',
    description:
      'Capture a page snapshot with interactive refs, coordinate centers, and lightweight page metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Optional target tab id. Defaults to the active tab.',
        },
        filterMode: {
          type: 'string',
          enum: ['interactive', 'all'],
          description: 'Snapshot scope. Default: interactive',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of nodes to include. Default: 60',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'navigate',
    description:
      'Navigate the active tab to a URL, or go back/forward in browser history. When "back" closes a newly-opened tab (navigationType: "back_close_tab"), the opener tab is activated but has no forward history — do not call forward after a back_close_tab result.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'Target URL (e.g. "https://example.com"), or "back"/"forward" for history navigation. Note: if the active tab was opened as a new tab (e.g. by a link click), "back" will close it and return to the opener tab (navigationType: "back_close_tab"). Forward navigation after that is not available.',
        },
        tabId: {
          type: 'number',
          description: 'Optional target tab id. Defaults to the active tab.',
        },
        waitForLoad: {
          type: 'boolean',
          description: 'Wait for page load to complete. Default: true',
        },
        timeout: {
          type: 'number',
          description: 'Max wait time in ms for page load. Default: 15000',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'javascript_eval',
    description:
      'Execute JavaScript in the page context. Can read DOM, page state, call page functions, and interact with variables. Returns the result of the last expression.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description:
            'JavaScript expression to evaluate. The result of the last expression is returned. Supports async/await.',
        },
        tabId: {
          type: 'number',
          description: 'Optional target tab id. Defaults to the active tab.',
        },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
  {
    name: 'computer',
    description:
      'Execute CDP-first browser actions such as click, type, scroll, and screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['click', 'double_click', 'right_click', 'type', 'scroll', 'screenshot', 'key', 'hover', 'drag'],
          description: 'Computer action type.',
        },
        tabId: {
          type: 'number',
          description: 'Optional target tab id. Defaults to the active tab.',
        },
        refId: {
          type: 'number',
          description: 'Snapshot ref id to target.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector fallback when no refId is provided.',
        },
        x: {
          type: 'number',
          description: 'Direct viewport x coordinate.',
        },
        y: {
          type: 'number',
          description: 'Direct viewport y coordinate.',
        },
        value: {
          type: 'string',
          description: 'Text value for type action.',
        },
        text: {
          type: 'string',
          description: 'Alias for value in type action.',
        },
        deltaY: {
          type: 'number',
          description: 'Scroll delta in CSS pixels.',
        },
        direction: {
          type: 'string',
          enum: ['up', 'down'],
          description: 'Optional semantic scroll direction.',
        },
        amount: {
          type: 'number',
          description: 'Optional semantic scroll amount.',
        },
        format: {
          type: 'string',
          enum: ['png', 'jpeg'],
          description: 'Screenshot format. Default: png',
        },
        includeData: {
          type: 'boolean',
          description: 'Include raw base64 screenshot data.',
        },
        key: {
          type: 'string',
          description:
            'Key name for key action (e.g. "Enter", "Tab", "Escape", "ArrowDown", "a").',
        },
        modifiers: {
          type: 'string',
          description:
            'Modifier keys for key action (e.g. "ctrl", "shift", "ctrl+shift", "meta").',
        },
        repeat: {
          type: 'number',
          description: 'Number of times to repeat key press. Default: 1',
        },
        startX: {
          type: 'number',
          description: 'Drag start x coordinate.',
        },
        startY: {
          type: 'number',
          description: 'Drag start y coordinate.',
        },
        startRefId: {
          type: 'number',
          description: 'Drag start element ref id.',
        },
      },
      required: ['type'],
      additionalProperties: true,
    },
  },
  {
    name: 'form_input',
    description:
      'Set values in form elements: select dropdowns, checkboxes, radio buttons, contenteditable, and text inputs. More reliable than click/type for complex form controls.',
    inputSchema: {
      type: 'object',
      properties: {
        refId: {
          type: 'number',
          description: 'Snapshot ref id of the form element.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector fallback when no refId is provided.',
        },
        tabId: {
          type: 'number',
          description: 'Optional target tab id. Defaults to the active tab.',
        },
        value: {
          description:
            'Value to set. String for text/select, boolean for checkbox/radio.',
        },
      },
      required: ['value'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait',
    description:
      'Wait for a condition: element appears/disappears, URL contains text, or page load completes. Avoids polling with repeated snapshots.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Optional target tab id. Defaults to the active tab.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to wait for.',
        },
        text: {
          type: 'string',
          description: 'Text to wait for in URL or page content.',
        },
        condition: {
          type: 'string',
          enum: ['visible', 'hidden', 'exists', 'url_contains', 'page_load', 'page_contains'],
          description:
            'Wait condition. Default: "visible" when selector provided, "page_load" otherwise. Use "page_contains" (with text param) to wait until text content appears anywhere on the page.',
        },
        timeout: {
          type: 'number',
          description: 'Max wait time in ms. Default: 10000, Max: 30000',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'muscle_recall',
    description:
      'Read learned muscle knowledge for a site. Defaults to the active tab\'s domain. Returns a profile plus a pre-rendered Markdown prompt segment you can inline into context. Returns an empty profile for unexplored sites.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Optional. Domain or full URL (auto-normalized). Leave empty to use the active tab\'s domain.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'muscle_remember',
    description:
      'Merge new knowledge discovered during this run into the site\'s muscle profile. Record reliable selectors, workflow steps, and gotchas. The extension deep-merges the patch and atomically writes the desktop JSON file (~/Desktop/AgentLimb-muscle/).',
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Domain or full URL. Leave empty to use the active tab\'s domain.',
        },
        patch: {
          type: 'object',
          description:
            'Partial SiteProfile fields. Supports three categories — notes / selectors / workflows.' +
            ' notes: [{at, text}];' +
            ' selectors: {roleName: [{value, type, reliability, lastTestedAt}]};' +
            ' workflows: [{id, name, description, steps: [string], successCount}]',
        },
      },
      required: ['patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'muscle_commit',
    description:
      'Persist (or discard) selectors and workflows auto-captured during this session into the site\'s muscle profile. The `status` field controls four modes: ' +
      '(1) manual (default) — save mid-task when something valuable is found; keeps the session buffer for further accumulation (user says "save this", semi-automatic sites at their limit, or a reliable workflow you don\'t want to lose); ' +
      '(2) success — full task success; writes and clears the buffer (call this before `task_complete`, then call `complete`); ' +
      '(3) partial — task partially done (e.g. 80% of the form filled, stopped one step before the end); writes, marks partial, clears buffer; ' +
      '(4) failed — task failed; discards the buffer to avoid polluting muscle (previously `manual`-committed data is kept).',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['manual', 'success', 'partial', 'failed'],
          description: 'Commit mode. Defaults to manual when omitted.',
        },
        note: {
          type: 'string',
          description: 'Reason or context for this commit (written into notes). Recommended for manual; optional for other modes.',
        },
        verification: {
          type: 'string',
          description: 'How the task was verified (e.g. "URL changed to /post/123 and page_contains the success message"). Recommended for success/partial.',
        },
        workflowName: {
          type: 'string',
          description: 'Optional. A name for this workflow (e.g. "first half of publishing a video", "fill form up to the email field").',
        },
        stepsCompleted: {
          type: 'number',
          description: 'Optional. In partial mode, which step number was reached.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ping',
    description: 'Check connectivity between the AgentLimb Bridge and the extension. Returns pong and a timestamp, useful for verifying the link is healthy.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'task_plan',
    description:
      'Submit a task plan (title + step list) to the side panel before the task starts. The side panel displays the live status of every step (✓ done / ▶ active / · pending). ' +
      'Step progression is driven **exclusively** by `task_step_done` — the side panel does not infer progress from tool calls. ' +
      'Plan steps at the **logical** level (2–5 steps such as "open page", "fill form", "verify result"), not at the tool-call level. One logical step typically spans 5–20 tool calls; if you break the plan into too many fine-grained steps, you will likely forget to call `task_step_done` after each, and the side panel will stall on step 1. ' +
      'Call `task_plan` before the first browser tool call of every new task. The task must be terminated explicitly at the end via `task_complete` or `task_fail`.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The overall task title — a concise description of the goal (e.g. "scrape quotes from the quotes.toscrape.com homepage").',
        },
        steps: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  hint: {
                    type: 'string',
                    enum: ['tool_call', 'terminal_connected', 'explicit'],
                    description: 'Termination-signal type for this step. Defaults to tool_call.',
                  },
                },
                required: ['text'],
                additionalProperties: false,
              },
            ],
          },
          description: 'Ordered list of task steps. Each entry can be a string or a { text, hint } object.',
          minItems: 1,
          maxItems: 20,
        },
      },
      required: ['title', 'steps'],
      additionalProperties: false,
    },
  },
  {
    name: 'task_step_done',
    description:
      'Mark a specific plan step as done or errored. This is the **only** signal the side panel uses to advance step state — without it, progress stays on step 1 for the entire task. Call it every time a logical step in your `task_plan` is finished. Skipping ahead is allowed: calling `task_step_done(index=N)` force-marks steps 0..N-1 as done in one shot.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          description: '0-based index of the step.',
        },
        ok: {
          type: 'boolean',
          description: 'Whether the step succeeded. When false, the step is marked as error.',
        },
        note: {
          type: 'string',
          description: 'Optional note (e.g. failure reason or result summary).',
        },
      },
      required: ['index', 'ok'],
      additionalProperties: false,
    },
  },
  {
    name: 'task_complete',
    description:
      'Explicitly mark the entire task as successful, triggering the side panel\'s "completed" terminal state. Call this after all steps have finished and `muscle_commit` has been called.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Task completion summary (e.g. "scraped 12 quotes successfully").',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'task_fail',
    description:
      'Explicitly mark the entire task as failed, triggering the side panel\'s "failed" terminal state. Call this after `muscle_commit` has been called.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Failure reason (e.g. "page unreachable", "captcha not solved").',
        },
        stepIndex: {
          type: 'number',
          description: 'Optional. Which step (0-based) the failure occurred at; that step is marked error, remaining pending steps are marked cancelled.',
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
];

export function summarizeHostTools() {
  return HOST_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}
