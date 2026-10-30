#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

mkdirSync('dist', { recursive: true });
execFileSync('zip', [
  '-r', 'dist/agentlimb-chrome.zip',
  'manifest.json', 'package.json', 'README.md',
  'kernel', 'host', 'bin', 'scripts', 'ui', 'icons', 'assets',
  '-x', '*.DS_Store', '*__pycache__*', '*.pyc',
], { stdio: 'inherit' });

const buf = readFileSync('dist/agentlimb-chrome.zip');
const hash = createHash('sha256').update(buf).digest('hex');
const checksumLine = `${hash}  agentlimb-chrome.zip\n`;
writeFileSync('dist/SHA256SUMS.txt', checksumLine);
console.log('Package created: dist/agentlimb-chrome.zip');
console.log('Checksum:', checksumLine.trim());
