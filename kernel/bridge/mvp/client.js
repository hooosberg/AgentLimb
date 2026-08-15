export function createMvpHttpClient(options = {}) {
  const baseUrl = String(options.baseUrl || 'http://127.0.0.1:7791').replace(/\/$/, '');
  const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  const sleep = options.sleep || defaultSleep;

  return {
    getBaseUrl() {
      return baseUrl;
    },

    getStatus() {
      return request('/api/mvp/status');
    },

    connectTerminal(input = {}) {
      return request('/api/mvp/terminal/connect', {
        method: 'POST',
        body: {
          name: input.name,
          type: input.type,
          cwd: input.cwd,
        },
      });
    },

    claimTask(input = {}) {
      return request('/api/mvp/terminal/next', {
        method: 'POST',
        headers: {
          'X-AgentLimb-Terminal': input.token || '',
        },
        body: {
          taskId: input.taskId || null,
        },
      });
    },

    getTask(taskId) {
      return request(`/api/mvp/tasks/${encodeURIComponent(taskId)}`);
    },

    completeTask(input = {}) {
      return request('/api/mvp/terminal/result', {
        method: 'POST',
        headers: {
          'X-AgentLimb-Terminal': input.token || '',
        },
        body: {
          taskId: input.taskId,
          ok: input.ok,
          output: input.output,
          error: input.error,
        },
      });
    },

    submitBrowserToolCall(input = {}) {
      return request('/api/mvp/browser/call', {
        method: 'POST',
        body: {
          tool: input.tool,
          params: input.params || {},
          source: input.source || 'terminal',
          target: input.target || null,
        },
      });
    },

    getBrowserCall(callId) {
      return request(`/api/mvp/browser/calls/${encodeURIComponent(callId)}`);
    },

    async waitForBrowserCall(input = {}) {
      const callId = String(input.callId || '').trim();
      if (!callId) {
        throw new Error('callId is required.');
      }

      const timeoutMs = Number.isFinite(Number(input.timeoutMs))
        ? Number(input.timeoutMs)
        : 30000;
      const pollIntervalMs = Number.isFinite(Number(input.pollIntervalMs))
        ? Number(input.pollIntervalMs)
        : 600;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const response = await request(
          `/api/mvp/browser/calls/${encodeURIComponent(callId)}`,
        );
        const status = response.call?.status;
        if (status === 'completed' || status === 'failed') {
          return response;
        }
        await sleep(pollIntervalMs);
      }

      throw new Error(`Timed out waiting for browser call ${callId}`);
    },

    async callBrowserTool(input = {}) {
      const submitted = await request('/api/mvp/browser/call', {
        method: 'POST',
        body: {
          tool: input.tool,
          params: input.params || {},
          source: input.source || 'terminal',
          target: input.target || null,
        },
      });

      const completed = await this.waitForBrowserCall({
        callId: submitted.call?.id,
        timeoutMs: input.timeoutMs,
        pollIntervalMs: input.pollIntervalMs,
      });

      return {
        submitted,
        completed,
      };
    },
  };

  async function request(path, options = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body:
        options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
