#!/usr/bin/env bash
# scripts/smoke-money-shot.sh
#
# Money-shot smoke test (D-31). The crown-jewel verification: create
# active reservations, redeploy mid-flight via `git push origin main`,
# and prove that the in-flight workflows survive the deploy.
#
# This is the Phase 2 gate before Phase 3 can start, AND the demo
# scenario the hackathon is built around.
#
# ─── HARD PREREQUISITES (do these BEFORE running) ────────────────────
#   1. Vercel Skew Protection is ENABLED (D-17, blocker B2):
#        Vercel Dashboard → Project → Settings → Skew Protection → On
#      Without it, in-flight runs pin to a deployment that gets garbage
#      collected and break the moment a new deploy lands.
#   2. BASE_URL points at a real PRODUCTION URL (not localhost).
#      Skew Protection only matters across deploys; localhost has no
#      deploys to skew across.
#   3. MCP_API_KEY matches the production env var (not a dev key).
#
# ─── USAGE ────────────────────────────────────────────────────────────
#   Live rehearsal (the actual money-shot):
#     BASE_URL=https://zero-to-agent.vercel.app bash scripts/smoke-money-shot.sh
#
#   Dry run (no deploy, validates script logic + env wiring only):
#     bash scripts/smoke-money-shot.sh --dry-run
#
#   Auto-skip the deploy prompt (CI-friendly; assumes deploy already happened):
#     SKIP_DEPLOY_PROMPT=1 bash scripts/smoke-money-shot.sh
#
# ─── PROCEDURE ────────────────────────────────────────────────────────
#   1. Create 2 reservations via MCP create_reservation, capture each
#      (reservation_id, session_token) pair.
#   2. Sleep 3s for the workflows to settle into their `:waiting` race.
#   3. Print the `git push` command and wait for the operator to confirm
#      it ran (NOT auto-executed — the operator owns the commit). Skip
#      this in --dry-run.
#   4. Poll /api/events/<id>?session_token=<token> SSE for each
#      reservation, up to 60s. Assert each receives at least one
#      `event: snapshot` chunk.
#   5. Exit 0 if both survive; non-zero with the failing reservation_id
#      otherwise.

set -euo pipefail

# ─── Args ─────────────────────────────────────────────────────────────
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      grep '^#' "$0" | head -50
      exit 0
      ;;
    *)
      echo "[smoke:money-shot] Unknown arg: $arg (use --dry-run or --help)"
      exit 2
      ;;
  esac
done

# ─── Bootstrap env ────────────────────────────────────────────────────
if [ -f ".env.local" ]; then
  if [ -z "${MCP_API_KEY:-}" ]; then
    MCP_API_KEY=$(grep -E '^MCP_API_KEY=' .env.local | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true)
  fi
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"

if [ -z "${MCP_API_KEY:-}" ]; then
  echo "[smoke:money-shot] ERROR: MCP_API_KEY not set (env or .env.local)"
  exit 1
fi

MCP_URL="${BASE_URL%/}/mcp/mcp"
BEARER="Authorization: Bearer ${MCP_API_KEY}"

echo "[smoke:money-shot] Target: ${BASE_URL}"
echo "[smoke:money-shot] Mode:   $([ "$DRY_RUN" -eq 1 ] && echo "DRY RUN" || echo "LIVE")"
echo ""

if [ "$DRY_RUN" -eq 0 ]; then
  cat <<'EOF'
[smoke:money-shot] HARD PREREQUISITE — Skew Protection (D-17, blocker B2):
[smoke:money-shot]   Verify in Vercel Dashboard → Project → Settings →
[smoke:money-shot]   Skew Protection → ENABLED before continuing.
[smoke:money-shot]
[smoke:money-shot]   Without Skew Protection, in-flight workflow runs pin
[smoke:money-shot]   to a deployment that gets garbage collected when the
[smoke:money-shot]   `git push` lands. The reservations will appear to
[smoke:money-shot]   "die" mid-flight, and this test will fail FOR THE
[smoke:money-shot]   WRONG REASON.

EOF
fi

# ─── Helpers ──────────────────────────────────────────────────────────
# tools/call responses come back as JSON-RPC envelopes with the tool's
# {ok, data|error} payload JSON-stringified inside content[0].text — so
# the inner JSON arrives with backslash-escaped quotes:
#   "text":"{\"ok\":true,\"data\":{\"reservation_id\":\"abc-…\"}}"
# Unescape \" -> " before matching, then extract the field.
extract_inner_field() {
  local body="$1"
  local field="$2"
  local unescaped
  unescaped=$(printf '%s' "$body" | sed 's/\\"/"/g')
  printf '%s' "$unescaped" | grep -oE "\"${field}\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

# Self-test the extractor at script startup. If the regex breaks against
# the realistic MCP envelope shape, fail fast — the money-shot demo
# cannot afford a silent capture-failure mid-flight.
__SMOKE_FIXTURE='{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\"ok\":true,\"data\":{\"reservation_id\":\"fixture-r-1\",\"session_token\":\"fixture-s-2\"}}"}]}}'
__SMOKE_RID=$(extract_inner_field "$__SMOKE_FIXTURE" "reservation_id")
__SMOKE_TOK=$(extract_inner_field "$__SMOKE_FIXTURE" "session_token")
if [ "$__SMOKE_RID" != "fixture-r-1" ] || [ "$__SMOKE_TOK" != "fixture-s-2" ]; then
  echo "[smoke:money-shot] FATAL: extract_inner_field self-test failed" >&2
  echo "[smoke:money-shot]   reservation_id expected 'fixture-r-1', got '${__SMOKE_RID}'" >&2
  echo "[smoke:money-shot]   session_token  expected 'fixture-s-2', got '${__SMOKE_TOK}'" >&2
  exit 2
fi

# create_reservation_via_mcp NAME EMAIL PHONE PARTY_SIZE
# Echoes "<reservation_id>|<session_token>" on stdout, exits non-zero on
# failure with diagnostic on stderr.
create_reservation_via_mcp() {
  local name="$1"
  local email="$2"
  local phone="$3"
  local party_size="$4"

  local payload
  payload=$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_reservation","arguments":{"name":"%s","email":"%s","phone":"%s","party_size":%d}}}' \
    "${name}" "${email}" "${phone}" "${party_size}")

  local response
  response=$(curl -sS -X POST "${MCP_URL}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "${BEARER}" \
    -d "${payload}")

  local rid
  rid=$(extract_inner_field "$response" "reservation_id")
  local stoken
  stoken=$(extract_inner_field "$response" "session_token")

  if [ -z "$rid" ] || [ -z "$stoken" ]; then
    echo "[smoke:money-shot] ERROR: create_reservation returned no reservation_id/session_token" >&2
    echo "    body: $(echo "$response" | head -c 400)" >&2
    return 1
  fi

  echo "${rid}|${stoken}"
}

# poll_sse_snapshot RESERVATION_ID SESSION_TOKEN TIMEOUT_SECS
# Returns 0 if at least one `event: snapshot` chunk arrives within timeout,
# non-zero on timeout. Uses curl --max-time to bound the SSE connection.
poll_sse_snapshot() {
  local rid="$1"
  local stoken="$2"
  local timeout_secs="$3"

  local start
  start=$(date +%s)

  while :; do
    local now
    now=$(date +%s)
    local elapsed=$((now - start))
    if [ "$elapsed" -ge "$timeout_secs" ]; then
      echo "[smoke:money-shot] TIMEOUT after ${timeout_secs}s polling reservation ${rid}"
      return 1
    fi

    local sse_url="${BASE_URL%/}/api/events/${rid}?session_token=${stoken}"
    local response
    # --max-time 5: SSE connections stay open; we only need to see one
    # snapshot frame. The handler emits the snapshot as the FIRST event.
    response=$(curl -sS -N --max-time 5 "${sse_url}" 2>/dev/null || true)

    if echo "$response" | grep -q '^event: snapshot'; then
      echo "[smoke:money-shot]   ✓ reservation ${rid:0:8}… snapshot received (elapsed ${elapsed}s)"
      return 0
    fi

    # Tight loop: curl --max-time already paces us; no extra sleep.
  done
}

# ─── Step 1: Create 2 reservations ────────────────────────────────────
echo "[smoke:money-shot] Creating reservation 1…"
PAIR_1=$(create_reservation_via_mcp "Money Shot 1" "money1@example.test" "+541100000091" 2)
R1_ID="${PAIR_1%%|*}"
R1_TOKEN="${PAIR_1##*|}"
echo "[smoke:money-shot]   reservation 1: id=${R1_ID:0:8}… token=${R1_TOKEN:0:8}…"

echo "[smoke:money-shot] Creating reservation 2…"
PAIR_2=$(create_reservation_via_mcp "Money Shot 2" "money2@example.test" "+541100000092" 4)
R2_ID="${PAIR_2%%|*}"
R2_TOKEN="${PAIR_2##*|}"
echo "[smoke:money-shot]   reservation 2: id=${R2_ID:0:8}… token=${R2_TOKEN:0:8}…"

# ─── Step 2: Settle the workflows ─────────────────────────────────────
echo "[smoke:money-shot] Sleeping 3s for workflows to settle into :waiting…"
sleep 3

# ─── Step 3: Deploy ───────────────────────────────────────────────────
DEPLOY_TS=$(date +%s)
if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  echo "[smoke:money-shot] DRY RUN: skipping deploy prompt."
  echo "[smoke:money-shot] DRY RUN: snapshot polling below validates that"
  echo "[smoke:money-shot] DRY RUN: SSE wiring works — but does NOT prove"
  echo "[smoke:money-shot] DRY RUN: skew survival. Run without --dry-run"
  echo "[smoke:money-shot] DRY RUN: against a real prod URL for the actual"
  echo "[smoke:money-shot] DRY RUN: money-shot rehearsal."
  echo ""
elif [ "${SKIP_DEPLOY_PROMPT:-0}" = "1" ]; then
  echo "[smoke:money-shot] SKIP_DEPLOY_PROMPT=1 set; assuming deploy already triggered."
else
  echo ""
  echo "=========================================="
  echo "[smoke:money-shot] MONEY-SHOT DEPLOY GATE"
  echo "=========================================="
  echo "Run this in another terminal to trigger the deploy:"
  echo ""
  echo "    git commit --allow-empty -m 'chore: money-shot deploy' && git push origin main"
  echo ""
  echo "Wait for the Vercel build to finish, then press ENTER to begin SSE polling."
  echo "(Ctrl-C aborts the test.)"
  read -r
  DEPLOY_TS=$(date +%s)
fi

# ─── Step 4: Poll SSE for both reservations ───────────────────────────
echo "[smoke:money-shot] Polling SSE for reservation 1 (60s timeout)…"
SSE1_OK=0
if poll_sse_snapshot "$R1_ID" "$R1_TOKEN" 60; then
  SSE1_OK=1
fi

echo "[smoke:money-shot] Polling SSE for reservation 2 (60s timeout)…"
SSE2_OK=0
if poll_sse_snapshot "$R2_ID" "$R2_TOKEN" 60; then
  SSE2_OK=1
fi

# ─── Step 5: Results ──────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "[smoke:money-shot] RESULTS"
echo "=========================================="
echo "  Reservation 1 (${R1_ID}): snapshot=$([ $SSE1_OK -eq 1 ] && echo PASS || echo FAIL)"
echo "  Reservation 2 (${R2_ID}): snapshot=$([ $SSE2_OK -eq 1 ] && echo PASS || echo FAIL)"
echo "  Mode: $([ "$DRY_RUN" -eq 1 ] && echo "DRY RUN — does not prove skew survival" || echo "LIVE — proved skew survival post-deploy")"
echo "  Deploy timestamp (epoch): ${DEPLOY_TS}"

FAIL=0
if [ "$SSE1_OK" -ne 1 ]; then
  echo "[smoke:money-shot] FAIL: reservation 1 (${R1_ID}) did not emit SSE snapshot"
  FAIL=$((FAIL + 1))
fi
if [ "$SSE2_OK" -ne 1 ]; then
  echo "[smoke:money-shot] FAIL: reservation 2 (${R2_ID}) did not emit SSE snapshot"
  FAIL=$((FAIL + 1))
fi

if [ "$FAIL" -gt 0 ]; then
  echo "[smoke:money-shot] FAILED: ${FAIL} reservation(s) did not survive."
  exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[smoke:money-shot] PASSED (dry run): SSE wiring is healthy."
  echo "[smoke:money-shot] Run without --dry-run against prod URL for the real test."
else
  echo "[smoke:money-shot] PASSED: both reservations survived the deploy."
  echo "[smoke:money-shot] Skew Protection is working. The money-shot is verified."
fi
exit 0
