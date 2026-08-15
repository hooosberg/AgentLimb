[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'AgentLimb'),
  [Alias('ChromeExtensionId')]
  [string]$ExtensionId = 'hldldfepjhljhbcneojddjkkodkjglof'
)

$installer = Join-Path $PSScriptRoot 'windows\install.ps1'
& $installer -InstallRoot $InstallRoot -ExtensionId $ExtensionId
exit $LASTEXITCODE
