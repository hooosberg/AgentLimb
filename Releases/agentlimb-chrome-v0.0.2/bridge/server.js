#!/usr/bin/env node
/**
 * AgentLimb Bridge Server v3
 *
 * HTTP + WebSocket bridge server.
 * Lets any terminal AI (Claude Code, Cursor, Codex, etc.)
 * drive Chrome browser through 5 tools (Unix philosophy: fewest tools, maximum power).
 *
 * ──────────────────────────────────────────
 * Tool protocol (POST /browser/<tool>)
 * ──────────────────────────────────────────
 *   observe  — Get page state (DOM tree + optional screenshot)
 *   act      — Execute page action (click / type / select / navigate / press_key)
 *   eval     — Execute arbitrary JavaScript in page (MAIN world, timeout_ms for polling)
 *   muscle   — Muscle memory CRUD + replay (action: list|save|run|delete)
 *   report   — Update monitor panel (title / steps / log / status)
 *
 * ──────────────────────────────────────────
 * WebSocket (same port)
 * ──────────────────────────────────────────
 *   Chrome extension Side Panel connects to ws://127.0.0.1:7789
 *   Bridge → Extension: BROWSER_CMD
 *   Extension → Bridge: BROWSER_RESULT | SYNC_MUSCLES | PING
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── Global muscle memory (~/.agentlimb/muscles.json) ────────────
const AGENTLIMB_DIR  = join(homedir(), '.agentlimb');
const MUSCLES_FILE = join(AGENTLIMB_DIR, 'muscles.json');
const BRIDGE_MARKER = join(AGENTLIMB_DIR, 'bridge.json');
try { mkdirSync(AGENTLIMB_DIR, { recursive: true }); } catch {}

// Bridge 启动标记
// bridge.json: 完整信息（JSON）
// bridge_dir:  纯文本，只有路径，AI 终端直接 cat 即可，零解析零转义
const BRIDGE_DIR_FILE = join(AGENTLIMB_DIR, 'bridge_dir');

function writeBridgeMarker() {
  const isWin = process.platform === 'win32';
  try {
    writeFileSync(BRIDGE_MARKER, JSON.stringify({
      bridge_dir: __dirname,
      start_cmd: isWin
        ? `cd /d "${__dirname}" && node server.js`
        : `cd "${__dirname}" && node server.js`,
      port: PORT,
      url: `http://127.0.0.1:${PORT}`,
      pid: process.pid,
      platform: process.platform,
      started_at: new Date().toISOString(),
    }, null, 2));
    // 纯文本版本——AI 终端只需读取此文件拿到路径
    // Unix: cat ~/.agentlimb/bridge_dir
    // Windows: type %USERPROFILE%\.agentlimb\bridge_dir
    writeFileSync(BRIDGE_DIR_FILE, __dirname);
  } catch {}
}

// 进程退出时清理标记（避免残留误导）
function clearBridgeMarker() {
  try {
    if (existsSync(BRIDGE_MARKER)) {
      const data = JSON.parse(readFileSync(BRIDGE_MARKER, 'utf8'));
      if (data.pid === process.pid) writeFileSync(BRIDGE_MARKER, JSON.stringify({ ...data, stopped_at: new Date().toISOString(), pid: null }, null, 2));
    }
  } catch {}
}
process.on('exit', clearBridgeMarker);
process.on('SIGINT', () => { clearBridgeMarker(); process.exit(0); });
process.on('SIGTERM', () => { clearBridgeMarker(); process.exit(0); });

// One-time migration from ~/.cowork/routes.json
const OLD_DIR = join(homedir(), '.cowork');
const OLD_ROUTES = join(OLD_DIR, 'routes.json');
if (!existsSync(MUSCLES_FILE) && existsSync(OLD_ROUTES)) {
  try {
    writeFileSync(MUSCLES_FILE, readFileSync(OLD_ROUTES, 'utf8'));
    console.log('[bridge] Migrated ~/.cowork/routes.json → ~/.agentlimb/muscles.json');
  } catch {}
}

let musclesStore = {};
function persistMuscles() {
  try { writeFileSync(MUSCLES_FILE, JSON.stringify(musclesStore, null, 2)); } catch {}
}

function escapeRegExp(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegExp(pattern) {
  return new RegExp(`^${escapeRegExp(pattern).replace(/\\\*/g, '.*')}$`, 'i');
}

function looksLikeRegexPattern(pattern) {
  return /(^\^)|(\$$)|[()[\]{}+?|\\]/.test(pattern);
}

function parseUrlLike(value) {
  const raw = String(value || '').trim();
  if (!raw) return { raw: '', url: '', host: '' };
  try {
    const parsed = new URL(raw);
    return { raw, url: parsed.href, host: parsed.hostname };
  } catch {
    const host = raw.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0];
    return { raw, url: raw, host };
  }
}

function matchMuscleSite(pattern, url) {
  const rawPattern = String(pattern || '').trim();
  if (!rawPattern) return true;

  const target = parseUrlLike(url);
  const targetValue = rawPattern.includes('://') || rawPattern.includes('/') ? target.url : target.host;
  if (!targetValue) return false;

  if (/^\/.*\/[a-z]*$/i.test(rawPattern)) {
    try {
      const lastSlash = rawPattern.lastIndexOf('/');
      const body = rawPattern.slice(1, lastSlash);
      const flags = rawPattern.slice(lastSlash + 1);
      return new RegExp(body, flags).test(targetValue);
    } catch {}
  }

  if (rawPattern.includes('*')) {
    return wildcardToRegExp(rawPattern).test(targetValue);
  }

  if (looksLikeRegexPattern(rawPattern)) {
    try {
      return new RegExp(rawPattern, 'i').test(targetValue);
    } catch {}
  }

  if (rawPattern.includes('://') || rawPattern.includes('/')) {
    return targetValue.includes(rawPattern);
  }

  return target.host === rawPattern || target.host.endsWith(`.${rawPattern}`);
}

function legacyActionsToSteps(actions = []) {
  return actions.map(action => {
    const step = { do: action.type || action.tool };
    if (action.selector) step.el = [action.selector];
    if (action.field) step.param = action.field;
    else if (action.value !== undefined) step.value = action.value;
    if (action.url) step.url = action.url;
    if (action.url_pattern || action.pattern) step.pattern = action.url_pattern || action.pattern;
    if (action.code) step.code = action.code;
    if (action.text) step.text = action.text;
    if (action.delay) step.delay = action.delay;
    if (action.timeout || action.timeout_ms) step.timeout = action.timeout || action.timeout_ms;
    if (action.property) step.property = action.property;
    return step;
  });
}

function getMuscleSteps(muscle) {
  if (Array.isArray(muscle?.steps)) return muscle.steps;
  if (Array.isArray(muscle?.actions)) return legacyActionsToSteps(muscle.actions);
  return [];
}

function getMuscleParams(muscle, steps = getMuscleSteps(muscle)) {
  if (Array.isArray(muscle?.params) && muscle.params.length) {
    return [...new Set(muscle.params.filter(Boolean))];
  }
  return [...new Set(steps.map(step => step?.param || step?.field).filter(Boolean))];
}

function canonicalizeMuscleRecord(muscle, fallback = {}) {
  const id = muscle?.id || muscle?.name || fallback?.id || fallback?.name;
  const steps = getMuscleSteps(muscle);
  return {
    id,
    desc: muscle?.desc || muscle?.name || fallback?.desc || fallback?.name || id,
    site: muscle?.site || muscle?.url_pattern || fallback?.site || fallback?.url_pattern || '',
    params: getMuscleParams(muscle, steps),
    steps,
    version: muscle?.version || fallback?.version || 1,
    created_at: muscle?.created_at || fallback?.created_at || new Date().toISOString(),
    updated_at: muscle?.updated_at || fallback?.updated_at || new Date().toISOString(),
    successful_runs: muscle?.successful_runs || fallback?.successful_runs || 0,
    confidence: muscle?.confidence || fallback?.confidence || 'low',
    last_success: muscle?.last_success || fallback?.last_success,
  };
}

function normalizeMuscleRecord(muscle, existing = {}) {
  const canonical = canonicalizeMuscleRecord(muscle, existing);
  return {
    ...canonical,
    version: (existing?.version || 0) + 1,
    created_at: existing?.created_at || canonical.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    successful_runs: existing?.successful_runs || canonical.successful_runs || 0,
    confidence: existing?.confidence || canonical.confidence || 'low',
    last_success: existing?.last_success || canonical.last_success,
  };
}

function migrateMuscleStore(rawStore = {}) {
  let changed = false;
  const nextStore = {};

  for (const [key, muscle] of Object.entries(rawStore || {})) {
    const id = muscle?.id || muscle?.name || key;
    if (!id) continue;
    const normalized = canonicalizeMuscleRecord({ ...muscle, id }, muscle);
    nextStore[id] = normalized;
    if (id !== key || JSON.stringify(normalized) !== JSON.stringify(muscle)) changed = true;
  }

  return { store: nextStore, changed };
}

try {
  if (existsSync(MUSCLES_FILE)) {
    const migrated = migrateMuscleStore(JSON.parse(readFileSync(MUSCLES_FILE, 'utf8')));
    musclesStore = migrated.store;
    if (migrated.changed) persistMuscles();
  }
} catch {}

// ── Terminal session tracking (TTL 5 min, persist by name) ────────────
const TERMINAL_TTL_MS  = 5 * 60 * 1000;
const terminalSessions = new Map();
const SESSIONS_FILE = join(AGENTLIMB_DIR, 'sessions.json');
let namedSessions = {};
try {
  if (existsSync(SESSIONS_FILE)) {
    namedSessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
    // 启动时清理过期的持久化 session
    const now = Date.now();
    let cleaned = false;
    for (const [name, s] of Object.entries(namedSessions)) {
      if (s.lastSeen && now - new Date(s.lastSeen).getTime() > TERMINAL_TTL_MS) {
        delete namedSessions[name];
        cleaned = true;
      }
    }
    if (cleaned) writeFileSync(SESSIONS_FILE, JSON.stringify(namedSessions, null, 2));
  }
} catch {}

function persistSessions() {
  try { writeFileSync(SESSIONS_FILE, JSON.stringify(namedSessions, null, 2)); } catch {}
}

function registerTerminal({ name, type, cwd }) {
  // 具名重连：同一 name 返回旧 token（幂等）
  if (name && namedSessions[name]) {
    const saved = namedSessions[name];
    const token = saved.token;
    const existing = terminalSessions.get(token);
    const mergedType = type || saved.type || 'generic';
    const mergedCwd  = cwd || existing?.cwd || saved.cwd || '';
    const now = new Date().toISOString();
    terminalSessions.set(token, {
      token, name,
      type: mergedType,
      cwd: mergedCwd,
      connectedAt: saved.connectedAt,
      lastSeen: now,
      reconnected: true,
    });
    // 回写到持久化 namedSessions，保持 type/cwd 同步
    saved.type = mergedType;
    saved.cwd  = mergedCwd;
    saved.lastSeen = now;
    persistSessions();
    broadcastTerminals();
    return { token, name, reused: true };
  }

  const token = `term-${randomUUID().slice(0, 8)}`;
  const connectedAt = new Date().toISOString();
  terminalSessions.set(token, {
    token, name: name || token, type: type || 'generic',
    cwd: cwd || '', connectedAt, lastSeen: connectedAt, reconnected: false,
  });
  if (name) {
    namedSessions[name] = { token, type: type || 'generic', cwd: cwd || '', connectedAt };
    persistSessions();
  }
  purgeExpiredTerminals();
  broadcastTerminals();
  return {
    token, name: name || token, reused: false,
    next_steps: 'GET /guide for tool reference, GET /doctor for diagnostics',
    docs: { guide: 'GET /guide', tools: 'GET /tools', doctor: 'GET /doctor' },
  };
}

function touchTerminal(token) {
  const s = terminalSessions.get(token);
  if (s) s.lastSeen = new Date().toISOString();
}

function getActiveTerminals() {
  const now = Date.now();
  return [...terminalSessions.values()].filter(
    s => now - new Date(s.lastSeen).getTime() < TERMINAL_TTL_MS
  );
}

function purgeExpiredTerminals() {
  const now = Date.now();
  let purged = false;
  for (const [t, s] of terminalSessions) {
    if (now - new Date(s.lastSeen).getTime() > TERMINAL_TTL_MS) {
      terminalSessions.delete(t);
      purged = true;
    }
  }
  if (purged) broadcastTerminals();
}

// 每 60 秒清理过期终端
setInterval(purgeExpiredTerminals, 60_000);

function broadcastTerminals() {
  sendToExtension({ type: 'TERMINAL_UPDATE', terminals: getActiveTerminals() });
}

// ── 状态 ──────────────────────────────────
const PORT = 7789;
let extensionWs = null;
const pendingCmds = new Map();
let _cmdCounter = 0;

// ── 会话操作追踪（自动活动 + 技能沉淀建议）────────────
const sessionTraces = new Map(); // token → { actions: [], startUrl: '', lastUrl: '' }

function getOrCreateTrace(token) {
  if (!sessionTraces.has(token)) sessionTraces.set(token, { actions: [], startUrl: '' });
  return sessionTraces.get(token);
}

function recordTraceAction(token, tool, args, result) {
  if (!token) return null;
  const trace = getOrCreateTrace(token);

  if (tool === 'act' && args.type === 'navigate') {
    // 新导航 = 新操作序列，重置沉淀状态
    trace.actions = [];
    trace.startUrl = args.url || '';
    trace.suggested = false;
  }

  // 只记录有意义的操作步骤
  if (tool === 'act' || tool === 'wait' || tool === 'eval') {
    const action = {
      tool,
      type: args.type,
      selector: args.selector,
      ref_id: args.ref_id,
      field: args.field,
      value: args.value,
      text: args.text,
      url: args.url,
      url_pattern: args.url_pattern,
      pattern: args.pattern,
      code: args.code,
      delay: args.delay,
      timeout: args.timeout || args.timeout_ms,
      timeout_ms: args.timeout_ms,
      property: args.property,
      ok: result?.ok,
    };
    if (result?.target_label) action.target_label = result.target_label;
    if (result?.target_selector) action.target_selector = result.target_selector;
    const targetCandidates = [...new Set([
      ...(Array.isArray(result?.target_candidates) ? result.target_candidates : []),
      args.selector,
      result?.target_label,
      result?.target_selector,
    ].filter(Boolean))];
    if (targetCandidates.length) action.target_candidates = targetCandidates;
    trace.actions.push(action);
  }

  // 成功的 wait/eval(timeout) → 检查是否构成可沉淀序列（每个序列只提示一次）
  const isWaitLike = result?.ok && (tool === 'wait' || (tool === 'eval' && args.timeout_ms));
  if (isWaitLike && !trace.suggested && trace.actions.length >= 3) {
    const hasNav = trace.actions.some(a => a.tool === 'act' && a.type === 'navigate');
    const hasInput = trace.actions.some(a => a.tool === 'act' && (a.type === 'type' || a.type === 'click' || a.type === 'select' || a.type === 'press_key'));
    if (hasNav && hasInput) {
      trace.suggested = true;
      // 发送沉淀建议到侧边栏 UI
      sendToExtension({
        type: 'BROWSER_CMD', cmdId: `auto-suggest-${Date.now()}`,
        cmd: 'suggest_save_muscle',
        args: { actions: trace.actions, start_url: trace.startUrl },
      });
      // 同时返回 tip，让 AI 终端也能看到建议
      return 'This workflow looks repeatable. Consider: muscle(action:"save", id:"...", desc:"...", site:"example.com", steps:[...]) to capture the reusable essence.';
    }
  }
  return null;
}

// Auto-activity broadcast: notify side panel on each tool call
const TOOL_LABELS = { observe: '🔍 observe', act: '👆 act', wait: '⏳ wait', eval: '⚙️ eval', muscle: '⚡ muscle', report: '📋 report', ping: '🏓 ping', project: '📁 project' };

function autoActivity(tool, args) {
  let desc = TOOL_LABELS[tool] || tool;
  if (tool === 'act') desc = args.type === 'navigate' ? `🌐 navigate ${(args.url || '').slice(0, 40)}` : `👆 ${args.type} ${args.selector || args.ref_id || ''}`;
  if (tool === 'report') return;
  sendToExtension({ type: 'AUTO_ACTIVITY', tool, desc });
}

// ── v2 tool set ────────────────────────────
const V2_TOOLS = new Set(['observe', 'act', 'eval', 'muscle', 'report']);

const LEGACY_MAP = {
  get_state: 'observe', screenshot: 'observe', ping_browser: 'observe',
  action: 'act', navigate: 'act',
  wait_for: 'eval', wait_for_text: 'eval', wait: 'eval',
  evaluate: 'eval',
  route: 'muscle',
  get_routes: 'muscle', save_route: 'muscle', run_route: 'muscle', delete_route: 'muscle',
  set_task: 'report', update_progress: 'report', add_log: 'report',
  complete_task: 'report', clear_task: 'report',
  compose: 'act', ping: 'observe',
};

const MUSCLE_ACTION_TYPES = new Set([
  'navigate', 'click', 'type', 'select', 'press_key', 'wait', 'wait_url',
  'evaluate', 'assert_text', 'assert_url', 'assert_selector', 'wait_for_text',
]);

const ASSERTION_TYPES = new Set(['assert_text', 'assert_url', 'assert_selector', 'wait_for_text']);

// ── HTTP 服务器 ──────────────────────────

const httpServer = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AgentLimb-Terminal');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  readBody(req).then(body => {
    try { route(req, body, res); }
    catch (e) { respond(res, 500, { error: e.message }); }
  });
});

async function route(req, body, res) {
  const method = req.method;
  const path = new URL(req.url, `http://localhost:${PORT}`).pathname;

  // ── GET /guide ────────────────────────
  if (method === 'GET' && path === '/guide') {
    respond(res, 200, {
      ok: true,
      title: 'AgentLimb Tool Guide v3 — 5 tools, Unix philosophy',
      tools: ['observe', 'act', 'eval', 'muscle', 'report'],
      tool_selection: {
        'See page': 'observe — DOM tree with ref_id per element',
        'Click/type/select/navigate/key': 'act — one mutation per call, use ref_id from observe',
        'Read page data': 'eval(code:"document.title") — arbitrary JS in page context',
        'Wait for condition': 'eval(code:"!!document.querySelector(\'.loaded\')", timeout_ms:10000) — polls until truthy',
        'Run JS on page': 'eval(code:"...") — full DOM access, no restrictions',
        'Find reusable workflow': 'muscle(action:"list", url:"https://current.page/...") — compact summaries for fast matching',
        'Save action sequence': 'muscle(action:"save", id:"...", desc:"...", site:"example.com", params:[...], steps:[...])',
        'Show progress': 'report(title, steps, status)',
      },
      common_mistakes: [
        { wrong: 'act(type:"select") on radio/checkbox', right: 'act(type:"click") — select is only for <select> dropdowns' },
        { wrong: 'Guess selectors', right: 'observe first → get ref_id → use ref_id' },
        { wrong: 'Use old ref_id after navigate', right: 'Must re-observe after navigation' },
        { wrong: 'Save raw ref_id / nth-child into muscles', right: 'Save label-first el candidate chains + stable CSS fallbacks only' },
        { wrong: 'Store full page URL for a site-wide workflow', right: 'Prefer site host; use wildcard/regex only when truly needed' },
        { wrong: 'Only send changed steps in report', right: 'steps is a full replacement each call' },
      ],
      reading_observe_tree: {
        format: 'Each line: role "label" [ref_N] name="..." type="..."',
        ref_id_usage: '[ref_41] → act(ref_id: 41)',
      },
      workflow: [
        '0. report(title, steps) — send your plan with numbered steps BEFORE starting.',
        '1. If the task may be repeatable, try muscle(action:"list", url: current_url) before rebuilding the flow',
        '2. observe — see what is on the page',
        '3. act / eval — perform the task and verify the result',
        '4. report(status:"done") — task completes; side panel may suggest or prompt muscle save automatically',
      ],
      shutdown: 'If the user says quit / exit / close / stop / 退出 / 关闭 / 停止 → call POST /api/shutdown (with X-AgentLimb-Terminal header). This closes the WebSocket, clears all sessions, and exits the bridge process.',
    });
    return;
  }

  // ── GET /info ─────────────────────────
  if (method === 'GET' && path === '/info') {
    const up = Math.round(process.uptime());
    respond(res, 200, {
      ok: true, bridge_dir: __dirname, version: '0.0.1',
      pid: process.pid, uptime_seconds: up,
      started_at: new Date(Date.now() - up * 1000).toISOString(),
      extension_connected: extensionWs?.readyState === 1,
      tools: [...V2_TOOLS],
      token_note: 'X-AgentLimb-Terminal is a terminal identity token, not an access authorization mechanism.',
    });
    return;
  }

  // ── GET /doctor ───────────────────────
  if (method === 'GET' && path === '/doctor') {
    const up = Math.round(process.uptime());
    const terms = getActiveTerminals();
    const issues = [];
    const extConnected = extensionWs?.readyState === 1;
    if (!extConnected)
      issues.push('Extension not connected — open Chrome and activate AgentLimb side panel');

    // 探测当前标签页的内容脚本注入状态
    let tabProbe = null;
    if (extConnected) {
      const probeId = `probe-${++_cmdCounter}`;
      tabProbe = await new Promise(resolve => {
        const timer = setTimeout(() => {
          pendingCmds.delete(probeId);
          resolve({ ok: false, error: 'Probe timed out (5s)' });
        }, 5000);
        pendingCmds.set(probeId, {
          res: null, timer, tool: 'probe_tab', args: {}, termToken: null, createdAt: Date.now(),
          onProbe: (data) => { clearTimeout(timer); pendingCmds.delete(probeId); resolve(data); },
        });
        extensionWs.send(JSON.stringify({ type: 'BROWSER_CMD', cmdId: probeId, cmd: 'probe_tab', args: {} }));
      });
      if (tabProbe && !tabProbe.ok && tabProbe.error_type) {
        issues.push(`Current tab: ${tabProbe.error} (${tabProbe.error_type})`);
      }
    }

    respond(res, 200, {
      ok: !issues.length, issues,
      process: { pid: process.pid, uptime_seconds: up, version: '0.0.1', bridge_dir: __dirname },
      extension: { connected: extConnected },
      current_tab: tabProbe || null,
      muscles: { count: Object.keys(musclesStore).length, file: MUSCLES_FILE },
      terminals: { active: terms.length, list: terms.map(t => ({ name: t.name, type: t.type })) },
    });
    return;
  }

  // ── GET /tools ────────────────────────
  if (method === 'GET' && path === '/tools') {
    respond(res, 200, {
      ok: true, version: '0.1.0',
      note: '5 tools via POST /browser/<tool>. Header: X-AgentLimb-Terminal: <token>. Unix philosophy: fewest tools, maximum power.',
      tools: {
        observe: {
          description: 'Get page state: URL, title, DOM accessibility tree with ref_id for each interactive element.',
          params: { filter: 'string? ("interactive"|"all")', screenshot: 'boolean? (include JPEG)' },
          returns: '{ ok, url, title, tree, element_count, warning?, screenshot?: { data_url, size_kb } }',
          notes: 'ref_ids are integers, expire on navigation. Call observe after every act(type:"navigate").',
        },
        act: {
          description: 'Execute ONE page mutation: click, type, select, navigate, or press_key.',
          params: { type: '"click"|"type"|"select"|"navigate"|"press_key"', ref_id: 'number?', selector: 'string?', url: 'string? (navigate)', value: 'string? (type/select/press_key)', confirm: 'boolean? (irreversible actions)' },
          returns: '{ ok, error?, final_url? }',
          notes: 'ref_id from observe tree. After navigate, all ref_ids expire. press_key value: Enter/Escape/Tab/Backspace/ArrowDown/ArrowUp/Space. confirm:true blocks until user approves in side panel.',
        },
        eval: {
          description: 'Execute arbitrary JavaScript in page (MAIN world). Full DOM access, no restrictions.',
          params: { code: 'string — JavaScript to execute', timeout_ms: 'number? — if set, polls code every 500ms until truthy result or timeout (replaces wait)' },
          returns: '{ ok, result, error? }',
          notes: 'Runs in page context via eval(). Can access any page API. With timeout_ms: polls until code returns truthy — use for waiting conditions. Examples: eval("document.title"), eval("document.querySelector(\'.btn\')?.click()"), eval("!!document.querySelector(\'.loaded\')", timeout_ms: 10000).',
        },
        muscle: {
          description: 'Muscle memory CRUD and replay. Reusable DOM action sequences — zero tokens.',
          params: { action: '"list"|"save"|"run"|"delete"', id: 'string?', desc: 'string? (save summary)', site: 'string? (host / wildcard / regex)', params: 'string[]? (save)', steps: 'MuscleStep[]? (save)', name: 'string? (legacy alias)', url_pattern: 'string? (legacy alias)', actions: 'MuscleAction[]? (legacy save)', fields: 'object? (run)', url: 'string? (list filter)' },
          returns: 'Varies by action. list: { count, muscles }. run: { muscle_id, steps }.',
          action_types: [...MUSCLE_ACTION_TYPES],
        },
        report: {
          description: 'Update the human-facing monitoring UI. IMPORTANT: Call at task start with your plan, update during execution, report done when finished.',
          params: { title: 'string?', status: '"running"|"done"|"error"|"clear"?', steps: 'Step[]?', log: 'string?', log_type: '"info"|"error"|"success"?', description: 'string?', summary: 'string?' },
          returns: '{ ok }',
          notes: 'steps is a full replacement each call. Workflow: 1) report(title + steps with your plan) 2) update step statuses as you go 3) report(status:"done") when finished. Do not add a separate "save muscle" plan step — the side panel handles suggestion/prompt automatically.',
        },
      },
      terminal: { connect: 'POST /api/terminal/connect { name, type, cwd? }', list: 'GET /api/terminals', shutdown: 'POST /api/shutdown — gracefully stops bridge (close WS, clear sessions, exit process). Call when user says quit/exit/close/退出/关闭.' },
      guide: 'GET /guide for full reference.',
    });
    return;
  }

  // ── GET /ping ─────────────────────────
  if (method === 'GET' && path === '/ping') {
    respond(res, 200, {
      ok: true, bridge_version: '0.0.1',
      extension_connected: extensionWs?.readyState === 1,
      uptime_seconds: Math.round(process.uptime()),
      active_terminals: getActiveTerminals().length,
    });
    return;
  }

  // ── POST /browser/:tool ───────────────
  const browserMatch = path.match(/^\/browser\/(\w+)$/);
  if (method === 'POST' && browserMatch) {
    const tool = browserMatch[1];
    let args = {};
    try { args = body ? JSON.parse(body) : {}; } catch {}

    const termToken = req.headers['x-agentlimb-terminal'];
    if (termToken) touchTerminal(termToken);

    // Legacy tool name → 410 upgrade guidance
    if (LEGACY_MAP[tool]) {
      respond(res, 410, {
        ok: false,
        error: `Tool "${tool}" removed in v2. Use "${LEGACY_MAP[tool]}" instead.`,
        upgrade: `POST /browser/${LEGACY_MAP[tool]}`,
        docs: 'GET /tools',
      });
      return;
    }

    if (!V2_TOOLS.has(tool)) {
      respond(res, 404, { ok: false, error: `Unknown tool: ${tool}. Available: ${[...V2_TOOLS].join(', ')}` });
      return;
    }

    // ── act 确认机制：confirm=true 时返回 need_confirm，AI 在终端运行 read 等用户回车
    if (tool === 'act' && args.confirm) {
      const confirmMsg = args.confirm_message || `About to: ${args.type} ${args.selector || args.ref_id || ''}`;
      respond(res, 200, {
        ok: false,
        need_confirm: true,
        confirm_message: confirmMsg,
        hint: `Run this bash command in the terminal to pause for user confirmation (Enter = proceed, Ctrl+C = cancel): printf '\\n⚠  ${confirmMsg}\\nPress Enter to confirm, Ctrl+C to cancel: ' && read -r _al_confirm\nAfter the user presses Enter, retry the SAME act call WITHOUT confirm:true.`,
      });
      return;
    }

    // ── muscle: list / save / delete handled locally, run forwarded to extension
    if (tool === 'muscle') {
      const action = args.action;
      if (action === 'list') {
        let muscles = Object.values(musclesStore);
        if (args.url) {
          muscles = muscles.filter(r => matchMuscleSite(r.site || r.url_pattern, args.url));
        }
        // 返回紧凑格式：AI 快速扫描决策用哪条肌肉，不返回完整 steps
        const compact = muscles.map(m => ({
          id: m.id,
          desc: m.desc || m.name,
          site: m.site || m.url_pattern,
          params: getMuscleParams(m),
        }));
        respond(res, 200, { ok: true, count: compact.length, muscles: compact });
        return;
      }
      if (action === 'save') {
        // name 可作 id 兜底
        if (!args.id && args.name) args.id = args.name;
        const hasSteps = Array.isArray(args.steps);
        const hasActions = Array.isArray(args.actions);
        if (!args.id) {
          respond(res, 400, { ok: false, error: 'muscle.id (or muscle.name) required' });
          return;
        }
        if (!hasSteps && !hasActions) {
          respond(res, 400, { ok: false, error: 'muscle.steps required (or legacy muscle.actions)' });
          return;
        }
        if (hasSteps) {
          const bad = args.steps.filter(step => !MUSCLE_ACTION_TYPES.has(step.do)).map(step => step.do);
          if (bad.length) {
            respond(res, 400, { ok: false, error: `Unsupported step do: ${bad.join(', ')}`, supported: [...MUSCLE_ACTION_TYPES] });
            return;
          }
        }
        // 仅对旧版 actions 做类型校验
        if (hasActions && !hasSteps) {
          const bad = args.actions.filter(a => !MUSCLE_ACTION_TYPES.has(a.type)).map(a => a.type);
          if (bad.length) {
            respond(res, 400, { ok: false, error: `Unsupported action type: ${bad.join(', ')}`, supported: [...MUSCLE_ACTION_TYPES] });
            return;
          }
        }
        const existing = musclesStore[args.id];
        musclesStore[args.id] = normalizeMuscleRecord(args, existing);
        persistMuscles();
        if (extensionWs?.readyState === 1) {
          extensionWs.send(JSON.stringify({
            type: 'BROWSER_CMD', cmdId: `sync-save-${Date.now()}`,
            cmd: 'save_muscle', args: musclesStore[args.id],
          }));
        }
        respond(res, 200, { ok: true, muscle: musclesStore[args.id], verified: true });
        return;
      }
      if (action === 'delete') {
        const id = args.id;
        if (!id || !musclesStore[id]) {
          respond(res, 404, { ok: false, error: 'Muscle not found' });
          return;
        }
        delete musclesStore[id];
        persistMuscles();
        if (extensionWs?.readyState === 1) {
          extensionWs.send(JSON.stringify({
            type: 'BROWSER_CMD', cmdId: `sync-del-${Date.now()}`,
            cmd: 'delete_muscle', args: { id },
          }));
        }
        respond(res, 200, { ok: true });
        return;
      }
      if (action === 'run') {
        const muscleObj = musclesStore[args.id];
        if (!muscleObj) {
          respond(res, 404, { ok: false, error: 'Muscle not found' });
          return;
        }
        args = { muscle: canonicalizeMuscleRecord(muscleObj, muscleObj), fields: args.fields || {} };
      } else {
        respond(res, 400, { ok: false, error: `Unknown muscle action: "${action}". Use: list, save, run, delete` });
        return;
      }
    }

    // ── 需要插件连接的工具：转发到 extension via WS
    if (!extensionWs || extensionWs.readyState !== 1) {
      respond(res, 503, { ok: false, error: 'Extension not connected. Open Chrome → AgentLimb side panel.' });
      return;
    }

    const cmdId = `cmd-${++_cmdCounter}`;
    const isRouteRun = tool === 'muscle';
    // HTTP 超时 = 用户指定值 + 5s 余量，或默认值
    const userTimeout = args.timeout_ms;
    const timeoutMs = userTimeout ? (userTimeout + 5000) : (isRouteRun ? 60000 : 15000);

    const timer = setTimeout(() => {
      if (!pendingCmds.has(cmdId)) return;
      pendingCmds.delete(cmdId);
      respond(res, 408, {
        ok: false, error: `Timeout (${timeoutMs}ms)`, tool, timeout_ms: timeoutMs,
        hint: 'Extension did not respond. Check Chrome side panel.',
      });
    }, timeoutMs);

    pendingCmds.set(cmdId, { res, timer, tool, args, termToken, createdAt: Date.now() });
    // 自动活动通知
    autoActivity(tool, args);
    // muscle(action:"run") → send as "run_muscle" cmd to extension
    const cmd = (tool === 'muscle') ? 'run_muscle' : tool;
    extensionWs.send(JSON.stringify({ type: 'BROWSER_CMD', cmdId, cmd, args }));
    return;
  }

  // ── GET /muscles (convenience endpoint) ────────────
  if (method === 'GET' && path === '/muscles') {
    respond(res, 200, { ok: true, count: Object.keys(musclesStore).length, muscles: Object.values(musclesStore).map(m => canonicalizeMuscleRecord(m, m)) });
    return;
  }

  // ── GET /api/terminals ────────────────
  if (method === 'GET' && path === '/api/terminals') {
    respond(res, 200, { ok: true, terminals: getActiveTerminals() });
    return;
  }

  // ── POST /api/shutdown ───────────────
  if (method === 'POST' && path === '/api/shutdown') {
    const termToken = req.headers['x-agentlimb-terminal'];
    // Close WebSocket connection to extension
    if (extensionWs) {
      try { extensionWs.send(JSON.stringify({ type: 'BRIDGE_SHUTDOWN' })); } catch {}
      try { extensionWs.close(1001, 'Bridge shutting down'); } catch {}
      extensionWs = null;
    }
    // Reject all pending commands
    for (const [, entry] of pendingCmds) {
      clearTimeout(entry.timer);
      try { respond(entry.res, 503, { ok: false, error: 'Bridge shutting down' }); } catch {}
    }
    pendingCmds.clear();
    // Remove terminal session
    if (termToken && terminalSessions.has(termToken)) {
      const session = terminalSessions.get(termToken);
      terminalSessions.delete(termToken);
      if (session.name && namedSessions[session.name]) {
        delete namedSessions[session.name];
        persistSessions();
      }
    }
    clearBridgeMarker();
    respond(res, 200, { ok: true, message: 'Bridge stopped. Background process terminated.' });
    // Give response time to flush, then exit
    setTimeout(() => process.exit(0), 100);
    return;
  }

  // ── POST|GET /api/terminal/connect ────────
  if (path === '/api/terminal/connect' && (method === 'POST' || method === 'GET')) {
    let params = {};
    if (method === 'POST') {
      try { params = JSON.parse(body || '{}'); } catch {}
    } else {
      // GET: parse query string (?name=xxx&type=xxx&cwd=xxx)
      const qs = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams;
      params = { name: qs.get('name'), type: qs.get('type'), cwd: qs.get('cwd') };
    }
    const result = registerTerminal(params);
    const resp = {
      ok: true, token: result.token, name: result.name, reused: result.reused,
      extension_connected: extensionWs?.readyState === 1,
      message: result.reused
        ? `Session "${result.name}" restored. Token unchanged.`
        : `Terminal "${result.name}" registered. Include header X-AgentLimb-Terminal: ${result.token}`,
    };
    if (!result.reused && result.next_steps) {
      resp.next_steps = result.next_steps;
      resp.docs = result.docs;
    }
    respond(res, 200, resp);
    return;
  }

  respond(res, 404, { error: 'Not found. Try: GET /tools, GET /ping, POST /browser/<tool>' });
}

function respond(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

async function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

function sendToExtension(msg) {
  if (extensionWs?.readyState === 1) { extensionWs.send(JSON.stringify(msg)); return true; }
  return false;
}

// ── WebSocket 服务器 ────────────────────

// 防止 socket 级错误（如客户端突然断开）导致进程崩溃
httpServer.on('clientError', (err, socket) => {
  if (err.code === 'ECONNRESET' || !socket.writable) return;
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const origin = req.headers.origin || '';
  const allowed = origin.startsWith('chrome-extension://') || origin.includes('localhost') || origin.includes('127.0.0.1') || origin === '';
  if (!allowed) { ws.close(1008, 'Unauthorized'); return; }

  console.log(`[bridge] Extension connected (${origin || 'direct'})`);
  extensionWs = ws;

  ws.send(JSON.stringify({ type: 'TERMINAL_UPDATE', terminals: getActiveTerminals() }));

  ws.on('message', data => {
    try { handleExtensionMsg(JSON.parse(data.toString())); }
    catch (e) { console.error('[bridge] Bad message:', e.message); }
  });
  ws.on('close', () => { console.log('[bridge] Extension disconnected'); if (extensionWs === ws) extensionWs = null; });
  ws.on('error', e => console.error('[bridge] WS error:', e.message));
});

function handleExtensionMsg(msg) {
  // Extension pushes global muscle library
  if (msg.type === 'SYNC_MUSCLES') {
    const muscles = Array.isArray(msg.muscles) ? msg.muscles
      : Array.isArray(msg.routes) ? msg.routes
      : Object.values(msg.muscles || msg.routes || {});
    musclesStore = {};
    for (const r of muscles) {
      if (!r?.id && !r?.name) continue;
      const canonical = canonicalizeMuscleRecord(r, r);
      if (canonical.id) musclesStore[canonical.id] = canonical;
    }
    persistMuscles();
    console.log(`[bridge] Muscles synced: ${muscles.length}`);
    return;
  }

  // 浏览器命令结果
  if (msg.type === 'BROWSER_RESULT') {
    const pending = pendingCmds.get(msg.cmdId);
    if (!pending) return;
    // confirm_action 结果：调用 onConfirm 回调，不走常规响应
    if (pending.tool === 'confirm_action' && pending.onConfirm) {
      const approved = msg.ok && msg.data?.approved !== false;
      pending.onConfirm(approved);
      return;
    }
    // probe_tab 结果：调用 onProbe 回调
    if (pending.tool === 'probe_tab' && pending.onProbe) {
      pending.onProbe(msg.data || { ok: msg.ok, error: msg.error });
      return;
    }
    clearTimeout(pending.timer);
    pendingCmds.delete(msg.cmdId);
    // Record action trace (include tip in response for AI terminal)
    let muscleTip = null;
    if (pending.termToken && pending.tool) {
      muscleTip = recordTraceAction(pending.termToken, pending.tool, pending.args || {}, msg.data);
    }
    // Muscle run success → update confidence
    if (msg.ok && msg.data?.muscle_id && musclesStore[msg.data.muscle_id]) {
      const r = musclesStore[msg.data.muscle_id];
      r.successful_runs = (r.successful_runs || 0) + 1;
      r.last_success = new Date().toISOString();
      const hasAssert = getMuscleSteps(r).some(step => ASSERTION_TYPES.has(step.do || step.type));
      r.confidence = r.successful_runs >= 5 ? 'high'
        : r.successful_runs >= 2 ? 'medium'
        : (hasAssert && r.successful_runs >= 1) ? 'medium'
        : 'low';
      persistMuscles();
      sendToExtension({ type: 'BROWSER_CMD', cmdId: `sync-stat-${Date.now()}`, cmd: 'update_muscle_stats', args: { muscle_id: r.id } });
    }
    const responseData = msg.data || { ok: msg.ok, error: msg.error };
    if (muscleTip && msg.ok) responseData.tip = muscleTip;
    respond(pending.res, msg.ok ? 200 : 500, responseData);
    return;
  }

  if (msg.type === 'PING') {
    extensionWs?.send(JSON.stringify({ type: 'PONG' }));
  }
}

// ── pendingCmds 兜底清理（60s 扫描一次，回收超时未清理的孤儿条目）──
const PENDING_MAX_AGE_MS = 120_000; // 2 分钟兜底上限
setInterval(() => {
  const now = Date.now();
  for (const [cmdId, entry] of pendingCmds) {
    if (entry.createdAt && now - entry.createdAt > PENDING_MAX_AGE_MS) {
      clearTimeout(entry.timer);
      pendingCmds.delete(cmdId);
      try { respond(entry.res, 408, { ok: false, error: 'Stale command cleaned up' }); } catch {}
    }
  }
}, 60_000);

// ── 启动 ────────────────────────────────

// ── 连接稳定性配置 ─────────────────────
// 防止 keep-alive 连接复用失败导致 "Couldn't connect to server"
httpServer.keepAliveTimeout = 65000;       // 65s，大于常见客户端的 idle timeout
httpServer.headersTimeout = 70000;         // 略大于 keepAliveTimeout
httpServer.maxRequestsPerSocket = 0;       // 不限制单连接请求数
httpServer.timeout = 0;                    // 禁用 socket 级超时（由 pendingCmds timer 控制）

httpServer.listen(PORT, '127.0.0.1', () => {
  writeBridgeMarker();
  console.log(`
  AgentLimb Bridge v0.0.1
  HTTP : http://127.0.0.1:${PORT}
  WS   : ws://127.0.0.1:${PORT}
  Tools: ${[...V2_TOOLS].join(', ')}
  Docs : GET /tools
  Marker: ${BRIDGE_MARKER}
`);
});
