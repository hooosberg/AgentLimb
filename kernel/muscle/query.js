import { normalizeDomain } from './schema.js';

/**
 * Resolve the best domain key for a given URL or hostname.
 * Returns: { domain, domainGroup } where domainGroup is the eTLD+1.
 */
export function resolveDomainKeys(urlOrHost) {
  const domain = normalizeDomain(urlOrHost);
  if (!domain) return null;

  // Build domainGroup: last two parts (e.g. tieba.baidu.com → baidu.com)
  const parts = domain.split('.');
  const domainGroup = parts.length >= 2 ? parts.slice(-2).join('.') : domain;

  return { domain, domainGroup };
}

/**
 * Given a store with get(domain) method, look up the best matching profile for a URL.
 * Priority: exact domain → domainGroup → null
 */
export async function queryProfile(store, urlOrHost) {
  const keys = resolveDomainKeys(urlOrHost);
  if (!keys) return null;

  const exact = await store.get(keys.domain);
  if (exact) return { profile: exact, matchType: 'exact', domain: keys.domain };

  if (keys.domainGroup !== keys.domain) {
    const group = await store.get(keys.domainGroup);
    if (group) return { profile: group, matchType: 'domainGroup', domain: keys.domainGroup };
  }

  return null;
}
