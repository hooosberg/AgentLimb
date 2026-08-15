/**
 * Connection protocol section.
 * Lifecycle: connect → call tools → complete.
 */
export function buildProtocolSection(ctx = {}) {
  const cmd = ctx.clientCommand || 'terminal-client';
  const name = ctx.terminalName || 'Terminal';
  const type = ctx.terminalType || 'claude-code';
  const taskId = ctx.taskId;

  const startCmd = taskId
    ? `${cmd} start --name "${name}" --type "${type}" --task-id "${taskId}"`
    : `${cmd} start --name "${name}" --type "${type}"`;

  const extensionOnline = Boolean(ctx.extensionOnline);
  const offlineRecovery = extensionOnline
    ? '> **If the response contains `"extensionOffline": true`** (rare) → reload the AgentLimb extension in Chrome, then re-run `start`.'
    : '> **If the response contains `"extensionOffline": true`** → return to Step 0, confirm the extension is enabled and connected to the Bridge, then re-run `start`.';

  const lines = [
    '## Connection Protocol',
    '',
    '### Lifecycle',
    '',
    `**1. Connect**`,
    '```',
    startCmd,
    '```',
    'Done automatically: register terminal → claim task → fetch initial context (tabs_context + page_snapshot).',
    'The response includes `task.id` — every subsequent operation needs it.',
    '',
    offlineRecovery,
    '',
    '**2. Call a tool**',
    '```',
    `${cmd} call --tool <tool_name> --params '<JSON>'`,
    '```',
    '',
    '**3. Finish the task (three fixed steps, in order)**',
    '',
    'Step A — commit muscle (required, otherwise selectors auto-captured this run are lost):',
    '```',
    `${cmd} call --tool muscle_commit --params '{"status":"success","verification":"<how you verified>"}'`,
    '```',
    'Four status values: `manual` (mid-task save, does not end the task) / `success` / `partial` / `failed`.',
    '',
    'Step B — push side-panel terminal state (**required**, otherwise a timeout fires after 5 minutes):',
    '```',
    `${cmd} call --tool task_complete --params '{"summary":"<one-line result>"}'`,
    '```',
    'On failure, use:',
    '```',
    `${cmd} call --tool task_fail --params '{"reason":"<failure reason>","stepIndex":<failed step index>}'`,
    '```',
    '> **Progress reporting**: call `task_step_done --params \'{"index":N,"ok":true,"note":"..."}\'` every time a logical plan step finishes — this is the only signal the side panel uses to advance progress. Plan your `task_plan.steps` at the logical level (2–5 entries, not one per tool call). Skipping ahead is supported: `index=N` force-marks steps 0..N-1 done.',
    '',
    'Step C — end the terminal session:',
    '```',
    `${cmd} complete --task-id "<task.id>" --ok true --output "<result summary>"`,
    '```',
    'On failure: `--ok false --error "<error description>"` (step A uses status=failed to discard candidates; step B uses task_fail).',
    '',
    '### Status check',
    '```',
    `${cmd} status`,
    '```',
  ];

  return lines.join('\n');
}
