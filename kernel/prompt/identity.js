import { APP_BUILD, APP_NAME, APP_VERSION } from '../shared/constants.js';

/**
 * The onboarding prompt is independent from extension installation paths.
 * The browser supplies identity metadata; GitHub hosts the small companion payload.
 */
export function buildIdentitySection(ctx = {}) {
  const name = ctx.appName || APP_NAME;
  const version = ctx.appVersion || APP_VERSION;
  const hostUrl = ctx.hostBaseUrl || 'http://127.0.0.1:7791';
  const clientCmd = ctx.clientCommand || 'agentlimb';
  const platform = ctx.platform || '';
  const browserName = ctx.browserName || 'Chromium browser';
  const extensionId = ctx.extensionId || '';
  const bridgeOnline = Boolean(ctx.bridgeOnline);
  const extensionOnline = Boolean(ctx.extensionOnline);
  const hasMission = Boolean(ctx.mission);
  const isWindows = /win/i.test(platform);
  const statusCommand = isWindows
    ? `Invoke-WebRequest "${hostUrl}/api/mvp/status" -UseBasicParsing`
    : `curl -sf ${hostUrl}/api/mvp/status`;
  // Keep every bootstrap URL on the github.com domain: raw.githubusercontent.com and
  // codeload.github.com are unreliable or unreachable in many regions (notably mainland China),
  // which previously deadlocked first-run setup on real Windows machines.
  const runtimeUrl = `https://github.com/hooosberg/AgentLimb/releases/download/v${version}/agentlimb-runtime-v${version}-${APP_BUILD}.zip`;
  const checksumUrl = `https://github.com/hooosberg/AgentLimb/releases/download/v${version}/SHA256SUMS.txt`;

  const lines = [
    `# ${name} v${version} - Browser Automation Runtime`,
    '',
    'AgentLimb connects an AI agent to the active Chromium-based browser through its standard local MCP Runtime.',
    '',
    '## Step 0: Runtime',
    '',
  ];

  if (bridgeOnline && extensionOnline) {
    lines.push(
      hasMission
        ? `The Runtime and extension are ready. Run \`${clientCmd} mcp\` or use the configured MCP server for the mission.`
        : 'The Runtime and extension are ready. No browser mission is present; wait for one without creating a task.',
    );
  } else if (bridgeOnline) {
    lines.push(
      `Runtime status: online at ${hostUrl}.`,
      extensionOnline
        ? ''
        : 'Enable the AgentLimb extension in the active Chromium browser, then reload the page.',
      hasMission ? `Use \`${clientCmd} mcp\` for the mission.` : 'No browser mission is present; wait for one without creating a task.',
    );
  } else {
    lines.push(
      `Verify: \`${statusCommand}\``,
      '',
    );
    if (isWindows) {
      lines.push(
        'If the Runtime is offline, request explicit approval before setup. Download the small matching Runtime only from the fixed official GitHub source URL, verify its SHA-256 file, extract it to a temporary directory, then run its platform installer with the Extension ID.',
        '',
        `- Runtime: ${runtimeUrl}`,
        `- SHA-256: ${checksumUrl}`,
        `- Windows installer: \`scripts\\install.ps1 -ExtensionId ${extensionId || '<extension-id>'}\``,
        '',
        'Do not scan browser profiles, desktop folders, zip files, or source directories. Do not substitute another download source or version.',
        '',
        `Then re-verify: \`${statusCommand}\`.`,
      );
    } else {
      lines.push(
        'If the Runtime is offline on macOS, follow the platform path in order — starting an already-installed Runtime needs no download and no approval:',
        '',
        '1. Start the installed Runtime service directly:',
        '   `launchctl kickstart -k gui/$(id -u)/com.agentlimb.bridge 2>/dev/null || (cd ~/.agentlimb/runtime && nohup "$(command -v node)" kernel/bridge/mvp/run-server.js >> /tmp/agentlimb-bridge.log 2>&1 &)`',
        '   A direct start is the normal fallback when launchd registration is unavailable (agent terminals outside the GUI session).',
        '2. Only if `~/.agentlimb` does not exist (first run): request explicit approval, download the small matching Runtime from the fixed official GitHub source URL, verify its SHA-256 file, extract it to a temporary directory, then run the installer with the Extension ID.',
        `- Runtime: ${runtimeUrl}`,
        `- SHA-256: ${checksumUrl}`,
        `- macOS installer: \`scripts/install.sh --extension-id ${extensionId || '<extension-id>'}\``,
        '',
        'Do not scan browser profiles, desktop folders, zip files, or source directories. Do not substitute another download source or version.',
        '',
        `Then re-verify: \`${statusCommand}\`.`,
      );
    }
  }

  lines.push(
    '',
    '## Environment',
    '',
    `- Bridge:       ${hostUrl}${bridgeOnline ? ' online' : ' offline'}`,
    `- Extension:    ${extensionOnline ? 'online' : 'unconfirmed'}`,
    `- Browser:      ${browserName}`,
    extensionId ? `- Extension ID: ${extensionId}` : '',
    platform ? `- Platform:     ${platform}` : '',
    `- MCP command:  \`${clientCmd} mcp\``,
    '',
    '## Bootstrap Boundary',
    '',
    'Without a Mission, Step 0 status and approved Runtime setup are allowed. Do not call browser tools, navigate, snapshot pages, or create a task. Once the Runtime is online, wait for a real browser Mission.',
  );

  return lines.filter(Boolean).join('\n');
}
