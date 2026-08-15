import test from 'node:test';
import assert from 'node:assert/strict';

import { createMvpHttpClient } from '../kernel/bridge/mvp/client.js';

test('MVP client waits until a browser call becomes completed', async () => {
  const responses = [
    {
      ok: true,
      call: {
        id: 'call_1',
        status: 'claimed',
      },
    },
    {
      ok: true,
      call: {
        id: 'call_1',
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
  ];

  const fetchCalls = [];
  const client = createMvpHttpClient({
    baseUrl: 'http://127.0.0.1:7791',
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      const payload = responses.shift();
      return {
        ok: true,
        async text() {
          return JSON.stringify(payload);
        },
      };
    },
    sleep: async () => {},
  });

  const result = await client.waitForBrowserCall({
    callId: 'call_1',
    timeoutMs: 1000,
    pollIntervalMs: 10,
  });

  assert.equal(result.call.status, 'completed');
  assert.equal(result.call.result.result.page.url, 'https://example.com');
  assert.equal(fetchCalls.length, 2);
});
