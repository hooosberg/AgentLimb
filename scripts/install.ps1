# AgentLimb host installer (Windows)
# Mirrors the repo layout into %USERPROFILE%\.agentlimb so relative imports keep working.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$HomeDir = Join-Path $env:USERPROFILE ".agentlimb"

New-Item -ItemType Directory -Force -Path "$HomeDir\host", "$HomeDir\kernel\shared", "$HomeDir\kernel\control\host" | Out-Null
Copy-Item "$Root\host\mcp-server.mjs"    "$HomeDir\host\mcp-server.mjs" -Force
Copy-Item "$Root\host\bridge-server.mjs" "$HomeDir\host\bridge-server.mjs" -Force
Copy-Item "$Root\kernel\shared\constants.js"   "$HomeDir\kernel\shared\constants.js" -Force
Copy-Item "$Root\kernel\control\host\tools.js" "$HomeDir\kernel\control\host\tools.js" -Force

$McpPath = "$HomeDir\host\mcp-server.mjs"
Write-Host "AgentLimb host installed to $HomeDir"
Write-Host ""
Write-Host "Add this MCP server to your agent software (any MCP-capable client):"
Write-Host ""
Write-Host "  {"
Write-Host "    `"mcpServers`": {"
Write-Host "      `"agentlimb`": {"
Write-Host "        `"command`": `"node`","
Write-Host "        `"args`": [`"$McpPath`"]"
Write-Host "      }"
Write-Host "    }"
Write-Host "  }"
Write-Host ""
Write-Host "Then: open the extension side panel, copy the connection prompt, paste it into your agent software."
