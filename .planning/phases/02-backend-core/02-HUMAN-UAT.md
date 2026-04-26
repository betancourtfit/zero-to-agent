---
status: partial
phase: 02-backend-core
source: [02-VERIFICATION.md]
started: 2026-04-26T12:37:23Z
updated: 2026-04-26T12:37:23Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live MCP curl against production deploy
expected: From a fresh terminal, `BASE_URL=https://zero-to-agent-xi.vercel.app bash scripts/smoke-test-mcp.sh` passes all 5 checks (create_reservation positive, 2 negative auth checks, get_reservation_status with session, cancel_reservation closes the fixture). HTTP 401 if Bearer is invalid; HTTP 200 with `INVALID_SESSION` body if `X-Reservation-Session` header missing.
result: PASS (local 5/5 on 2026-04-26 after bash 3.2 array-splat fix `21f04f9`); production variant deferred until next deploy. Same code path, so prod is a deploy+reachability check.

### 2. Money-shot live rehearsal (success criterion 3 — full proof)
expected: With Skew Protection enabled in Vercel Dashboard → Project → Settings → Skew Protection → On (B2 prerequisite, owner: user), run `BASE_URL=https://zero-to-agent-xi.vercel.app bash scripts/smoke-money-shot.sh`. When prompted, in another terminal: `git commit --allow-empty -m 'chore: money-shot deploy' && git push origin main`. Wait for Vercel build to complete, press ENTER to begin SSE polling. Both reservations emit `event: snapshot` within 60s of deploy and continue progressing through their lifecycles, proving in-flight workflows survive the deploy.
result: [pending]

### 3. Workflow visible in Vercel Workflow dashboard
expected: After running `npm run seed:demo` against the deployed app, open Vercel Dashboard → Workflows for the project. 3 workflow runs are visible (one per seeded reservation A/B/C), each tracking its lifecycle. Run B shows `applyCallTransition` step completed; run C shows `acknowledgeTerminal('seated')`.
result: [pending]

### 4. Edge Config reads return real values mid-workflow
expected: While a reservation is in `waiting` state, change `no_show_timeout_min` in Vercel Edge Config dashboard, then trigger `markCalled` via the staff API. The `applyCallTransition` step samples the new value (D-13 sample-once-and-store). `reservations.no_show_deadline = NOW() + new_timeout_minutes` for that ticket.
result: [pending]

### 5. KV pub/sub fan-out under two concurrent SSE connections
expected: Open `curl -N "https://.../api/events/<reservation_id>?session_token=<token>"` in two terminals; trigger `markCalled` from a third (e.g., `curl -X POST -H "Authorization: Bearer …" https://.../api/queue/<id>/call`). Both SSE streams receive the snapshot event first, then a live `reservation.called` event with matching `id`.
result: [pending]

## Summary

total: 5
passed: 1
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

None — the 3 code-level gaps from `02-VERIFICATION.md` have been closed (commits `20490ef`, `86206cb`, `c622f0c`). All 5 items above are live-infrastructure tests that require user/browser action and cannot be automated from a sandboxed agent.

Items 2 and 4 are gated on the user enabling Skew Protection (B2 in `STATE.md`) — that toggle is the only remaining hard-block before the money-shot demo can be rehearsed end-to-end.

## Notes

- The 7 warnings from `02-REVIEW.md` (WR-01 redactor depth cap, WR-02 SSE event ids, WR-03 markCalled race, WR-04 misleading comment, WR-05 subscribe-after-snapshot gap, WR-06 missing reservation_events on create, WR-07 ES2017 vs `using`) are real latent risks and should be tracked as Phase 2 polish or Phase 4 hardening items. They are NOT blockers for this UAT.
- The 9 info findings (IN-01..IN-09) are documented in `02-REVIEW.md`; defer to Phase 4 cleanup.
