import test from 'node:test';
import assert from 'node:assert/strict';

import { bootstrapTerminalTaskSession } from '../kernel/bridge/mvp/bootstrap-session.js';

test('bootstrapTerminalTaskSession connects, claims the task, and fetches initial browser context', async () => {
  const calls = [];

  const client = {
    async connectTerminal(input) {
      calls.push({ type: 'connectTerminal', input });
      return {
        token: 'term_123',
        terminal: {
          token: 'term_123',
          name: input.name,
          type: input.type,
          cwd: input.cwd,
        },
      };
    },
    async claimTask(input) {
      calls.push({ type: 'claimTask', input });
      return {
        task: {
          id: input.taskId,
          prompt: '测试自动 bootstrap',
          status: 'claimed',
        },
      };
    },
    async callBrowserTool(input) {
      calls.push({ type: 'callBrowserTool', input });
      if (input.tool === 'tabs_context') {
        return {
          completed: {
            call: {
              status: 'completed',
              result: {
                ok: true,
                result: {
                  page: {
                    url: 'https://example.com',
                  },
                },
              },
            },
          },
        };
      }

      return {
        completed: {
          call: {
            status: 'completed',
            result: {
              ok: true,
              result: {
                count: 5,
              },
            },
          },
        },
      };
    },
  };

  const session = await bootstrapTerminalTaskSession({
    client,
    taskId: 'task_123',
    terminalName: 'Codex',
    terminalType: 'codex',
    cwd: '/tmp/project',
  });

  assert.equal(session.terminal.token, 'term_123');
  assert.equal(session.task.id, 'task_123');
  assert.equal(session.browserBootstrap.tabsContext.ok, true);
  assert.equal(
    session.browserBootstrap.tabsContext.result.page.url,
    'https://example.com',
  );
  assert.equal(session.browserBootstrap.pageSnapshot.result.count, 5);

  assert.deepEqual(
    calls.map((entry) => entry.type),
    ['connectTerminal', 'claimTask', 'callBrowserTool', 'callBrowserTool'],
  );
});
