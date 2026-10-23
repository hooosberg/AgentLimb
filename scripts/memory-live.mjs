#!/usr/bin/env node
/**
 * 网站记忆 live check against the user's real Chrome.
 *
 * Acts as a genuine MCP client (stdio, same as any AI tool): connects to the
 * installed host, pairs through the extension's open authorization window,
 * opens a background tab, then proves the memory loop twice — session 1
 * briefs → operates → records, session 2 (fresh process) briefs and reads it back.
 *
 *   node scripts/memory-live.mjs            # uses ~/.agentlimb/host
 *   AGENTLIMB_LIVE_ROOT=<dir> ...           # keep the test notes out of the real folder (default: temp)
 *
 * Needs: Chrome running with the extension and its side panel opened once, and
 * the copy-prompt button pressed within the last 30 minutes (first pairing only).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const host = process.env.AGENTLIMB_LIVE_HOST || join(homedir(), '.agentlimb', 'host', 'mcp-server.mjs');
const notes = process.env.AGENTLIMB_LIVE_ROOT || mkdtempSync(join(tmpdir(), 'agentlimb-live-'));
const site = process.env.AGENTLIMB_LIVE_SITE || 'example.com';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${String(detail).replace(/\s+/g, ' ').slice(0, 160)}` : ''}`);
};

function open() {
  const child = spawn(process.execPath, [host], {
    env: { ...process.env, AGENTLIMB_CLIENT_NAME: 'Antigravity', AGENTLIMB_CLIENT_KIND: 'agent', AGENTLIMB_MEMORY_ROOT: notes },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const pending = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      try { const m = JSON.parse(line); if (m.id != null) pending.get(m.id)?.(m); } catch (_) { /* log line */ }
    }
  });
  let id = 1;
  const call = (method, params = {}, ms = 30000) => new Promise((resolve, reject) => {
    const n = id++;
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), ms);
    pending.set(n, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
  });
  const tool = async (name, args = {}, ms) => {
    const m = await call('tools/call', { name, arguments: args }, ms);
    if (m.error) throw new Error(m.error.message);
    return m.result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  };
  return { child, call, tool };
}

async function ready(session) {
  const init = await session.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Antigravity', version: '1' } });
  const waitMs = Number(process.env.AGENTLIMB_LIVE_WAIT_MS || 120000);
  const until = Date.now() + waitMs;
  let hinted = false;
  let last = '';
  while (Date.now() < until) {
    last = await session.tool('ping').catch((e) => e.message);
    if (/pong/i.test(last) && !/not authorized|no browser|not connected/i.test(last)) return { init, pong: last, ok: true };
    if (!hinted) { console.log('… waiting for authorization: click the copy-prompt button in the AgentLimb side panel'); hinted = true; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { init, pong: last, ok: false };
}

let tabId;
const one = open();
try {
  const { init, pong, ok } = await ready(one);
  check('instructions carry site memory', /Site memory \(enabled\)/.test(init.result.instructions), notes);
  check('pairing: ping pong', ok, pong);
  if (!ok) throw new Error('not paired — remaining browser checks skipped');

  const first = await one.tool('site_memory', { action: 'brief', site });
  check('session 1 briefs first (no playbook yet)', /^NO_PLAYBOOK/.test(first));

  const tabs = await one.tool('tabs_context');
  check('tabs_context lists real tabs', /example|http|chrome/i.test(tabs), tabs.slice(0, 80));

  const opened = await one.tool('tab_new', { url: `https://${site}/` });
  tabId = (/"?tab(?:Id|_id)"?\s*[:=]\s*(\d+)/i.exec(opened) || /(\d{3,})/.exec(opened) || [])[1];
  check('tab_new opened a background tab', Boolean(tabId), opened);
  check('tab_new result carries the automatic site-memory hint', /SITE MEMORY \(auto\)/.test(opened), opened.slice(opened.indexOf('SITE MEMORY')));
  await one.tool('wait', { tabId: Number(tabId), condition: 'page_contains', text: 'Example Domain' }, 20000).catch(() => {});
  const found = await one.tool('find', { tabId: Number(tabId), selector: 'a' }).catch((e) => e.message);
  check('operated the page (found the link)', /"ref"|href|Learn more|More information/i.test(found), found);

  const recorded = await one.tool('site_memory', {
    action: 'record', site, status: 'success', title: 'Example Domain', capabilities: ['read_page'],
    entry: `https://${site}/`, selectors: '更多信息链接 → a → 页面唯一的链接', verify: '标题为 Example Domain', note: 'live check by Antigravity',
  });
  check('session 1 recorded', /^RECORDED: example\.com/.test(recorded), recorded);
  const said = await one.tool('say', { text: '网站记忆 live check：已操作并记录。' }).catch((e) => e.message);
  check('say after recording does not nag', !/SITE MEMORY/.test(said), said);
} catch (error) {
  check('browser part completed', false, error.message);
} finally {
  if (tabId) await one.tool('tab_close', { tabId: Number(tabId) }).catch(() => {});
  one.child.kill();
}

const playbook = join(notes, 'knowledge', 'sites', site, 'PLAYBOOK.md');
check('playbook on disk', existsSync(playbook) && /a → 页面/.test(readFileSync(playbook, 'utf8')), playbook);

const two = open();
try {
  await ready(two);
  const second = await two.tool('site_memory', { action: 'brief', site });
  check('session 2 (fresh process) reads it back', /PLAYBOOK: example\.com/.test(second) && /更多信息链接/.test(second) && /status=verified/.test(second), second);
} finally {
  two.child.kill();
}

const passed = results.filter(Boolean).length;
console.log(`\nLive ${passed}/${results.length}  notes: ${notes}`);
process.exit(passed === results.length ? 0 : 1);
