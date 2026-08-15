#!/usr/bin/env bash
set -euo pipefail

EXTENSION_ID="hldldfepjhljhbcneojddjkkodkjglof"
if [[ "${1:-}" == "--extension-id" && -n "${2:-}" ]]; then
  EXTENSION_ID="$2"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_ROOT="$HOME/.agentlimb/runtime"
BIN_DIR="$HOME/.agentlimb/bin"
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "AgentLimb requires Node.js 18 or later: https://nodejs.org/" >&2
  exit 1
fi
NODE_MAJOR="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 18 )); then
  echo "AgentLimb requires Node.js 18 or later." >&2
  exit 1
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer currently supports macOS. Use scripts/install.ps1 on Windows." >&2
  exit 1
fi

mkdir -p "$INSTALL_ROOT" "$BIN_DIR"
rm -rf "$INSTALL_ROOT/kernel"
cp -R "$SOURCE_ROOT/kernel" "$INSTALL_ROOT/kernel"
cp "$SOURCE_ROOT/package.json" "$INSTALL_ROOT/package.json"
mkdir -p "$INSTALL_ROOT/scripts"
cp "$SOURCE_ROOT/scripts/native-host.mjs" "$INSTALL_ROOT/scripts/native-host.mjs"

cat > "$BIN_DIR/agentlimb" <<EOF
#!/usr/bin/env bash
exec "$NODE_BIN" "$INSTALL_ROOT/kernel/bridge/mvp/terminal-client.mjs" "\$@"
EOF
chmod +x "$BIN_DIR/agentlimb"

PLIST_ID="com.agentlimb.bridge"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$PLIST_ID.plist"
mkdir -p "$PLIST_DIR"
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$PLIST_ID</string>
  <key>ProgramArguments</key><array><string>$NODE_BIN</string><string>$INSTALL_ROOT/kernel/bridge/mvp/run-server.js</string></array>
  <key>WorkingDirectory</key><string>$INSTALL_ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/agentlimb-bridge.log</string>
  <key>StandardErrorPath</key><string>/tmp/agentlimb-bridge.error.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_LAUNCHER="$INSTALL_ROOT/scripts/agentlimb-native-host"
mkdir -p "$HOST_DIR"
cat > "$HOST_LAUNCHER" <<EOF
#!/usr/bin/env bash
exec "$NODE_BIN" "$INSTALL_ROOT/scripts/native-host.mjs" "$INSTALL_ROOT"
EOF
chmod +x "$HOST_LAUNCHER"
cat > "$HOST_DIR/com.agentlimb.bridge.json" <<EOF
{
  "name": "com.agentlimb.bridge",
  "description": "AgentLimb Bridge runtime locator",
  "path": "$HOST_LAUNCHER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

for _ in {1..10}; do
  if curl -sf http://127.0.0.1:7791/api/mvp/status >/dev/null; then
    echo "AgentLimb installed. Bridge: http://127.0.0.1:7791"
    echo "CLI: $BIN_DIR/agentlimb"
    exit 0
  fi
  sleep 0.5
done

echo "AgentLimb was installed but the Bridge health check failed. See /tmp/agentlimb-bridge.error.log" >&2
exit 1
