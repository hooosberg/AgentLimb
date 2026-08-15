/**
 * Serialize a SiteProfile into a Markdown string for injection into AI prompts.
 * Stays under ~800 tokens for a typical profile (2000 token hard cap enforced by truncation).
 */
const MAX_CHARS = 6000; // ~2000 tokens

export function profileToMarkdown(profile) {
  if (!profile) return '';

  const lines = [];
  lines.push(`## Site Knowledge (learned)`);
  lines.push('');
  lines.push(`**Site:** ${profile.domain}  |  knowledge version v${profile.version ?? 0}  |  updated: ${fmtDate(profile.lastUpdatedAt)}`);
  lines.push('');

  // Selectors
  const selectorRoles = Object.entries(profile.selectors || {});
  if (selectorRoles.length > 0) {
    lines.push('### Known element selectors');
    for (const [role, strategies] of selectorRoles) {
      // Only include strategies with reliability >= 0.5
      const reliable = (strategies || []).filter(s => (s.reliability ?? 1) >= 0.5);
      if (reliable.length === 0) continue;
      const best = reliable[0];
      const extras = reliable.slice(1).map(s => `\`${s.value}\``).join(' / ');
      lines.push(`- **${role}**: \`${best.value}\`${extras ? ` (alternatives: ${extras})` : ''}`);
    }
    lines.push('');
  }

  // Workflows
  const workflows = (profile.workflows || []).filter(w => (w.successCount ?? 0) >= 0);
  if (workflows.length > 0) {
    lines.push('### Known workflows');
    for (const wf of workflows) {
      const rate = wf.successCount ? `${wf.successCount} successful run(s)` : '';
      lines.push(`#### ${wf.name}${rate ? ` (${rate})` : ''}`);
      if (wf.description) lines.push(wf.description);
      if (Array.isArray(wf.steps) && wf.steps.length > 0) {
        for (let i = 0; i < wf.steps.length; i++) {
          lines.push(`${i + 1}. ${wf.steps[i]}`);
        }
      }
      lines.push('');
    }
  }

  // Notes
  const notes = profile.notes || [];
  if (notes.length > 0) {
    lines.push('### Notes');
    for (const note of notes.slice(-10)) { // only latest 10
      lines.push(`- ${note.text || note}`);
    }
    lines.push('');
  }

  lines.push('> The knowledge above comes from past operations and is advisory. If a selector no longer works or the workflow has changed, operate based on the current page state.');

  const result = lines.join('\n');
  if (result.length > MAX_CHARS) {
    return result.slice(0, MAX_CHARS) + '\n\n> (...knowledge truncated for length)';
  }
  return result;
}

export function isEmpty(profile) {
  if (!profile) return true;
  const hasNotes = (profile.notes || []).length > 0;
  const hasSelectors = Object.keys(profile.selectors || {}).length > 0;
  const hasWorkflows = (profile.workflows || []).length > 0;
  return !hasNotes && !hasSelectors && !hasWorkflows;
}

function fmtDate(iso) {
  if (!iso) return 'unknown';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
