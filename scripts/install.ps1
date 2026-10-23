# AgentLimb installer (Windows). All install logic lives in the Node CLI.
$ErrorActionPreference = 'Stop'

$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) {
  throw 'Node.js 18 or newer is required. Install Node.js, then run this script again.'
}
$VersionText = (& $Node.Source -p 'process.versions.node')
if ($LASTEXITCODE -ne 0 -or $VersionText -notmatch '^([0-9]+)\.' -or [int]$Matches[1] -lt 18) {
  throw "Node.js 18 or newer is required (found $VersionText)."
}

$Root = Split-Path -Parent $PSScriptRoot
& $Node.Source (Join-Path $Root 'bin/agentlimb.mjs') install @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
