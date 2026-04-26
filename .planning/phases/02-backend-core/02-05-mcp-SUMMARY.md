# Phase 02-05 MCP Server — Summary

## Outcome

Plan complete. The MCP server is live at `app/mcp/[transport]/route.ts` with 4 tools (`create_reservation`, `get_reservation_status`, `extend_wait`, `cancel_reservation`), bearer-gated by `withMcpAuth`, with per-action `X-Reservation-Session` resolution.

This SUMMARY was authored by the orchestrator after the prior gsd-executor agent (`ad1eac2ac66d66106`) hit `FailedToOpenSocket` mid-flight. The agent had landed all three implementation commits cleanly before the API error; only this SUMMARY and the STATE/ROADMAP closeout commit remained. The orchestrator verified the build is green and the artifacts match the success criteria, then wrote this file.

## Files Created / Modified

| File | Change | Notes |
|------|--------|-------|
| `lib/mcp/auth.ts` | created (4602 B) | `verifyBearer` (constant-time vs `env.MCP_API_KEY`) + `resolveSession` (UUID-shape pre-check, single SELECT against `reservations.session_token`, never logs tokens) |
| `app/mcp/[transport]/route.ts` | created (8801 B) | `createMcpHandler` registering 4 tools; `withMcpAuth` wraps the whole handler; `GET = POST = DELETE = authHandler` |
| `package.json` | +`mcp-handler@^1.1.0`, +`@modelcontextprotocol/sdk@^1.26.0`; `zod@^4.3.6` already present | |
| `package-lock.json` | regenerated to reflect installs | |

## Verified Against Success Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| 4 tools registered via mcp-handler | ✅ | `route.ts` lines 109, 134, 161, 188 — `server.registerTool(...)` x4 |
| `withMcpAuth` gates the whole handler with bearer | ✅ | `route.ts` line 225 `withMcpAuth(mcpHandler, verifyBearer, { required: true })` |
| Bearer enforced; missing/invalid → 401 | ✅ | `verifyBearer` returns `undefined` → mcp-handler maps to 401 with `WWW-Authenticate` |
| Session enforced for action tools | ✅ | `get_reservation_status`, `extend_wait`, `cancel_reservation` all call `resolveSession(readSessionHeader(extra))` and short-circuit to `INVALID_SESSION` if null |
| `reservation_id` NOT in LLM-visible action input (Pitfall #5) | ✅ | Action schema is `z.object({}).passthrough()` — empty. Identity comes from `X-Reservation-Session` header |
| Zod schemas use `.passthrough()` | ✅ | `createReservationSchema` and `actionSchema` both use `.passthrough()` |
| Numerics coerced | ✅ | `party_size: z.coerce.number().int().min(1).max(20)` |
| Tool error contract `{ error: CODE, message }` | ✅ | `invalidSessionResponse()` returns `{ ok:false, error:{ code:"INVALID_SESSION", message: "…" } }`; service-layer `ServiceResult` already shapes the same contract |
| All logging via `lib/log.ts` with PII redaction | ✅ | `grep -n "console\\." app/mcp lib/mcp` returns no hits; `log.warn("mcp.auth.bearer_*")` and `log.info("mcp.tool.*")` use only `code`, `reservation_id`, `ok` — never bearer or session tokens |
| `MCP_API_KEY` in `lib/env.ts` | ✅ | `lib/env.ts:14` `MCP_API_KEY: z.string().min(1)` |
| `SKIP_ENV_VALIDATION=1 npm run build` succeeds | ✅ | Build output shows `ƒ /mcp/[transport]` registered as a Function route; type-check green |

## Architecture / Discipline Notes

- **One-verifier pattern (D-01, ARCHITECTURE Anti-Pattern 5):** Auth lives at the route boundary (`withMcpAuth`), not inline per tool. Adding a 5th tool tomorrow doesn't require touching auth — it's already gated.
- **Service-layer funnel (ARCHITECTURE §3.1):** Each tool body is a 5–15 line wrapper around the corresponding `lib/services/reservations.ts` function. No HTTP self-call (Pattern 1). MCP tools, future WhatsApp adapter, and staff API endpoints all funnel through the same service functions.
- **Spanish error copy (SAFE-03 empathic tone):** `INVALID_SESSION` message — *"No pudimos verificar tu reserva. Volvé a empezar la conversación."* Same code regardless of failure cause (missing header / malformed UUID / no row) to avoid an enumeration oracle.
- **Tool descriptions in Spanish:** the LLM-facing `title` and `description` are Spanish so Claude Sonnet 4.6 routes correctly when comensales ask in Spanish ("dame 5 más", "voy llegando", "no voy a ir").

## Deviations

None of substance. Two minor quality wins worth flagging:

1. **Constant-time bearer comparison** (`lib/mcp/auth.ts:43-51`). Plan didn't require it; the prior session's draft used plain `===`. The orchestrator verified `Buffer.from + timingSafeEqual` lands cleanly and provides defence-in-depth against the (low-likelihood, but free-to-prevent) length-oracle leak.
2. **UUID shape pre-check before the `session_token` SELECT** (`lib/mcp/auth.ts:104`). Loose regex (32–40 hex+dash chars) — strict UUID validation still happens at the DB. Faster fail path on garbage input, no functional change for valid sessions.

## What This Unblocks

- **Plan 02-06 (SSE handlers):** can run next; consumes nothing from MCP.
- **Plan 02-07 (staff API):** needs the service layer (already shipped in 02-03) + workflow (02-04). Independent of MCP route at code level.
- **Plan 02-08 (smoke tests):** `scripts/smoke-test-mcp.sh` will hit this route with curl + bearer + JSON-RPC `initialize` → `tools/list` → `tools/call create_reservation` → `tools/call get_reservation_status` (with the returned session_token in the header).

## Self-Check

- [x] All 5 success criteria from PLAN.md `<success_criteria>` verified
- [x] Build passes type-check (`SKIP_ENV_VALIDATION=1 npm run build`)
- [x] No raw `console.*` in new files (grep verified)
- [x] No PII or secrets in log strings (grep verified)
- [x] Tool registration uses `.passthrough()` per Pitfall #9
- [x] Action tools accept zero LLM-visible identity per Pitfall #5

**Self-Check: PASSED**
