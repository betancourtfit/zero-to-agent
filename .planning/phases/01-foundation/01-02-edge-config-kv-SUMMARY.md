---
phase: 01-foundation
plan: 02
status: complete
completed: 2026-04-26
requirements_validated:
  - PLAT-06
---

# Plan 01-02 SUMMARY: Edge Config seed + KV smoke + getConfig wrapper

## Edge Config

- **Store name:** `zero-to-agent-params`
- **ID:** `ecfg_brvvnajluboikevnyvjdmfgn1tmq`
- **Connected to:** project `zero-to-agent` (auto-injects `EDGE_CONFIG` env var across all 3 envs)
- **Storage size:** 247 B / 8 kB (after seed)

## Confirmed seeded values (live reads via `@vercel/edge-config get()`)

| Key | Value |
|-----|-------|
| `no_show_timeout_min` | `20` (number) |
| `followup_after_call_min` | `1` (number) |
| `extension_min` | `5` (number) |
| `max_extensions_per_ticket` | `2` (number) |
| `eta_recompute_interval_sec` | `60` (number) |
| `colors_by_party_size` | `{"1-2":"#A8E6CF","3-4":"#FFD3B6","5-6":"#FFAAA5","7+":"#D5AAFF"}` (object) |

All values match D-08 defaults. No deviations.

## Idempotency proven

- **First `npm run edge-config:seed`** → `[seeded] no_show_timeout_min, followup_after_call_min, extension_min, max_extensions_per_ticket, eta_recompute_interval_sec, colors_by_party_size`
- **Second `npm run edge-config:seed`** → 6 lines of `[skip] {key} (unchanged)` followed by `All keys up to date. Run with --force to overwrite.`

T-02-02 mitigation verified: rerunning the seed script will not clobber Phase 4 dashboard demo edits unless `--force` is passed.

## Dashboard propagation test (PLAT-06 SC #4)

| Step | Action | Result |
|------|--------|--------|
| 1 | Live read | `no_show_timeout_min = 20` |
| 2 | User edited dashboard 20 → 5, saved, waited ~15s | (dashboard write) |
| 3 | Live read | `no_show_timeout_min = 5` ✓ — propagated without redeploy |
| 4 | `npm run edge-config:seed:force` | `[seeded] no_show_timeout_min, ...` (restored from seed.json) |
| 5 | Live read | `no_show_timeout_min = 20` ✓ — restored |

**PLAT-06 success criterion #4 directly verified.** Phase 4 demo scenario 5 substrate is real.

## KV (Upstash Redis) smoke test

- **Run:** `set -a; source .env.local; set +a; npm run smoke:kv`
- **Output:** `KV smoke test passed`
- Sequence: `ping()` → `"PONG"`, `set("smoke:test:key", "hello", { ex: 60 })` → ok, `get("smoke:test:key")` → `"hello"`, `del("smoke:test:key")` → ok
- No latency measured (not in scope; Phase 2 will exercise real pub/sub round-trips)

Vercel Marketplace's Upstash integration provisions env vars under Vercel's KV-style names (`KV_REST_API_URL`, `KV_REST_API_TOKEN`). Plan 01-01 mirrored those values into `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` so `Redis.fromEnv()` (which reads the SDK-style names) works without modifications.

## Code shipped

| File | Purpose |
|------|---------|
| `edge-config/seed.json` | Source-of-truth defaults for the 6 D-08 operational params |
| `lib/edge-config/index.ts` | Typed `getConfig<T>(key, fallback)` + `getTypedConfig<T>` (keyed on `EdgeConfigKey` union) — Phase 2 workflow consumers |
| `scripts/edge-config-seed.ts` | Idempotent PATCH against `api.vercel.com/v1/edge-config/{id}/items`. `--force` overrides skip logic. Throws cleanly if `VERCEL_TOKEN` or `EDGE_CONFIG` missing. Never logs the token (T-02-01) |
| `scripts/smoke-test-kv.ts` | `Redis.fromEnv()` ping/set/get/del round-trip. Logs only `"PONG"` / `"KV smoke test passed"` / fixed test key (T-02-06) |
| `package.json` | npm scripts: `edge-config:seed`, `edge-config:seed:force`, `smoke:kv` |

## Deviations from plan

None. All scripts, snippets, and acceptance criteria executed as written.

## Unresolved items blocking downstream plans

None. Plans 01-03 and 01-04 can proceed.

- Plan 01-03 (DB migrations) needs `DATABASE_URL` + `DATABASE_URL_UNPOOLED` (already provisioned by Neon integration).
- Plan 01-04 (Auth.js) needs the `employees` table from Plan 01-03 + the Resend env vars (already set in 01-01).
- Phase 2 workflow code can `import { getConfig } from '@/lib/edge-config'` without any further setup.

## Threat model status

| Threat ID | Status |
|-----------|--------|
| T-02-01 (`VERCEL_TOKEN` in error logs) | Mitigated — script never prints `process.env`, `Authorization` header, or connection string |
| T-02-02 (seed clobbers dashboard demo) | Mitigated + verified — idempotency proven across 2 runs |
| T-02-03 (`VERCEL_TOKEN` set in Vercel envs) | Mitigated — kept local-only in `.env.local`; not in `vercel env ls` |
| T-02-04 (Edge Config unreachable at runtime) | Mitigated — `getConfig<T>(key, fallback)` enforces fallback parameter |
| T-02-05 (adversary edits Edge Config to disable safety timers) | Accepted — same trust boundary as code/env access; restore path documented (`npm run edge-config:seed:force`) |
| T-02-06 (KV token in smoke test logs) | Mitigated — script logs only PONG/test key, never token |
| T-02-07 (`EDGE_CONFIG` parse anomaly with team query params) | Mitigated — `URL.pathname` extraction unaffected by `?token=...&teamId=...`; verified parse worked on this team account |

## Verification evidence (commands run + outputs)

```
$ npm run smoke:kv
KV smoke test passed

$ npm run edge-config:seed
[seeded] no_show_timeout_min, followup_after_call_min, extension_min, max_extensions_per_ticket, eta_recompute_interval_sec, colors_by_party_size

$ npm run edge-config:seed   # second run
[skip] no_show_timeout_min (unchanged)
[skip] followup_after_call_min (unchanged)
... (4 more skip lines)
All keys up to date. Run with --force to overwrite.

$ npx tsx -e "...get('no_show_timeout_min')..."
no_show_timeout_min = 20

# user edits dashboard 20 → 5, waits 15s

$ npx tsx -e "...get('no_show_timeout_min')..."
no_show_timeout_min = 5

$ npm run edge-config:seed:force
[seeded] no_show_timeout_min, followup_after_call_min, ...

$ npx tsx -e "...get('no_show_timeout_min')..."
no_show_timeout_min = 20
```
