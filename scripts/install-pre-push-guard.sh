#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
HOOK_PATH="$ROOT_DIR/.git/hooks/pre-push"

mkdir -p "$(dirname "$HOOK_PATH")"

cat > "$HOOK_PATH" <<'EOF'
#!/bin/sh

remote_name="$1"
[ "$remote_name" = "origin" ] || exit 0
zero_sha="0000000000000000000000000000000000000000"

while read -r local_ref local_sha remote_ref remote_sha
do
  [ "$local_sha" = "$zero_sha" ] && continue
  case "$remote_ref" in
    refs/heads/main|refs/tags/v[0-9]*.[0-9]*.[0-9]*)
      continue
      ;;
  esac

  printf '%s\n' "pre-push: blocked push to $remote_ref on origin."
  printf '%s\n' "AgentLimb's public repository accepts main and semantic version tags only."
  exit 1
done
EOF

chmod +x "$HOOK_PATH"
printf '%s\n' "Installed pre-push guard at $HOOK_PATH"
