[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'AgentLimb'),
  [string]$ChromeExtensionId = 'hldldfepjhljhbcneojddjkkodkjglof'
)

$installer = Join-Path $PSScriptRoot 'windows\install.ps1'
& $installer -InstallRoot $InstallRoot -ChromeExtensionId $ChromeExtensionId
exit $LASTEXITCODE
