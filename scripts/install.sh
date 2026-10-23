#!/usr/bin/env bash
# AgentLimb installer (macOS / Linux). All install logic lives in the Node CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required. Install Node.js, then run this script again." >&2
  exit 1
fi
NODE_VERSION="$(node -p 'process.versions.node.split(".")[0]')"
if [[ ! "${NODE_VERSION}" =~ ^[0-9]+$ ]] || (( NODE_VERSION < 18 )); then
  echo "Node.js 18 or newer is required (found $(node --version))." >&2
  exit 1
fi

exec node "${ROOT}/bin/agentlimb.mjs" install "$@"
