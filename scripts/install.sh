#!/usr/bin/env bash
# AgentLimb host installer (macOS / Linux)
# Mirrors the repo layout into ~/.agentlimb so relative imports keep working.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${HOME}/.agentlimb"

mkdir -p "${HOME_DIR}/host" "${HOME_DIR}/kernel/shared" "${HOME_DIR}/kernel/control/host"
cp "${ROOT}/host/mcp-server.mjs"    "${HOME_DIR}/host/mcp-server.mjs"
cp "${ROOT}/host/bridge-server.mjs" "${HOME_DIR}/host/bridge-server.mjs"
cp "${ROOT}/kernel/shared/constants.js"   "${HOME_DIR}/kernel/shared/constants.js"
cp "${ROOT}/kernel/control/host/tools.js" "${HOME_DIR}/kernel/control/host/tools.js"

MCP_PATH="${HOME_DIR}/host/mcp-server.mjs"
echo "AgentLimb host installed to ${HOME_DIR}"
echo
echo "Add this MCP server to your agent software (any MCP-capable client):"
echo
echo "  {"
echo "    \"mcpServers\": {"
echo "      \"agentlimb\": {"
echo "        \"command\": \"node\","
echo "        \"args\": [\"${MCP_PATH}\"]"
echo "      }"
echo "    }"
echo "  }"
echo
echo "Then: open the extension side panel → copy the connection prompt → paste it into your agent software."
echo "First connection asks for pairing confirmation in the browser; after that it is automatic."
