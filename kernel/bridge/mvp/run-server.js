#!/usr/bin/env node

import { createMvpServer } from './server.js';

const port = Number(process.env.AGENTLIMB_MVP_PORT || 7791);
const host = process.env.AGENTLIMB_MVP_HOST || '127.0.0.1';

const server = createMvpServer({ host, port });

await server.start();

console.log(`[agentlimb mvp] listening on ${server.getBaseUrl()}`);

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
