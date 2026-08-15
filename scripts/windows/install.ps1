[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'AgentLimb'),
  [string]$ChromeExtensionId = 'hldldfepjhljhbcneojddjkkodkjglof'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NodeCommand {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    throw 'Node.js 18 or later is required. Install it from https://nodejs.org/, reopen PowerShell, and run this installer again.'
  }

  $version = (& $node.Source --version).Trim().TrimStart('v')
  $major = 0
  if (-not [int]::TryParse($version.Split('.')[0], [ref]$major) -or $major -lt 18) {
    throw "Node.js $version is installed; AgentLimb requires Node.js 18 or later."
  }
  return $node.Source
}

function Test-BridgeHealth {
  try {
    $status = Invoke-WebRequest 'http://127.0.0.1:7791/api/mvp/status' -UseBasicParsing -TimeoutSec 2
    return $status.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

if ($ChromeExtensionId -notmatch '^[a-p]{32}$') {
  throw 'ChromeExtensionId must be the 32-character extension ID shown on chrome://extensions.'
}

$nodePath = Get-NodeCommand
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sourceKernel = Join-Path $sourceRoot 'kernel'
$sourcePackage = Join-Path $sourceRoot 'package.json'
if (-not (Test-Path (Join-Path $sourceKernel 'bridge\mvp\run-server.js')) -or -not (Test-Path $sourcePackage)) {
  throw 'Run this installer from the extracted AgentLimb Windows package or the AgentLimb source repository.'
}

$taskName = 'AgentLimb Bridge'
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

if (Test-BridgeHealth) {
  try {
    Invoke-WebRequest 'http://127.0.0.1:7791/api/mvp/shutdown' -Method Post -UseBasicParsing -TimeoutSec 2 | Out-Null
  } catch {
    throw 'Port 7791 is already in use and the existing Bridge could not be stopped.'
  }
  for ($attempt = 0; $attempt -lt 20 -and (Test-BridgeHealth); $attempt++) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-BridgeHealth) {
    throw 'The previous AgentLimb Bridge is still running. Stop it and run the installer again.'
  }
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$installedKernel = Join-Path $InstallRoot 'kernel'
if (Test-Path -LiteralPath $installedKernel) {
  Remove-Item -LiteralPath $installedKernel -Recurse -Force
}
Copy-Item -LiteralPath $sourceKernel -Destination $installedKernel -Recurse -Force
Copy-Item -LiteralPath $sourcePackage -Destination (Join-Path $InstallRoot 'package.json') -Force

$installedScripts = Join-Path $InstallRoot 'scripts\windows'
New-Item -ItemType Directory -Force -Path $installedScripts | Out-Null
foreach ($name in @('AgentLimbNativeHost.cs', 'start-bridge.ps1', 'uninstall.ps1')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $installedScripts $name) -Force
}

$binPath = Join-Path $InstallRoot 'bin'
$nativeHostDir = Join-Path $InstallRoot 'native-host'
New-Item -ItemType Directory -Force -Path $binPath, $nativeHostDir | Out-Null

$cliPath = Join-Path $binPath 'agentlimb.cmd'
$cli = "@echo off`r`n`"$nodePath`" `"%~dp0..\kernel\bridge\mvp\terminal-client.mjs`" %*`r`n"
[System.IO.File]::WriteAllText($cliPath, $cli, [System.Text.Encoding]::ASCII)

$nativeHostSource = Join-Path $installedScripts 'AgentLimbNativeHost.cs'
$nativeHostCommand = Join-Path $nativeHostDir 'agentlimb-native-host.exe'
if (Test-Path -LiteralPath $nativeHostCommand) {
  Remove-Item -LiteralPath $nativeHostCommand -Force
}
$cscCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
  throw 'The Windows .NET Framework C# compiler was not found; the Chrome Native Messaging host could not be installed.'
}
& $csc /nologo /target:exe "/out:$nativeHostCommand" $nativeHostSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $nativeHostCommand)) {
  throw 'Compiling the AgentLimb Native Messaging host failed.'
}

$nativeManifestPath = Join-Path $nativeHostDir 'com.agentlimb.bridge.json'
$nativeManifest = @{
  name = 'com.agentlimb.bridge'
  description = 'AgentLimb Bridge runtime locator'
  path = $nativeHostCommand
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ChromeExtensionId/")
} | ConvertTo-Json -Depth 3
Write-Utf8NoBom -Path $nativeManifestPath -Content $nativeManifest

foreach ($registryKey in @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.agentlimb.bridge',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.agentlimb.bridge'
)) {
  New-Item -Path $registryKey -Force | Out-Null
  Set-Item -Path $registryKey -Value $nativeManifestPath
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = if ([string]::IsNullOrWhiteSpace($userPath)) { @() } else { @($userPath -split ';' | Where-Object { $_ }) }
$alreadyOnPath = $pathEntries | Where-Object {
  [string]::Equals($_.TrimEnd('\'), $binPath.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}
if (-not $alreadyOnPath) {
  [Environment]::SetEnvironmentVariable('Path', (@($binPath) + $pathEntries -join ';'), 'User')
}
$env:Path = "$binPath;$env:Path"

$config = @{
  projectDir = $InstallRoot
  nodebin = $nodePath
  clientCommand = $cliPath
  bridgeUrl = 'http://127.0.0.1:7791'
  installedAt = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json
Write-Utf8NoBom -Path (Join-Path $InstallRoot 'config.json') -Content $config

foreach ($logName in @('agentlimb-bridge.log', 'agentlimb-bridge.error.log')) {
  Remove-Item -LiteralPath (Join-Path $env:TEMP $logName) -Force -ErrorAction SilentlyContinue
}

$powerShellPath = (Get-Command powershell.exe).Source
$startScript = Join-Path $installedScripts 'start-bridge.ps1'
$actionArguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -NodePath "{1}" -InstallRoot "{2}"' -f $startScript, $nodePath, $InstallRoot
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $actionArguments -WorkingDirectory $InstallRoot
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Runs the local AgentLimb Bridge on 127.0.0.1:7791.' -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
for ($attempt = 0; $attempt -lt 20 -and -not (Test-BridgeHealth); $attempt++) {
  Start-Sleep -Milliseconds 500
}

if (-not (Test-BridgeHealth)) {
  $errorLog = Join-Path $env:TEMP 'agentlimb-bridge.error.log'
  throw "AgentLimb was installed, but the Bridge health check failed. Inspect Scheduled Task '$taskName' and $errorLog."
}

Write-Host "AgentLimb installed to $InstallRoot" -ForegroundColor Green
Write-Host 'Bridge: http://127.0.0.1:7791'
Write-Host "CLI: $cliPath"
Write-Host "Logs: $env:TEMP\agentlimb-bridge.log and $env:TEMP\agentlimb-bridge.error.log"
Write-Host 'Open a new terminal to use: agentlimb status'
