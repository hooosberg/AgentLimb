import { APP_BUILD, APP_NAME, APP_VERSION } from '../shared/constants.js';

/**
 * The onboarding prompt is intentionally independent from extension source files.
 * The browser supplies identity metadata; the official Runtime release owns setup.
 */
export function buildIdentitySection(ctx = {}) {
  const name = ctx.appName || APP_NAME;
  const version = ctx.appVersion || APP_VERSION;
  const build = ctx.appBuild || APP_BUILD;
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
  const runtimeAsset = `agentlimb-runtime-v${version}-${build}.zip`;
  const releaseBase = `https://github.com/hooosberg/AgentLimb/releases/download/v${version}`;
  const runtimeUrl = `${releaseBase}/${runtimeAsset}`;
  const checksumUrl = `${releaseBase}/SHA256SUMS.txt`;

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
      'If the Runtime is offline, request explicit approval before setup. Download the matching Runtime only from the official GitHub Release, verify its SHA-256 entry in SHA256SUMS.txt, extract it to a temporary directory, then run its platform installer with the Extension ID.',
      '',
      `- Runtime: ${runtimeUrl}`,
      `- Checksums: ${checksumUrl}`,
      `- Windows installer: \`scripts\\install.ps1 -ExtensionId ${extensionId || '<extension-id>'}\``,
      `- macOS installer: \`scripts/install.sh --extension-id ${extensionId || '<extension-id>'}\``,
      '',
      'Do not scan browser profiles, desktop folders, zip files, or source directories. Do not substitute another download source or a different Runtime version.',
      '',
      `Then re-verify: \`${statusCommand}\`.`,
    );
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
