[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'AgentLimb')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $PSCmdlet.ShouldProcess($InstallRoot, 'Remove AgentLimb Bridge, CLI, scheduled task, and Native Messaging registration')) {
  return
}

$taskName = 'AgentLimb Bridge'
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

foreach ($registryKey in @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.agentlimb.bridge',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.agentlimb.bridge'
)) {
  Remove-Item -LiteralPath $registryKey -Recurse -Force -ErrorAction SilentlyContinue
}

$binPath = Join-Path $InstallRoot 'bin'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -ne $userPath) {
  $remaining = @($userPath -split ';' | Where-Object {
    $_ -and -not [string]::Equals($_.TrimEnd('\'), $binPath.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
  })
  [Environment]::SetEnvironmentVariable('Path', ($remaining -join ';'), 'User')
}

if (Test-Path -LiteralPath $InstallRoot) {
  Remove-Item -LiteralPath $InstallRoot -Recurse -Force
}

Write-Host 'AgentLimb Bridge, CLI, scheduled task, and Native Messaging host were removed.'
Write-Host 'Muscle files on your Desktop were preserved.'
