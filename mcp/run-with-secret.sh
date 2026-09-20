#!/usr/bin/env bash
# BotDesk MCP launcher for Grok / Linux bot boxes.
# Prefer platform-injected env (secret-request / MCP env). Homemade JSON stores are fragile.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTER="${BOTDESK_ADAPTER_PATH:-$SCRIPT_DIR/server.mjs}"
SECRET_FILE="${BOTDESK_SECRET_FILE:-/home/box/sand-data/box-secrets.json}"

read_secret_file() {
  local key="$1"
  local file="$2"
  if [[ ! -f "$file" ]]; then
    return 1
  fi
  # Prefer python for reliable JSON; fall back to node. Each reader is tried in
  # turn because a present-but-broken interpreter (for example the Windows Store
  # `python3` alias stub) must not mask a working fallback.
  local value
  if command -v python3 >/dev/null 2>&1; then
    if value="$(python3 - "$file" "$key" 2>/dev/null <<'PY'
import json,sys
path,key=sys.argv[1],sys.argv[2]
try:
  data=json.load(open(path,"r",encoding="utf-8"))
except Exception:
  sys.exit(1)
secrets=data.get("secrets") if isinstance(data,dict) else None
if not isinstance(secrets,dict):
  sys.exit(1)
value=secrets.get(key)
if not isinstance(value,str) or not value.strip():
  sys.exit(1)
print(value,end="")
PY
)" && [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  fi
  if command -v node >/dev/null 2>&1; then
    if value="$(node -e 'const fs=require("fs");let d;try{d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}catch{process.exit(1);}const v=d&&d.secrets&&d.secrets[process.argv[2]];if(typeof v!=="string"||!v.trim())process.exit(1);process.stdout.write(v);' "$file" "$key" 2>/dev/null)" && [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  fi
  return 1
}

if [[ -z "${BOTDESK_BOT_TOKEN:-}" ]]; then
  if TOKEN="$(read_secret_file BOTDESK_BOT_TOKEN "$SECRET_FILE" 2>/dev/null)"; then
    export BOTDESK_BOT_TOKEN="$TOKEN"
  fi
fi

missing=()
[[ -z "${BOTDESK_RELAY_URL:-}" ]] && missing+=("BOTDESK_RELAY_URL")
[[ -z "${BOTDESK_HOST_ID:-}" ]] && missing+=("BOTDESK_HOST_ID")
[[ -z "${BOTDESK_BOT_TOKEN:-}" ]] && missing+=("BOTDESK_BOT_TOKEN")

if ((${#missing[@]})); then
  echo "credential-missing: unset ${missing[*]}. Restore BOTDESK_BOT_TOKEN via platform secret-request (preferred) or MCP env. Homemade box-secrets.json can wipe empty mid-session and is not durable." >&2
  exit 2
fi

if [[ ! -f "$ADAPTER" ]]; then
  echo "misconfigured: adapter not found at $ADAPTER" >&2
  exit 3
fi

exec node "$ADAPTER"
