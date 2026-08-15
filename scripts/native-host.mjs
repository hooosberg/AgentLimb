#!/usr/bin/env node

import { stdin, stdout } from 'node:process';

const projectDir = process.argv[2] || process.cwd();
let buffer = Buffer.alloc(0);

stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (length < 1 || length > 1024 * 1024 || buffer.length < length + 4) return;
    buffer = buffer.subarray(length + 4);
    const payload = Buffer.from(JSON.stringify({ projectDir }), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    stdout.write(Buffer.concat([header, payload]));
  }
});
