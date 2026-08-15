/**
 * Deep-merge a patch into an existing SiteProfile.
 * Rules:
 *   notes     — append new entries (deduplicate by text+at pair)
 *   selectors — per role: append new values, update reliability+lastTestedAt for existing
 *   workflows — per id: replace if new, accumulate successCount
 *   version   — increment by 1
 *   lastUpdatedAt — always overwrite to now
 */
export function mergeProfile(base, patch) {
  const merged = {
    domain: base.domain,
    lastUpdatedAt: new Date().toISOString(),
    version: (base.version ?? 0) + 1,
    notes: mergeNotes(base.notes || [], patch.notes || []),
    selectors: mergeSelectors(base.selectors || {}, patch.selectors || {}),
    workflows: mergeWorkflows(base.workflows || [], patch.workflows || []),
  };
  return merged;
}

function mergeNotes(base, incoming) {
  const existing = new Set(base.map(n => `${n.at}|${n.text}`));
  const result = [...base];
  for (const note of incoming) {
    const key = `${note.at}|${note.text}`;
    if (!existing.has(key)) {
      result.push(note);
      existing.add(key);
    }
  }
  // Keep newest 50 notes max to avoid unbounded growth
  return result.slice(-50);
}

function mergeSelectors(base, incoming) {
  const result = { ...base };
  for (let [role, strategies] of Object.entries(incoming)) {
    // Normalize shorthand: {"role": "css-selector"} → array of strategy objects
    if (typeof strategies === 'string') {
      strategies = [{ value: strategies, type: 'css', reliability: 0.8, lastTestedAt: new Date().toISOString() }];
    }
    if (!Array.isArray(strategies)) continue;
    if (!result[role]) {
      result[role] = strategies;
      continue;
    }
    const existingByValue = new Map(result[role].map(s => [s.value, s]));
    for (const strategy of strategies) {
      if (existingByValue.has(strategy.value)) {
        // Update reliability and lastTestedAt
        Object.assign(existingByValue.get(strategy.value), {
          reliability: strategy.reliability ?? existingByValue.get(strategy.value).reliability,
          lastTestedAt: strategy.lastTestedAt ?? new Date().toISOString(),
        });
      } else {
        result[role].push(strategy);
        existingByValue.set(strategy.value, strategy);
      }
    }
    // Sort by reliability desc
    result[role].sort((a, b) => (b.reliability ?? 0) - (a.reliability ?? 0));
  }
  return result;
}

function mergeWorkflows(base, incoming) {
  const byId = new Map(base.map(w => [w.id, { ...w }]));
  for (const workflow of incoming) {
    if (!workflow.id) continue;
    if (byId.has(workflow.id)) {
      const existing = byId.get(workflow.id);
      // Accumulate successCount, keep other fields from incoming
      byId.set(workflow.id, {
        ...existing,
        ...workflow,
        successCount: (existing.successCount ?? 0) + (workflow.successCount ?? 0),
      });
    } else {
      byId.set(workflow.id, workflow);
    }
  }
  return Array.from(byId.values());
}
