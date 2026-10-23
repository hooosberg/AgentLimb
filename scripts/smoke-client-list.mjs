#!/usr/bin/env node
/**
 * Browser smoke test for the paired-AI list.
 *
 * Loads the REAL sidepanel.js and the REAL bridge-client.js in a real Chrome
 * (no packaging, no build), feeds them the exact storage state from the bug
 * report — three stale identities of one software — and reads back what the
 * panel would render. Run with `node scripts/smoke-client-list.mjs`.
 *
 * Why a browser and not just a unit test: the report was about what the user
 * SEES. This renders it.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const PORT = 9777;
const HTTP_PORT = 18823;
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serve the repo over HTTP so module imports work (file:// blocks them). */
async function serve() {
  const { createServer } = await import('node:http');
  const { readFileSync, statSync } = await import('node:fs');
  const { extname, join: joinPath } = await import('node:path');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${HTTP_PORT}`);
    const file = joinPath(root, decodeURIComponent(url.pathname));
    try {
      const body = readFileSync(statSync(file).isFile() ? file : joinPath(root, 'index.html'));
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'text/plain' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', resolve));
  return () => new Promise((resolve) => server.close(resolve));
}

/** Minimal CDP client over Node's built-in WebSocket. */
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  return {
    send(method, params = {}) {
      const id = next++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

async function main() {
  const stop = await serve();
  const profile = mkdtempSync(join(tmpdir(), 'al-smoke-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    '--no-first-run', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i += 1) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
  }
  if (!target) { console.error('FAIL: no Chrome target'); process.exitCode = 1; }

  const client = await cdp(target.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/ui/sidepanel/dedupe-smoke.html` });
  await sleep(2500);

  const read = await client.send('Runtime.evaluate', {
    expression: `document.getElementById('out').textContent`,
    returnByValue: true,
  });
  const text = read?.result?.result?.value;
  console.log(text || '(no output)');

  let payload = null;
  try { payload = JSON.parse(text); } catch { /* leave null */ }
  const failures = [];
  if (!payload) failures.push('the page did not produce a result');
  else {
    if (payload.rowCount !== 2) failures.push(`expected 2 visible rows, got ${payload.rowCount}`);
    if (payload.workbuddyRows !== 1) failures.push(`expected 1 WorkBuddy row, got ${payload.workbuddyRows}`);
    if (payload.storedIdentities !== 4) failures.push(`expected 4 stored identities, got ${payload.storedIdentities}`);
    if (payload.popoverHiddenAfterClick !== true) failures.push('clicking topbar identity must NOT open the manager popover');
    if (payload.statePairedHidden !== false || payload.stateUnpairedHidden !== true) {
      failures.push(`expected panel to stay on #state-paired after Baidu task, got pairedHidden=${payload.statePairedHidden} unpairedHidden=${payload.stateUnpairedHidden}`);
    }
    if (payload.topStatus !== 'WorkBuddy AI · 已连接') failures.push(`expected topStatus "WorkBuddy AI · 已连接", got "${payload.topStatus}"`);
    if (payload.topDotClass !== 'dot online') failures.push(`expected topDotClass "dot online", got "${payload.topDotClass}"`);
    if (!String(payload.chatText || '').includes('已为你打开百度')) failures.push(`expected chat log to retain Baidu message, got "${payload.chatText}"`);
    if (String(payload.chatText || '').includes('还没有回复') || String(payload.chatText || '').includes('随机发帖子')) {
      failures.push(`expected stale user/timeout bubbles to be filtered out, got "${payload.chatText}"`);
    }
    if (payload.chatFormHidden !== true) failures.push('expected misleading chat form and Stop button to be hidden in paired view');
    if (!String(payload.axTreeSample || '').includes('button "百度一下"') || !String(payload.axTreeSample || '').includes('link "贴吧"')) {
      failures.push(`expected a11y-tree to extract nested <span> text in <button>/<a>, got:\n${payload.axTreeSample}`);
    }
    if (!(payload.axFindMatches || []).includes('button:百度一下')) {
      failures.push(`expected AGENTLIMB_FIND to match nested <span> text on button, got ${JSON.stringify(payload.axFindMatches)}`);
    }
    if (payload.stateUnpairedHiddenAfterRemove !== false || payload.topStatusAfterRemove !== '未连接') {
      failures.push(`expected explicit remove to return to #state-unpaired, got unpairedHidden=${payload.stateUnpairedHiddenAfterRemove} topStatus="${payload.topStatusAfterRemove}"`);
    }
  }

  client.close();
  chrome.kill();
  await stop();
  // Best effort: this sandbox's safe-delete shim refuses to trash paths it does
  // not recognise, and a leftover profile under the OS temp dir is harmless.
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* leave it */ }

  if (failures.length) {
    console.error(`FAIL:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log('PASS: three stale identities of one software render as one row');
  }
}

await main();
