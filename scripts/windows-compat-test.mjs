#!/usr/bin/env node
/**
 * AgentLimb Windows 兼容性实测（可在 Windows 本机、也可在 CI 的 windows-latest 上跑）
 *
 *   node scripts/windows-compat-test.mjs env       # 系统 / 浏览器 / Node 基线
 *   node scripts/windows-compat-test.mjs browsers  # 用 Edge / Chrome 真加载扩展并探测 API
 *   node scripts/windows-compat-test.mjs paths     # 中文+空格路径、install、桥接、端口
 *   node scripts/windows-compat-test.mjs all       # 全部
 *
 * 结论写入 windows-compat-report.json，同时逐条打印 PASS/FAIL。
 *
 * 设计要点：
 * - 不依赖 POSIX 工具（Windows 上只有 powershell / node 可用）。
 * - 扩展加载尝试三条策略：--load-extension（带/不带关掉限制的 feature 开关）、
 *   CDP Extensions.loadUnpacked。哪条通就记哪条，这本身就是课件要写的结论。
 * - 判定"扩展真的起来了"的唯一硬证据：CDP Target 里出现 chrome-extension:// 的 service_worker。
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SUBCOMMAND = process.argv[2] || 'all';
const REPORT_PATH = join(ROOT, `windows-compat-report-${SUBCOMMAND}.json`);
const WORK = mkdtempSync(join(tmpdir(), 'agentlimb-win-'));
const IS_WIN = process.platform === 'win32';
const results = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rec(section, name, ok, detail = '') {
  const row = { section, name, ok: ok === null ? null : Boolean(ok), detail: String(detail).slice(0, 600) };
  results.push(row);
  const tag = row.ok === null ? 'INFO' : row.ok ? 'PASS' : 'FAIL';
  console.log(`${tag}  [${section}] ${name}${detail ? `  — ${row.detail}` : ''}`);
  return row;
}

function flush() {
  writeFileSync(REPORT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    osRelease: process.getSystemVersion?.() || '',
    node: process.versions.node,
    arch: process.arch,
    results,
  }, null, 2));
  const fail = results.filter((r) => r.ok === false).length;
  console.log(`\n报告已写入 ${REPORT_PATH}（${results.length} 条，失败 ${fail} 条）`);
}

// ── PowerShell 小工具（Windows 上唯一可靠的取版本方式） ─────────────────────
function ps(command) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8', timeout: 20000, windowsHide: true,
    }).trim();
  } catch (error) {
    return `__ERR__ ${error.message}`;
  }
}

function fileVersion(exe) {
  if (!exe) return '';
  const out = ps(`try { (Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion } catch { '' }`);
  return out.startsWith('__ERR__') ? '' : out;
}

function browserCandidates() {
  // 允许在非 Windows 上做逻辑自测（CI 之外的本地验证用）
  const override = process.env.AGENTLIMB_BROWSER_OVERRIDE;
  if (override) return [{ label: 'Override', kind: 'override', paths: [override] }];
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  return [
    { label: 'Edge', kind: 'edge', paths: [
      join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ] },
    { label: 'Chrome', kind: 'chrome', paths: [
      join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local ? join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    ].filter(Boolean) },
    { label: 'Chrome for Testing', kind: 'cft', paths: [
      join(pf, 'Chrome for Testing', 'chrome.exe'),
    ] },
  ];
}

// ── CDP ────────────────────────────────────────────────────────────────────
async function fetchJson(url, timeout = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

async function cdp(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); resolve({ __timeout: true }); }, 8000);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, close: () => { try { ws.close(); } catch {} } };
}

async function waitForCdp(port, ms = 25000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const info = await fetchJson(`http://127.0.0.1:${port}/json/version`, 800);
    if (info) return info;
    await sleep(400);
  }
  return null;
}

/** 从 profile 的 Preferences 里读已加载扩展 id（--load-extension 路径下没有返回值可用） */
async function readExtensionIds(profileDir, ms = 12000) {
  const pref = join(profileDir, 'Default', 'Preferences');
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(pref)) {
      try {
        const json = JSON.parse(readFileSync(pref, 'utf8'));
        const settings = json?.extensions?.settings || {};
        const ids = Object.entries(settings)
          .filter(([, v]) => v && v.path && v.state !== 0 && !String(v.path).includes('__MSG'))
          .map(([id, v]) => ({ id, path: v.path, state: v.state }));
        if (ids.length) return ids;
      } catch { /* 文件可能正在写，重试 */ }
    }
    await sleep(500);
  }
  return [];
}

/** 打开扩展自己的页面，在页面上下文里探测 API —— 比等休眠的 SW 更可靠 */
async function probeViaExtensionPage(client, id, port) {
  const pageUrl = `chrome-extension://${id}/ui/sidepanel/sidepanel.html`;
  await client.send('Target.createTarget', { url: pageUrl });
  return probeAnyExtensionTarget(port, id, 12000);
}

/** 从 /json/list 里找到本扩展的 target（SW 或页面），直连它的调试端口做探测 */
async function probeAnyExtensionTarget(port, id, ms = 15000) {
  const deadline = Date.now() + ms;
  let target = null;
  while (Date.now() < deadline) {
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`, 900) || [];
    target = list.find((t) => String(t.url).includes(id)
      && (t.type === 'service_worker' || t.type === 'page' || t.type === 'background_page'));
    if (target?.webSocketDebuggerUrl) break;
    target = null;
    await sleep(500);
  }
  if (!target?.webSocketDebuggerUrl) return { error: '本扩展 target 未出现' };

  const page = await cdp(target.webSocketDebuggerUrl);
  try {
    await page.send('Runtime.enable');
    const expr = `(() => {
      const has = (k) => !!(globalThis.chrome && chrome[k]);
      const out = {
        targetType: ${JSON.stringify(target.type)},
        pageUrl: typeof location !== 'undefined' ? location.href : '',
        title: typeof document !== 'undefined' ? document.title : '',
        manifestVersion: chrome?.runtime?.getManifest?.().manifest_version ?? null,
        extensionVersion: chrome?.runtime?.getManifest?.().version ?? null,
        extensionId: chrome?.runtime?.id ?? null,
        sidePanel: has('sidePanel'),
        sidePanelOpen: typeof chrome?.sidePanel?.open === 'function',
        sidePanelClose: typeof chrome?.sidePanel?.close === 'function',
        debugger: has('debugger'),
        tabGroups: has('tabGroups'),
        scripting: has('scripting'),
        tabs: has('tabs'),
        storage: has('storage'),
        alarms: has('alarms'),
        identity: has('identity'),
        runtimeGetContexts: typeof chrome?.runtime?.getContexts === 'function',
        domNodes: typeof document !== 'undefined' ? document.querySelectorAll('*').length : null,
        userAgent: navigator.userAgent,
      };
      return JSON.stringify(out);
    })()`;
    const res = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    const value = res?.result?.result?.value;
    if (!value) return { error: 'evaluate failed', raw: res };
    try { return JSON.parse(value); } catch { return { error: 'bad json', raw: value }; }
  } finally {
    page.close();
  }
}

/** 在浏览器里找扩展 service worker target，找不到返回 null */
async function findExtensionWorker(client) {
  const res = await client.send('Target.getTargets');
  const targets = res?.result?.targetInfos || [];
  return targets.find((t) => t.type === 'service_worker' && String(t.url).startsWith('chrome-extension://')) || null;
}

async function probeExtensionApis(client, target) {
  const attached = await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sessionId = attached?.result?.sessionId;
  if (!sessionId) return { error: 'attach failed', raw: attached };
  await client.send('Runtime.enable', {}, sessionId);
  const expr = `(() => {
    const has = (k) => !!(globalThis.chrome && chrome[k]);
    const out = {
      manifestVersion: chrome?.runtime?.getManifest?.().manifest_version ?? null,
      extensionVersion: chrome?.runtime?.getManifest?.().version ?? null,
      sidePanel: has('sidePanel'),
      sidePanelOpen: typeof chrome?.sidePanel?.open === 'function',
      sidePanelClose: typeof chrome?.sidePanel?.close === 'function',
      debugger: has('debugger'),
      tabGroups: has('tabGroups'),
      scripting: has('scripting'),
      tabs: has('tabs'),
      storage: has('storage'),
      alarms: has('alarms'),
      identity: has('identity'),
      runtimeGetContexts: typeof chrome?.runtime?.getContexts === 'function',
      userAgent: navigator.userAgent,
    };
    return JSON.stringify(out);
  })()`;
  const res = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
  const value = res?.result?.result?.value;
  if (!value) return { error: 'evaluate failed', raw: res };
  try { return JSON.parse(value); } catch { return { error: 'bad json', raw: value }; }
}

// ── 桥接：起一个真桥接，用 /health 判断扩展是否真的活起来 ──────────────────
function startBridge() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'bin', 'agentlimb.mjs'), 'bridge', '--client-name', 'Windows 自检'], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let buf = '';
    let settled = false;
    const finish = (port) => { if (!settled) { settled = true; resolve({ child, port }); } };
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/running on port (\d+)/i);
      if (m) finish(Number(m[1]));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', () => finish(null));
    setTimeout(() => finish(null), 15000);
  });
}

async function waitForExtensionConnected(port, ms = 40000, baseline = 0) {
  const deadline = Date.now() + ms;
  let last = null;
  while (Date.now() < deadline) {
    const health = await fetchJson(`http://127.0.0.1:${port}/health`, 1000);
    if (health) {
      last = health;
      // /health.connected 指的是"AI 客户端"连接；浏览器连接看 browsers 计数
      if ((health.browsers ?? 0) > baseline) return { connected: true, health };
    }
    await sleep(1000);
  }
  return { connected: false, health: last };
}

// ── 扩展目录（只复制扩展本体，别把 .git / 忽略上传 拖进去） ────────────────
function stageExtension(destDir) {
  mkdirSync(destDir, { recursive: true });
  cpSync(join(ROOT, 'manifest.json'), join(destDir, 'manifest.json'));
  for (const dir of ['kernel', 'ui', 'icons']) {
    cpSync(join(ROOT, dir), join(destDir, dir), { recursive: true });
  }
  return destDir;
}

function reportApis(section, apis) {
  rec(section, 'manifest_version', apis.manifestVersion === 3, `mv=${apis.manifestVersion} v=${apis.extensionVersion} id=${apis.extensionId}`);
  rec(section, 'chrome.sidePanel 存在', apis.sidePanel, '');
  rec(section, 'sidePanel.open()', apis.sidePanelOpen, '（<116 缺失 → 侧栏打不开）');
  rec(section, 'sidePanel.close()', apis.sidePanelClose, '（141+ 才有，缺失仅影响"再按一次关闭"）');
  rec(section, 'chrome.debugger', apis.debugger, '（没有它就没有自动化）');
  rec(section, 'chrome.tabGroups', apis.tabGroups, '');
  rec(section, 'chrome.scripting', apis.scripting, '');
  rec(section, 'chrome.alarms', apis.alarms, '');
  rec(section, 'chrome.identity', apis.identity, '');
  rec(section, 'runtime.getContexts()', apis.runtimeGetContexts, '（116+，已 try/catch 兜底）');
  rec(section, 'UA', null, apis.userAgent);
  const usable = apis.sidePanelOpen && apis.debugger && apis.tabGroups;
  rec(section, '可用结论', usable, usable ? '本浏览器可作为课程推荐载体' : '不满足课程要求');
  return usable;
}

// ── 单浏览器实测：多种加载策略 × 扩展页上下文探测 ──────────────────────────
async function testBrowser(candidate, exe, extDir, tag, bridgePort) {
  const section = `browser:${candidate.label}${tag ? `(${tag})` : ''}`;
  const version = fileVersion(exe);
  rec(section, '可执行文件存在', true, `${exe} | ProductVersion=${version || 'n/a'}`);
  // 起浏览器之前先记下桥接里已有的浏览器数，避免历史残留 profile 造成假阳性
  const baselineHealth = bridgePort ? await fetchJson(`http://127.0.0.1:${bridgePort}/health`, 1000) : null;
  const baseline = baselineHealth?.browsers ?? 0;

  const strategies = [
    { name: 'cdp:Extensions.loadUnpacked', via: 'cdp', headless: true, extra: ['--enable-unsafe-extension-debugging'] },
    { name: 'flag:--load-extension', via: 'flag', headless: true, extra: [`--load-extension=${extDir}`] },
    { name: 'flag:--load-extension(headful)', via: 'flag', headless: false, extra: [`--load-extension=${extDir}`] },
    { name: 'flag:--load-extension+disable-feature', via: 'flag', headless: true, extra: [`--load-extension=${extDir}`, '--disable-features=DisableLoadExtensionCommandLineSwitch'] },
  ];

  for (const strategy of strategies) {
    const port = 9300 + Math.floor(Math.random() * 500);
    const profile = join(WORK, `profile-${candidate.kind}-${port}`);
    mkdirSync(profile, { recursive: true });
    const args = [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      ...(strategy.headless ? ['--headless=new'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-sync',
      ...strategy.extra,
      'about:blank',
    ];
    let child;
    try {
      child = spawn(exe, args, { stdio: 'ignore', windowsHide: true, detached: false });
    } catch (error) {
      rec(section, `启动(${strategy.name})`, false, error.message);
      continue;
    }
    let stderrNote = '';
    child.on('error', (e) => { stderrNote = e.message; });

    const info = await waitForCdp(port, 25000);
    if (!info) {
      rec(section, `启动(${strategy.name})`, false, stderrNote || 'CDP 端口未就绪（安全策略拦截 / 无桌面会话 / headless 不支持扩展）');
      try { child.kill('SIGKILL'); } catch {}
      await sleep(800);
      continue;
    }
    const browserString = info.Browser || '';
    rec(section, `启动(${strategy.name})`, true, browserString);

    const client = await cdp(info.webSocketDebuggerUrl);
    const cleanup = async () => {
      client.close();
      try { child.kill('SIGKILL'); } catch {}
      await sleep(600);
    };
    try {
      let extId = null;
      if (strategy.via === 'cdp') {
        const loaded = await client.send('Extensions.loadUnpacked', { path: extDir });
        if (loaded?.error) {
          rec(section, 'Extensions.loadUnpacked', false, JSON.stringify(loaded.error).slice(0, 300));
        } else {
          extId = loaded?.result?.id || null;
          rec(section, 'Extensions.loadUnpacked', true, extId || '(未返回 id)');
        }
      }
      if (!extId) {
        const norm = (p) => String(p).toLowerCase().replace(/\\/g, '/');
        const ids = await readExtensionIds(profile);
        const mine = ids.find((x) => norm(x.path).startsWith(norm(extDir)));
        extId = mine?.id || null;
        rec(section, '从 profile 读扩展 id', Boolean(extId), extId || `已注册 ${ids.length} 个扩展`);
      }
      if (!extId) {
        await cleanup();
        continue;
      }
      rec(section, '扩展加载成功', true, `id=${extId}（策略 ${strategy.name}）`);

      // 主判据：扩展是否真的连上桥接 —— 这比枚举 API 更接近"能不能用"
      if (bridgePort) {
        const wait = await waitForExtensionConnected(bridgePort, 40000, baseline);
        rec(section, '扩展连上桥接（browsers 增加）', wait.connected,
          wait.connected
            ? `port=${bridgePort} browsers ${baseline}→${wait.health?.browsers}`
            : `40s 内未连上 port=${bridgePort}（baseline=${baseline}，最后 ${JSON.stringify(wait.health || {}).slice(0, 160)}）`);
      }

      // 辅判据：直接在扩展自己的上下文里枚举 chrome API —— "内核门槛"的直接证据
      let apis = await probeAnyExtensionTarget(port, extId, 15000);
      if (apis.error) {
        rec(section, 'SW 内 API 枚举', null, apis.error);
        apis = await probeViaExtensionPage(client, extId, port);
      }
      if (apis.error) {
        rec(section, '扩展上下文 API 探测', null, `headless 下不稳定，跳过：${JSON.stringify(apis).slice(0, 200)}`);
        await cleanup();
        return { browserString, strategy: strategy.name, extId, apis: null };
      }
      if (apis.domNodes != null) {
        rec(section, '扩展页可打开', apis.domNodes > 0, `${apis.pageUrl} | DOM ${apis.domNodes} 节点 | ${apis.title}`);
      }
      const usable = reportApis(section, apis);
      await cleanup();
      return { browserString, strategy: strategy.name, extId, apis, usable };
    } catch (error) {
      rec(section, `异常(${strategy.name})`, false, error.message);
      await cleanup();
    }
  }
  rec(section, '结论', false, '全部加载策略失败');
  return null;
}

// ── env ────────────────────────────────────────────────────────────────────
function runEnv() {
  rec('env', 'platform', IS_WIN, `${process.platform} ${process.arch}`);
  if (IS_WIN) {
    rec('env', 'OS 版本', null, ps('(Get-CimInstance Win32_OperatingSystem).Caption + " build " + (Get-CimInstance Win32_OperatingSystem).BuildNumber'));
    rec('env', '用户名', null, process.env.USERNAME || '');
    rec('env', '用户目录', null, process.env.USERPROFILE || '');
    rec('env', 'Node', true, `${process.version} (${process.execPath})`);
    rec('env', 'PowerShell 执行策略', null, ps('Get-ExecutionPolicy -List | Out-String').slice(0, 300));
    rec('env', '已装浏览器', null, ps(`@('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files\\360ChromeX\\Chrome\\Application\\360ChromeX.exe','C:\\Program Files (x86)\\360\\360Chrome\\Chrome\\Application\\360chrome.exe','C:\\Program Files (x86)\\Tencent\\QQBrowser\\QQBrowser.exe') | ForEach-Object { if (Test-Path $_) { $v=(Get-Item $_).VersionInfo.ProductVersion; "$_ => $v" } } | Out-String`));
  }
}

// ── browsers ───────────────────────────────────────────────────────────────
async function runBrowsers() {
  const extDir = stageExtension(join(WORK, 'ext-plain'));
  rec('browsers', '扩展暂存目录', true, extDir);

  const bridge = await startBridge();
  rec('browsers', '桥接启动', Boolean(bridge.port), bridge.port ? `port=${bridge.port}` : '未拿到端口');

  try {
    for (const candidate of browserCandidates()) {
      const exe = candidate.paths.find((p) => existsSync(p));
      if (!exe) { rec(`browser:${candidate.label}`, '未安装', null, '跳过'); continue; }
      await testBrowser(candidate, exe, extDir, '', bridge.port);
    }

    // 中文 + 空格路径（Windows 用户目录常见）
    if (IS_WIN) {
      const tricky = join(process.env.USERPROFILE || WORK, '测试 目录 空格', 'AgentLimb 插件');
      try {
        rmSync(tricky, { recursive: true, force: true });
        stageExtension(tricky);
        rec('paths', '中文+空格路径可写入', true, tricky);
        const candidate = browserCandidates()[0];
        const exe = candidate.paths.find((p) => existsSync(p));
        if (exe) await testBrowser(candidate, exe, tricky, '中文空格路径', bridge.port);
      } catch (error) {
        rec('paths', '中文+空格路径可写入', false, error.message);
      }
    }
  } finally {
    try { bridge.child.kill('SIGKILL'); } catch {}
  }
}

// ── paths / install / bridge ───────────────────────────────────────────────
async function runInstall() {
  const node = process.execPath;
  const cli = join(ROOT, 'bin', 'agentlimb.mjs');
  let installOut = '';
  try {
    installOut = execFileSync(node, [cli, 'install', '--client-name', 'Windows 自检', '--client-kind', 'generic'], {
      encoding: 'utf8', timeout: 60000, windowsHide: true,
    });
    rec('install', 'agentlimb install', true, installOut.split('\n')[0]);
  } catch (error) {
    rec('install', 'agentlimb install', false, (error.stdout || '') + (error.stderr || '') + error.message);
    flush();
    return;
  }

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const hostFile = join(home, '.agentlimb', 'host', 'mcp-server.mjs');
  rec('install', '宿主文件落位', existsSync(hostFile), hostFile);

  const jsonStart = installOut.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const cfg = JSON.parse(installOut.slice(jsonStart, installOut.lastIndexOf('}') + 1));
      const entry = cfg.mcpServers?.agentlimb || Object.values(cfg.mcpServers || {})[0];
      const cmd = entry?.command || '';
      rec('install', 'MCP command 为绝对路径', /^[A-Za-z]:\\/.test(cmd), cmd);
      const argPath = (entry?.args || []).join(' ');
      rec('install', 'MCP args 用反斜杠绝对路径', /[A-Za-z]:\\/.test(argPath), argPath.slice(0, 200));
      rec('install', 'args 路径真实存在', existsSync((entry?.args || [])[0] || ''), (entry?.args || [])[0] || '');
      rec('install', '未出现 POSIX 路径', !argPath.includes('/.agentlimb'), argPath.slice(0, 200));
    } catch (error) {
      rec('install', 'MCP JSON 解析', false, error.message);
    }
  } else {
    rec('install', 'MCP JSON 输出', false, 'stdout 中没找到 JSON');
  }

  // 桥接：后台起，探测 status
  const bridge = spawn(node, [cli, 'bridge', '--client-name', 'Windows 自检'], { stdio: 'ignore', windowsHide: true });
  await sleep(3500);
  try {
    const status = execFileSync(node, [cli, 'status'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    const ok = status.includes('"ok"') || status.includes('port');
    rec('bridge', 'bridge 启动 + status 探测', ok, status.replace(/\s+/g, ' ').slice(0, 300));
  } catch (error) {
    rec('bridge', 'bridge 启动 + status 探测', false, error.message);
  } finally {
    try { bridge.kill('SIGKILL'); } catch {}
  }

  // 端口占用情况（8765-8770）
  if (IS_WIN) {
    const ports = ps(`(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge 8765 -and $_.LocalPort -le 8770 } | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique) -join ','`);
    rec('bridge', '8765-8770 占用', null, ports ? `已占用: ${ports}` : '全部空闲');
  }

  // 包管理器自带的 CLI 入口（npm link 在 Windows 上生成 .cmd shim）
  rec('install', 'package.json bin 字段', null, existsSync(join(ROOT, 'package.json')) ? '有 package.json，但未声明 bin 字段时 Windows 无全局命令（本课用 node 直调，不受影响）' : '');
}

// ── main ───────────────────────────────────────────────────────────────────
const cmd = process.argv[2] || 'all';
try {
  if (cmd === 'env' || cmd === 'all') runEnv();
  if (cmd === 'browsers' || cmd === 'all') await runBrowsers();
  if (cmd === 'paths' || cmd === 'install' || cmd === 'all') await runInstall();
} catch (error) {
  rec('fatal', '脚本异常', false, error.stack || error.message);
} finally {
  flush();
  try { rmSync(WORK, { recursive: true, force: true }); } catch {}
}
