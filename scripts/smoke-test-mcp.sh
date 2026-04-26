#!/usr/bin/env bash
# scripts/smoke-test-mcp.sh
#
# End-to-end MCP tool smoke test (D-33). Hits all 4 tools with bearer auth
# over JSON-RPC streamable-HTTP at /mcp/mcp.
#
# Usage:
#   BASE_URL=https://zero-to-agent.vercel.app bash scripts/smoke-test-mcp.sh
#   bash scripts/smoke-test-mcp.sh                # defaults to local dev
#
# Env (auto-loaded from .env.local if present):
#   BASE_URL       Default: http://localhost:3000
#   MCP_API_KEY    Required. The bearer token (matches lib/env.ts).
#
# Asserts:
#   - HTTP 2xx on every tools/call
#   - Tool 1 (create_reservation) returns ok:true and a UUID session_token
#   - Tools 2/3/4 (action tools) return ok:false / INVALID_SESSION when
#     called WITHOUT X-Reservation-Session header (Pitfall #5 enforcement)
#   - Tool 2 (get_reservation_status) returns ok:true when given the
#     session_token from Tool 1 (positive end-to-end coverage)
#   - Tool 4 (cancel_reservation) closes the smoke reservation cleanly so
#     re-runs don't accumulate active rows
#
# Exit: 0 if all checks pass, 1 otherwise.

set -euo pipefail

# ─── Bootstrap env ────────────────────────────────────────────────────
if [ -f ".env.local" ]; then
  # Pull MCP_API_KEY out of .env.local without invoking `source` (which
  # would dump every key into the script's env, including secrets we don't
  # want this script to know about).
  if [ -z "${MCP_API_KEY:-}" ]; then
    MCP_API_KEY=$(grep -E '^MCP_API_KEY=' .env.local | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true)
  fi
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"

if [ -z "${MCP_API_KEY:-}" ]; then
  echo "[smoke:mcp] ERROR: MCP_API_KEY not set (env or .env.local)"
  exit 1
fi

MCP_URL="${BASE_URL%/}/mcp/mcp"
BEARER="Authorization: Bearer ${MCP_API_KEY}"

# Idempotent fixture identity. Runs may overlap with seed-demo.ts but use
# a distinct email pattern (smoke@example.test, not demo*@example.test).
SMOKE_EMAIL="smoke@example.test"
SMOKE_PHONE="+541100000099"

echo "[smoke:mcp] Target: ${MCP_URL}"
echo ""

PASS=0
FAIL=0

# ─── Helpers ──────────────────────────────────────────────────────────
# call_tool TOOL_NAME ARGS_JSON [SESSION_TOKEN]
# Echoes the response body on stdout; status code on file descriptor 3.
call_tool() {
  local tool_name="$1"
  local args_json="$2"
  local session_token="${3:-}"

  local payload
  payload=$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' \
    "${tool_name}" "${args_json}")

  local extra_header=()
  if [ -n "$session_token" ]; then
    extra_header=(-H "X-Reservation-Session: ${session_token}")
  fi

  # mcp-handler streamable-HTTP requires Accept: application/json,
  # text/event-stream per the MCP spec; without it the server returns 406.
  curl -sS \
    -w "\n%{http_code}" \
    -X POST "${MCP_URL}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "${BEARER}" \
    "${extra_header[@]}" \
    -d "${payload}"
}

# tools/call responses come back as JSON-RPC envelopes; the tool's own
# {ok, data|error} payload is JSON-stringified inside content[0].text.
# We grep for the inner shape — jq would be cleaner but we don't want to
# require jq for the hackathon laptop setup.
extract_inner_field() {
  local body="$1"
  local field="$2"
  # Greedy enough to skip the outer JSON-RPC keys; specific enough to
  # avoid matching ok:true that lives in a parent envelope.
  echo "$body" | grep -oE "\"${field}\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

# Records pass/fail and prints a one-line summary.
record() {
  local label="$1"
  local outcome="$2" # "PASS" or "FAIL"
  local detail="${3:-}"
  if [ "$outcome" = "PASS" ]; then
    echo "[smoke:mcp] PASS ${label}${detail:+ ($detail)}"
    PASS=$((PASS + 1))
  else
    echo "[smoke:mcp] FAIL ${label}${detail:+ — $detail}"
    FAIL=$((FAIL + 1))
  fi
}

# ─── Tool 1: create_reservation (positive) ────────────────────────────
echo "[smoke:mcp] [1/5] create_reservation (no session, valid input)…"
ARGS_1=$(printf '{"name":"Smoke Test","email":"%s","phone":"%s","party_size":2}' \
  "${SMOKE_EMAIL}" "${SMOKE_PHONE}")
RESPONSE_1=$(call_tool "create_reservation" "$ARGS_1")
HTTP_1=$(echo "$RESPONSE_1" | tail -n 1)
BODY_1=$(echo "$RESPONSE_1" | sed '$d')

if [ "$HTTP_1" -ge 200 ] && [ "$HTTP_1" -lt 300 ]; then
  if echo "$BODY_1" | grep -q '\\"ok\\":true' || echo "$BODY_1" | grep -q '"ok":true'; then
    SESSION_TOKEN=$(extract_inner_field "$BODY_1" "session_token")
    if [ -n "$SESSION_TOKEN" ]; then
      record "create_reservation" "PASS" "HTTP ${HTTP_1}, session_token=${SESSION_TOKEN:0:8}…"
    else
      record "create_reservation" "FAIL" "ok:true but no session_token in response"
    fi
  else
    record "create_reservation" "FAIL" "HTTP ${HTTP_1} but ok:true not in body"
  fi
else
  record "create_reservation" "FAIL" "HTTP ${HTTP_1}"
  echo "    body: ${BODY_1}" | head -c 400
  echo ""
fi

# ─── Tool 2: get_reservation_status (negative — no session header) ────
echo "[smoke:mcp] [2/5] get_reservation_status (no header, expect INVALID_SESSION)…"
RESPONSE_2=$(call_tool "get_reservation_status" "{}")
HTTP_2=$(echo "$RESPONSE_2" | tail -n 1)
BODY_2=$(echo "$RESPONSE_2" | sed '$d')
if [ "$HTTP_2" -ge 200 ] && [ "$HTTP_2" -lt 300 ] && echo "$BODY_2" | grep -q "INVALID_SESSION"; then
  record "get_reservation_status (no session)" "PASS" "HTTP ${HTTP_2}, INVALID_SESSION"
else
  record "get_reservation_status (no session)" "FAIL" "HTTP ${HTTP_2}, expected INVALID_SESSION"
fi

# ─── Tool 3: extend_wait (negative — no session header) ───────────────
echo "[smoke:mcp] [3/5] extend_wait (no header, expect INVALID_SESSION)…"
RESPONSE_3=$(call_tool "extend_wait" "{}")
HTTP_3=$(echo "$RESPONSE_3" | tail -n 1)
BODY_3=$(echo "$RESPONSE_3" | sed '$d')
if [ "$HTTP_3" -ge 200 ] && [ "$HTTP_3" -lt 300 ] && echo "$BODY_3" | grep -q "INVALID_SESSION"; then
  record "extend_wait (no session)" "PASS" "HTTP ${HTTP_3}, INVALID_SESSION"
else
  record "extend_wait (no session)" "FAIL" "HTTP ${HTTP_3}, expected INVALID_SESSION"
fi

# ─── Tool 2 (positive): get_reservation_status WITH session_token ─────
if [ -n "${SESSION_TOKEN:-}" ]; then
  echo "[smoke:mcp] [4/5] get_reservation_status (with X-Reservation-Session)…"
  RESPONSE_4=$(call_tool "get_reservation_status" "{}" "${SESSION_TOKEN}")
  HTTP_4=$(echo "$RESPONSE_4" | tail -n 1)
  BODY_4=$(echo "$RESPONSE_4" | sed '$d')
  if [ "$HTTP_4" -ge 200 ] && [ "$HTTP_4" -lt 300 ] && echo "$BODY_4" | grep -q '"ok":true\|\\"ok\\":true'; then
    record "get_reservation_status (with session)" "PASS" "HTTP ${HTTP_4}, ok:true"
  else
    record "get_reservation_status (with session)" "FAIL" "HTTP ${HTTP_4}, expected ok:true"
  fi
else
  echo "[smoke:mcp] [4/5] SKIP get_reservation_status (with session) — no session_token from step 1"
  FAIL=$((FAIL + 1))
fi

# ─── Tool 4: cancel_reservation (positive — close smoke fixture) ──────
if [ -n "${SESSION_TOKEN:-}" ]; then
  echo "[smoke:mcp] [5/5] cancel_reservation (with session, close smoke fixture)…"
  RESPONSE_5=$(call_tool "cancel_reservation" "{}" "${SESSION_TOKEN}")
  HTTP_5=$(echo "$RESPONSE_5" | tail -n 1)
  BODY_5=$(echo "$RESPONSE_5" | sed '$d')
  if [ "$HTTP_5" -ge 200 ] && [ "$HTTP_5" -lt 300 ] && echo "$BODY_5" | grep -q '"ok":true\|\\"ok\\":true'; then
    record "cancel_reservation (with session)" "PASS" "HTTP ${HTTP_5}, ok:true"
  else
    record "cancel_reservation (with session)" "FAIL" "HTTP ${HTTP_5}, expected ok:true"
  fi
else
  echo "[smoke:mcp] [5/5] cancel_reservation (no session, expect INVALID_SESSION)…"
  RESPONSE_5=$(call_tool "cancel_reservation" "{}")
  HTTP_5=$(echo "$RESPONSE_5" | tail -n 1)
  BODY_5=$(echo "$RESPONSE_5" | sed '$d')
  if [ "$HTTP_5" -ge 200 ] && [ "$HTTP_5" -lt 300 ] && echo "$BODY_5" | grep -q "INVALID_SESSION"; then
    record "cancel_reservation (no session)" "PASS" "HTTP ${HTTP_5}, INVALID_SESSION"
  else
    record "cancel_reservation (no session)" "FAIL" "HTTP ${HTTP_5}, expected INVALID_SESSION"
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────
echo ""
echo "[smoke:mcp] Results: ${PASS} passed, ${FAIL} failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

exit 0
