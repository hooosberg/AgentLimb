#!/usr/bin/env node
/**
 * AgentLimb 真机测试（live）
 *
 * 用 Chrome for Testing + 隔离 profile 起一个真的浏览器，装上本扩展，
 * 然后用一个真的 MCP 客户端（stdio，和 AI 软件用的完全同一套协议）去驱动它：
 *
 *   新建标签 → 读页面 → 找元素 → 点击 → 填表单 → 截图 → 关标签
 *   侧栏发消息（自带截图/正文/refs）→ agent 收到 → say 回话 → 断开
 *
 * 不需要人工点，不碰用户正在用的 Chrome（独立 profile + 独立 HOME）。
 *
 *   node scripts/live-test.mjs            # 跑全套
 *   node scripts/live-test.mjs --keep     # 失败时保留浏览器窗口
 *
 * 产物：系统临时目录/agentlimb-clean-<随机值> 下的 summary.json 与截图；安装/配对/浏览器数据运行后删除
 */

import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync, openSync, closeSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORK = mkdtempSync(join(tmpdir(), 'agentlimb-clean-'));
const EXT = join(WORK, 'extension');
const HOME = join(WORK, 'home');
const PROFILE = join(WORK, 'profile');
const SHOTS = join(WORK, 'shots');
let CDP_PORT;
let CDP;
let TEST_BRIDGE_PORT;
let TEST_BRIDGE_PORTS;
const hosts = new Set();
let ownedChrome;
let ownedSite;
let chromeLog;
const NODE = process.execPath;
const KEEP = process.argv.includes('--keep');
const PUBLIC = process.argv.includes('--public');
const MONKEY = process.argv.includes('--monkey');
const MONKEY_SEED = Number(process.env.AGENTLIMB_MONKEY_SEED || 20261022) >>> 0;
const MONKEY_STEPS = Number(process.env.AGENTLIMB_MONKEY_STEPS || 120);
const monkeyTrace = [];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
].filter(Boolean);

const results = [];
let publicSite = null;
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 200)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, timeout = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── 一个能点的测试页（example.com 没有按钮，没法验证点击） ───────────────────
function startTestServer() {
  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>AgentLimb 测试页</title></head><body>
<h1>AgentLimb 测试页</h1>
<p id="intro">这个页面用来验证 AI 能不能真的操作浏览器：点击、输入、滚动、截图。</p>
<button id="btn" onclick="document.getElementById('count').textContent = String(Number(document.getElementById('count').textContent) + 1)">点我 +1</button>
<p>点击次数：<span id="count">0</span></p>
<label for="name">名字</label><input id="name" type="text" placeholder="在这里输入">
<section><h2>本地发帖测试（不会发布到外网）</h2>
<label>标题<input id="post-title"></label>
<label>正文<textarea id="post-body"></textarea></label>
<label><input id="post-agree" type="checkbox">确认本地测试</label>
<button id="post-submit" onclick="publishPost()">发布到本地测试页</button><p id="post-result"></p>
</section>
<script>
async function publishPost() {
  if (!document.getElementById('post-agree').checked) return;
  const title = document.getElementById('post-title').value;
  const body = document.getElementById('post-body').value;
  const res = await fetch('/posts', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,body})});
  const post = await res.json();
  document.getElementById('post-result').textContent = '本地发布成功：' + post.title + ' / ' + post.body;
}
</script>
<div style="height:1600px"></div>
<button id="deep" onclick="document.getElementById('deep-out').textContent='deep-clicked'">折叠线以下的按钮</button>
<p id="deep-out"></p>
</body></html>`;
  return new Promise((resolve) => {
    const posts = [];
    const server = createServer(async (req, res) => {
      if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (req.method === 'POST' && req.url === '/posts') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const post = JSON.parse(Buffer.concat(chunks).toString());
        posts.push(post);
        await sleep(1000); // a real network wait BETWEEN browser tool calls
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(post));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, posts, close: () => server.close() });
    });
  });
}

// ── 最小 CDP 客户端 ──────────────────────────────────────────────────────────
async function cdp(wsUrl, onEvent) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('cdp connect failed'));
  });
  let id = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method && onEvent) onEvent(msg);
  };
  return {
    send: (method, params = {}) => new Promise((res) => {
      const i = id++;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    close: () => ws.close(),
  };
}

const listTargets = async () => (await fetchJson(`${CDP}/json/list`, 2500)) || [];

async function savePanelShot(panel, name, width = 400) {
  await panel.send('Emulation.setDeviceMetricsOverride', {
    width, height: 860, deviceScaleFactor: 2, mobile: false,
  });
  const shot = await panel.send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) writeFileSync(join(SHOTS, name), Buffer.from(shot.result.data, 'base64'));
  await panel.send('Emulation.clearDeviceMetricsOverride');
}

async function panelValue(panel, expression) {
  const response = await panel.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
  return response.result?.result?.value;
}

// ── 真的 MCP 客户端（和 AI 软件同一条路径） ─────────────────────────────────
class McpClient {
  constructor(home, identity = {}) {
    this.pending = new Map();
    this.notifications = [];
    this.stderr = '';
    this.buffer = '';
    this.nextId = 1;
    const config = JSON.parse(readFileSync(join(WORK, 'mcp-config.json'), 'utf8')).mcpServers.agentlimb;
    this.child = spawn(config.command, config.args, {
      env: { ...process.env, HOME: home, ...config.env, ...identity },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    hosts.add(this.child);
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        const text = line.trim();
        if (!text) continue;
        let msg;
        try { msg = JSON.parse(text); } catch { continue; }
        if (msg.id != null && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        } else if (msg.method) {
          this.notifications.push(msg);
        }
      }
    });
    this.child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      this.stderr += text;
      process.stdout.write(`   [host] ${text.trim().slice(0, 200)}\n`);
    });
  }

  request(method, params = {}, timeoutMs = 60000) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return promise;
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  call(name, args = {}) {
    return this.request('tools/call', { name, arguments: args });
  }

  stop() {
    try { this.child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

const payload = (res) => {
  const content = res?.result?.content || [];
  const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const images = content.filter((c) => c.type === 'image');
  let json = null;
  // Results can carry JSON plus a second text block with a sidebar message.
  try { json = JSON.parse(content.find((c) => c.type === 'text')?.text); } catch { /* not JSON */ }
  return { text, images, json, isError: !!res?.result?.isError };
};

// ── 环境准备 ─────────────────────────────────────────────────────────────────
function preflight() {
  // Unique per-run directories cannot inherit installations, browser storage or pairings.
  check('clean_room_has_no_prior_install', !existsSync(join(HOME, '.agentlimb')) && !existsSync(PROFILE) && !existsSync(EXT));
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(HOME, { recursive: true });
  cpSync(ROOT, EXT, {
    recursive: true,
    filter: (src) => !src.includes('/.git') && !src.includes('/.workbuddy-ai') && !src.includes('/忽略上传'),
  });
  // Real Chrome also discovers production bridge ports. Keep BOTH halves of
  // this test on a private range so it cannot authorize a daily-use AI by accident.
  const constants = join(EXT, 'kernel/shared/constants.js');
  const source = readFileSync(constants, 'utf8');
  const isolated = source.replace(/export const BRIDGE_PORTS = \[[^\]]+\];/,
    `export const BRIDGE_PORTS = [${TEST_BRIDGE_PORTS.join(", ")}];`);
  if (isolated === source) throw new Error('could not isolate test bridge ports');
  writeFileSync(constants, isolated);
  const env = { ...process.env, HOME, USERPROFILE: HOME };
  const cli = join(EXT, 'bin', 'agentlimb.mjs');
  const identity = ['--client-name', 'WorkBuddy AI', '--client-kind', 'livetest'];
  execFileSync(NODE, [cli, 'install', ...identity], { env });
  const config = JSON.parse(execFileSync(NODE, [cli, 'config', ...identity], { env, encoding: 'utf8' }));
  writeFileSync(join(WORK, 'mcp-config.json'), JSON.stringify(config, null, 2));
  const entry = config.mcpServers.agentlimb;
  check('fresh_installer_generated_usable_config', entry.command === NODE && existsSync(entry.args[0])
    && entry.args[0].startsWith(HOME) && !existsSync(join(HOME, '.agentlimb/paired-clients.json')));
}

async function freePorts() {
  const servers = Array.from({ length: 7 }, () => createServer());
  try {
    for (const server of servers) await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    return servers.map((server) => server.address().port);
  } finally { for (const server of servers) await new Promise((resolve) => server.close(resolve)); }
}

async function waitForSw() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const target = (await listTargets()).find(
      (t) => t.type === 'service_worker' && t.url.includes('service-worker.js'),
    );
    if (target) return target;
    await sleep(400);
  }
  return null;
}

async function waitFor(fn, timeoutMs = 15000, interval = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(interval);
  }
  return null;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  [CDP_PORT, ...TEST_BRIDGE_PORTS] = await freePorts();
  TEST_BRIDGE_PORT = TEST_BRIDGE_PORTS[0];
  CDP = `http://127.0.0.1:${CDP_PORT}`;
  preflight();
  const chromePath = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!chromePath) throw new Error('找不到 Chrome for Testing，请设置 CHROME_PATH');
  console.log(`chrome: ${chromePath}`);

  const site = ownedSite = await startTestServer();
  console.log(`test page: ${site.url}`);

  let mcp = new McpClient(HOME);
  await mcp.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'WorkBuddy AI', version: '1.0.0' },
  });
  mcp.notify('notifications/initialized');
  const port = await waitFor(async () => {
    const m = mcp.stderr.match(/bridge on 127\.0\.0\.1:(\d+)/);
    return m ? Number(m[1]) : null;
  }, 10000);
  check('bridge_up', port != null, port ? `127.0.0.1:${port}` : mcp.stderr.slice(0, 120));
  if (!port) throw new Error('bridge 没起来');

  chromeLog = openSync(join(WORK, 'chrome.log'), 'w');
  const chrome = ownedChrome = spawn(chromePath, [
    `--user-data-dir=${PROFILE}`,
    `--load-extension=${EXT}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1280,900',
    site.url,
  ], { detached: true, stdio: ['ignore', 'ignore', chromeLog] });
  chrome.unref();

  try {
    const sw = await waitForSw();
    check('extension_loaded', !!sw, sw ? 'service worker 已注册' : 'SW 未出现');
    if (!sw) throw new Error('扩展没装上');
    const extId = sw.url.match(/chrome-extension:\/\/([a-z]+)\//)[1];
    const swSession = await cdp(sw.webSocketDebuggerUrl);
    await swSession.send('Runtime.evaluate', { expression: "chrome.storage.local.set({'agentlimb.lang':'zh-CN'})", awaitPromise: true });
    swSession.close();

    const health = await waitFor(async () => {
      const h = await fetchJson(`http://127.0.0.1:${port}/health`);
      return h?.browsers >= 1 ? h : null;
    }, 30000);
    check('extension_connected', !!health, `browsers=${health?.browsers ?? 0}`);

    // ── 授权：和用户一样点一次「复制连接提示词」，没有确认页可点 ────────────
    // 侧栏面板本身就是扩展页，可以直接当标签页打开来点真实按钮。
    const hostPage = (await listTargets()).find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension://'));
    const creator = await cdp(hostPage.webSocketDebuggerUrl);
    const authTab = await creator.send('Target.createTarget', {
      url: `chrome-extension://${extId}/ui/sidepanel/sidepanel.html`,
      background: true,
    });
    const authTabId = authTab.result?.targetId;
    const authTarget = await waitFor(async () =>
      (await listTargets()).find((t) => t.id === authTabId), 10000);
    const authSession = await cdp(authTarget.webSocketDebuggerUrl);
    await authSession.send('Runtime.enable');
    await sleep(600);
    await authSession.send('Runtime.evaluate', {
      expression: "Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{}}); document.getElementById('btn-copy-prompt').click();",
    });
    const authorized = await waitFor(async () => {
      const h = await fetchJson(`http://127.0.0.1:${port}/health`);
      return h?.activeBrowser ? h : null;
    }, 20000);
    check('authorized_by_copy_without_confirmation_page', !!authorized);
    check('trust_saved_after_copy', authorized?.paired === true);
    check('no_pairing_page_in_extension', !(await listTargets()).some((t) => t.url.includes('pairing.html')));
    authSession.close();
    await creator.send('Target.closeTarget', { targetId: authTabId }).catch(() => {});
    creator.close();

    // ── 1. 连接性 ───────────────────────────────────────────────────────────
    const ping = payload(await mcp.call('ping'));
    check('tool_ping', ping.json?.pong === true, ping.text.slice(0, 80));

    const tabs0 = payload(await mcp.call('tabs_context'));
    check('tool_tabs_context', (tabs0.json?.count || 0) >= 1, `${tabs0.json?.count} 个标签`);

    // ── 2. 新建标签（后台，不抢用户焦点） ───────────────────────────────────
    const created = payload(await mcp.call('tab_new', { url: site.url, active: false }));
    const tabId = created.json?.tab?.id;
    check('tool_tab_new', Number.isInteger(tabId) && created.json?.tab?.url === site.url,
      `tab ${tabId} → ${created.json?.tab?.url}`);
    check('tab_new_is_background', created.json?.tab?.active === false, `active=${created.json?.tab?.active}`);

    // ── 3. 读页面结构 ───────────────────────────────────────────────────────
    const page = payload(await mcp.call('read_page', { tabId }));
    check('tool_read_page', /点我|btn/.test(page.text) && page.json?.elementCount > 0,
      `${page.json?.elementCount} 个元素`);

    // ── 4. 找元素 → 点击 ────────────────────────────────────────────────────
    const found = payload(await mcp.call('find', { tabId, query: '点我' }));
    const ref = found.json?.matches?.[0]?.ref;
    check('tool_find', ref != null, `ref=${ref}`);
    const click = payload(await mcp.call('computer', { tabId, action: 'click', ref }));
    check('tool_computer_click', click.json?.ok !== false, click.text.slice(0, 80));
    await sleep(400);
    const afterClick = payload(await mcp.call('javascript_eval', {
      tabId, expression: "document.getElementById('count').textContent",
    }));
    check('click_actually_worked', String(afterClick.json?.result) === '1', `count=${afterClick.json?.result}`);

    // ── 5. 表单输入 ─────────────────────────────────────────────────────────
    await mcp.call('form_input', { tabId, selector: '#name', value: 'agentlimb' });
    const inputValue = payload(await mcp.call('javascript_eval', {
      tabId, expression: "document.getElementById('name').value",
    }));
    check('tool_form_input', String(inputValue.json?.result) === 'agentlimb', `value=${inputValue.json?.result}`);

    // ── 6. 折叠线以下的元素（滚动后才可点） ─────────────────────────────────
    const deep = payload(await mcp.call('computer', { tabId, action: 'click', selector: '#deep' }));
    await sleep(300);
    const deepOut = payload(await mcp.call('javascript_eval', {
      tabId, expression: "document.getElementById('deep-out').textContent",
    }));
    check('click_below_fold', deepOut.json?.result === 'deep-clicked' && deep.json?.ok !== false,
      `deep-out=${deepOut.json?.result}`);

    // ── 7. 截图（AI 遇到困难时的眼睛） ──────────────────────────────────────
    const shot = payload(await mcp.call('computer', { tabId, action: 'screenshot' }));
    check('tool_screenshot', !!shot.images[0]?.data,
      shot.images[0] ? `${Math.round(shot.images[0].data.length / 1024)}KB` : '没有图片');
    if (shot.images[0]?.data) {
      writeFileSync(join(SHOTS, 'page-after-click.jpg'), Buffer.from(shot.images[0].data, 'base64'));
    }

    // ── 8. 批量操作（一次往返多步） ─────────────────────────────────────────
    const batch = payload(await mcp.call('browser_batch', {
      actions: [
        { tool: 'computer', args: { tabId, action: 'click', selector: '#btn' } },
        { tool: 'computer', args: { tabId, action: 'click', selector: '#btn' } },
      ],
    }));
    const countAfterBatch = payload(await mcp.call('javascript_eval', {
      tabId, expression: "document.getElementById('count').textContent",
    }));
    check('tool_browser_batch', String(countAfterBatch.json?.result) === '3',
      `count=${countAfterBatch.json?.result} batch=${batch.text.slice(0, 80)}`);

    // ── 9. 侧栏聊天：自带当前页面 ───────────────────────────────────────────
    const pageTarget = (await listTargets()).find((t) => t.type === 'page' && t.url === site.url)
      || (await listTargets()).find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension://'));
    const bs = await cdp(pageTarget.webSocketDebuggerUrl);
    const createdPanel = await bs.send('Target.createTarget', {
      url: `chrome-extension://${extId}/ui/sidepanel/sidepanel.html`,
      background: true,
    });
    const panelId = createdPanel.result?.targetId;

    let panel = null;
    await waitFor(async () => {
      const target = (await listTargets()).find((t) => t.id === panelId);
      if (!target) return null;
      const cand = await cdp(target.webSocketDebuggerUrl);
      await cand.send('Runtime.enable');
      await sleep(1000);
      const r = await cand.send('Runtime.evaluate', {
        expression: "!document.getElementById('state-paired').hidden",
        returnByValue: true,
      });
      if (r.result?.result?.value === true) { panel = cand; return true; }
      cand.close();
      return null;
    }, 20000);
    check('panel_chat_ready', !!panel, panel ? '侧栏进入聊天态' : '侧栏没进聊天态');
    if (panel) check('header_disconnect_removed', await panelValue(panel, "!document.getElementById('btn-disconnect')"));

    if (panel) {
      // No step history: only the four-state controller and twenty chat records.
      const groups = await panel.send('Runtime.evaluate', {
        expression: "document.querySelectorAll('.msg.activity').length",
        returnByValue: true,
      });
      const groupCount = groups.result?.result?.value;
      check('no_activity_history', groupCount === 0, `${groupCount} 行操作记录`);

      // Hold a real browser tool open: UI and SW must both reject chat, while
      // the browser tool itself continues normally.
      const heldTool = mcp.call('javascript_eval', {
        tabId, expression: "new Promise(resolve => setTimeout(() => resolve('finished'), 3000))",
      });
      const toolLocked = await waitFor(async () => {
        const r = await panel.send('Runtime.evaluate', {
          expression: "document.getElementById('chat-input').disabled && !document.getElementById('btn-send').disabled && document.getElementById('btn-send').textContent === '停止' && document.getElementById('composer-status').textContent === '正在操作'",
          returnByValue: true,
        });
        return r.result?.result?.value === true;
      }, 3000, 80);
      check('browser_tool_locks_composer', toolLocked);
      const blockedSend = await panel.send('Runtime.evaluate', {
        expression: "chrome.runtime.sendMessage({type:'AGENTLIMB_CHAT_SEND',text:'busy attempt'})",
        awaitPromise: true, returnByValue: true,
      });
      check('backend_rejects_chat_while_tool_runs', blockedSend.result?.result?.value?.ok === false);
      check('operating_placeholder_is_explicit', await panelValue(panel,
        "document.getElementById('chat-input').placeholder === 'AI 正在操作浏览器，完成后可继续聊天…'"));
      await savePanelShot(panel, 'panel-stop-button-400w.png');
      const stopBefore = mcp.notifications.length;
      await panelValue(panel, "document.getElementById('btn-send').click(); document.getElementById('btn-send').click()");
      check('stop_request_pending_ui', !!await waitFor(() => panelValue(panel,
        "document.getElementById('chat-input').disabled && document.getElementById('chat-input').placeholder.includes('已请求停止') && document.getElementById('btn-send').disabled && document.getElementById('btn-send').textContent === '已请求'"), 3000, 80));
      const duplicateStop = await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_CHAT_STOP'})");
      check('stop_backend_dedupes_clicks', duplicateStop?.alreadyRequested === true);
      const stopNote = await waitFor(() => mcp.notifications.slice(stopBefore).find((n) =>
        n.params?.logger === 'agentlimb-chat' && /用户请求停止当前任务/.test(String(n.params.data))), 3000, 80);
      check('stop_plain_message_reaches_agent', !!stopNote && !/Current tab|Visible page text/.test(String(stopNote.params.data)));
      const heldResult = payload(await heldTool);
      check('browser_control_continues_while_chat_locked', heldResult.json?.result === 'finished');
      check('stop_rides_in_flight_tool_result_without_image', /用户请求停止当前任务/.test(heldResult.text) && heldResult.images.length === 0);
      check('stop_sent_once', mcp.notifications.slice(stopBefore).filter((n) =>
        n.params?.logger === 'agentlimb-chat' && /用户请求停止当前任务/.test(String(n.params.data))).length === 1);
      check('stop_keeps_pairing', await panelValue(panel,
        "chrome.runtime.sendMessage({type:'AGENTLIMB_GET_STATUS'}).then(s=>s.clients.some(c=>c.paired) && s.stopRequested)"));
      await savePanelShot(panel, 'panel-stop-requested-400w.png');
      check('tool_gap_keeps_composer_locked', await panelValue(panel,
        "document.getElementById('chat-input').disabled && document.getElementById('composer-status').dataset.mode === 'operating'"));
      const gapSend = await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_CHAT_SEND',text:'tool gap attempt'})");
      check('backend_rejects_chat_between_tools', gapSend?.ok === false);
      check('toolbar_badge_persists_between_tools', await panelValue(panel, 'chrome.action.getBadgeText({})') === '…');
      await savePanelShot(panel, 'panel-operating-400w.png');
      await mcp.call('say', { text: '浏览器操作测试已完成。' });
      const unlocked = await waitFor(async () => {
        const r = await panel.send('Runtime.evaluate', {
          expression: "!document.getElementById('chat-input').disabled", returnByValue: true,
        });
        return r.result?.result?.value === true;
      }, 3000, 80);
      check('final_say_restores_composer', unlocked);
      check('final_reply_clears_toolbar_badge', await panelValue(panel, 'chrome.action.getBadgeText({})') === '');
      const clearedIndicator = payload(await mcp.call('javascript_eval', {
        tabId, expression: "!document.querySelector('#agentlimb-indicator.agentlimb-active')",
      }));
      check('final_reply_clears_page_indicator', clearedIndicator.json?.result === true);
      await mcp.call('say', { text: '状态指示验证完成。' });
      // `say` acknowledges the SSE write, not the panel's DOM update.
      await waitFor(() => panelValue(panel, "!document.getElementById('chat-input').disabled"), 3000, 80);

      // 用真的键盘事件发送（Enter 发送是本次打磨的交互）
      await panel.send('Runtime.evaluate', {
        expression: "document.getElementById('chat-input').focus()",
      });
      await panel.send('Input.insertText', { text: '这个页面是干什么的？' });
      await panel.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      await panel.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });

      const sawThinking = await waitFor(async () => {
        const r = await panel.send('Runtime.evaluate', {
          expression: "document.getElementById('composer-status').dataset.mode === 'replying'",
          returnByValue: true,
        });
        return r.result?.result?.value === true;
      }, 4000, 150);
      check('single_replying_status', sawThinking, sawThinking ? '发送后显示等待回复' : '没出现');
      const pendingLock = await waitFor(() => panelValue(panel,
        "document.getElementById('chat-input').disabled && document.getElementById('btn-send').textContent === '停止' && !document.getElementById('btn-send').disabled"), 5000, 80);
      check('pending_reply_locks_composer', pendingLock === true);
      const duplicate = await panel.send('Runtime.evaluate', {
        expression: "chrome.runtime.sendMessage({type:'AGENTLIMB_CHAT_SEND',text:'duplicate attempt'})",
        awaitPromise: true, returnByValue: true,
      });
      check('backend_rejects_duplicate_pending_message', duplicate.result?.result?.value?.ok === false);
    }

    const chatNote = await waitFor(() =>
      mcp.notifications.find((n) => n.params?.logger === 'agentlimb-chat' && /这个页面是干什么的/.test(String(n.params.data))) || null, 15000);
    check('panel_message_reached_agent', !!chatNote);
    if (chatNote) {
      const data = String(chatNote.params.data || '');
      check('message_carries_page_text', /Visible page text/.test(data) && /测试页/.test(data),
        data.split('\n').slice(0, 4).join(' / ').slice(0, 160));
      check('message_carries_refs', /Interactive elements/.test(data));
    }

    // 下一条工具结果应带上「当前标签截图」——零额外往返
    const withShot = payload(await mcp.call('ping'));
    check('message_carries_screenshot', !!withShot.images[0]?.data,
      withShot.images[0] ? `${Math.round(withShot.images[0].data.length / 1024)}KB` : '没带截图');

    if (panel) {
      await savePanelShot(panel, 'panel-waiting-400w.png');
      // Reopening the UI must not reset the background's unanswered turn lock.
      await panel.send('Page.reload');
      const stillLocked = await waitFor(async () => {
        const r = await panel.send('Runtime.evaluate', {
          expression: "!document.getElementById('state-paired')?.hidden && document.getElementById('chat-input')?.disabled && document.getElementById('composer-status')?.textContent.includes('等待')",
          returnByValue: true,
        });
        return r.result?.result?.value === true;
      }, 5000, 150);
      check('pending_reply_survives_panel_reload_and_tool_result', stillLocked);
    }

    const say = payload(await mcp.call('say', { text: '这是一个用于测试点击与输入的本地页面。' }));
    check('tool_say', /Delivered/.test(say.text), say.text.slice(0, 60));

    if (panel) {
      const bubble = await waitFor(async () => {
        const r = await panel.send('Runtime.evaluate', {
          expression: "Array.from(document.querySelectorAll('.msg.agent')).map(e => e.textContent).join('|')",
          returnByValue: true,
        });
        const text = String(r.result?.result?.value || '');
        return text.includes('测试点击') ? text : null;
      }, 8000, 300);
      check('agent_reply_in_panel', !!bubble, bubble ? bubble.slice(0, 80) : '没出现 AI 气泡');
      const replyUnlocked = await panel.send('Runtime.evaluate', {
        expression: "!document.getElementById('chat-input').disabled && document.querySelectorAll('.msg.thinking, .msg.pending-hint').length === 0",
        returnByValue: true,
      });
      check('say_reply_restores_composer', replyUnlocked.result?.result?.value === true);
      check('reply_restores_send_button', await panelValue(panel,
        "document.getElementById('btn-send').textContent === '发送' && !document.getElementById('chat-input').placeholder.includes('操作浏览器')"));
      await panelValue(panel, `(() => {
        const input=document.getElementById('chat-input'); input.value='任务结束后恢复的草稿'; input.dispatchEvent(new Event('input'));
      })()`);
      const draftTask = mcp.call('javascript_eval', { tabId,
        expression: "new Promise(resolve=>setTimeout(()=>resolve('done'),800))" });
      check('busy_placeholder_replaces_but_keeps_draft', !!await waitFor(() => panelValue(panel,
        "document.getElementById('chat-input').disabled && document.getElementById('chat-input').value === '' && document.getElementById('chat-input').placeholder.includes('完成后可继续聊天')"), 3000, 80));
      await draftTask;
      await mcp.call('say', { text: '草稿恢复验证完成。' });
      check('draft_restored_after_task', !!await waitFor(() => panelValue(panel,
        "!document.getElementById('chat-input').disabled && document.getElementById('chat-input').value === '任务结束后恢复的草稿'"), 3000, 80));
      await panelValue(panel, "document.getElementById('chat-input').value='';document.getElementById('chat-input').dispatchEvent(new Event('input'))");
      // Real connected-state toolbar and settings, including narrow side panels.
      await panelValue(panel, `(() => {
        const input=document.getElementById('chat-input'); input.value='设置往返保留的草稿'; input.dispatchEvent(new Event('input'));
        Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async(text)=>{window.__copiedPrompt=text;}});
        document.getElementById('btn-copy-prompt-chat').click();
      })()`);
      const copied = await waitFor(() => panelValue(panel, 'window.__copiedPrompt || null'), 5000);
      check('connected_header_copy_works', !!copied && copied.includes('Extension ID:')
        && await panelValue(panel, "!document.getElementById('copy-feedback-chat').hidden && !document.getElementById('state-paired').hidden"));
      await panelValue(panel, "document.getElementById('btn-settings-chat').click()");
      check('settings_opens_while_connected', await panelValue(panel, "!document.getElementById('settings-view').hidden && document.querySelectorAll('.settings-section').length === 4"));
      await savePanelShot(panel, 'settings-400w.png');
      await panelValue(panel, "document.getElementById('btn-copy-prompt-settings').click()");
      check('settings_has_dedicated_copy_section', !!await waitFor(() => panelValue(panel, "!document.getElementById('copy-feedback-settings').hidden"), 5000));
      await panelValue(panel, "document.getElementById('btn-settings-back').click()");
      check('settings_roundtrip_keeps_draft', await panelValue(panel, "document.getElementById('chat-input').value === '设置往返保留的草稿'"));
      await panelValue(panel, "document.getElementById('chat-input').value='';document.getElementById('chat-input').dispatchEvent(new Event('input'));document.getElementById('btn-settings-chat').click();document.getElementById('language-select').value='en';document.getElementById('language-select').dispatchEvent(new Event('change'))");
      check('language_switch_translates_settings', !!await waitFor(() => panelValue(panel, "document.documentElement.lang === 'en' && document.querySelector('#settings-view h2').textContent === 'Settings' && document.getElementById('settings-connect').textContent.includes('Connect another AI')"), 5000));
      await savePanelShot(panel, 'settings-english-320w.png', 320);
      await panel.send('Page.reload');
      check('language_persists_after_reload', !!await waitFor(() => panelValue(panel, "document.getElementById('language-select')?.value === 'en' && document.documentElement.lang === 'en'"), 5000));
      await panelValue(panel, "document.getElementById('btn-settings-chat').click()");
      await panel.send('Emulation.setDeviceMetricsOverride', { width:320,height:860,deviceScaleFactor:2,mobile:false });
      check('settings_320px_has_no_horizontal_overflow', await panelValue(panel, "document.documentElement.scrollWidth <= 320 && document.getElementById('settings-view').scrollWidth <= 320"));
      await panel.send('Emulation.clearDeviceMetricsOverride');
      await panelValue(panel, "document.getElementById('language-select').value='zh-CN';document.getElementById('language-select').dispatchEvent(new Event('change'))");
      await waitFor(() => panelValue(panel, "document.documentElement.lang === 'zh-CN'"), 5000);
      await panelValue(panel, "document.getElementById('btn-settings-back').click()");
      await panel.send('Emulation.setDeviceMetricsOverride', { width:320,height:860,deviceScaleFactor:2,mobile:false });
      check('toolbar_copy_and_settings_fit_320px', await panelValue(panel, "['btn-copy-prompt-chat','btn-settings-chat'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.right<=320&&r.left>=0;}) && document.documentElement.scrollWidth<=320"));
      await panel.send('Emulation.clearDeviceMetricsOverride');


      const shotPanel = await panel.send('Page.captureScreenshot', { format: 'png' });
      if (shotPanel.result?.data) {
        writeFileSync(join(SHOTS, 'panel-chat.png'), Buffer.from(shotPanel.result.data, 'base64'));
      }
      // 侧栏真实宽度只有 ~400px，按这个宽度再存一张，方便看真实排版
      await panel.send('Emulation.setDeviceMetricsOverride', {
        width, height: 860, deviceScaleFactor: 2, mobile: false,
      });
      await sleep(300);
      const narrow = await panel.send('Page.captureScreenshot', { format: 'png' });
      if (narrow.result?.data) {
        writeFileSync(join(SHOTS, 'panel-chat-400w.png'), Buffer.from(narrow.result.data, 'base64'));
      }
      await panel.send('Emulation.clearDeviceMetricsOverride');
    }

    // Sidebar-origin task: multi-tab form entry, real click + async network,
    // while attempts to interrupt from the composer are rejected.
    if (panel) {
      const beforeTask = mcp.notifications.length;
      await panelValue(panel, `(() => {
        const input = document.getElementById('chat-input');
        input.value = '帮我在本地测试页发布一篇测试帖子';
        input.dispatchEvent(new Event('input'));
        document.getElementById('chat-form').requestSubmit();
      })()`);
      check('sidebar_can_start_browser_task', !!await waitFor(() => mcp.notifications.slice(beforeTask).find(
        (n) => n.params?.logger === 'agentlimb-chat' && /发布一篇测试帖子/.test(String(n.params.data))), 8000));
      const postTab = payload(await mcp.call('tab_new', { url: site.url }));
      const postId = postTab.json?.tab?.id;
      check('ai_tabs_reuse_orange_group', Number.isInteger(postTab.json?.tab?.groupId)
        && postTab.json.tab.groupId >= 0 && postTab.json.tab.groupId === created.json?.tab?.groupId);
      const group = await panelValue(panel, `chrome.tabGroups.get(${postTab.json?.tab?.groupId ?? -1})`);
      check('ai_group_has_visible_name_and_color', group?.title === 'AgentLimb' && group?.color === 'orange');
      const userTabs = await panelValue(panel, `chrome.tabs.query({url:${JSON.stringify(site.url)}})`);
      const originalId = tabs0.json?.tabs?.find((tab) => tab.active)?.id;
      check('original_user_tab_not_regrouped', userTabs.some((tab) => tab.id === originalId && tab.groupId === -1),
        JSON.stringify(userTabs.map(({ id, groupId, active }) => ({ id, groupId, active }))));
      const filled = payload(await mcp.call('browser_batch', { actions: [
        { tool: 'form_input', args: { tabId: postId, selector: '#post-title', value: 'AgentLimb 本地测试' } },
        { tool: 'form_input', args: { tabId: postId, selector: '#post-body', value: '复杂任务第一行\n第二行：只发布到本地测试服务器。' } },
        { tool: 'form_input', args: { tabId: postId, selector: '#post-agree', value: true } },
      ] }));
      check('multi_step_post_form_filled', !filled.isError);
      await mcp.call('computer', { tabId: postId, action: 'click', selector: '#post-submit' });
      check('sidebar_task_stays_operating_between_calls', await panelValue(panel,
        "document.getElementById('chat-input').disabled && document.getElementById('composer-status').textContent === '正在操作'"));
      const concurrent = await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_CHAT_SEND',text:'操作时同时问一个问题'})");
      check('concurrent_question_rejected_without_interrupting_post', concurrent?.ok === false);
      const posted = payload(await mcp.call('wait', { tabId: postId, condition: 'page_contains', text: '本地发布成功', timeout: 5000 }));
      check('local_post_reached_server_once', !posted.isError && site.posts.length === 1
        && site.posts[0].title === 'AgentLimb 本地测试' && /第二行/.test(site.posts[0].body));
      await mcp.call('tab_close', { tabId: postId });
      await mcp.call('say', { text: '测试帖子已发布到本地测试页，操作完成。' });
      check('sidebar_task_final_reply_unlocks', !!await waitFor(() => panelValue(panel,
        "!document.getElementById('chat-input').disabled && document.getElementById('composer-status').dataset.mode === 'ready'"), 3000));

      for (let i = 1; i <= 25; i++) await mcp.call('say', { text: `记录上限测试 ${i}` });
      check('visible_records_capped_at_20', !!await waitFor(() => panelValue(panel,
        "document.querySelectorAll('#chat-log .msg').length === 20 && document.querySelector('#chat-log .msg')?.textContent === '记录上限测试 6' && document.querySelector('#chat-log .msg:last-child')?.textContent === '记录上限测试 25'"), 5000));
      const stored = await panelValue(panel, "chrome.storage.local.get('agentlimb.chatLog')");
      const records = stored?.['agentlimb.chatLog'] || [];
      check('stored_records_capped_at_20', records.length === 20 && records[0].text === '记录上限测试 6');
      check('record_storage_has_no_page_payload_or_activity', records.every((record) =>
        !record.image && !record.page?.image && !record.page?.text && record.from !== 'activity'));
      await panel.send('Page.reload');
      check('record_cap_survives_reopen', !!await waitFor(() => panelValue(panel,
        "document.querySelectorAll('#chat-log .msg').length === 20 && !document.getElementById('chat-input').disabled"), 5000));
      await savePanelShot(panel, 'panel-records-20-400w.png');
    }

    // Optional public-site run uses the SAME MCP browser tools, no logged-in
    // profile and no public posting. Record site blocks separately from tests.
    if (PUBLIC && panel) {
      const publicTab = payload(await mcp.call('tab_new', { url: 'https://tieba.baidu.com/f?kw=%E6%B5%8B%E8%AF%95' }));
      const publicId = publicTab.json?.tab?.id;
      await sleep(2500);
      const read = payload(await mcp.call('read_page', { tabId: publicId, filter: 'all', limit: 60 }));
      publicSite = { url: publicTab.json?.tab?.url, readError: read.isError, excerpt: read.text.slice(0, 1800) };
      if (!read.isError && read.json?.elementCount > 0) {
        publicSite.status = /安全验证|验证码|Access Denied|ERR_/i.test(read.text) ? 'blocked' : 'readable';
        const duringPublic = await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_CHAT_SEND',text:'真实网站操作时的问题'})");
        check('public_site_task_rejects_interruption', duringPublic?.ok === false);
      } else {
        publicSite.status = 'unavailable';
      }
      const publicShot = payload(await mcp.call('computer', { tabId: publicId, action: 'screenshot' }));
      if (publicShot.images[0]?.data) writeFileSync(join(SHOTS, 'public-tieba.jpg'), Buffer.from(publicShot.images[0].data, 'base64'));
      console.log(`PUBLIC SITE: ${JSON.stringify(publicSite)}`);
      if (publicId) await mcp.call('tab_close', { tabId: publicId });
      await mcp.call('say', { text: '真实网站访问测试结束。' });
    }

    // ── 10. 不可读页面：读不到就要明说，不能装作空白页 ─────────────────────
    // 用扩展页当「当前标签」（chrome:// 的 WebUI 在 --no-sandbox 的测试环境里
    // 会把测试进程带走；人工验证过 chrome://extensions 走的是同一条分支）。
    // 全程只用 MCP 工具，和真实 agent 的做法一致。
    if (panel) {
      const before = mcp.notifications.length;
      const restrictedTab = payload(await mcp.call('tab_new', {
        url: `chrome-extension://${extId}/ui/sidepanel/sidepanel.html`,
      }));
      const restrictedId = restrictedTab.json?.tab?.id;
      if (restrictedId) await mcp.call('tab_activate', { tabId: restrictedId });
      await mcp.call('say', { text: '受限页面已打开，浏览器操作完成。' });
      await sleep(800);
      await panel.send('Runtime.evaluate', {
        expression: "(() => { const i = document.getElementById('chat-input'); i.value = '这个页面是什么？'; document.getElementById('chat-form').requestSubmit(); return 1; })()",
      });
      const restrictedNote = await waitFor(() => {
        const found = mcp.notifications.slice(before).find((n) =>
          n.params?.logger === 'agentlimb-chat' && /chrome-extension:\/\//.test(String(n.params?.data || '')));
        return found || null;
      }, 12000, 300);
      const noteText = String(restrictedNote?.params?.data || '');
      check('restricted_page_is_honest',
        /does not allow reading or controlling/.test(noteText) && !/Visible page text/.test(noteText),
        noteText.split('\n').slice(0, 3).join(' / ').slice(0, 160));
      if (restrictedId) await mcp.call('tab_close', { tabId: restrictedId });
    }

    // ── 11. 关标签 ──────────────────────────────────────────────────────────
    const closed = payload(await mcp.call('tab_close', { tabId }));
    // Chrome removes the tab asynchronously — poll instead of racing it.
    const gone = await waitFor(async () => {
      const snapshot = payload(await mcp.call('tabs_context'));
      return (snapshot.json?.tabs || []).every((t) => t.id !== tabId) ? true : null;
    }, 5000, 250);
    check('tool_tab_close', closed.json?.closed === tabId && gone === true,
      `closed=${closed.json?.closed} target=${tabId} gone=${gone === true}`);

    if (MONKEY && panel) {
      let seed = MONKEY_SEED;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const monkeyTab = payload(await mcp.call('tab_new', { url: site.url })).json?.tab?.id;
      if (!Number.isInteger(monkeyTab)) throw new Error('monkey tab did not open');
      console.log(`MONKEY seed=${MONKEY_SEED}, steps=${MONKEY_STEPS}`);
      for (let step = 0; step < MONKEY_STEPS; step++) {
        const action = Math.floor(random() * 10);
        const trace = { step, action };
        monkeyTrace.push(trace);
        let reply;
        let expectedError = false;
        if (action === 0) reply = payload(await mcp.call('computer', { tabId: monkeyTab, action: 'click', selector: '#btn' }));
        if (action === 1) {
          const value = `随机输入 ${step} '" <> 🐒`;
          reply = payload(await mcp.call('form_input', { tabId: monkeyTab, selector: '#name', value }));
          const readback = payload(await mcp.call('javascript_eval', { tabId: monkeyTab, expression: 'document.getElementById("name").value' }));
          if (readback.json?.result !== value) throw new Error(`monkey input mismatch at ${step}`);
        }
        if (action === 2) reply = payload(await mcp.call('computer', { tabId: monkeyTab, action: 'scroll', deltaY: Math.round((random() - 0.5) * 3000) }));
        if (action === 3) {
          expectedError = true;
          reply = payload(await mcp.call('read_page', { tabId: -999 }));
        }
        if (action === 4) {
          expectedError = true;
          reply = payload(await mcp.call('computer', { tabId: monkeyTab, action: 'click', ref: 999999 }));
        }
        if (action === 5) {
          const invalid = await mcp.call('unknown_monkey_tool');
          if (invalid.error?.code !== -32602) throw new Error('unknown tool was not rejected');
          reply = { isError: false };
        }
        if (action === 6) {
          reply = payload(await mcp.call('read_page', { tabId: monkeyTab }));
          const attempts = await Promise.all(Array.from({ length: 3 }, (_, i) => panelValue(panel,
            `chrome.runtime.sendMessage({type:'AGENTLIMB_CHAT_SEND',text:'monkey busy ${step}-${i}'})`)));
          if (attempts.some((result) => result.ok !== false)) throw new Error('busy chat accepted a duplicate interruption');
        }
        if (action === 7) {
          await mcp.call('say', { text: `猴子测试 ${step} 完成。` });
          await panel.send('Runtime.evaluate', { expression: 'location.reload()' });
          const restored = await waitFor(() => panelValue(panel, "!!document.getElementById('chat-input') && !document.getElementById('chat-input').disabled"), 5000);
          if (!restored) throw new Error('panel did not recover after reload');
          reply = { isError: false };
        }
        if (action === 8) {
          const replies = await Promise.all([mcp.call('ping'), mcp.call('ping'), mcp.call('tabs_context')]);
          if (payload(replies[0]).json?.pong !== true || payload(replies[1]).json?.pong !== true
            || !Array.isArray(payload(replies[2]).json?.tabs)) throw new Error('concurrent tool replies were lost');
          reply = { isError: false };
        }
        if (action === 9) reply = payload(await mcp.call('navigate', { tabId: monkeyTab, url: `${site.url}?monkey=${step}` }));
        trace.expectedError = expectedError;
        trace.isError = reply.isError;
        if (reply.isError !== expectedError) throw new Error(`monkey action ${action} at ${step}: ${reply.text}`);
        await mcp.call('say', { text: `随机步骤 ${step} 已处理。` });
        if (payload(await mcp.call('ping')).json?.pong !== true) throw new Error('bridge failed to recover after random action');
        const usable = await waitFor(() => panelValue(panel, "!document.getElementById('chat-input').disabled"), 3000);
        if (!usable) throw new Error(`composer stuck at monkey step ${step}`);
        trace.ok = true;
        if ((step + 1) % 20 === 0) console.log(`MONKEY ${step + 1}/${MONKEY_STEPS} recovered`);
      }
      await mcp.call('tab_close', { tabId: monkeyTab });
      await mcp.call('say', { text: '随机测试已完成。' });
      check('monkey_all_steps_recover', monkeyTrace.length === MONKEY_STEPS && monkeyTrace.every((step) => step.ok), `seed=${MONKEY_SEED}, steps=${MONKEY_STEPS}`);
    }

    // Remembered trust alone must show the connection prompt. A new live MCP
    // with the same identity restores chat without another authorization step.
    if (panel) {
      await mcp.call('say', { text: '重连测试前的操作已完成。' });
      await waitFor(() => panelValue(panel, "!document.getElementById('chat-input').disabled"), 3000, 80);
      await panel.send('Runtime.evaluate', {
        expression: "document.getElementById('chat-input').value = '重连后保留的草稿';document.getElementById('chat-input').dispatchEvent(new Event('input'))",
      });
      await new Promise((resolve) => { mcp.child.once('exit', resolve); mcp.stop(); });
      const offlineView = await waitFor(async () => {
        const r = await panel.send('Runtime.evaluate', {
          expression: "!document.getElementById('state-unpaired').hidden && document.getElementById('state-paired').hidden && document.getElementById('connection-note').textContent.includes('已记住')",
          returnByValue: true,
        });
        return r.result?.result?.value === true;
      }, 8000, 150);
      check('offline_paired_client_shows_connection_prompt', offlineView);
      await savePanelShot(panel, 'panel-offline-400w.png');
      const offlineSend = await panel.send('Runtime.evaluate', {
        expression: "chrome.runtime.sendMessage({type:'AGENTLIMB_CHAT_SEND',text:'offline attempt'})",
        awaitPromise: true, returnByValue: true,
      });
      check('offline_backend_rejects_send', offlineSend.result?.result?.value?.ok === false);

      mcp = new McpClient(HOME);
      await mcp.request('initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'WorkBuddy AI', version: '1.0.0' },
      });
      mcp.notify('notifications/initialized');
      const resumed = await waitFor(async () => {
        const r = await panel.send('Runtime.evaluate', {
          expression: "!document.getElementById('state-paired').hidden && !document.getElementById('chat-input').disabled",
          returnByValue: true,
        });
        return r.result?.result?.value === true;
      }, 20000, 200);
      check('reconnected_mcp_restores_chat', resumed);
      const newPairing = (await listTargets()).some((t) => t.type === 'page' && t.url.includes('pairing.html?'));
      check('reconnect_needs_no_confirmation_page', !newPairing);
      const draft = await panel.send('Runtime.evaluate', {
        expression: "document.getElementById('chat-input').value", returnByValue: true,
      });
      check('connection_change_preserves_draft', draft.result?.result?.value === '重连后保留的草稿');
      const resumedPing = payload(await mcp.call('ping'));
      check('reconnected_browser_control_works', resumedPing.json?.pong === true);
    }

    // A genuinely different AI must not inherit the previous client's trust.
    if (panel) {
      const originalClient = mcp;
      mcp = new McpClient(HOME, { AGENTLIMB_CLIENT_NAME: 'Fresh AI', AGENTLIMB_CLIENT_KIND: 'fresh-ai' });
      await mcp.request('initialize', {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Fresh AI', version: '1' },
      });
      mcp.notify('notifications/initialized');
      const freshPort = Number(mcp.stderr.match(/bridge on 127\.0\.0\.1:(\d+)/)?.[1]);
      const waiting = await waitFor(async () => {
        const h = await fetchJson(`http://127.0.0.1:${freshPort}/health`);
        return h?.client?.name === 'Fresh AI' && h.browsers > 0 ? h : null;
      }, 20000);
      check('different_ai_requires_its_own_authorization', waiting?.paired === false
        && waiting?.activeBrowser === false && waiting?.stage === 'awaiting_authorization');
      // 关键：没有确认页。未授权只回一句可执行提示，页面数不增加。
      const pagesBefore = (await listTargets()).filter((t) => t.type === 'page').length;
      await sleep(1200);
      check('no_confirmation_page_for_new_ai',
        (await listTargets()).filter((t) => t.type === 'page').length === pagesBefore);
      const denied = payload(await mcp.call('ping'));
      check('unauthorized_ai_gets_actionable_error',
        /not authorized/i.test(denied.text) && /copy-prompt/i.test(denied.text));
      // 用户点一次复制：已经连着的 AI 立刻受信，不用重启、不用改配置。
      await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_COPY_PROMPT'})");
      check('copy_grants_the_waiting_ai', payload(await mcp.call('ping')).json?.pong === true);
      const tabs = payload(await mcp.call('tabs_context'));
      check('new_ai_browser_tabs', Array.isArray(tabs.json?.tabs) && tabs.json.tabs.length > 0);
      await mcp.call('say', { text: '新客户端独立授权验证完成。' });

      const peers = [originalClient, mcp];
      for (let index = 3; index <= 5; index++) {
        // 每个新客户端一次复制：一次授权只够一个 AI 接入。
        await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_COPY_PROMPT'})");
        const peer = new McpClient(HOME, { AGENTLIMB_CLIENT_NAME: `AI ${index}`, AGENTLIMB_CLIENT_KIND: `multi-${index}` });
        peers.push(peer);
        await peer.request('initialize', { clientInfo: { name: `AI ${index}`, version: '1' } });
        peer.notify('notifications/initialized');
        check(`client_${index}_automatic_browser_ping`, payload(await peer.call('ping')).json?.pong === true);
        await peer.call('tabs_context');
        await peer.call('say', { text: `AI ${index} 已连接。` });
      }
      const allOnline = await waitFor(async () => {
        const state = await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_GET_STATUS'})");
        return state.clients?.filter((c) => c.paired && c.online).length === 5 ? state : null;
      }, 15000);
      check('five_clients_keep_trust_and_stay_online', !!allOnline);
      if (allOnline) {
        await panelValue(panel, "document.getElementById('chat-input').value='AI 5 独立草稿';document.getElementById('chat-input').dispatchEvent(new Event('input'));document.getElementById('client-chips').click()");
        check('manager_lists_five_ai', await panelValue(panel, "document.querySelectorAll('.client-row').length === 5"));
        await savePanelShot(panel, 'manager-five-ai-400w.png');
        const firstId = allOnline.clients.find((c) => c.name === 'WorkBuddy AI')?.id;
        await panelValue(panel, `document.querySelector('[data-client-id="${firstId}"] [data-action="select"]').click()`);
        const pickedState = await waitFor(async () => { const state = await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_GET_STATUS'})"); return state.connectedClientId === firstId ? state : null; });
        const pick = { ok: !!pickedState };
        check('manager_switches_back_without_repair', pick.ok === true && payload(await originalClient.call('ping')).json?.pong === true);
        await panelValue(panel, "document.getElementById('btn-settings-back').click()");
        check('switching_ai_does_not_leak_other_draft', await panelValue(panel, "document.getElementById('chat-input').value !== 'AI 5 独立草稿'"));
        await originalClient.call('read_page', { tabId: (payload(await originalClient.call('tabs_context')).json.tabs.find((tab) => tab.url.startsWith('http:')))?.id });
        const selectedBefore = (await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_GET_STATUS'})")).connectedClientId;
        const otherId = allOnline.clients.find((c) => c.name === 'AI 5')?.id;
        const blocked = await panelValue(panel, `chrome.runtime.sendMessage({type:'AGENTLIMB_SELECT_CLIENT',clientId:${JSON.stringify(otherId)}})`);
        check('manager_does_not_interrupt_busy_controller', blocked.ok === false && selectedBefore === firstId);
        const pendingCall = peers[4].call('tabs_context');
        await sleep(500);
        const queuedState = await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_GET_STATUS'})");
        check('other_ai_waits_for_current_task', queuedState.clients.find((c) => c.id === otherId)?.waiting === true && queuedState.connectedClientId === firstId);
        await originalClient.call('say', { text: 'WorkBuddy 任务已完成，可以交接。' });
        check('waiting_ai_runs_after_handoff', !payload(await pendingCall).isError);
        await peers[4].call('say', { text: '交接后任务完成。' });
        check('returning_to_ai_restores_its_draft', !!await waitFor(() => panelValue(panel, "document.getElementById('chat-input').value === 'AI 5 独立草稿'"), 5000));
        // Remove only one peer; the other four must retain authorization.
        const removable = allOnline.clients.find((c) => c.name === 'AI 3')?.id;
        await panelValue(panel, `chrome.runtime.sendMessage({type:'AGENTLIMB_DISCONNECT_CLIENT',clientId:${JSON.stringify(removable)}})`);
        const afterRemoval = await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_GET_STATUS'})");
        check('removing_one_ai_preserves_other_four', afterRemoval.clients.filter((c) => c.paired).length === 4);
        // Close the other peers before exercising the original single-client disconnect check.
        for (const peer of peers.slice(0, 4)) await new Promise((resolve) => { peer.child.once('exit', resolve); peer.stop(); });
        mcp = peers[4];
      }
    }

    // ── 11. 断开：一条明文给 AI，侧栏回到未配对 ─────────────────────────────
    if (panel) {
      await panelValue(panel, "chrome.runtime.sendMessage({type:'AGENTLIMB_GET_STATUS'}).then(s=>chrome.runtime.sendMessage({type:'AGENTLIMB_DISCONNECT_CLIENT',clientId:s.connectedClientId}))");
      const backToUnpaired = await waitFor(async () => {
        const r = await panel.send('Runtime.evaluate', {
          expression: "!document.getElementById('state-unpaired').hidden",
          returnByValue: true,
        });
        return r.result?.result?.value === true;
      }, 8000, 300);
      check('disconnect_returns_to_unpaired', backToUnpaired, backToUnpaired ? '侧栏回到复制提示词' : '还停在聊天态');

      // UI returns immediately; the host notification arrives asynchronously.
      const revokedNote = await waitFor(() => mcp.notifications.find(
        (n) => /断开连接/.test(String(n.params?.data || '')),
      ), 5000, 100);
      check('disconnect_tells_agent', !!revokedNote, revokedNote ? '宿主收到断开通知' : '宿主没收到');
      panel.close();
    }
    bs.close();
    site.close();
  } finally {
    mcp.stop();
    const failed = results.filter((r) => !r.ok);
    writeFileSync(join(WORK, 'summary.json'), JSON.stringify({ results, publicSite, stderr: mcp.stderr }, null, 2));
    console.log(`\n${results.length - failed.length}/${results.length} passed — ${WORK}/summary.json`);
    if (failed.length) console.log(`FAILED: ${failed.map((f) => f.name).join(', ')}`);
  }
}

async function cleanup() {
  for (const child of hosts) if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
  if (!KEEP && ownedChrome) {
    try { process.kill(-ownedChrome.pid, 'SIGTERM'); } catch { /* already exited */ }
  }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && ([...hosts].some((child) => child.exitCode == null && child.signalCode == null)
    || (!KEEP && ownedChrome && ownedChrome.exitCode == null && ownedChrome.signalCode == null))) await sleep(100);
  for (const child of hosts) if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
  if (!KEEP && ownedChrome?.exitCode == null && ownedChrome?.signalCode == null) {
    try { process.kill(-ownedChrome.pid, 'SIGKILL'); } catch { /* already exited */ }
  }
  ownedSite?.close();
  if (chromeLog != null) closeSync(chromeLog);
  if (!KEEP) {
    for (const path of [HOME, PROFILE, EXT, join(WORK, 'mcp-config.json')]) rmSync(path, { recursive: true, force: true });
    check('clean_room_removed_install_pairings_and_browser_data', [HOME, PROFILE, EXT].every((path) => !existsSync(path)));
  }
}

try {
  await main();
} catch (error) {
  check('fatal', false, error.stack || error.message);
} finally {
  await cleanup();
  writeFileSync(join(WORK, 'summary.json'), JSON.stringify({ results, publicSite, cleanRoom: WORK, kept: KEEP, monkey: MONKEY ? { seed: MONKEY_SEED, trace: monkeyTrace } : null }, null, 2));
  console.log(`Final: ${results.filter((r) => r.ok).length}/${results.length} passed — ${WORK}/summary.json`);
}
process.exit(results.some((r) => !r.ok) ? 1 : 0);
