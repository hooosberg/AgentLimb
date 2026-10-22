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
 * 产物：/tmp/agentlimb-verify/live/{summary.json,shots/*.png}
 */

import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, cpSync, rmSync, openSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORK = '/tmp/agentlimb-verify/live';
const EXT = '/tmp/agentlimb-ext';
const HOME = join(WORK, 'home');
const PROFILE = join(WORK, 'profile');
const SHOTS = join(WORK, 'shots');
const CDP_PORT = 9337;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const NODE = process.execPath;
const KEEP = process.argv.includes('--keep');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
].filter(Boolean);

const results = [];
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
<div style="height:1600px"></div>
<button id="deep" onclick="document.getElementById('deep-out').textContent='deep-clicked'">折叠线以下的按钮</button>
<p id="deep-out"></p>
</body></html>`;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
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

// ── 真的 MCP 客户端（和 AI 软件同一条路径） ─────────────────────────────────
class McpClient {
  constructor(home) {
    this.pending = new Map();
    this.notifications = [];
    this.stderr = '';
    this.nextId = 1;
    this.child = spawn(NODE, [join(ROOT, 'bin', 'agentlimb.mjs'), 'mcp'], {
      env: { ...process.env, HOME: home, AGENTLIMB_CLIENT_KIND: 'livetest' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
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
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { text, images, json, isError: !!res?.result?.isError };
};

// ── 环境准备 ─────────────────────────────────────────────────────────────────
function preflight() {
  // 上一轮泄漏的浏览器/宿主会让本轮连到旧桥接上，先清干净。
  try { execSync(`pkill -f "${PROFILE}" || true`, { stdio: 'ignore' }); } catch { /* none */ }
  try { execSync('pkill -f "agentlimb-ext" || true', { stdio: 'ignore' }); } catch { /* none */ }
  rmSync(PROFILE, { recursive: true, force: true });
  rmSync(EXT, { recursive: true, force: true });
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(HOME, { recursive: true });
  cpSync(ROOT, EXT, {
    recursive: true,
    filter: (src) => !src.includes('/.git') && !src.includes('/.workbuddy-ai') && !src.includes('/忽略上传'),
  });
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
  preflight();
  const chromePath = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!chromePath) throw new Error('找不到 Chrome for Testing，请设置 CHROME_PATH');
  console.log(`chrome: ${chromePath}`);

  const site = await startTestServer();
  console.log(`test page: ${site.url}`);

  const mcp = new McpClient(HOME);
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

  const chrome = spawn(chromePath, [
    `--user-data-dir=${PROFILE}`,
    `--load-extension=${EXT}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1280,900',
    site.url,
  ], { detached: true, stdio: ['ignore', 'ignore', openSync(join(WORK, 'chrome.log'), 'w')] });
  chrome.unref();

  try {
    const sw = await waitForSw();
    check('extension_loaded', !!sw, sw ? 'service worker 已注册' : 'SW 未出现');
    if (!sw) throw new Error('扩展没装上');
    const extId = sw.url.match(/chrome-extension:\/\/([a-z]+)\//)[1];

    const health = await waitFor(async () => {
      const h = await fetchJson(`http://127.0.0.1:${port}/health`);
      return h?.browsers >= 1 ? h : null;
    }, 30000);
    check('extension_connected', !!health, `browsers=${health?.browsers ?? 0}`);

    // ── 配对（和用户一样：点「允许连接」） ──────────────────────────────────
    const pairing = await waitFor(async () =>
      (await listTargets()).find((t) => t.type === 'page' && t.url.includes('pairing.html')), 20000);
    check('pairing_tab_opened', !!pairing);
    if (pairing) {
      const ps = await cdp(pairing.webSocketDebuggerUrl);
      await ps.send('Runtime.enable');
      await sleep(600);
      await ps.send('Runtime.evaluate', { expression: "document.getElementById('btn-allow')?.click()" });
      ps.close();
    }
    const paired = await waitFor(async () => {
      const h = await fetchJson(`http://127.0.0.1:${port}/health`);
      return h?.paired ? h : null;
    }, 15000);
    check('paired', !!paired);

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

    if (panel) {
      // 十几步操作应该折叠成一行，不能把聊天刷没
      const groups = await panel.send('Runtime.evaluate', {
        expression: "document.querySelectorAll('.msg.activity').length",
        returnByValue: true,
      });
      const groupCount = groups.result?.result?.value;
      check('activity_collapsed', groupCount === 1, `${groupCount} 行操作记录`);

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
          expression: "document.querySelectorAll('.msg.thinking, .msg.pending-hint').length",
          returnByValue: true,
        });
        return (r.result?.result?.value || 0) > 0;
      }, 4000, 150);
      check('panel_thinking_bubble', sawThinking, sawThinking ? '发送后出现进度气泡' : '没出现');
    }

    const chatNote = await waitFor(() =>
      mcp.notifications.find((n) => n.params?.logger === 'agentlimb-chat') || null, 15000);
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

      const shotPanel = await panel.send('Page.captureScreenshot', { format: 'png' });
      if (shotPanel.result?.data) {
        writeFileSync(join(SHOTS, 'panel-chat.png'), Buffer.from(shotPanel.result.data, 'base64'));
      }
      // 侧栏真实宽度只有 ~400px，按这个宽度再存一张，方便看真实排版
      await panel.send('Emulation.setDeviceMetricsOverride', {
        width: 400, height: 860, deviceScaleFactor: 2, mobile: false,
      });
      await sleep(300);
      const narrow = await panel.send('Page.captureScreenshot', { format: 'png' });
      if (narrow.result?.data) {
        writeFileSync(join(SHOTS, 'panel-chat-400w.png'), Buffer.from(narrow.result.data, 'base64'));
      }
      await panel.send('Emulation.clearDeviceMetricsOverride');
    }

    // ── 10. 不可读页面：读不到就要明说，不能装作空白页 ─────────────────────
    // 用扩展页当「当前标签」（chrome:// 的 WebUI 在 --no-sandbox 的测试环境里
    // 会把测试进程带走；人工验证过 chrome://extensions 走的是同一条分支）。
    // 全程只用 MCP 工具，和真实 agent 的做法一致。
    if (panel) {
      const before = mcp.notifications.length;
      const restrictedTab = payload(await mcp.call('tab_new', {
        url: `chrome-extension://${extId}/ui/pairing/pairing.html`,
      }));
      const restrictedId = restrictedTab.json?.tab?.id;
      if (restrictedId) await mcp.call('tab_activate', { tabId: restrictedId });
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

    // ── 11. 断开：一条明文给 AI，侧栏回到未配对 ─────────────────────────────
    if (panel) {
      await panel.send('Runtime.evaluate', { expression: "document.getElementById('btn-disconnect').click()" });
      const backToUnpaired = await waitFor(async () => {
        const r = await panel.send('Runtime.evaluate', {
          expression: "!document.getElementById('state-unpaired').hidden",
          returnByValue: true,
        });
        return r.result?.result?.value === true;
      }, 8000, 300);
      check('disconnect_returns_to_unpaired', backToUnpaired, backToUnpaired ? '侧栏回到复制提示词' : '还停在聊天态');

      const revokedNote = mcp.notifications.find(
        (n) => /断开连接/.test(String(n.params?.data || '')),
      );
      check('disconnect_tells_agent', !!revokedNote, revokedNote ? '宿主收到断开通知' : '宿主没收到');
      panel.close();
    }
    bs.close();
    site.close();
  } finally {
    if (!KEEP) {
      try { process.kill(-chrome.pid, 'SIGTERM'); } catch { /* ignore */ }
      await sleep(500);
      try { execSync(`pkill -f "${PROFILE}" || true`, { stdio: 'ignore' }); } catch { /* ignore */ }
    }
    mcp.stop();
    const failed = results.filter((r) => !r.ok);
    writeFileSync(join(WORK, 'summary.json'), JSON.stringify({ results, stderr: mcp.stderr }, null, 2));
    console.log(`\n${results.length - failed.length}/${results.length} passed — ${WORK}/summary.json`);
    if (failed.length) console.log(`FAILED: ${failed.map((f) => f.name).join(', ')}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\nFATAL: ${error.message}`);
    writeFileSync(join(WORK, 'summary.json'), JSON.stringify({ results, error: error.message }, null, 2));
    process.exit(1);
  });
