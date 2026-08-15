import { APP_NAME, APP_VERSION } from '../shared/constants.js';

/**
 * Identity, environment, and startup section.
 *
 * At copy-time the sidepanel injects runtime metadata:
 *   extensionOnline  — always true (panel is open = extension is running)
 *   bridgeOnline     — current polling result
 *   platform         — OS detected from navigator
 *   projectDir       — installation path (stored by install.sh)
 *
 * These values collapse the multi-branch "situation A/B/C" into a single
 * precise instruction for the current user's environment.
 */
export function buildIdentitySection(ctx = {}) {
  const name            = ctx.appName        || APP_NAME;
  const version         = ctx.appVersion     || APP_VERSION;
  const hostUrl         = ctx.hostBaseUrl    || 'http://127.0.0.1:7791';
  const clientCmd       = ctx.clientCommand  || '';
  const projectDir      = ctx.projectDir     || '';
  const platform        = ctx.platform       || '';
  const extensionId     = ctx.extensionId    || '';
  const extensionOnline = Boolean(ctx.extensionOnline);
  const bridgeOnline    = Boolean(ctx.bridgeOnline);

  const isWindows = /win/i.test(platform);
  const knownPlatform = Boolean(platform);

  // Derive exact commands from actual paths — no templates when projectDir is known
  const serverPath = projectDir
    ? (isWindows
        ? `${projectDir.replace(/\//g, '\\')}\\kernel\\bridge\\mvp\\run-server.js`
        : `${projectDir}/kernel/bridge/mvp/run-server.js`)
    : null;

  const startCmd = serverPath
    ? (isWindows
        ? `$task = Get-ScheduledTask -TaskName "AgentLimb Bridge" -ErrorAction SilentlyContinue; if ($task) { Start-ScheduledTask -TaskName "AgentLimb Bridge" } else { Start-Process node -ArgumentList '"${serverPath}"' -WindowStyle Hidden }`
        : `launchctl kickstart -k gui/$(id -u)/com.agentlimb.bridge 2>/dev/null || nohup node "${serverPath}" > /tmp/agentlimb-bridge.log 2>&1 &`)
    : null;

  const checkCmd = isWindows
    ? `Invoke-WebRequest "${hostUrl}/api/mvp/status" -UseBasicParsing`
    : `curl -sf ${hostUrl}/api/mvp/status`;

  const logPath = isWindows ? '$env:TEMP\\agentlimb-bridge.log' : '/tmp/agentlimb-bridge.log';
  const logCmd  = isWindows ? `Get-Content "${logPath}" -Tail 100` : `tail -n 100 ${logPath}`;

  const step0 = buildStep0({
    bridgeOnline, extensionOnline, startCmd, checkCmd, logCmd, hostUrl, version,
    isWindows, knownPlatform, projectDir, logPath, extensionId,
  });

  const envLines = [
    `- Bridge:       ${hostUrl}${bridgeOnline ? ' ✓' : ''}`,
    `- Extension:    ${extensionOnline ? 'online (this prompt was generated live by the panel)' : 'unconfirmed'}`,
    clientCmd  ? `- Client command: \`${clientCmd}\`` : '',
    projectDir ? `- Project path:   ${projectDir}` : '',
    platform   ? `- Platform:       ${platform}` : '',
    `- Link chain:     Terminal → Bridge → Chrome Extension → CDP/DOM`,
    `- Bridge log:     ${logPath}`,
  ].filter(Boolean);

  return [
    `# ${name} v${version} — Browser Automation Runtime`,
    '',
    'You are the AgentLimb AI terminal. You control Chrome through a local Bridge to complete tasks. This prompt embeds every piece of connection information for the current environment — follow the steps directly.',
    '',
    ...step0,
    '',
    '## Environment',
    '',
    ...envLines,
  ].join('\n');
}

function buildStep0({ bridgeOnline, extensionOnline, startCmd, checkCmd, logCmd,
                      hostUrl, version, isWindows, knownPlatform, projectDir, extensionId }) {
  const shell = isWindows ? 'powershell' : 'bash';

  // ── Best case: both confirmed online ─────────────────────────────────────────
  if (bridgeOnline && extensionOnline) {
    return [
      '## Step 0: Confirm Bridge is online',
      '',
      '**Bridge and extension are both ready** (verified live when this prompt was copied). Run the `start` command directly.',
    ];
  }

  // ── Bridge online, extension confirmed ────────────────────────────────────────
  if (bridgeOnline) {
    return [
      '## Step 0: Confirm Bridge is online',
      '',
      `Bridge is online (${hostUrl}).`,
      extensionOnline ? '' : 'Confirm the AgentLimb extension is enabled in Chrome, then reload any page to finish the connection.',
    ].filter((l) => l !== undefined);
  }

  // ── Bridge offline ─────────────────────────────────────────────────────────────
  const lines = [
    '## Step 0: Start the Bridge',
    '',
    `Verify: \`${checkCmd}\``,
    '',
  ];

  if (startCmd) {
    // Exact path known — one precise command, no branching
    lines.push(
      '**If not online, run:**',
      '',
      `\`\`\`${shell}`,
      startCmd,
      '```',
      '',
      'Wait 3 seconds and re-verify.',
    );
  } else {
    // projectDir unknown — compact fallback, only show relevant platform
    const showMac = !knownPlatform || !isWindows;
    const showWin = !knownPlatform || isWindows;

    lines.push('**If not online:**', '');

    lines.push(
      'This is a one-time local runtime installation. Before downloading files, creating a scheduled task or LaunchAgent, changing PATH, or registering Native Messaging, ask the user for explicit approval. If you cannot execute terminal commands, show the relevant command block and do not claim that installation succeeded.',
      '',
    );

    if (showMac) {
      lines.push(
        '```bash',
        `VERSION="${version}"`,
        `EXTENSION_ID="${extensionId}"`,
        'SOURCE_ROOT="$(pwd)"',
        'is_agentlimb_source() {',
        '  [[ -f "$1/scripts/install.sh" && -f "$1/package.json" ]] && grep -q "\\\"version\\\": \\\"$VERSION\\\"" "$1/package.json"',
        '}',
        'if ! is_agentlimb_source "$SOURCE_ROOT"; then',
        '  WORK_DIR="${TMPDIR:-/tmp}/agentlimb-bootstrap-$VERSION"',
        '  rm -rf "$WORK_DIR" && mkdir -p "$WORK_DIR"',
        `  curl -fL "https://github.com/hooosberg/AgentLimb/archive/refs/tags/v${version}.zip" -o "$WORK_DIR/source.zip"`,
        '  unzip -q "$WORK_DIR/source.zip" -d "$WORK_DIR"',
        '  INSTALLER="$(find "$WORK_DIR" -maxdepth 3 -path "*/scripts/install.sh" -type f -print -quit)"',
        '  [[ -n "$INSTALLER" ]] || { echo "AgentLimb installer was not found in the versioned source archive." >&2; exit 1; }',
        '  SOURCE_ROOT="$(dirname "$(dirname "$INSTALLER")")"',
        '  is_agentlimb_source "$SOURCE_ROOT" || { echo "AgentLimb source version check failed." >&2; exit 1; }',
        'fi',
        'chmod +x "$SOURCE_ROOT/scripts/install.sh"',
        'if [[ -n "$EXTENSION_ID" ]]; then',
        '  "$SOURCE_ROOT/scripts/install.sh" --extension-id "$EXTENSION_ID"',
        'else',
        '  "$SOURCE_ROOT/scripts/install.sh"',
        'fi',
        'curl -sf http://127.0.0.1:7791/api/mvp/status',
        '```',
      );
      if (showWin) lines.push('');
    }

    if (showWin) {
      lines.push(
        '```powershell',
        `$version = "${version}"`,
        `$extensionId = "${extensionId}"`,
        '$sourceRoot = (Get-Location).Path',
        '$manifest = Join-Path $sourceRoot "package.json"',
        '$installer = Join-Path $sourceRoot "scripts\\install.ps1"',
        '$isAgentLimbSource = (Test-Path $installer) -and (Test-Path $manifest) -and (((Get-Content $manifest -Raw | ConvertFrom-Json).version) -eq $version)',
        'if (-not $isAgentLimbSource) {',
        '  $workDir = Join-Path $env:TEMP "agentlimb-bootstrap-$version"',
        '  Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue',
        '  New-Item -ItemType Directory -Path $workDir -Force | Out-Null',
        '  $archive = Join-Path $workDir "source.zip"',
        `  Invoke-WebRequest "https://github.com/hooosberg/AgentLimb/archive/refs/tags/v${version}.zip" -OutFile $archive`,
        '  Expand-Archive -Path $archive -DestinationPath $workDir -Force',
        '  $sourceRoot = Get-ChildItem $workDir -Directory | Where-Object {',
        '    $candidateInstaller = Join-Path $_.FullName "scripts\\install.ps1"',
        '    $candidateManifest = Join-Path $_.FullName "package.json"',
        '    (Test-Path $candidateInstaller) -and (Test-Path $candidateManifest) -and (((Get-Content $candidateManifest -Raw | ConvertFrom-Json).version) -eq $version)',
        '  } | Select-Object -First 1 -ExpandProperty FullName',
        '  if (-not $sourceRoot) { throw "AgentLimb source version check failed." }',
        '}',
        'Set-ExecutionPolicy -Scope Process Bypass -Force',
        'if ($extensionId) {',
        '  & (Join-Path $sourceRoot "scripts\\install.ps1") -ChromeExtensionId $extensionId',
        '} else {',
        '  & (Join-Path $sourceRoot "scripts\\install.ps1")',
        '}',
        'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
        `Invoke-WebRequest "${hostUrl}/api/mvp/status" -UseBasicParsing`,
        '```',
      );
    }
  }

  if (!extensionOnline) {
    lines.push('', 'Once the Bridge is ready, confirm the AgentLimb extension is enabled in Chrome and reload any page to connect.');
  }

  lines.push('', `If startup fails, inspect the log: \`${logCmd}\``);

  return lines;
}
