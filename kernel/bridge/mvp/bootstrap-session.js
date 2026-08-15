const DEFAULT_BROWSER_BOOTSTRAP_STEPS = [
  {
    key: 'tabsContext',
    tool: 'tabs_context',
    params: {},
  },
  {
    key: 'pageSnapshot',
    tool: 'page_snapshot',
    params: {
      filterMode: 'interactive',
      limit: 40,
    },
  },
];

export async function bootstrapTerminalTaskSession(options = {}) {
  const client = options.client;
  if (!client) {
    throw new Error('client is required.');
  }

  const terminalName = String(options.terminalName || 'Codex').trim() || 'Codex';
  const terminalType = String(options.terminalType || 'codex').trim() || 'codex';
  const cwd = String(options.cwd || process.cwd()).trim() || process.cwd();

  const connectResponse = await client.connectTerminal({
    name: terminalName,
    type: terminalType,
    cwd,
  });

  const token = connectResponse.token || connectResponse.terminal?.token;
  if (!token) {
    throw new Error('Terminal connect response did not contain a token.');
  }

  let claimResponse = await client.claimTask({
    token,
    taskId: options.taskId || undefined,
  });

  // If no task in queue, auto-submit a default prompt so there's always a task to work with
  if (!claimResponse.task) {
    const defaultPrompt =
      options.defaultPrompt ||
      'Terminal connected. Follow the user\'s instructions and operate the browser through the extension.';
    try {
      const promptResponse = await fetch(
        `${client.getBaseUrl()}/api/mvp/extension/prompt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: defaultPrompt, source: 'terminal-bootstrap' }),
        },
      );
      if (promptResponse.ok) {
        claimResponse = await client.claimTask({ token });
      }
    } catch {
      // Prompt submission failed, continue without task
    }
  }

  const task = claimResponse.task || null;
  const browserBootstrap = {};

  const steps = options.browserBootstrapSteps || DEFAULT_BROWSER_BOOTSTRAP_STEPS;

  // Fast-fail: skip browser bootstrap if Chrome extension is not polling
  try {
    const statusData = await client.getStatus();
    if (statusData.status?.extension?.online === false) {
      const offlineError =
        'ExtensionOffline: Chrome extension is not connected. ' +
        'Open Chrome and make sure the AgentLimb extension is enabled, then retry start.';
      for (const step of steps) {
        browserBootstrap[step.key] = { ok: false, error: offlineError };
      }
      return {
        ok: false,
        extensionOffline: true,
        error: offlineError,
        terminal: connectResponse.terminal || { token, name: terminalName, type: terminalType, cwd },
        token,
        task,
        browserBootstrap,
        connectResponse,
        claimResponse,
      };
    }
  } catch {
    // Status check failed — proceed and let individual calls time out naturally
  }

  for (const step of steps) {
    try {
      const callResponse = await client.callBrowserTool({
        tool: step.tool,
        params: step.params || {},
        source: terminalType,
        timeoutMs: options.timeoutMs,
        pollIntervalMs: options.pollIntervalMs,
      });

      browserBootstrap[step.key] = normalizeBrowserBootstrapResult(callResponse);
    } catch (error) {
      browserBootstrap[step.key] = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    ok: true,
    terminal: connectResponse.terminal || {
      token,
      name: terminalName,
      type: terminalType,
      cwd,
    },
    token,
    task,
    browserBootstrap,
    connectResponse,
    claimResponse,
  };
}

function normalizeBrowserBootstrapResult(callResponse) {
  const result = callResponse?.completed?.call?.result;
  if (result && typeof result === 'object') {
    return result;
  }

  return {
    ok: false,
    error: 'Browser bootstrap call returned no result payload.',
  };
}
