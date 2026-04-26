---
phase: 02-backend-core
plan: 08
type: execute
wave: 1
depends_on:
  - "02-04-workflow"
  - "02-05-mcp"
  - "02-06-sse"
  - "02-07-staff-api"
files_modified:
  - scripts/seed-demo.ts
  - scripts/smoke-test-mcp.sh
  - scripts/smoke-money-shot.sh
  - package.json (scripts: seed:demo, smoke:mcp, smoke:money-shot)
  - package-lock.json
autonomous: true
requirements:
  - DEMO-04

must_haves:
  truths:
    - "scripts/seed-demo.ts creates 3 reservations via REAL createReservation()"
    - "seed-demo.ts advances 2 reservations (called + seated) via service layer"
    - "seed-demo.ts is idempotent (deletes existing demo rows first)"
    - "seed-demo.ts uses safe fake data (Demo Comensal 1/2/3, +540000000001..3)"
    - "scripts/smoke-test-mcp.sh hits all 4 MCP tools with bearer auth"
    - "scripts/smoke-money-shot.sh creates reservations, deploys, verifies in-flight survival"
  artifacts:
    - path: "scripts/seed-demo.ts"
      provides: "3 reservations in distinct states for dev/demo"
      exports: "CLI script"
    - path: "scripts/smoke-test-mcp.sh"
      provides: "End-to-end MCP tool smoke test"
      exports: "CLI script"
    - path: "scripts/smoke-money-shot.sh"
      provides: "Money-shot smoke test (deploy mid-flight)"
      exports: "CLI script"

---

<objective>
Create the demo seed script (`scripts/seed-demo.ts`), MCP smoke test (`scripts/smoke-test-mcp.sh`), and money-shot smoke test (`scripts/smoke-money-shot.sh`). These complete Phase 2's testing and demo infrastructure.

Purpose: DEMO-04 + D-32 + D-33 + D-31 — seed-demo gives devs live reservations every session; smoke-test-mcp validates all 4 tools end-to-end; smoke-money-shot verifies the money-shot scenario (deploy mid-flight doesn't break active workflows).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/02-backend-core/02-CONTEXT.md
@.planning/phases/02-backend-core/02-RESEARCH.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/research/STACK.md
@.planning/research/ARCHITECTURE.md
@.planning/research/PITFALLS.md
@CLAUDE.md

<interfaces>
From 02-CONTEXT.md D-32 — seed-demo strategy:
- 3 reservations via REAL `createReservation()` (workflows LIVE every dev session)
- Advance 2 via internal hook resumes:
  - Reservation A: fresh `waiting`
  - Reservation B: advanced to `called` (via `markCalled`)
  - Reservation C: advanced to `seated` (via `markCalled` then `markSeated`)
- Names: Demo Comensal 1/2/3, +540000000001..3, demoN@example.test
- Idempotent: deletes existing `email LIKE 'demo%@example.test'` first, then re-creates
- `npm run seed:demo` — runs from day 1 of Phase 2

From 02-CONTEXT.md D-33 — smoke-test-mcp.sh:
- Minimal bash hitting all 4 MCP tools end-to-end with proper auth headers
- Asserts 2xx + `{ ok: true, data: ... }` shape
- Uses production URL by default, accepts `BASE_URL` env override

From 02-CONTEXT.md D-31 — smoke-money-shot.sh:
1. `curl POST /mcp` with bearer + `create_reservation` payload, twice, captures both `reservation_id`s
2. Sleeps 3s to let workflows settle
3. Echoes `git push origin main` command for operator
4. Polls `/api/events/<id>?session_token=<token>` SSE for each reservation for 60s
5. Asserts each receives at least one `event: snapshot` AND post-deploy activity
6. Exits 0 if both succeed, non-zero with failing reservation_id otherwise

From 02-CONTEXT.md D-34 — push-to-prod-every-phase discipline:
- Phase 2 ends with money-shot smoke test running green against production
- No manual `vercel --prod` — every commit to `main` auto-deploys

From scripts/seed-maitre.ts — pattern to copy for seed-demo:
- Idempotent ON CONFLICT upsert pattern
- Uses `sql` from `@/lib/db/neon`
- Runs via `tsx`

From scripts/smoke-test-kv.ts — pattern to copy:
- `Redis.fromEnv()` + ping/set/get/del pattern
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create scripts/seed-demo.ts — 3 reservations in distinct states</name>
  <files>scripts/seed-demo.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-32 (seed-demo strategy)
    - .planning/phases/01-foundation/01-03-db-migrations-seed-SUMMARY.md (seed-maitre.ts pattern)
    - .planning/phases/02-backend-core/02-03-service-layer-PLAN.md (service layer functions)
  </read_first>
  <action>
    1. Create `scripts/seed-demo.ts`:

       ```typescript
       // scripts/seed-demo.ts
       // Creates 3 reservations in distinct states for dev/demo use.
       // Idempotent: deletes existing demo rows first, then re-creates.
       // Uses REAL service layer — workflows are LIVE every dev session.

       import { sql } from "@/lib/db/neon";
       import { createReservation, getReservationStatus } from "@/lib/services/reservations";
       import { markCalled, markSeated } from "@/lib/services/queue";
       import { log } from "@/lib/log";

       async function main() {
         console.log("[seed-demo] Clearing existing demo rows...");
         await sql`DELETE FROM reservations WHERE email LIKE 'demo%@example.test'`;
         await sql`DELETE FROM reservation_events WHERE reservation_id IN (SELECT id FROM reservations WHERE email LIKE 'demo%@example.test')`;

         console.log("[seed-demo] Creating Reservation A (fresh waiting)...");
         const a = await createReservation({
           name: "Demo Comensal 1",
           email: "demo1@example.test",
           phone: "+540000000001",
           party_size: 2,
         });
         console.log("[seed-demo] A:", JSON.stringify(a));

         console.log("[seed-demo] Creating Reservation B (will advance to called)...");
         const b = await createReservation({
           name: "Demo Comensal 2",
           email: "demo2@example.test",
           phone: "+540000000002",
           party_size: 4,
         });
         console.log("[seed-demo] B:", JSON.stringify(b));

         console.log("[seed-demo] Advancing B to called...");
         const bCalled = await markCalled(b.data.reservation_id);
         console.log("[seed-demo] B called:", JSON.stringify(bCalled));

         console.log("[seed-demo] Creating Reservation C (will advance to seated)...");
         const c = await createReservation({
           name: "Demo Comensal 3",
           email: "demo3@example.test",
           phone: "+540000000003",
           party_size: 6,
         });
         console.log("[seed-demo] C:", JSON.stringify(c));

         console.log("[seed-demo] Advancing C to called...");
         await markCalled(c.data.reservation_id);

         console.log("[seed-demo] Advancing C to seated...");
         const cSeated = await markSeated(c.data.reservation_id);
         console.log("[seed-demo] C seated:", JSON.stringify(cSeated));

         console.log("[seed-demo] Done! 3 reservations created:");
         console.log("  A: waiting  (session_token:", a.data.session_token, ")");
         console.log("  B: called   (session_token:", b.data.session_token, ")");
         console.log("  C: seated   (session_token:", c.data.session_token, ")");
       }

       main().catch((err) => {
         log.error("seed-demo.error", err);
         console.error("[seed-demo] FAILED:", err);
         process.exit(1);
       });
       ```

       Note: `npm run seed:demo` runs this via `tsx scripts/seed-demo.ts`. Every developer reset uses this — NOT a Phase 4-only artifact (D-32).
   </action>
   <verify>
     <automated>test -f scripts/seed-demo.ts && grep -q 'demo1@example.test' scripts/seed-demo.ts && grep -q 'demo2@example.test' scripts/seed-demo.ts && grep -q 'demo3@example.test' scripts/seed-demo.ts && grep -q 'createReservation' scripts/seed-demo.ts && grep -q 'markCalled' scripts/seed-demo.ts && grep -q 'markSeated' scripts/seed-demo.ts && grep -q 'DELETE FROM reservations' scripts/seed-demo.ts</automated>
   </verify>
   <acceptance_criteria>
     - `scripts/seed-demo.ts` exists
     - Creates 3 reservations via REAL `createReservation()`
     - Advances B to `called` via `markCalled`
     - Advances C to `seated` via `markCalled` + `markSeated`
     - Idempotent: deletes existing demo rows first
     - Safe fake data: Demo Comensal 1/2/3, +540000000001..3, demoN@example.test
     - Uses `log.*` — no raw `console.*` (except progress messages)
     - Uses `sql` from `@/lib/db/neon`
   </acceptance_criteria>
   <done>
     `scripts/seed-demo.ts` creates 3 reservations in distinct states. Idempotent, safe fake data, workflows LIVE. DEMO-04 + D-32.
   </done>
</task>

<task type="auto">
  <name>Task 2: Create scripts/smoke-test-mcp.sh — end-to-end MCP tool smoke test</name>
  <files>scripts/smoke-test-mcp.sh</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-33 (smoke-test-mcp.sh)
    - .planning/phases/01-foundation/01-02-edge-config-kv-SUMMARY.md (smoke test pattern)
  </read_first>
  <action>
    1. Create `scripts/smoke-test-mcp.sh`:

       ```bash
       #!/usr/bin/env bash
       # scripts/smoke-test-mcp.sh
       # End-to-end MCP tool smoke test — hits all 4 tools with proper auth
       # Uses production URL by default, accepts BASE_URL env override

       set -euo pipefail

       BASE_URL="${BASE_URL:-$(cat .env.local 2>/dev/null | grep VERCEL_URL | cut -d= -f2 | sed 's|^https://|https://|;s|^http://||' || echo "http://localhost:3000")}"
       MCP_API_KEY="${MCP_API_KEY:-$(cat .env.local 2>/dev/null | grep '^MCP_API_KEY=' | cut -d= -f2)}"

       if [ -z "$MCP_API_KEY" ]; then
         echo "ERROR: MCP_API_KEY not found in .env.local"
         exit 1
       fi

       BASE="${BASE_URL:-http://localhost:3000}"
       MCP_URL="${BASE}/mcp"
       BEARER="Authorization: Bearer ${MCP_API_KEY}"

       echo "[smoke:mcp] Testing against ${MCP_URL}"
       PASS=0
       FAIL=0

       # Helper: run a tool call
       run_tool() {
         local tool_name="$1"
         local payload="$2"
         local expected_ok="$3"

         local response
         response=$(curl -s -w "\n%{http_code}" -X POST "${MCP_URL}" \
           -H "Content-Type: application/json" \
           -H "${BEARER}" \
           -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"${tool_name}\",\"arguments\":${payload}}}")

         local body
         body=$(echo "$response" | head -n -1)
         local http_code
         http_code=$(echo "$response" | tail -n 1)

         if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
           if [ "$expected_ok" = "true" ] && echo "$body" | grep -q '"ok":true'; then
             echo "[smoke:mcp] PASS ${tool_name} (HTTP ${http_code})"
             PASS=$((PASS + 1))
           elif [ "$expected_ok" = "false" ] && echo "$body" | grep -q '"ok":false'; then
             echo "[smoke:mcp] PASS ${tool_name} (expected error, HTTP ${http_code})"
             PASS=$((PASS + 1))
           else
             echo "[smoke:mcp] FAIL ${tool_name} (unexpected response: ${body})"
             FAIL=$((FAIL + 1))
           fi
         else
           echo "[smoke:mcp] FAIL ${tool_name} (HTTP ${http_code})"
           FAIL=$((FAIL + 1))
         fi
       }

       # Tool 1: create_reservation (expected: success)
       run_tool "create_reservation" '{"name":"Smoke Test","email":"smoke@example.test","phone":"+5491100000001","party_size":2}' "true"

       # Tool 2: get_reservation_status (expected: INVALID_SESSION — no header)
       run_tool "get_reservation_status" '{}' "false"

       # Tool 3: extend_wait (expected: INVALID_SESSION — no header)
       run_tool "extend_wait" '{}' "false"

       # Tool 4: cancel_reservation (expected: INVALID_SESSION — no header)
       run_tool "cancel_reservation" '{}' "false"

       echo ""
       echo "[smoke:mcp] Results: ${PASS} passed, ${FAIL} failed"

       if [ "$FAIL" -gt 0 ]; then
         exit 1
       fi
       ```
   </action>
   <verify>
     <automated>test -f scripts/smoke-test-mcp.sh && grep -q 'create_reservation' scripts/smoke-test-mcp.sh && grep -q 'get_reservation_status' scripts/smoke-test-mcp.sh && grep -q 'extend_wait' scripts/smoke-test-mcp.sh && grep -q 'cancel_reservation' scripts/smoke-test-mcp.sh && grep -q 'MCP_API_KEY' scripts/smoke-test-mcp.sh && grep -q 'tools/call' scripts/smoke-test-mcp.sh</automated>
   </verify>
   <acceptance_criteria>
     - `scripts/smoke-test-mcp.sh` exists and is executable
     - Hits all 4 MCP tools: create_reservation, get_reservation_status, extend_wait, cancel_reservation
     - Uses `MCP_API_KEY` from `.env.local`
     - Accepts `BASE_URL` env override
     - Asserts 2xx + `{ ok: true/false }` shape
     - Reports pass/fail count, exits 0 or 1
   </acceptance_criteria>
   <done>
     `scripts/smoke-test-mcp.sh` — end-to-end MCP tool smoke test. All 4 tools, bearer auth, shape assertions. D-33.
   </done>
</task>

<task type="auto">
  <name>Task 3: Create scripts/smoke-money-shot.sh — deploy mid-flight smoke test</name>
  <files>scripts/smoke-money-shot.sh</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-31 (money-shot smoke test format)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-17 (Skew Protection prerequisite)
  </read_first>
  <action>
    1. Create `scripts/smoke-money-shot.sh`:

       ```bash
       #!/usr/bin/env bash
       # scripts/smoke-money-shot.sh
       # Money-shot smoke test: create reservations, deploy, verify in-flight survival
       # This is the Phase 2 gate before Phase 3 can start
       #
       # PREREQUISITE: Skew Protection must be enabled in Vercel dashboard (D-17)
       #
       # Automated part:
       # 1. Create 2 reservations via MCP
       # 2. Sleep 3s for workflows to settle
       # 3. Deploy (operator confirms)
       # 4. Poll SSE for post-deploy activity
       # 5. Exit 0 if both survive, non-zero otherwise

       set -euo pipefail

       BASE_URL="${BASE_URL:-$(cat .env.local 2>/dev/null | grep VERCEL_URL | cut -d= -f2 | sed 's|^https://|https://|;s|^http://||' || echo "http://localhost:3000")}"
       MCP_API_KEY="${MCP_API_KEY:-$(cat .env.local 2>/dev/null | grep '^MCP_API_KEY=' | cut -d= -f2)}"

       if [ -z "$MCP_API_KEY" ]; then
         echo "ERROR: MCP_API_KEY not found in .env.local"
         exit 1
       fi

       BASE="${BASE_URL:-http://localhost:3000}"
       MCP_URL="${BASE}/mcp"
       BEARER="Authorization: Bearer ${MCP_API_KEY}"

       echo "[smoke:money-shot] Testing money-shot against ${BASE}"
       echo "[smoke:money-shot] PREREQUISITE: Verify Skew Protection is enabled in Vercel dashboard"
       echo ""

       # Step 1: Create 2 reservations via MCP
       echo "[smoke:money-shot] Creating reservation 1..."
       R1=$(curl -s -X POST "${MCP_URL}" \
         -H "Content-Type: application/json" \
         -H "${BEARER}" \
         -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_reservation","arguments":{"name":"Money Shot 1","email":"money1@example.test","phone":"+5491100000001","party_size":2}}}')
       R1_ID=$(echo "$R1" | grep -o '"reservation_id":"[^"]*"' | cut -d'"' -f4)
       R1_TOKEN=$(echo "$R1" | grep -o '"session_token":"[^"]*"' | cut -d'"' -f4)
       echo "[smoke:money-shot] Reservation 1: id=${R1_ID} token=${R1_TOKEN}"

       echo "[smoke:money-shot] Creating reservation 2..."
       R2=$(curl -s -X POST "${MCP_URL}" \
         -H "Content-Type: application/json" \
         -H "${BEARER}" \
         -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_reservation","arguments":{"name":"Money Shot 2","email":"money2@example.test","phone":"+5491100000002","party_size":4}}}')
       R2_ID=$(echo "$R2" | grep -o '"reservation_id":"[^"]*"' | cut -d'"' -f4)
       R2_TOKEN=$(echo "$R2" | grep -o '"session_token":"[^"]*"' | cut -d'"' -f4)
       echo "[smoke:money-shot] Reservation 2: id=${R2_ID} token=${R2_TOKEN}"

       # Step 2: Sleep for workflows to settle
       echo "[smoke:money-shot] Waiting 3s for workflows to settle..."
       sleep 3

       # Step 3: Deploy (operator confirms — NOT auto-executed)
       echo ""
       echo "=========================================="
       echo "[smoke:money-shot] MONEY-SHOT DEPLOY"
       echo "=========================================="
       echo "Run this command to deploy:"
       echo "  git commit --allow-empty -m 'chore: money-shot deploy' && git push origin main"
       echo ""
       echo "After deploy completes, press ENTER to continue polling SSE..."
       read -r

       # Step 4: Poll SSE for each reservation
       echo "[smoke:money-shot] Polling SSE for reservation 1 (60s timeout)..."
       SSE1_START=$(date +%s)
       SSE1_SNAPSHOT=false
       SSE1_POST_DEPLOY=false
       DEPLOY_TS=$(date +%s)

       while true; do
         CURRENT=$(date +%s)
         ELAPSED=$((CURRENT - SSE1_START))
         if [ "$ELAPSED" -ge 60 ]; then
           echo "[smoke:money-shot] TIMEOUT polling reservation 1 SSE"
           break
         fi

         RESPONSE=$(curl -s -N --max-time 5 "${BASE}/api/events/${R1_ID}?session_token=${R1_TOKEN}" 2>/dev/null || true)
         if echo "$RESPONSE" | grep -q 'event: snapshot'; then
           SSE1_SNAPSHOT=true
           if echo "$RESPONSE" | grep -q '"status"'; then
             SSE1_POST_DEPLOY=true
           fi
           echo "[smoke:money-shot] Reservation 1: snapshot received (elapsed: ${ELAPSED}s)"
           break
         fi
       done

       echo "[smoke:money-shot] Polling SSE for reservation 2 (60s timeout)..."
       SSE2_START=$(date +%s)
       SSE2_SNAPSHOT=false

       while true; do
         CURRENT=$(date +%s)
         ELAPSED=$((CURRENT - SSE2_START))
         if [ "$ELAPSED" -ge 60 ]; then
           echo "[smoke:money-shot] TIMEOUT polling reservation 2 SSE"
           break
         fi

         RESPONSE=$(curl -s -N --max-time 5 "${BASE}/api/events/${R2_ID}?session_token=${R2_TOKEN}" 2>/dev/null || true)
         if echo "$RESPONSE" | grep -q 'event: snapshot'; then
           SSE2_SNAPSHOT=true
           echo "[smoke:money-shot] Reservation 2: snapshot received (elapsed: ${ELAPSED}s)"
           break
         fi
       done

       # Step 5: Results
       echo ""
       echo "=========================================="
       echo "[smoke:money-shot] RESULTS"
       echo "=========================================="
       echo "Reservation 1: snapshot=${SSE1_SNAPSHOT} post_deploy=${SSE1_POST_DEPLOY}"
       echo "Reservation 2: snapshot=${SSE2_SNAPSHOT}"

       FAIL=0
       if [ "$SSE1_SNAPSHOT" != "true" ]; then
         echo "[smoke:money-shot] FAIL: Reservation 1 did not receive SSE snapshot"
         FAIL=$((FAIL + 1))
       fi
       if [ "$SSE2_SNAPSHOT" != "true" ]; then
         echo "[smoke:money-shot] FAIL: Reservation 2 did not receive SSE snapshot"
         FAIL=$((FAIL + 1))
       fi

       if [ "$FAIL" -gt 0 ]; then
         echo "[smoke:money-shot] FAILED: ${FAIL} reservation(s) did not survive the deploy"
         exit 1
       fi

       echo "[smoke:money-shot] PASSED: Both reservations survived the deploy"
       echo ""
       echo "Skew Protection is working. The money-shot is verified."
       exit 0
       ```
   </action>
   <verify>
     <automated>test -f scripts/smoke-money-shot.sh && grep -q 'create_reservation' scripts/smoke-money-shot.sh && grep -q 'session_token' scripts/smoke-money-shot.sh && grep -q 'event: snapshot' scripts/smoke-money-shot.sh && grep -q 'Skew Protection' scripts/smoke-money-shot.sh && grep -q 'git push' scripts/smoke-money-shot.sh</automated>
   </verify>
   <acceptance_criteria>
     - `scripts/smoke-money-shot.sh` exists and is executable
     - Creates 2 reservations via MCP
     - Sleeps 3s for workflow settlement
     - Prompts operator for git push (NOT auto-executed)
     - Polls SSE for each reservation (60s timeout)
     - Asserts each receives at least one `event: snapshot`
     - Reports pass/fail, exits 0 or 1
     - Mentions Skew Protection prerequisite
   </acceptance_criteria>
   <done>
     `scripts/smoke-money-shot.sh` — deploy mid-flight smoke test. Creates reservations, prompts deploy, polls SSE, verifies survival. D-31.
   </done>
</task>

<task type="auto">
  <name>Task 4: Update package.json scripts</name>
  <files>package.json</files>
  <read_first>
    - .planning/phases/01-foundation/01-PATTERNS.md (existing npm scripts)
  </read_first>
  <action>
    1. Add the following scripts to `package.json` `scripts`:
       ```json
       {
         "seed:demo": "tsx scripts/seed-demo.ts",
         "smoke:mcp": "bash scripts/smoke-test-mcp.sh",
         "smoke:money-shot": "bash scripts/smoke-money-shot.sh",
         "dev:reset": "npm run db:migrate && npm run seed:demo"
       }
       ```
       These are added to the existing scripts object, not replacing it.
   </action>
   <verify>
     <automated>grep -q '"seed:demo"' package.json && grep -q '"smoke:mcp"' package.json && grep -q '"smoke:money-shot"' package.json && grep -q '"dev:reset"' package.json</automated>
   </verify>
   <acceptance_criteria>
     - `package.json` has `seed:demo` script
     - `package.json` has `smoke:mcp` script
     - `package.json` has `smoke:money-shot` script
     - `package.json` has `dev:reset` script
   </acceptance_criteria>
   <done>
     `package.json` scripts updated: `seed:demo`, `smoke:mcp`, `smoke:money-shot`, `dev:reset`.
   </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Smoke scripts → Production DB | Scripts read `.env.local` for DB connection; must NOT commit real credentials |
| Smoke scripts → Vercel API | `git push origin main` triggers deploy for money-shot test |
| seed-demo → service layer | Uses REAL `createReservation()` — workflows are live |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-08-01 | Information Disclosure | MCP_API_KEY in smoke scripts | accept | Scripts read from `.env.local` at runtime; never committed |
| T-02-08-02 | Tampering | seed-demo creates real DB rows | accept | Demo data uses safe fake names/emails; deleted on re-run (idempotent) |
| T-02-08-03 | Information Disclosure | session_token in smoke test output | accept | Only visible to operator running the script; not committed |

</threat_model>

<verification>
**End-to-end checks for this plan:**
1. `test -f scripts/seed-demo.ts` → seed script exists
2. `grep -q 'demo1@example.test' scripts/seed-demo.ts` → 3 demo reservations
3. `grep -q 'createReservation' scripts/seed-demo.ts` → uses real service layer
4. `test -f scripts/smoke-test-mcp.sh` → MCP smoke test exists
5. `grep -q 'tools/call' scripts/smoke-test-mcp.sh` → MCP protocol
6. `test -f scripts/smoke-money-shot.sh` → money-shot script exists
7. `grep -q 'event: snapshot' scripts/smoke-money-shot.sh` → SSE polling
8. `grep -q 'git push' scripts/smoke-money-shot.sh` → deploy prompt
9. `grep -q '"seed:demo"' package.json` → npm script registered
10. `grep -q '"smoke:mcp"' package.json` → npm script registered

</verification>

<success_criteria>
1. **seed-demo.ts:** 3 reservations in distinct states (waiting, called, seated), idempotent, safe fake data.
2. **smoke-test-mcp.sh:** Hits all 4 MCP tools, asserts 2xx + `{ ok: true/false }` shape.
3. **smoke-money-shot.sh:** Creates reservations, prompts deploy, polls SSE, verifies survival.
4. **package.json scripts:** `seed:demo`, `smoke:mcp`, `smoke:money-shot`, `dev:reset` registered.
5. **Skew Protection:** Money-shot script mentions prerequisite (D-17).
6. **Push-to-prod discipline:** Every commit auto-deploys; money-shot runs against production (D-34).

</success_criteria>

<output>
After completion, create `.planning/phases/02-backend-core/02-08-smoke-SUMMARY.md` documenting:
- Seed demo results (3 reservations created)
- MCP smoke test results (pass/fail per tool)
- Money-shot test results (if executed)
- Any deviations from the spec
</output>
