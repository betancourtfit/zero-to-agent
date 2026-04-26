#!/usr/bin/env bash
set -euo pipefail
MISSING=()
KEYS=$(awk '/runtimeEnv:/,/^  \},/' lib/env.ts | grep -oE '^    [A-Z_]+:' | tr -d ' :' | sort -u)
for key in $KEYS; do
  if ! grep -qE "^${key}=" .env.example; then
    MISSING+=("$key")
  fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "ERROR: Keys in lib/env.ts runtimeEnv missing from .env.example:" >&2
  printf '  - %s\n' "${MISSING[@]}" >&2
  exit 1
fi
echo "Env sync OK: $(echo "$KEYS" | wc -l | tr -d ' ') keys verified"
