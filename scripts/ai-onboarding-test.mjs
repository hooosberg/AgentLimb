#!/usr/bin/env node
/** Run a real czen model from a clean installation. No user MCP/browser state is reused. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../kernel/shared/constants.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'agentlimb-ai-'));
const home = join(work, 'home');
const source = join(work, 'extension');
const profile = join(work, 'chrome-profile');
const configFile = join(work, 'mcp.json');
const model = process.env.AGENTLIMB_TEST_MODEL || 'hy3';
const czen = process.env.CZEN_PATH || join(homedir(), 'bin/czen');
const chrome = process.env.CHROME_PATH || join(homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const identity = { name: `Czen ${model}`, kind: 'czen-clean-test' };
const results = [];
const children = new Set();
let browser;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  if (browser) { try { process.kill(-browser.pid, 'SIGTERM'); } catch {} }
  // Main promise settles from the terminated child and its finally block cleans directories.
});
let site;
let cdpBase;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
  if (!ok) throw new Error(`${name}: ${detail}`);
}
async function waitFor(fn, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await sleep(200); }
  return null;
}
async function json(url) { try { return await (await fetch(url, { signal: AbortSignal.timeout(1000) })).json(); } catch { return null; } }
async function ports() {
  const servers = [createServer(), createServer()];
  try {
    for (const s of servers) await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
    return servers.map((s) => s.address().port);
  } finally { for (const s of servers) await new Promise((resolve) => s.close(resolve)); }
}
async function cdp(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const next = ++id;
      const timer = setTimeout(() => { pending.delete(next); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(next, (result) => { clearTimeout(timer); resolve(result); });
      ws.send(JSON.stringify({ id: next, method, params }));
    }),
    close: () => ws.close(),
  };
}
function runAgent(stage, prompt, mcpConfig, tools, allowed) {
  const env = {
    ...process.env, HOME: home, USERPROFILE: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    ZEN_GATE_HOME: process.env.ZEN_GATE_HOME || join(homedir(), 'Library/Application Support/zen-gate'),
  };
  delete env.CLAUDECODE;
  const child = spawn(czen, [model, '--bare', '-p', prompt, '--output-format', 'stream-json', '--verbose',
    '--strict-mcp-config', '--mcp-config', mcpConfig, '--tools', tools, '--allowedTools', allowed,
    '--no-session-persistence', '--max-turns', '24',
    '--append-system-prompt', `This is an authorized isolated software test. Only read/write/execute within ${work}. Do not access real user configuration, browser profiles or credentials. Do not use subagents. The user Copy action grants this test connection; never click an approval UI yourself.`,
  ], { cwd: source, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.add(child);
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => {
    const value = String(chunk); stdout += value;
    for (const line of value.split('\n')) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'assistant') for (const c of event.message?.content || []) {
          if (c.type === 'tool_use') console.log(`[${stage}] tool ${c.name}`);
          if (c.type === 'text') console.log(`[${stage}] ${c.text.slice(0, 250)}`);
        }
      } catch { /* banners and partial lines retained in log */ }
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} reject(new Error(`${stage} agent exceeded 5 minutes`)); }, 300000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      writeFileSync(join(work, `${stage}.jsonl`), stdout);
      writeFileSync(join(work, `${stage}.stderr.log`), stderr);
      resolve({ code, stdout, stderr });
    });
  });
}

try {
  mkdirSync(home);
  cpSync(root, source, { recursive: true, filter: (src) => !/\/(\.git|忽略上传|node_modules|\.tmp-test)(\/|$)/.test(src) });
  const [debugPort, bridgePort] = await ports();
  cdpBase = `http://127.0.0.1:${debugPort}`;
  const constants = join(source, 'kernel/shared/constants.js');
  writeFileSync(constants, readFileSync(constants, 'utf8').replace(/export const BRIDGE_PORTS = \[[^\]]+\];/, `export const BRIDGE_PORTS = [${bridgePort}];`));
  check('blank_install_and_client_state', !existsSync(join(home, '.agentlimb')) && !existsSync(join(home, '.claude')) && !existsSync(profile));
  console.log(`Model: ${model}; evidence: ${work}`);
  site = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end('<!doctype html><title>AgentLimb AI 验收</title><button id="increment" onclick="document.getElementById(\'count\').textContent=Number(document.getElementById(\'count\').textContent)+1">点我加一</button><span id="count">0</span><label>测试输入<input id="name"></label>');
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${site.address().port}/`;
  browser = spawn(chrome, [`--user-data-dir=${profile}`, `--load-extension=${source}`, `--remote-debugging-port=${debugPort}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu', url], { detached: true, stdio: 'ignore' });
  check('fresh_browser_started', !!await waitFor(() => json(`${cdpBase}/json/version`)));
  const worker = await waitFor(async () => ((await json(`${cdpBase}/json/list`)) || []).find((t) => t.type === 'service_worker' && t.url.includes('service-worker.js')));
  check('extension_worker_ready', !!worker);
  const extensionId = worker.url.match(/chrome-extension:\/\/([a-z]+)\//)[1];
  const workerSession = await cdp(worker.webSocketDebuggerUrl);
  const created = await workerSession.send('Target.createTarget', { url: `chrome-extension://${extensionId}/ui/sidepanel/sidepanel.html` });
  workerSession.close();
  const panelTarget = await waitFor(async () => ((await json(`${cdpBase}/json/list`)) || []).find((t) => t.id === created.result?.targetId));
  check('copy_panel_ready', !!panelTarget);
  const panel = await cdp(panelTarget.webSocketDebuggerUrl);
  let prompt;
  try {
    const ready = await waitFor(async () => {
      // Read the version from the manifest rather than from the DOM: the hero
      // screen was simplified and no longer shows it, and the About page is not
      // mounted while the panel is on its first screen.
      const r = await panel.send('Runtime.evaluate', { expression: `!!document.getElementById('btn-copy-prompt') && chrome.runtime.getManifest().version === '${APP_VERSION}'`, returnByValue: true });
      return r.result?.result?.value;
    });
    check('visible_new_version', ready);
    await panel.send('Runtime.evaluate', { expression: `Object.defineProperty(navigator.clipboard, 'writeText', { configurable:true, value: async (text) => { window.__testPrompt = text; } }); document.getElementById('btn-copy-prompt').click();` });
    prompt = await waitFor(async () => (await panel.send('Runtime.evaluate', { expression: 'window.__testPrompt', returnByValue: true })).result?.result?.value);
    check('real_copy_button_generated_prompt', !!prompt && prompt.includes('Extension ID:'));
    const shot = await panel.send('Page.captureScreenshot', { format: 'png' });
    if (shot.result?.data) writeFileSync(join(work, 'copy-guidance.png'), Buffer.from(shot.result.data, 'base64'));
  } finally { panel.close(); }
  writeFileSync(join(work, 'connection-prompt.md'), prompt);
  const setup = await runAgent('setup', `${prompt}\n\n本轮是从零安装实测。当前软件是 czen / Claude Code，身份名称固定为 ${identity.name}，kind 为 ${identity.kind}。你的 HOME 是 ${home}，可信源码/插件目录是当前目录 ${source}。只使用本目录安装器来安装。此终端客户端支持 --mcp-config 文件；请把可加载的 MCP JSON 写到 ${configFile}，保留所有文件在测试目录内。当前对话无法动态加载新工具，完成安装、配置文件检查后返回 SETUP_READY，下一轮新对话会加载该文件；本轮不要另起 MCP，不要要求真实用户重启或点浏览器。使用已提供的安装器即可，不必通读实现；配置并校验完成后只输出 SETUP_READY。`, '{"mcpServers":{}}', 'Read,Write,Bash', 'Read,Write,Bash');
  check('real_ai_setup_exited', setup.code === 0, `exit=${setup.code}`);
  check('real_ai_created_config', existsSync(configFile));
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const entry = config.mcpServers?.agentlimb;
  check('real_ai_config_paths_and_identity', entry?.command === process.execPath && entry?.args?.[0] === join(home, '.agentlimb/host/mcp-server.mjs')
    && existsSync(entry.args[0]) && entry.env?.AGENTLIMB_CLIENT_NAME === identity.name && entry.env?.AGENTLIMB_CLIENT_KIND === identity.kind);
  // 授权在浏览器侧（点复制时打开的窗口），所以配置里不能出现任何密钥。
  check('config_carries_no_authorization_secret',
    !JSON.stringify(config).includes('PAIRING_TOKEN') && !/pairing-token/.test(prompt));
  check('setup_did_not_preapprove_browser', !existsSync(join(home, '.agentlimb/paired-clients.json')));

  // 没有任何测试代码点「允许」——复制本身就已经授权，流程里不该出现确认页。
  let sawPairingPopup = false;
  let sawConnectedGuidance = false;
  const guidanceWatch = await cdp(panelTarget.webSocketDebuggerUrl);
  let polling = false;
  const watcher = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      if (((await json(`${cdpBase}/json/list`)) || []).some((target) => target.url.includes('pairing.html?'))) sawPairingPopup = true;
      if (!sawConnectedGuidance) {
        const r = await guidanceWatch.send('Runtime.evaluate', { expression: `({online:!!document.getElementById('state-paired') && !document.getElementById('state-paired').hidden,text:document.body?.innerText || ''})`, returnByValue: true });
        const state = r.result?.result?.value;
        if (state?.online && /已连接|配对成功/.test(state.text) && /总结当前网页|直接发送任务|直接发任务/.test(state.text)) {
          const shot = await guidanceWatch.send('Page.captureScreenshot', { format: 'png' });
          if (shot.result?.data) writeFileSync(join(work, 'connected-guidance.png'), Buffer.from(shot.result.data, 'base64'));
          sawConnectedGuidance = true;
        }
      }
    } catch { /* page context may be changing; next observation retries */ }
    finally { polling = false; }
  }, 250);
  const verify = await runAgent('verify', `现在新的对话已经加载你刚配置的 AgentLimb MCP。仅用 MCP 工具验证：1 调用 AgentLimb ping，本轮已在复制时授权，应该自动配对，不要请用户点任何确认。2 tabs_context 找到 ${url}。3 read_page/find 找“点我加一”，computer 点击一次。4 form_input 把 #name 填成 AI_FROM_ZERO_OK。5 用 say 明确告诉用户配对成功，可以直接发任务，随后在当前AI对话也明确告诉用户这一点；只有真实工具成功才报告 CONNECTED_OK。如果没有工具或报错，原样报告，禁止伪造成功。`, configFile, '', 'mcp__agentlimb__*');
  clearInterval(watcher);
  while (polling) await sleep(50);
  guidanceWatch.close();
  check('automatic_pairing_needed_no_confirmation_popup', !sawPairingPopup);
  check('real_ai_verification_exited', verify.code === 0, `exit=${verify.code}`);
  const targets = (await json(`${cdpBase}/json/list`)) || [];
  const page = targets.find((t) => t.type === 'page' && t.url === url);
  check('local_acceptance_page_exists', !!page);
  const session = await cdp(page.webSocketDebuggerUrl);
  try {
    const state = await session.send('Runtime.evaluate', { expression: '({count:document.getElementById("count").textContent,name:document.getElementById("name").value})', returnByValue: true });
    check('independent_browser_readback', state.result?.result?.value?.count === '1' && state.result?.result?.value?.name === 'AI_FROM_ZERO_OK', JSON.stringify(state.result?.result?.value));
    const shot = await session.send('Page.captureScreenshot', { format: 'png' });
    if (shot.result?.data) writeFileSync(join(work, 'acceptance.png'), Buffer.from(shot.result.data, 'base64'));
  } finally { session.close(); }
  check('sidebar_shows_success_and_next_action_while_connected', sawConnectedGuidance);
  check('real_ai_used_ping_and_tabs', verify.stdout.includes('mcp__agentlimb__ping') && verify.stdout.includes('mcp__agentlimb__tabs_context'));

  // ── 网站记忆：安装即带目录 → 真模型写一次 → 新会话读回来 ────────────────
  // 这一段是「越用越快」的唯一可信证明：不是模型自称记住了，而是磁盘上有
  // 文件，且一个全新的会话能把它读出来。
  const memoryRoot = join(home, '.agentlimb/memory');
  check('site_memory_seeded_by_install', existsSync(join(memoryRoot, '.agentlimb-kb')));

  const memoryStage = await runAgent('memory', `现在测试「网站记忆」。你刚刚操作过 ${url}（域名 127.0.0.1）。只调用 site_memory，不要操作浏览器：
1) {action:"brief", site:"127.0.0.1"} —— 此时应为 NO_PLAYBOOK。
2) {action:"record", site:"127.0.0.1", status:"success", title:"AgentLimb 验收页", entry:"${url}", steps:"1) 打开页面 2) 点 #increment 按钮 3) 在 #name 输入框填值", selectors:"#increment → button#increment → 页面唯一的按钮；#name → label 内的 input", pitfalls:"无", note:"计数从 0 变 1 且 #name 的值等于输入值"}
3) 再次 {action:"brief", site:"127.0.0.1"} —— 此时应能读到第 2 步写的内容。
完成后用 say 汇报 MEMORY_OK。不要编造，工具报错就原样报告。`, configFile, '', 'mcp__agentlimb__*');
  check('real_ai_memory_stage_exited', memoryStage.code === 0, `exit=${memoryStage.code}`);
  check('real_ai_called_site_memory', memoryStage.stdout.includes('mcp__agentlimb__site_memory'));
  const playbookFile = join(memoryRoot, 'knowledge/sites/127.0.0.1/PLAYBOOK.md');
  check('playbook_written_to_disk', existsSync(playbookFile));
  const playbook = existsSync(playbookFile) ? readFileSync(playbookFile, 'utf8') : '';
  check('playbook_records_entry_and_selector', playbook.includes(url) && /#increment/.test(playbook));
  check('playbook_status_verified', /status: verified/.test(playbook));
  check('playbook_stores_no_secrets', !/(password|passwd|cookie|authorization|bearer)/i.test(playbook));
  check('run_logged_as_one_small_file', existsSync(join(memoryRoot, 'knowledge/sites/127.0.0.1/sessions')));

  // 全新会话：这就是"下次不用摸索"。
  const reuse = await runAgent('memory-reuse', `这是一个全新的对话，没有任何上一轮的上下文。只调用一次 site_memory {action:"brief", site:"127.0.0.1"}，然后把工具返回的入口 URL 原样复述。不要操作浏览器，不要凭印象编造；如果工具返回 NO_PLAYBOOK 就照实说。`, configFile, '', 'mcp__agentlimb__*');
  check('new_session_reads_the_playbook', reuse.stdout.includes('PLAYBOOK: 127.0.0.1'), 'a fresh session must get the record back');
  check('new_session_gets_the_direct_entry', reuse.stdout.includes(url));
  check('no_playbook_leftover_for_other_sites', !existsSync(join(memoryRoot, 'knowledge/sites/example.com')));
} catch (error) {
  console.error(error.stack || error.message);
  results.push({ name: 'fatal', ok: false, detail: error.message });
} finally {
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  if (browser) { try { process.kill(-browser.pid, 'SIGTERM'); } catch {} }
  await sleep(800);
  if (browser) { try { process.kill(-browser.pid, 'SIGKILL'); } catch {} }
  site?.close();
  // Best-effort: a locked profile or a sandboxed filesystem must not turn a
  // finished run into a crash before the summary is written.
  // AGENTLIMB_TEST_KEEP=1 keeps the evidence folder (and skips the cleanup
  // check) for environments where recursive deletes are blocked.
  const keep = process.env.AGENTLIMB_TEST_KEEP === '1';
  if (!keep) {
    for (const path of [home, profile, source, configFile]) {
      try { rmSync(path, { recursive: true, force: true }); } catch { /* left for manual cleanup */ }
    }
    results.push({ name: 'cleaned_install_client_and_browser_state', ok: [home, profile, source, configFile].every((p) => !existsSync(p)) });
  } else {
    results.push({ name: 'cleanup_skipped_AGENTLIMB_TEST_KEEP', ok: true, detail: work });
  }
  writeFileSync(join(work, 'summary.json'), JSON.stringify({ model, results }, null, 2));
  console.log(`Final ${results.filter((r) => r.ok).length}/${results.length}; ${work}/summary.json`);
}
process.exit(results.some((r) => !r.ok) ? 1 : 0);
