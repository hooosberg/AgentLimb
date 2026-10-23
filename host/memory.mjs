/**
 * 网站记忆 / Site Memory
 *
 * One folder of Markdown files that lets any MCP-connected AI reuse what it
 * already learned about a website: the direct URL, the element anchors, the
 * pitfalls, and how to tell success from "looks like it worked".
 *
 * Design rules (deliberate, do not "improve" these away):
 *   1. The knowledge lives on disk, never inside the extension or this process.
 *      Swapping the browser MCP, the AI client, or the plugin version changes
 *      nothing about what is already written down.
 *   2. The folder is a valid `kb` library (marker `.agentlimb-kb` +
 *      `knowledge/sites/<domain>/PLAYBOOK.md`), so the standalone CLI and this
 *      module can read and write the same files.
 *   3. Only operation knowledge is stored. Never credentials, cookies, tokens,
 *      or the site's own data — see RULES.md.
 *   4. The hot path (`brief`) reads exactly one file. Recording appends one
 *      small file. Nothing here scans the whole library.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const MEMORY_MARKER = '.agentlimb-kb';
export const MEMORY_DIR_NAME = 'memory';

/** Section number → (title, key). Same numbering as the `kb` CLI uses. */
export const SECTIONS = [
  [0, '一句话', 'summary'],
  [1, '前置条件', 'pre'],
  [2, '入口', 'entry'],
  [3, '操作步骤', 'steps'],
  [4, '元素锚点', 'selectors'],
  [5, '站内接口', 'api'],
  [6, '坑与风控', 'pitfalls'],
  [7, '成功判定', 'verify'],
  [8, '变更记录', 'history'],
];

const SECTION_BY_KEY = new Map(SECTIONS.map(([num, title, key]) => [key, { num, title }]));
const PLACEHOLDER = /（暂无|\(暂无|TODO|待补充/;

// ── 路径与配置 ───────────────────────────────────────────────────────────────

export function agentlimbHome() {
  return join(process.env.HOME || process.env.USERPROFILE || homedir(), '.agentlimb');
}

export function memoryConfigPath(home = agentlimbHome()) {
  return join(home, 'memory-config.json');
}

export function defaultMemoryRoot(home = agentlimbHome()) {
  return join(home, MEMORY_DIR_NAME);
}

/**
 * Resolve the memory root: explicit env > saved config > default.
 * `AGENTLIMB_MEMORY_ROOT` also lets a user point every client at one shared
 * folder (several AI clients, one memory).
 */
export function resolveMemoryRoot({ home = agentlimbHome(), config } = {}) {
  const saved = config || readMemoryConfig({ home });
  const fromEnv = String(process.env.AGENTLIMB_MEMORY_ROOT || '').trim();
  if (fromEnv) return expandHome(fromEnv);
  if (saved?.root) return expandHome(saved.root);
  return defaultMemoryRoot(home);
}

export function expandHome(value) {
  const text = String(value || '').trim();
  if (!text) return text;
  if (text === '~') return homedir();
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2));
  return text;
}

export function readMemoryConfig({ home = agentlimbHome() } = {}) {
  try {
    const raw = JSON.parse(readFileSync(memoryConfigPath(home), 'utf8'));
    return {
      enabled: raw.enabled !== false,
      root: typeof raw.root === 'string' ? raw.root : '',
      updatedAt: raw.updatedAt || null,
    };
  } catch (_) {
    return { enabled: true, root: '', updatedAt: null };
  }
}

export function writeMemoryConfig(patch = {}, { home = agentlimbHome() } = {}) {
  const current = readMemoryConfig({ home });
  const next = {
    enabled: patch.enabled === undefined ? current.enabled : Boolean(patch.enabled),
    root: patch.root === undefined ? current.root : String(patch.root || ''),
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(home, { recursive: true });
  const file = memoryConfigPath(home);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  try {
    renameSync(temp, file);
  } catch (_) {
    try { writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`); } finally {
      try { rmSync(temp, { force: true }); } catch { /* ignore */ }
    }
  }
  return next;
}

/**
 * Is the feature usable right now? Enabled in config AND the folder exists
 * (a folder that was deleted by hand is not "on" just because config says so).
 */
export function memoryState({ home = agentlimbHome() } = {}) {
  const config = readMemoryConfig({ home });
  const root = resolveMemoryRoot({ home, config });
  const exists = existsSync(join(root, MEMORY_MARKER));
  return { enabled: config.enabled && exists, configured: config.enabled, root, exists, config };
}

// ── 脚手架 ───────────────────────────────────────────────────────────────────

const MARKER_TEXT = `# AgentLimb 网站记忆

这个文件标记目录为知识库根目录。
整个文件夹可以随意移动或备份；移动后在 AgentLimb 设置里改一次路径即可。
`;

const RULES_TEMPLATE = `# 网站记忆 · 使用规则

你（AI）在操作任何网站之前，先读这个网站的既有记录；操作完成后，把新学到的操作知识写回去。
记录由 \`site_memory\` 工具读写，不要自己去翻文件（除非工具不可用）。

- 知识库位置：\`{{ROOT}}\`
- 一条记录只回答一个问题：**下次做同样的操作，怎么少试一次？**

## 三条铁律

1. **操作前先查**：\`site_memory {action:"brief", site:"<域名>"}\`。有记录就照着走，不要重新摸索页面结构。
2. **操作后按增量写**：有新知识（首次跑通 / 锚点变了 / 踩到新坑）才 \`record\` 并带上对应字段；
   没有新知识就只记 \`status\` 和一句 \`note\`。纯一次性试探可以不记，但要跟用户说一句"本次未沉淀"。
3. **只记操作，不记内容**：入口 URL、元素锚点、站内接口、坑与风控、成功判定。
   绝不记录账号、密码、Cookie、Token、验证码，也不记录网站上抓到的业务数据。

## 记什么最值钱

| 值得记 | 不值得记 |
|---|---|
| 直达 URL（省掉从首页点菜单） | "我点了这里又点了那里"的流水账 |
| 选择器 + 为什么这么选 | 整页 HTML |
| 二次确认、验证码、A/B 改版 | 抓到的标题、评论、销量 |
| 可验证的成功证据 | "看起来成功了" |

## 成功判定

必须拿到可判定的证据：目标文案出现 / URL 变化 / 列表出现新条目 / 接口返回 id。
`;

const CONVENTIONS_TEMPLATE = `# 记录规范

## 目录

\`\`\`
<根目录>/
├── ${MEMORY_MARKER}          标记文件（勿删）
├── RULES.md                  给 AI 的规则
├── CONVENTIONS.md            本文件
├── INDEX.md                  站点总览（自动生成）
└── knowledge/sites/<域名>/
    ├── PLAYBOOK.md           唯一的"活"文档，8 节固定结构
    └── sessions/             每次运行一行，只追加不改
\`\`\`

## 8 节结构（顺序固定）

| # | 章节 | 回答什么 |
|---|---|---|
| 0 | 一句话 | 这个站能干什么 |
| 1 | 前置条件 | 登录哪个账号、哪个 profile、有无地区/额度限制 |
| 2 | 入口 | 可直接打开的 URL |
| 3 | 操作步骤 | 每步一个动作 + 一个可判定结果 |
| 4 | 元素锚点 | 用途 → 选择器 → 为什么这么选 |
| 5 | 站内接口 | 能同源 fetch 的接口 |
| 6 | 坑与风控 | 弹窗、二次确认、验证码、改版 |
| 7 | 成功判定 | 可验证的证据 |
| 8 | 变更记录 | 自动追加，带日期 |

## 锚点优先级

\`data-testid\` / \`aria-label\` / \`role+name\` > 稳定 id > 结构选择器 > 文案匹配。
每条写成：\`- <用途> → <选择器> → <备注：为什么/坑在哪>\`

## 纪律

1. 单本 ≤ 120 行。超了就是记多了。
2. 只追加不重写，纠错也写成新的一条（\`更正：...\`）。
3. 不写凭据，不写站点数据。
4. 不确定的标 \`(待验证)\`。
`;

const TEMPLATE_PLAYBOOK = `---
domain: example.com
aliases: []
title: 站点名称
status: draft
last_verified: ""
last_run: ""
runs: 0
success: 0
fails: 0
requires_login: false
capabilities: []
---

# {{DOMAIN}}

> 只记录操作知识：怎么进入、点哪里、怎么算成功、哪里会踩坑。

## 0. 一句话

## 1. 前置条件

## 2. 入口

## 3. 操作步骤

## 4. 元素锚点

## 5. 站内接口

## 6. 坑与风控

## 7. 成功判定

## 8. 变更记录
`;

const README_TEMPLATE = `# 网站记忆

AgentLimb 的「网站记忆」：把 AI 操作过的网站**怎么做**记下来，下次任何 AI 接上同一台电脑都能直接用。

- \`RULES.md\` — 给 AI 的规则（插件会把它注入 MCP 会话）
- \`knowledge/sites/<域名>/PLAYBOOK.md\` — 每个网站一本手册
- \`knowledge/sites/<域名>/sessions/\` — 每次操作的一行结果，供人复盘
- \`INDEX.md\` — 站点总览

**这里不会存**：账号、密码、Cookie、Token、验证码、网站上抓到的数据。
只存操作知识：入口 URL、元素锚点、坑、成功判定。

关闭方式：AgentLimb 侧栏 → 设置 → 网站记忆。
`;

function writeIfMissing(file, content) {
  if (existsSync(file)) return false;
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
  return true;
}

/**
 * Create the folder layout if needed. Safe to call on every start: existing
 * files are never overwritten, so user edits survive upgrades.
 */
export function ensureMemory(root = defaultMemoryRoot()) {
  const created = !existsSync(join(root, MEMORY_MARKER));
  mkdirSync(join(root, 'knowledge', 'sites'), { recursive: true });
  writeIfMissing(join(root, MEMORY_MARKER), MARKER_TEXT);
  writeIfMissing(join(root, 'README.md'), README_TEMPLATE);
  writeIfMissing(join(root, 'RULES.md'), RULES_TEMPLATE.replace('{{ROOT}}', root));
  writeIfMissing(join(root, 'CONVENTIONS.md'), CONVENTIONS_TEMPLATE);
  writeIfMissing(join(root, 'knowledge', 'sites', '_template', 'PLAYBOOK.md'), TEMPLATE_PLAYBOOK);
  if (!existsSync(join(root, 'INDEX.md'))) writeIndex(root);
  return { root, created };
}

// ── front-matter（只支持本站需要的子集：标量 + 行内数组） ──────────────────────

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitDoc(text) {
  const match = FM_RE.exec(text);
  if (!match) return { fm: {}, body: text };
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const index = line.indexOf(':');
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const raw = line.slice(index + 1).trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      fm[key] = raw.slice(1, -1).split(',').map((v) => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (raw === 'true' || raw === 'false') {
      fm[key] = raw === 'true';
    } else if (raw !== '' && /^-?\d+$/.test(raw)) {
      fm[key] = Number(raw);
    } else {
      fm[key] = raw.replace(/^["']|["']$/g, '');
    }
  }
  return { fm, body: text.slice(match[0].length) };
}

const FM_ORDER = ['domain', 'aliases', 'title', 'status', 'last_verified', 'last_run', 'runs', 'success', 'fails', 'streak', 'requires_login', 'capabilities'];

export function dumpDoc(fm, body) {
  const keys = [...FM_ORDER.filter((k) => k in fm), ...Object.keys(fm).filter((k) => !FM_ORDER.includes(k))];
  const lines = ['---'];
  for (const key of keys) {
    const value = fm[key];
    if (Array.isArray(value)) lines.push(`${key}: [${value.join(', ')}]`);
    else if (typeof value === 'boolean') lines.push(`${key}: ${value}`);
    else if (typeof value === 'number') lines.push(`${key}: ${value}`);
    else if (value === '' || value === null || value === undefined) lines.push(`${key}: ""`);
    else lines.push(`${key}: ${/[":]/.test(String(value)) ? `"${String(value).replace(/"/g, '\\"')}"` : value}`);
  }
  lines.push('---');
  return `${lines.join('\n')}\n\n${String(body || '').replace(/^\n+/, '')}`;
}

// ── 站点定位 ─────────────────────────────────────────────────────────────────

const SAFE_DOMAIN = /^[\p{L}\p{N}][\p{L}\p{N}.-]*$/u;

/** Normalise any URL / host / "yt" into the folder name used on disk. */
export function normDomain(query) {
  let value = String(query || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes('://')) value = value.split('://')[1];
  value = value.split(/[/?#]/)[0];
  value = value.split('@').pop().split(':')[0].replace(/\.$/, '');
  for (const prefix of ['www.', 'm.', 'mobile.', 'amp.']) {
    if (value.startsWith(prefix) && value.split('.').length >= 3) value = value.slice(prefix.length);
  }
  // The result becomes a folder name. Anything that is not a plain host label
  // sequence (`..`, `a/b`, empty segments) must not reach the filesystem.
  if (!SAFE_DOMAIN.test(value) || value.includes('..')) return '';
  return value;
}

function sitesDir(root) {
  return join(root, 'knowledge', 'sites');
}

export function listSites(root = defaultMemoryRoot()) {
  const base = sitesDir(root);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((name) => !name.startsWith('_') && !name.startsWith('.'))
    .filter((name) => existsSync(join(base, name, 'PLAYBOOK.md')))
    .sort()
    .map((name) => {
      const file = join(base, name, 'PLAYBOOK.md');
      const { fm } = splitDoc(readFileSync(file, 'utf8'));
      return { domain: fm.domain || name, file, fm };
    });
}

/** Exact folder hit first (O(1)); alias/title scan only as a fallback. */
export function findSite(root, query) {
  const domain = normDomain(query);
  const exact = join(sitesDir(root), domain, 'PLAYBOOK.md');
  if (domain && existsSync(exact)) {
    const { fm, body } = splitDoc(readFileSync(exact, 'utf8'));
    return { domain: fm.domain || domain, file: exact, fm, body };
  }
  const needle = String(query || '').trim().toLowerCase();
  for (const site of listSites(root)) {
    const aliases = (site.fm.aliases || []).map((a) => String(a).toLowerCase());
    if (aliases.includes(needle) || String(site.fm.title || '').toLowerCase() === needle) {
      const { body } = splitDoc(readFileSync(site.file, 'utf8'));
      return { ...site, body };
    }
  }
  return null;
}

// ── 读 ───────────────────────────────────────────────────────────────────────

function sectionText(body, num) {
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^##\s*(\d+)/.exec(lines[i]);
    if (m && Number(m[1]) === num) { start = i + 1; break; }
  }
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s*\d+/.test(lines[i])) { end = i; break; }
  }
  const text = lines.slice(start, end).join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!text || (PLACEHOLDER.test(text) && text.length < 200)) return '';
  return text;
}

export function brief(root, query) {
  const site = findSite(root, query);
  const domain = normDomain(query) || String(query || '');
  if (!normDomain(query) && !site) {
    return { found: false, domain: String(query || ''), text: 'INVALID_SITE: 需要域名或 URL（例如 studio.youtube.com）。' };
  }
  if (!site) {
    return {
      found: false,
      domain,
      text: [
        `NO_PLAYBOOK: ${domain}`,
        '这个网站还没有记录。正常探索并完成操作，然后用一次 site_memory record 把它记下来：',
        `  site_memory {action:"record", site:"${domain}", status:"success", title:"<站点名>",`,
        '    entry:"<直达 URL>", steps:"<1) ... 2) ...>", selectors:"<用途 → 选择器 → 备注>",',
        '    pitfalls:"<会踩的坑>", note:"<怎么确认成功的>"}',
        '只记操作知识：入口、锚点、坑、成功判定。不要记账号密码 Cookie，也不要记网站上的内容。',
      ].join('\n'),
    };
  }
  const fm = site.fm;
  const bits = [`status=${fm.status || 'draft'}`];
  if (fm.last_verified) bits.push(`last_verified=${fm.last_verified}`);
  if (fm.runs) bits.push(`runs=${fm.runs}(ok ${fm.success || 0}/fail ${fm.fails || 0})`);
  const out = [
    `PLAYBOOK: ${fm.domain || site.domain}  (${bits.join(' · ')})`,
    fm.requires_login ? 'requires_login: true' : '',
    (fm.capabilities || []).length ? `capabilities: ${(fm.capabilities || []).join(', ')}` : '',
    '',
  ].filter((line) => line !== '');
  for (const [num, title] of SECTIONS) {
    if (num === 8) continue;
    let text = sectionText(site.body, num);
    if (!text) continue;
    const rows = text.split('\n');
    if (rows.length > BRIEF_TAIL) text = rows.slice(-BRIEF_TAIL).join('\n');
    out.push(`## ${num}. ${title}`, text, '');
  }
  out.push('照着做。与当前页面不一致时以页面为准，并立刻 record 一条更正。');
  if (fm.status === 'stale') out.unshift('WARNING: 这本记录连续失败过，锚点可能已变，先用一次快照验证关键锚点。');
  return { found: true, domain: fm.domain || site.domain, text: out.join('\n') };
}

// ── 写 ───────────────────────────────────────────────────────────────────────


// ── 写入纪律（代码层兜底，不只靠提示词） ─────────────────────────────────────

const SECRET_PATTERNS = [
  /(?:\b(?:password|passwd|pwd|secret|token|cookie|authorization|api[_-]?key|session[_-]?id)\b|验证码|密码)\s*[:=：]\s*(?:Bearer\s+)?\S+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g,
  /\b(?:sk|pk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{16,}/g,
  /\b[A-Fa-f0-9]{40,}\b/g,
];

/** Strip anything that looks like a credential. Returns the clean text and how many hits were removed. */
export function redact(text) {
  let hits = 0;
  let out = String(text ?? '');
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, () => { hits += 1; return '[已脱敏]'; });
  }
  return { text: out, hits };
}

/** Write via temp + rename so a crash or a parallel reader never sees half a playbook. */
function writeAtomic(file, content) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, content);
  try {
    renameSync(temp, file);
  } catch (_) {
    try { writeFileSync(file, content); } finally { rmSync(temp, { force: true }); }
  }
}

/**
 * Several AI clients may share one memory folder. A directory lock (mkdir is
 * atomic) serialises read-modify-write on a playbook; a stale lock is taken
 * over after 5s so a crashed client can never block recording forever.
 */
function withLock(dir, fn) {
  const lock = join(dir, '.lock');
  const deadline = Date.now() + 2000;
  for (;;) {
    try { mkdirSync(lock); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let age = 0;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch (_) { continue; }
      if (age > 5000) { rmSync(lock, { recursive: true, force: true }); continue; }
      if (Date.now() > deadline) break; // give up waiting; last write wins rather than failing the user's task
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

const KNOWLEDGE_CAP = 10;
const HISTORY_CAP = 30;
const BRIEF_TAIL = 5;
const entryText = (line) => line.replace(/^\s*-\s*(?:\[\d{4}-\d{2}-\d{2}\]\s*)?/, '').trim();

function appendSection(body, key, line) {
  const section = SECTION_BY_KEY.get(key);
  if (!section) return body;
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^##\s*(\d+)/.exec(lines[i]);
    if (m && Number(m[1]) === section.num) { start = i; break; }
  }
  if (start < 0) {
    lines.push('', `## ${section.num}. ${section.title}`, '');
    start = lines.length - 2;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s*\d+/.test(lines[i])) { end = i; break; }
  }
  const kept = lines.slice(start + 1, end).filter((text) => text.trim() && !PLACEHOLDER.test(text));
  // Same knowledge written again is not new knowledge: skip it (keeps a playbook short).
  if (!kept.some((text) => entryText(text) === entryText(line))) kept.push(line);
  const cap = key === 'history' ? HISTORY_CAP : KNOWLEDGE_CAP;
  while (kept.length > cap) kept.shift();
  return [...lines.slice(0, start + 1), '', ...kept, '', ...lines.slice(end)].join('\n');
}

/**
 * One call for the whole write-back: create the site if new, append whatever
 * knowledge was provided, log the run, and move the status.
 */
export function record(root, input = {}) {
  const domain = normDomain(input.site);
  if (!domain) throw new Error('site_memory record 需要一个合法的 site（域名或 URL）');
  const today = new Date().toISOString().slice(0, 10);
  const dir = join(sitesDir(root), domain);
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  return withLock(dir, () => recordLocked(root, domain, dir, today, input));
}

function recordLocked(root, domain, dir, today, input) {
  const file = join(dir, 'PLAYBOOK.md');
  let redacted = 0;
  // One entry = one line, scrubbed of anything credential-shaped.
  const clean = (value) => {
    const { text, hits } = redact(String(value ?? '').replace(/\s*\n\s*/g, ' ⏎ ').trim());
    redacted += hits;
    return text;
  };

  let fm;
  let body;
  if (existsSync(file)) {
    ({ fm, body } = splitDoc(readFileSync(file, 'utf8')));
  } else {
    ({ fm, body } = splitDoc(TEMPLATE_PLAYBOOK.replace(/\{\{DOMAIN\}\}/g, domain)));
    fm = {
      domain,
      aliases: [],
      title: clean(input.title) || domain,
      status: 'draft',
      last_verified: '',
      last_run: '',
      runs: 0,
      success: 0,
      fails: 0,
      streak: 0,
      requires_login: Boolean(input.requiresLogin),
      capabilities: [],
    };
    const heading = clean(input.title) || domain;
    body = body.replace(/^#\s*.*$/m, () => `# ${heading}`); // fn replacer: a title like "$&" must stay literal
  }

  if (input.title) fm.title = clean(input.title);
  if (input.requiresLogin !== undefined) fm.requires_login = Boolean(input.requiresLogin);
  if (Array.isArray(input.capabilities) && input.capabilities.length) {
    fm.capabilities = [...new Set([...(fm.capabilities || []), ...input.capabilities.map(String)])];
  }

  const knowledge = [
    ['entry', input.entry],
    ['steps', input.steps],
    ['selectors', input.selectors],
    ['api', input.api],
    ['pitfalls', input.pitfalls],
    ['verify', input.verify],
    ['summary', input.summary],
    ['pre', input.pre],
  ];
  let wroteKnowledge = 0;
  for (const [key, value] of knowledge) {
    const text = clean(value);
    if (!text) continue;
    body = appendSection(body, key, `- [${today}] ${text}`);
    wroteKnowledge += 1;
  }

  const status = ['success', 'partial', 'fail'].includes(input.status) ? input.status : 'success';
  const runs = Number(fm.runs || 0) + 1;
  const success = Number(fm.success || 0) + (status === 'success' ? 1 : 0);
  const fails = Number(fm.fails || 0) + (status === 'success' ? 0 : 1);
  // "Stale" means failing *now*, not failing once long ago: count the streak.
  const streak = status === 'success' ? 0 : Number(fm.streak || 0) + 1;
  let next = fm.status || 'draft';
  if (status === 'success') next = 'verified';
  else if (streak >= 2) next = 'stale';

  fm.runs = runs;
  fm.success = success;
  fm.fails = fails;
  fm.streak = streak;
  fm.status = next;
  fm.last_run = today;
  if (status === 'success') fm.last_verified = today;

  const note = clean(input.note);
  if (note) body = appendSection(body, 'history', `- [${today}] ${status} · ${note}`);

  writeAtomic(file, dumpDoc(fm, body));

  // Millisecond precision: two runs inside the same second must not overwrite
  // each other's log — retries after a failure are exactly that fast.
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  let session = join(dir, 'sessions', `${stamp}-${status}.md`);
  for (let n = 2; existsSync(session); n += 1) session = join(dir, 'sessions', `${stamp}-${status}-${n}.md`);
  writeFileSync(session, [
    `# ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${status}${input.task ? ` · ${clean(input.task)}` : ''}`,
    `- ai: ${input.ai || 'unknown'}`,
    `- note: ${note || '-'}`,
    input.deviation ? `- deviation: ${clean(input.deviation)}` : '',
    `- knowledge: ${wroteKnowledge} section(s)`,
  ].filter(Boolean).join('\n') + '\n');

  writeIndex(root);
  return { domain, status: next, runs, success, fails, streak, knowledge: wroteKnowledge, redacted, file };
}

export function stats(root = defaultMemoryRoot()) {
  const sites = listSites(root);
  let sessions = 0;
  for (const site of sites) {
    const dir = join(sitesDir(root), site.domain, 'sessions');
    if (!existsSync(dir)) continue;
    sessions += readdirSync(dir).filter((name) => name.endsWith('.md') && !name.startsWith('_')).length;
  }
  const latest = sites.reduce((acc, site) => (site.fm.last_run > acc ? site.fm.last_run : acc), '');
  return { root, sites: sites.length, sessions, latest };
}

export function writeIndex(root = defaultMemoryRoot()) {
  const sites = listSites(root);
  const rows = sites.map((site) => {
    const fm = site.fm;
    return `| ${fm.domain || site.domain} | ${fm.title || ''} | ${fm.status || 'draft'} | ${fm.last_verified || '-'} | ${fm.success || 0}/${fm.runs || 0} | ${(fm.capabilities || []).join(', ') || '-'} |`;
  });
  const text = [
    '# 网站记忆 · 总览',
    '',
    `> 自动生成。共 ${sites.length} 个网站。`,
    '',
    '| 域名 | 站点 | 状态 | 最近验证 | 成功/次数 | 已覆盖能力 |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    '状态：`verified` 近期验证可用 · `draft` 未跑通 · `stale` 连续失败需重验锚点',
    '',
  ].join('\n');
  mkdirSync(root, { recursive: true });
  writeAtomic(join(root, 'INDEX.md'), text);
  return text;
}

// ── 注入给 AI 的软提示词 ─────────────────────────────────────────────────────

/**
 * This block is what makes the feature work for *any* MCP client: MCP delivers
 * `instructions` on initialize, so no per-client skill installation is needed.
 */
export function memoryInstructions(root = defaultMemoryRoot()) {
  return [
    '网站记忆 / Site memory (enabled):',
    `- Folder: ${root}`,
    '- Before operating any website (publish, upload, submit, change settings, bulk actions), call `site_memory` with action "brief" and the site domain. If a playbook exists, follow it instead of re-exploring the page structure.',
    '- If it answers NO_PLAYBOOK, work normally, then call `site_memory` action "record" once with what you learned: entry URL, steps, selectors, pitfalls, and how you verified success.',
    '- You decide per task whether anything is worth saving. After a run on a known site, record the status plus a one-line note only if it confirms or changes the playbook; for a throwaway probe, skip recording and tell the user "not saved". Add knowledge fields only when something was new or different.',
    '- Store operation knowledge only. Never store credentials, cookies, tokens, verification codes, or data copied from the site.',
    '- The user can see and turn this off in the AgentLimb side panel → Settings → Site memory.',
  ].join('\n');
}

// ── 自动提示：不依赖客户端是否把 instructions 交给模型 ────────────────────────

/**
 * Some MCP clients load tools lazily or never show `instructions` to the model,
 * so the soft prompt alone is not enough (a real WorkBuddy run posted to Tieba
 * and never touched site_memory). The host sees every navigation and every
 * `say`, so it can put the right sentence into a tool result the model is
 * guaranteed to read:
 *   - first time a site is opened in a session: its playbook (or "none yet");
 *   - when the agent calls `say` to finish: a one-time nudge to record.
 * One instance per MCP session. It only talks; it never writes to disk.
 */
export function createMemoryHints() {
  const seen = new Set();
  const recorded = new Set();
  const reminded = new Set();
  return {
    navigated(root, url) {
      if (!/^https?:\/\//i.test(String(url || ''))) return '';
      const domain = normDomain(url);
      if (!domain || seen.has(domain)) return '';
      seen.add(domain);
      const result = brief(root, domain);
      if (result.found) return `SITE MEMORY (auto) — follow this playbook instead of re-exploring ${domain}:\n${result.text}`;
      return `SITE MEMORY (auto): no playbook for ${domain} yet. When the task is done and you learned how to operate it, call site_memory once: {action:"record", site:"${domain}", status, entry, steps, selectors, pitfalls, verify}. Skip it for throwaway probes.`;
    },
    recorded(site) {
      const domain = normDomain(site);
      if (domain) recorded.add(domain);
    },
    finishing() {
      const pending = [...seen].filter((domain) => !recorded.has(domain) && !reminded.has(domain));
      if (!pending.length) return '';
      pending.forEach((domain) => reminded.add(domain));
      return `SITE MEMORY (auto): you operated ${pending.join(', ')} this session but have not recorded it. If you learned how to do it (or the playbook was wrong), call site_memory {action:"record"} now — one call, entry/steps/selectors/pitfalls/verify. For a throwaway probe, skip and tell the user "not saved".`;
    },
  };
}
