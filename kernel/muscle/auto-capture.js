/**
 * Auto-capture flush logic — called when a sedimentation event fires:
 *
 *   - Task complete with status=success  → flush all buffered selectors
 *   - Task complete with status=partial  → flush, mark workflow as partial
 *   - Task complete with status=failed   → drop buffer (no pollution)
 *   - AI/user calls muscle_commit        → flush immediately, keep buffer (status=manual)
 *
 * Grouping: buffer entries by domain, build a patch per domain, merge into
 * the hot profile, add to pending for Host sync, then write to Host.
 */

import { normalizeDomain, createEmptyProfile } from './schema.js';
import { mergeProfile } from './merge.js';

/**
 * @param {object} deps - { store, nowISO? }
 * @param {object} params - { taskId, status, note?, workflowName?, verification?, stepsCompleted? }
 * @returns {Promise<object>} summary of what happened
 */
export async function flushSession(deps, params) {
  const { store } = deps;
  const nowISO = deps.nowISO || (() => new Date().toISOString());
  const { taskId, status } = params;

  if (!taskId) {
    return { ok: false, error: 'taskId is required' };
  }

  const entries = await store.readSession(taskId);

  // Failed tasks drop the buffer — don't pollute the muscle with wrong paths.
  if (status === 'failed') {
    await store.clearSession(taskId);
    return {
      ok: true,
      action: 'dropped',
      reason: 'task_failed',
      droppedEntries: entries.length,
    };
  }

  if (!entries || entries.length === 0) {
    // Manual commit with empty buffer — nothing to do but not an error.
    return { ok: true, action: 'noop', reason: 'empty_session' };
  }

  // Group by domain
  const byDomain = new Map();
  for (const entry of entries) {
    const d = normalizeDomain(entry.domain);
    if (!d) continue;
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(entry);
  }

  const flushed = [];

  for (const [domain, items] of byDomain) {
    const patch = buildPatch(items, params, nowISO);
    const base = (await store.get(domain)) || createEmptyProfile(domain);
    const merged = mergeProfile(base, patch);

    await store.setHot(domain, merged);
    await store.addPending(domain);

    try {
      await store.writeToHost(domain, merged);
      await store.removePending(domain);
      flushed.push({ domain, ok: true, version: merged.version, entries: items.length });
    } catch (err) {
      flushed.push({
        domain,
        ok: false,
        error: err.message || String(err),
        version: merged.version,
        note: 'hot layer updated; Host write will retry on next flush',
      });
    }
  }

  // Manual commit keeps buffer so the session can keep accumulating.
  // success/partial complete clears it — the task is over.
  if (status !== 'manual') {
    await store.clearSession(taskId);
  }

  return { ok: true, action: 'flushed', status, flushed };
}

/**
 * Build a SiteProfile patch from session entries + flush metadata.
 */
function buildPatch(items, params, nowISO) {
  const { status, note, workflowName, verification, stepsCompleted } = params;

  const selectors = {};
  for (const item of items) {
    const key = item.label || item.role || 'unlabeled';
    if (!selectors[key]) selectors[key] = [];
    selectors[key].push({
      value: item.selector,
      type: 'css',
      reliability: 0.8,
      lastTestedAt: item.at || nowISO(),
    });
  }

  const patch = { selectors };

  // Add a note for manual commits / partial / failed — lets future runs understand context.
  const noteTexts = [];
  if (status === 'manual' && note) {
    noteTexts.push(`[manual commit] ${note}`);
  }
  if (status === 'partial') {
    const stepPart = stepsCompleted ? ` (reached step ${stepsCompleted})` : '';
    noteTexts.push(`[partial]${stepPart} ${verification || ''}`.trim());
  }
  if (verification && status === 'success') {
    // Keep success verification as note too — useful avoidance data
    noteTexts.push(`[success verification] ${verification}`);
  }
  if (noteTexts.length > 0) {
    patch.notes = noteTexts.map((text) => ({ at: nowISO(), text }));
  }

  // Build workflow if we have a name or this is a full task completion
  if (workflowName || (status === 'success' && items.length >= 2)) {
    const workflowId = (workflowName || `auto-${Date.now()}`).toLowerCase().replace(/\s+/g, '-');
    const steps = items.map(
      (it, i) =>
        `${i + 1}. click${it.label ? ` "${it.label}"` : ''} (${it.role}, selector: ${it.selector})`,
    );
    patch.workflows = [
      {
        id: workflowId,
        name: workflowName || `auto-captured workflow ${new Date().toISOString().slice(0, 10)}`,
        description:
          status === 'partial'
            ? `partial workflow${stepsCompleted ? ` (reached step ${stepsCompleted})` : ''}`
            : status === 'manual'
              ? `manual commit: ${note || 'no note'}`
              : verification || 'auto-captured action sequence',
        steps,
        partial: status === 'partial',
        stepsCompleted: stepsCompleted || items.length,
        lastSucceededAt: status === 'success' ? nowISO() : null,
        successCount: status === 'success' ? 1 : 0,
      },
    ];
  }

  return patch;
}
