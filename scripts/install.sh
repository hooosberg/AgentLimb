#!/usr/bin/env bash
set -euo pipefail

EXTENSION_ID="hldldfepjhljhbcneojddjkkodkjglof"
if [[ "${1:-}" == "--extension-id" && -n "${2:-}" ]]; then
  EXTENSION_ID="$2"
fi
if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Extension ID must be the 32-character ID shown on your Chromium browser extensions page." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_PACKAGE="$SOURCE_ROOT/package.json"
if [[ ! -f "$SOURCE_ROOT/kernel/bridge/mvp/run-server.js" || ! -f "$SOURCE_ROOT/bin/agentlimb.mjs" || ! -f "$SOURCE_ROOT/runtime/mcp-server.mjs" || ! -f "$SOURCE_PACKAGE" ]]; then
  echo "The AgentLimb Runtime archive is incomplete; download the matching asset from the official GitHub Release." >&2
  exit 1
fi
SOURCE_VERSION="$(node -e 'const fs=require("fs"); const pkg=JSON.parse(fs.readFileSync(process.argv[1])); if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) process.exit(1); process.stdout.write(pkg.version)' "$SOURCE_PACKAGE")" || {
  echo "The AgentLimb Runtime package metadata is invalid; installation was not started." >&2
  exit 1
}
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
rm -rf "$INSTALL_ROOT/kernel" "$INSTALL_ROOT/bin" "$INSTALL_ROOT/runtime"
cp -R "$SOURCE_ROOT/kernel" "$INSTALL_ROOT/kernel"
cp -R "$SOURCE_ROOT/bin" "$INSTALL_ROOT/bin"
cp -R "$SOURCE_ROOT/runtime" "$INSTALL_ROOT/runtime"
rm -f "$INSTALL_ROOT/kernel/.mvp-terminal-session.json"
cp "$SOURCE_PACKAGE" "$INSTALL_ROOT/package.json"
mkdir -p "$INSTALL_ROOT/scripts"
cp "$SOURCE_ROOT/scripts/native-host.mjs" "$INSTALL_ROOT/scripts/native-host.mjs"

cat > "$BIN_DIR/agentlimb" <<EOF
#!/usr/bin/env bash
exec "$NODE_BIN" "$INSTALL_ROOT/bin/agentlimb.mjs" "\$@"
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

HOST_LAUNCHER="$INSTALL_ROOT/scripts/agentlimb-native-host"
cat > "$HOST_LAUNCHER" <<EOF
#!/usr/bin/env bash
exec "$NODE_BIN" "$INSTALL_ROOT/scripts/native-host.mjs" "$INSTALL_ROOT"
EOF
chmod +x "$HOST_LAUNCHER"

# Chromium browsers keep Native Messaging manifests in vendor-specific locations.
# Writing the same host manifest to each supported location keeps onboarding browser-agnostic.
HOST_DIRS=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge Beta/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge Canary/NativeMessagingHosts"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  "$HOME/Library/Application Support/Vivaldi/NativeMessagingHosts"
  "$HOME/Library/Application Support/Arc/NativeMessagingHosts"
  "$HOME/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts"
)
for host_dir in "${HOST_DIRS[@]}"; do
  mkdir -p "$host_dir"
  cat > "$host_dir/com.agentlimb.bridge.json" <<EOF
{
  "name": "com.agentlimb.bridge",
  "description": "AgentLimb Bridge runtime locator",
  "path": "$HOST_LAUNCHER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
done

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
