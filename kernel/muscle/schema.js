const MVP_HOST_BASE_URL = 'http://127.0.0.1:7791';

/**
 * Normalize a URL or hostname to a plain lowercase domain string.
 * Mirrors the logic in host/mvp/muscle-fs.js (kept in sync manually).
 */
export function normalizeDomain(input) {
  if (!input || typeof input !== 'string') return null;
  let d = input.trim().toLowerCase();
  const hasProtocol = /^https?:\/\//.test(d);
  d = d.replace(/^https?:\/\//, '');
  if (!hasProtocol && d.includes('/')) return null;
  d = d.split('/')[0];
  if (!d) return null;
  if (/[\\<>:"|?*\x00-\x1f]/.test(d) || d === '..' || d === '.') return null;
  return d;
}

/**
 * Create a blank SiteProfile for a given domain.
 */
export function createEmptyProfile(domain) {
  const d = normalizeDomain(domain);
  if (!d) throw new Error(`Invalid domain: ${domain}`);
  return {
    domain: d,
    lastUpdatedAt: new Date().toISOString(),
    version: 0,
    notes: [],
    selectors: {},
    workflows: [],
  };
}

/**
 * Lightweight validation — just ensure required fields are present and typed correctly.
 * Does not validate every leaf; trusts AI-generated content otherwise.
 */
export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') return false;
  if (typeof profile.domain !== 'string' || !profile.domain) return false;
  if (!Array.isArray(profile.notes)) return false;
  if (typeof profile.selectors !== 'object' || profile.selectors === null) return false;
  if (!Array.isArray(profile.workflows)) return false;
  return true;
}
