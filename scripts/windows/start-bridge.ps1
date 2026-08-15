[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$InstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$serverPath = Join-Path $InstallRoot 'kernel\bridge\mvp\run-server.js'
$logPath = Join-Path $env:TEMP 'agentlimb-bridge.log'
$errorLogPath = Join-Path $env:TEMP 'agentlimb-bridge.error.log'

foreach ($path in @($logPath, $errorLogPath)) {
  if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Length -ge 5MB) {
    $archivePath = "$path.1"
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $path -Destination $archivePath -Force
  }
}

Set-Location -LiteralPath $InstallRoot
& $NodePath $serverPath 1>> $logPath 2>> $errorLogPath
exit $LASTEXITCODE
