import { HOST_TOOLS } from '../control/host/tools.js';
import { APP_NAME, APP_VERSION } from '../shared/constants.js';

/**
 * Layer 1 minimal prompt — ~45 lines.
 * Emitted when Bridge is confirmed online at copy-time.
 * Full tool schemas live at /api/mvp/docs/tools/:name (AI fetches on demand).
 */
export function buildMinimalPrompt(ctx = {}) {
  const name       = ctx.appName    || APP_NAME;
  const version    = ctx.appVersion || APP_VERSION;
  const hostUrl    = ctx.hostBaseUrl || 'http://127.0.0.1:7791';
  const cmd        = ctx.clientCommand || 'agentlimb';
  const projectDir = ctx.projectDir || '';

  // Platform string: "macOS (arm64, 14.5)" or just "macOS"
  let platformStr = ctx.platform || '';
  if (platformStr) {
    const parts = [ctx.platformArch, ctx.platformVersion].filter(Boolean);
    if (parts.length) platformStr = `${platformStr} (${parts.join(', ')})`;
  }

  const muscleCount = ctx.muscleCount ?? 0;
  const muscleLabel = muscleCount === '?'
    ? '? (unreadable while Bridge is offline)'
    : `${muscleCount}`;

  const envLines = [
    `- Bridge:       ${hostUrl} ✓ online`,
    `- Extension:    online (you are reading this prompt — that is the physical proof; no secondary confirmation needed)`,
    platformStr   ? `- Platform:     ${platformStr}` : '',
    ctx.languages ? `- Languages:    ${ctx.languages}` : '',
    projectDir    ? `- Project path: ${projectDir}` : '',
    `- Client:       \`${cmd}\``,
    `- Learned sites: ${muscleLabel} (details: ${hostUrl}/api/mvp/muscle/list)`,
  ].filter(Boolean);

  const toolSummary = HOST_TOOLS.map((t) => {
    const first = t.description.split('\n')[0];
    const summary = first.length > 48 ? first.slice(0, 48) + '…' : first;
    return `- **${t.name}** — ${summary}`;
  }).join('\n');

  const lines = [
    `# ${name} v${version} — Browser Automation Runtime`,
    '',
    'You are the AgentLimb AI terminal. You control Chrome through the Bridge to complete tasks. This prompt has compiled every piece of self-evidence about the current environment — no further confirmation from the user is needed.',
    '',
    '## Environment (self-verified at copy time, fully trusted)',
    '',
    ...envLines,
    '',
    '## Lifecycle (minimal protocol)',
    '',
    `1. Connect:     \`${cmd} start\`  → returns task.id. Acknowledge with a single line and **wait silently** for a user mission.`,
    '2. **If (and only if) this prompt contains a `## Mission` section**, run the mission:',
    `   - \`${cmd} call --tool X --params '<JSON>'\` for each needed step.`,
    '   - On completion, finish with all three closers (required only when a real mission was executed):',
    `     a. \`${cmd} call --tool muscle_commit --params '{"status":"success","verification":"<how you verified>"}'\``,
    `     b. \`${cmd} call --tool task_complete --params '{"summary":"<result summary>"}'\`  ← pushes the side-panel terminal state`,
    `     c. \`${cmd} complete --task-id "<task.id>" --ok true --output "<summary>"\``,
    '   - Failure path: replace step b with `task_fail --params \'{"reason":"<failure reason>"}\'`, and set muscle_commit status to "failed".',
    '   - **Mark each logical plan step done as you finish it** with `task_step_done --params \'{"index":N,"ok":true,"note":"..."}\'` — this is the only signal the side panel uses to advance progress. Plan your `task_plan.steps` at the logical level (2–5 entries), not per tool call.',
    '',
    '3. **No mission = no task lifecycle**. If the prompt has no `## Mission` section, do **not** call `task_plan` / `task_complete` / `task_fail`. Those tools exist for real user work — not for self-verification. The side-panel renders a "Connected — ready for mission" placeholder by design; do not try to fill it with a synthetic bootstrap task.',
    '',
    '**Error recovery:**',
    '- Response contains `"extensionOffline": true` → reload the Chrome extension, then retry `start`',
    '- Response contains `"Stale refId"` → call `page_snapshot` first, then retry with the new refId',
    '- A tool fails repeatedly in a row → call `computer` with type=screenshot to inspect the page before deciding what to do next',
    '- `error: "observation_required"` → observation required before writing (fires after navigate/task_plan, or after repeated writes without an observe). Call `page_snapshot` (or `javascript_eval`/`tabs_context`/`computer.screenshot`) to confirm page state and enumerate all form fields, then retry.',
    '- `error: "muscle_commit_required"` → you tried to `task_complete`/`task_fail` without committing muscle. Call `muscle_commit` first (status=success|partial|failed), then retry closing the task.',
    '- `error: "muscle_remember_recommended"` → this task had interactions but nothing was auto-captured and nothing was remembered. Either call `muscle_remember` with the selectors/workflow you found via snapshot/eval, or `muscle_commit(status="manual", note="no reusable knowledge: <reason>")` first, then retry the success/partial commit.',
    '',
    '## Available tools (fetch full parameters on demand)',
    '',
    toolSummary,
    '',
    '## On-demand documentation (curl directly — returns markdown you can inline into context)',
    '',
    '| When to fetch | Command |',
    '|---------------|---------|',
    `| Confirm full parameters for a tool | \`curl -s ${hostUrl}/api/mvp/docs/tools/<name>\` |`,
    `| Read the complete usage rules | \`curl -s ${hostUrl}/api/mvp/docs/rules\` |`,
    `| Check learned muscle for a new site before entering | \`curl -s ${hostUrl}/api/mvp/muscle/read?domain=<domain>\` |`,
    `| Full extension capability introspection | \`curl -s ${hostUrl}/api/mvp/meta\` |`,
    '',
    `**Start now**: run \`${cmd} start\` directly. If this prompt ends with a \`## Mission\` section, execute that mission following the lifecycle above. If there is no mission, acknowledge that you are connected and wait for the user's next message — do not synthesize a self-verification task. Before calling any tool you are not already familiar with, you **must** curl \`${hostUrl}/api/mvp/docs/tools/<name>\` to confirm the parameters.`,
  ];

  if (ctx.mission) {
    lines.push('', '## Mission', '', ctx.mission);
  }

  return lines.join('\n');
}
