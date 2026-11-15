import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createBridgeClient } from '../kernel/control/background/bridge-client.js';

test('discovery cancels an unrelated service error body before returning', { timeout: 5000 }, async (t) => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: { sendMessage: async () => {} },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
  t.after(() => { globalThis.chrome = originalChrome; });

  let responseClosed;
  const server = createServer((_request, response) => {
    responseClosed = once(response, 'close');
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.write('not found');
    // Leave the body open so GC or a completed response cannot hide a leak.
  });
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const bridge = createBridgeClient({ ports: [server.address().port], discoveryIntervalMs: 0 });
  t.after(() => bridge.stop());
  await bridge.start();
  assert.equal(bridge.getStatus().status, 'disconnected');
  assert.ok(responseClosed, 'discovery must actually reach the unrelated service');
  let timeout;
  try {
    const cancelled = await Promise.race([
      responseClosed.then(() => true),
      new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 250); }),
    ]);
    assert.equal(cancelled, true, 'an ignored HTTP error response must release its transport');
  } finally { clearTimeout(timeout); }
});
