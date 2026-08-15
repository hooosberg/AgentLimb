import { readFile, writeFile, rename, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mergeProfile } from '../../muscle/merge.js';
import { createEmptyProfile } from '../../muscle/schema.js';

const MUSCLE_DIR_ENV = 'AGENTLIMB_MUSCLE_DIR';
const DEFAULT_MUSCLE_DIR = join(homedir(), 'Desktop', 'AgentLimb-muscle');
const INDEX_FILE = 'index.json';
const README_FILE = 'README.md';

const README_CONTENT = `# AgentLimb Muscle Memory

⚠️  **Please do not delete this folder.**

This folder stores the "muscle memory" AgentLimb builds up while helping you operate websites:
reliable button selectors, verified workflows, and per-site notes.

**Why it matters**
- With this memory, the next time the AI operates the same site it can work directly, skipping redundant exploration.
- Saves significant tokens and waiting time (typically 60–80% fewer exploration steps).
- Even if you uninstall and reinstall the extension, as long as this folder exists all memory is restored automatically.

**File guide**
- Each \`.json\` file corresponds to one site; the filename is the domain (e.g. \`x.com.json\`).
- \`index.json\` is an auto-maintained index with the basic info for every site.
- This file (\`README.md\`) is informational — read it anytime.

**Security note**
- These files only store UI-structure knowledge (selectors, workflow descriptions). They do not store credentials or private data.

Questions or feedback are welcome. Thank you for using AgentLimb!
`;


function getMuscleDir() {
  return process.env[MUSCLE_DIR_ENV] || DEFAULT_MUSCLE_DIR;
}

function normalizeDomain(domain) {
  if (!domain || typeof domain !== 'string') return null;
  let d = domain.trim().toLowerCase();
  const hasProtocol = /^https?:\/\//.test(d);
  // Strip protocol
  d = d.replace(/^https?:\/\//, '');
  // Without protocol, a '/' means it's a path, not a domain
  if (!hasProtocol && d.includes('/')) return null;
  // Strip path (only strips when protocol was present)
  d = d.split('/')[0];
  if (!d) return null;
  // Validate: no dangerous chars
  if (/[\\<>:"|?*\x00-\x1f]/.test(d) || d === '..' || d === '.') return null;
  return d;
}

async function ensureDir() {
  const dir = getMuscleDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  // Write README on first setup or if it was deleted.
  const readmePath = join(dir, README_FILE);
  if (!existsSync(readmePath)) {
    await writeFile(readmePath, README_CONTENT, 'utf8');
  }
  return dir;
}

async function readProfile(domain) {
  const d = normalizeDomain(domain);
  if (!d) throw new Error(`Invalid domain: ${domain}`);
  // Wait for any in-progress write on this domain so reads never return stale data
  try { await (domainLocks.get(d) ?? Promise.resolve()); } catch (_) {}
  return readProfileRaw(d);
}

async function writeProfile(domain, profile) {
  const d = normalizeDomain(domain);
  if (!d) throw new Error(`Invalid domain: ${domain}`);
  const dir = await ensureDir();
  const filePath = join(dir, `${d}.json`);
  const tmpPath = `${filePath}.tmp`;
  const data = JSON.stringify(profile, null, 2);
  await writeFile(tmpPath, data, 'utf8');
  await rename(tmpPath, filePath);
  // Update index
  await _updateIndex(d, filePath, data.length);
  return { path: filePath, bytes: data.length };
}

async function listDomains() {
  const dir = await ensureDir(); // recreate if deleted (also restores README.md)
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const results = [];
  for (const name of entries) {
    if (!name.endsWith('.json') || name === INDEX_FILE) continue;
    const domain = name.slice(0, -5);
    try {
      const s = await stat(join(dir, name));
      results.push({ domain, sizeBytes: s.size, mtimeMs: s.mtimeMs });
    } catch {
      // file disappeared between readdir and stat
    }
  }
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results;
}

async function readIndex() {
  const dir = getMuscleDir();
  const indexPath = join(dir, INDEX_FILE);
  try {
    const raw = await readFile(indexPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    // Derive from directory listing
    const domains = await listDomains();
    return { domains };
  }
}

async function _updateIndex(domain, filePath, bytes) {
  const dir = getMuscleDir();
  const indexPath = join(dir, INDEX_FILE);
  let index = { domains: [] };
  try {
    const raw = await readFile(indexPath, 'utf8');
    index = JSON.parse(raw);
  } catch { /* start fresh */ }

  const existing = index.domains.find(d => d.domain === domain);
  const entry = { domain, path: filePath, bytes, updatedAt: new Date().toISOString() };
  if (existing) {
    Object.assign(existing, entry);
  } else {
    index.domains.push(entry);
  }
  const tmpPath = `${indexPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(index, null, 2), 'utf8');
  await rename(tmpPath, indexPath);
}

// ── Per-domain write lock ─────────────────────────────────────────────────────
// Serializes concurrent operations on the same domain so that a parallel
// muscle_recall never reads stale data while a muscle_remember is mid-write.
const domainLocks = new Map(); // domain → Promise<void> (the lock being held)

async function withDomainLock(domain, fn) {
  const prev = domainLocks.get(domain) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  domainLocks.set(domain, current);
  try { await prev; } catch (_) {}
  try {
    return await fn();
  } finally {
    release();
    if (domainLocks.get(domain) === current) domainLocks.delete(domain);
  }
}

/**
 * Atomic read-merge-write under per-domain lock.
 * Use this instead of separate GET+POST to avoid race conditions with
 * concurrent muscle_recall calls.
 */
async function mergeAndWriteProfile(domain, patch) {
  const d = normalizeDomain(domain);
  if (!d) throw new Error(`Invalid domain: ${domain}`);
  return withDomainLock(d, async () => {
    const base = await readProfileRaw(d);
    const merged = mergeProfile(base || createEmptyProfile(d), patch);
    const result = await writeProfileRaw(d, merged);
    return { ...result, profile: merged };
  });
}

// Internal raw read/write that skip the lock (called from within the lock).
async function readProfileRaw(d) {
  const dir = getMuscleDir();
  const filePath = join(dir, `${d}.json`);
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeProfileRaw(d, profile) {
  const dir = await ensureDir();
  const filePath = join(dir, `${d}.json`);
  const tmpPath = `${filePath}.tmp`;
  const data = JSON.stringify(profile, null, 2);
  await writeFile(tmpPath, data, 'utf8');
  await rename(tmpPath, filePath);
  await _updateIndex(d, filePath, data.length);
  return { path: filePath, bytes: data.length };
}

export { getMuscleDir, normalizeDomain, readProfile, writeProfile, mergeAndWriteProfile, listDomains, readIndex };
