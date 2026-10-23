#!/usr/bin/env node
/**
 * 网站记忆 chaos test: random brief/record/status calls with hostile input,
 * checking invariants after every step instead of exact outputs.
 *
 *   node scripts/memory-monkey.mjs [rounds=3000] [seed=1]
 *
 * Invariants: nothing is written outside the root; no secret ever reaches disk;
 * a playbook stays under 120 lines; run counters equal session files;
 * brief never throws.
 */
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brief, ensureMemory, findSite, record, stats } from '../host/memory.mjs';

const rounds = Number(process.argv[2]) || 3000;
let seed = Number(process.argv[3]) || 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (list) => list[Math.floor(rnd() * list.length)];

const SITES = ['a.example', 'https://www.b.example/x?y=1', 'm.c.example', '../../evil', '..', 'x/../y', '', '站点.中国', 'd.example:8443'];
const SECRET = 'S3cr3tVALUE9876';
const TEXTS = ['', '入口 https://a.example/go', `password: ${SECRET}`, `Authorization: Bearer ${SECRET}${SECRET}`, '1) 点 2) 填\n3) 提交', `token=${SECRET}`, 'x'.repeat(500), '按钮 → button.primary → 唯一'];
const STATUS = ['success', 'fail', 'partial', 'bogus', undefined];

const base = mkdtempSync(join(tmpdir(), 'memory-monkey-'));
const root = join(base, 'kb');
ensureMemory(root);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    statSync(full).isDirectory() ? walk(full, out) : out.push(full);
  }
  return out;
}

let recorded = 0;
for (let i = 0; i < rounds; i += 1) {
  const site = pick(SITES);
  if (rnd() < 0.3) {
    brief(root, site); // must never throw
    continue;
  }
  try {
    record(root, {
      site, status: pick(STATUS), title: pick(TEXTS), entry: pick(TEXTS), steps: pick(TEXTS), selectors: pick(TEXTS),
      pitfalls: pick(TEXTS), verify: pick(TEXTS), note: pick(TEXTS), task: pick(TEXTS), capabilities: rnd() < 0.5 ? ['cap'] : undefined,
    });
    recorded += 1;
  } catch (error) {
    if (!/合法的 site/.test(error.message)) throw error;
  }
}

const failures = [];
const files = walk(root);
for (const file of files) {
  if (!file.startsWith(root)) failures.push(`escaped: ${file}`);
  const text = readFileSync(file, 'utf8');
  if (text.includes(SECRET)) failures.push(`secret on disk: ${file}`);
  if (file.endsWith('PLAYBOOK.md') && !file.includes('_template') && text.split('\n').length >= 120) failures.push(`oversized: ${file}`);
}
for (const entry of readdirSync(base)) if (entry !== 'kb') failures.push(`write outside root: ${entry}`);
const summary = stats(root);
const runsInFm = readdirSync(join(root, 'knowledge', 'sites'))
  .filter((n) => !n.startsWith('_'))
  .reduce((sum, n) => sum + Number(findSite(root, n)?.fm.runs || 0), 0);
if (runsInFm !== summary.sessions) failures.push(`counter drift: front matter ${runsInFm} vs ${summary.sessions} session files`);

console.log(`memory-monkey: ${rounds} rounds, ${recorded} records, ${summary.sites} sites, ${files.length} files`);
if (failures.length) {
  console.error(failures.slice(0, 10).join('\n'));
  process.exit(1);
}
console.log('invariants hold ✔');
