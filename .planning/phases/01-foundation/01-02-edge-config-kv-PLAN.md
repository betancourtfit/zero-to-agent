---
phase: 01-foundation
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - edge-config/seed.json
  - scripts/edge-config-seed.ts
  - scripts/smoke-test-kv.ts
  - lib/edge-config/index.ts
  - package.json
autonomous: false
requirements:
  - PLAT-06

must_haves:
  truths:
    - "Edge Config returns no_show_timeout_min === 20 after seed"
    - "Edge Config dashboard edit reflects on next read without redeploy"
    - "Upstash Redis ping/set/get/del round-trip succeeds"
    - "Seed script is idempotent (skips unchanged keys)"
  artifacts:
    - path: "edge-config/seed.json"
      provides: "6 operational params with demo-safe defaults per D-08"
      contains: "no_show_timeout_min"
    - path: "scripts/edge-config-seed.ts"
      provides: "Idempotent PATCH /v1/edge-config/{id}/items via Vercel REST API"
    - path: "scripts/smoke-test-kv.ts"
      provides: "Upstash Redis ping + set/get/del verification"
    - path: "lib/edge-config/index.ts"
      provides: "Typed getConfig<T>(key, fallback) wrapper for Phase 2+ consumers"
      exports: ["getConfig"]
  key_links:
    - from: "scripts/edge-config-seed.ts"
      to: "Vercel REST API"
      via: "PATCH https://api.vercel.com/v1/edge-config/{id}/items with Bearer VERCEL_TOKEN"
      pattern: "operation: \"upsert\""
    - from: "lib/edge-config/index.ts"
      to: "@vercel/edge-config get()"
      via: "EDGE_CONFIG connection string"
      pattern: "await get<T>(key)"
---

<objective>
Seed Vercel Edge Config with 6 operational parameters (D-08), provision verification that Upstash Redis is reachable, and ship the typed `getConfig<T>()` wrapper that Phase 2 workflow steps will consume.

Purpose: Phase 2 workflow code needs `getConfig('no_show_timeout_min')` to compile cleanly (Edge Config pulled forward from scope Fase 7 per ROADMAP). Phase 4 demo scenario 5 demonstrates a live dashboard edit propagating without redeploy — this plan provides the substrate.
Output: Edge Config populated and verified live; Redis verified reachable via smoke test; reusable typed read wrapper in `lib/edge-config/index.ts`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/01-PATTERNS.md
@CLAUDE.md

<interfaces>
<!-- Verbatim canonical snippets from 01-PATTERNS.md and 01-RESEARCH.md. -->

From 01-PATTERNS.md `edge-config/seed.json` (lines 1014-1027) — copy verbatim:
```json
{
  "no_show_timeout_min": 20,
  "followup_after_call_min": 1,
  "extension_min": 5,
  "max_extensions_per_ticket": 2,
  "eta_recompute_interval_sec": 60,
  "colors_by_party_size": {
    "1-2": "#A8E6CF",
    "3-4": "#FFD3B6",
    "5-6": "#FFAAA5",
    "7+": "#D5AAFF"
  }
}
```

From 01-PATTERNS.md `scripts/edge-config-seed.ts` (lines 858-911) — copy verbatim:
```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { get } from "@vercel/edge-config";

const FORCE = process.argv.includes("--force");

async function seedEdgeConfig() {
  const token = process.env.VERCEL_TOKEN;
  const edgeConfigConnectionString = process.env.EDGE_CONFIG;

  if (!token) throw new Error("VERCEL_TOKEN is required (local only — do not commit)");
  if (!edgeConfigConnectionString) throw new Error("EDGE_CONFIG is required");

  const url = new URL(edgeConfigConnectionString);
  const edgeConfigId = url.pathname.replace(/^\//, "");

  const seedPath = join(process.cwd(), "edge-config", "seed.json");
  const seed = JSON.parse(await readFile(seedPath, "utf-8"));

  const items = [];
  for (const [key, value] of Object.entries(seed)) {
    if (!FORCE) {
      const current = await get(key);
      if (JSON.stringify(current) === JSON.stringify(value)) {
        console.log(`[skip] ${key} (unchanged)`);
        continue;
      }
    }
    items.push({ operation: "upsert", key, value });
  }

  if (items.length === 0) {
    console.log("All keys up to date. Run with --force to overwrite.");
    return;
  }

  const res = await fetch(
    `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items }),
    }
  );

  const result = await res.json();
  if (!res.ok) throw new Error(`Edge Config seed failed: ${JSON.stringify(result)}`);
  console.log(`[seeded] ${items.map((i: { key: string }) => i.key).join(", ")}`);
}

seedEdgeConfig().catch((err) => { console.error(err); process.exit(1); });
```

From 01-PATTERNS.md `scripts/smoke-test-kv.ts` (lines 930-946) — copy verbatim:
```typescript
import { Redis } from "@upstash/redis";

async function smokeTestKV() {
  const redis = Redis.fromEnv();
  const pong = await redis.ping();
  if (pong !== "PONG") throw new Error(`KV ping failed: ${pong}`);

  await redis.set("smoke:test:key", "hello", { ex: 60 });
  const val = await redis.get("smoke:test:key");
  if (val !== "hello") throw new Error(`KV set/get failed: ${val}`);

  await redis.del("smoke:test:key");
  console.log("KV smoke test passed");
}

smokeTestKV().catch((err) => { console.error(err); process.exit(1); });
```

From 01-PATTERNS.md `lib/edge-config/index.ts` (lines 397-422) — copy verbatim:
```typescript
import { get } from "@vercel/edge-config";

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  return ((await get<T>(key)) ?? fallback);
}

type EdgeConfigKey =
  | "no_show_timeout_min"
  | "followup_after_call_min"
  | "extension_min"
  | "max_extensions_per_ticket"
  | "eta_recompute_interval_sec"
  | "colors_by_party_size";

export async function getTypedConfig<T>(key: EdgeConfigKey, fallback: T): Promise<T> {
  return ((await get<T>(key)) ?? fallback);
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create edge-config/seed.json + lib/edge-config/index.ts wrapper</name>
  <files>edge-config/seed.json, lib/edge-config/index.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-PATTERNS.md (sections "edge-config/seed.json", "lib/edge-config/index.ts")
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 5 "Edge Config Seeding" — full snippets and propagation timing)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-05 seed.json checked in, D-08 initial values, D-26 lib/edge-config/ wrapper location)
  </read_first>
  <action>
    1. Create `edge-config/seed.json` with the verbatim 6-key JSON from `<interfaces>` above. Values are the exact D-08 defaults: `no_show_timeout_min: 20`, `followup_after_call_min: 1`, `extension_min: 5`, `max_extensions_per_ticket: 2`, `eta_recompute_interval_sec: 60`, `colors_by_party_size: { "1-2": "#A8E6CF", "3-4": "#FFD3B6", "5-6": "#FFAAA5", "7+": "#D5AAFF" }`. Pretty-print with 2-space indent for diff readability when Phase 2 refines values.

    2. Create `lib/edge-config/index.ts` with the verbatim wrapper from `<interfaces>` above. Exports two functions:
       - `getConfig<T>(key: string, fallback: T): Promise<T>` — generic accessor
       - `getTypedConfig<T>(key: EdgeConfigKey, fallback: T): Promise<T>` — typed key union for the 6 operational params

       The fallback parameter is mandatory — Phase 2 workflow steps must never crash on a missing Edge Config key. The fallback values used by callers should match the seeded defaults in `seed.json` so behaviour is consistent if Edge Config is unreachable.
  </action>
  <verify>
    <automated>test -f edge-config/seed.json && test -f lib/edge-config/index.ts && node -e "const s=require('./edge-config/seed.json'); if(s.no_show_timeout_min!==20) process.exit(1); if(s.followup_after_call_min!==1) process.exit(1); if(s.extension_min!==5) process.exit(1); if(s.max_extensions_per_ticket!==2) process.exit(1); if(s.eta_recompute_interval_sec!==60) process.exit(1); if(!s.colors_by_party_size) process.exit(1); if(s.colors_by_party_size['1-2']!=='#A8E6CF') process.exit(1); console.log('OK')" && grep -q 'export async function getConfig' lib/edge-config/index.ts && grep -q 'export async function getTypedConfig' lib/edge-config/index.ts && grep -q 'EdgeConfigKey' lib/edge-config/index.ts && grep -q '@vercel/edge-config' lib/edge-config/index.ts</automated>
  </verify>
  <acceptance_criteria>
    - `edge-config/seed.json` parses as valid JSON with all 6 keys at the exact D-08 values
    - `edge-config/seed.json` `colors_by_party_size` object has exactly 4 size-band keys: `"1-2"`, `"3-4"`, `"5-6"`, `"7+"`
    - `lib/edge-config/index.ts` exports `getConfig<T>` with signature `(key: string, fallback: T) => Promise<T>`
    - `lib/edge-config/index.ts` exports `getTypedConfig<T>` with signature `(key: EdgeConfigKey, fallback: T) => Promise<T>`
    - `lib/edge-config/index.ts` defines the `EdgeConfigKey` union with all 6 D-08 keys
    - File imports `get` from `@vercel/edge-config` (not from `node-fetch` or anything else)
  </acceptance_criteria>
  <done>
    Seed values committed as the source of truth for Edge Config defaults. Typed wrapper ready for Phase 2 workflow consumers — they will call `getConfig('no_show_timeout_min', 20)` rather than touching `@vercel/edge-config` directly.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create scripts/edge-config-seed.ts + scripts/smoke-test-kv.ts + npm scripts</name>
  <files>scripts/edge-config-seed.ts, scripts/smoke-test-kv.ts, package.json</files>
  <read_first>
    - .planning/phases/01-foundation/01-PATTERNS.md (sections "scripts/edge-config-seed.ts", "scripts/smoke-test-kv.ts")
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 5 "REST API for writes — verified endpoint" and "scripts/edge-config-seed.ts" full snippet; Focus Area 6 "Upstash Redis Provisioning" full smoke test; A4 assumption — EDGE_CONFIG URL parsing format)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-06 idempotent seed, D-07 --force flag for overwriting dashboard edits)
    - edge-config/seed.json (just created — script reads this file)
    - lib/edge-config/index.ts (just created — script reuses `get()` indirectly through `@vercel/edge-config` for current-value comparison)
    - package.json (Task 2 of PLAN-01 added `check:env-sync` — must extend without removing existing scripts)
  </read_first>
  <action>
    1. Create `scripts/edge-config-seed.ts` with the verbatim snippet from `<interfaces>`. Key behaviors:
       - Reads `VERCEL_TOKEN` and `EDGE_CONFIG` from `process.env` (NOT `lib/env.ts` — scripts run in Node directly, before env validation context).
       - Parses `EDGE_CONFIG_ID` from the connection string URL pathname (verified format per RISK-5: `https://edge-config.vercel.com/{id}?token={readToken}`).
       - For each seed key, uses `@vercel/edge-config`'s `get()` to read current value; if it equals the seed value (deep JSON compare), skip. Otherwise upsert. Skip logic respects D-07 (don't overwrite dashboard edits unless `--force`).
       - PATCHes `https://api.vercel.com/v1/edge-config/{id}/items` with `Authorization: Bearer ${VERCEL_TOKEN}` and `{ items: [{ operation: "upsert", key, value }, ...] }`.
       - Tail-call error handler: `seedEdgeConfig().catch((err) => { console.error(err); process.exit(1); })`.
       - `--force` CLI flag bypasses skip logic.

    2. Create `scripts/smoke-test-kv.ts` with the verbatim snippet from `<interfaces>`. Key behaviors:
       - Uses `Redis.fromEnv()` which reads `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` automatically.
       - Sequence: `ping()` → expect `"PONG"`; `set("smoke:test:key", "hello", { ex: 60 })`; `get("smoke:test:key")` → expect `"hello"`; `del("smoke:test:key")`.
       - On any mismatch, throw with the actual value to aid debugging (do NOT log the key or value of any production data — this script uses a fixed test key only).

    3. Update `package.json` to add the following scripts (preserving existing scripts from PLAN-01 like `check:env-sync`):
       ```json
       {
         "scripts": {
           "edge-config:seed": "tsx scripts/edge-config-seed.ts",
           "edge-config:seed:force": "tsx scripts/edge-config-seed.ts -- --force",
           "smoke:kv": "tsx scripts/smoke-test-kv.ts"
         }
       }
       ```
       Use the Edit tool to merge into existing `scripts` object — do NOT overwrite the file. Preserve `dev`, `build`, `start`, `lint`, `check:env-sync` from PLAN-01.
  </action>
  <verify>
    <automated>test -f scripts/edge-config-seed.ts && test -f scripts/smoke-test-kv.ts && grep -q 'VERCEL_TOKEN' scripts/edge-config-seed.ts && grep -q 'process.argv.includes("--force")' scripts/edge-config-seed.ts && grep -q 'api.vercel.com/v1/edge-config' scripts/edge-config-seed.ts && grep -q '"operation": "upsert"' scripts/edge-config-seed.ts || grep -q '"operation":"upsert"' scripts/edge-config-seed.ts || grep -q 'operation: "upsert"' scripts/edge-config-seed.ts && grep -q 'process.exit(1)' scripts/edge-config-seed.ts && grep -q 'Redis.fromEnv()' scripts/smoke-test-kv.ts && grep -q 'redis.ping()' scripts/smoke-test-kv.ts && grep -q '"edge-config:seed":' package.json && grep -q '"smoke:kv":' package.json && grep -q '"check:env-sync":' package.json</automated>
  </verify>
  <acceptance_criteria>
    - `scripts/edge-config-seed.ts` reads `process.env.VERCEL_TOKEN` and `process.env.EDGE_CONFIG`, throws clear errors if either missing
    - `scripts/edge-config-seed.ts` parses `EDGE_CONFIG_ID` via `new URL(connectionString).pathname.replace(/^\//, "")`
    - `scripts/edge-config-seed.ts` uses `operation: "upsert"` in the PATCH body items
    - `scripts/edge-config-seed.ts` supports `--force` flag (`process.argv.includes("--force")`)
    - `scripts/edge-config-seed.ts` ends with `.catch((err) => { console.error(err); process.exit(1); })`
    - `scripts/smoke-test-kv.ts` uses `Redis.fromEnv()` (NOT `new Redis({...})`)
    - `scripts/smoke-test-kv.ts` performs ping → set → get → del round-trip with the literal test key `smoke:test:key`
    - `package.json` includes `edge-config:seed`, `edge-config:seed:force`, `smoke:kv` scripts and preserves `check:env-sync` from PLAN-01
  </acceptance_criteria>
  <done>
    Idempotent seed script ready (won't clobber Phase 4 dashboard demo edits unless `--force`). KV smoke test script ready. npm scripts wired so the human can run them via `npm run edge-config:seed` and `npm run smoke:kv`.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Run seed + smoke test against live Vercel + verify dashboard propagation</name>
  <files>(no new files — operational verification step)</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 5 "Propagation timing and live reads" — 15-second cache flush note)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-07 dashboard takes precedence; deferred ideas — `/api/health` is Phase 4)
    - scripts/edge-config-seed.ts (just created)
    - scripts/smoke-test-kv.ts (just created)
    - .env.local (created in PLAN-01 Task 3 via `vercel env pull`)
  </read_first>
  <action>
    Claude automates everything that has a CLI path; the human only verifies the dashboard-edit-propagates-without-redeploy behavior (success criterion #4 from ROADMAP).

    **Claude's automated steps:**

    1. Verify `.env.local` exists (created by PLAN-01 Task 3 via `vercel env pull`):
       ```bash
       test -f .env.local && grep -qE '^EDGE_CONFIG=' .env.local && grep -qE '^UPSTASH_REDIS_REST_URL=' .env.local && grep -qE '^UPSTASH_REDIS_REST_TOKEN=' .env.local
       ```
       If `EDGE_CONFIG` or Upstash vars are missing, the human did not complete PLAN-01 Task 3 marketplace integrations. Surface this clearly in the checkpoint.

    2. Verify `VERCEL_TOKEN` is set in `.env.local` (it is local-only, must be added manually by the human after generating from Vercel Dashboard -> Settings -> Tokens):
       ```bash
       grep -qE '^VERCEL_TOKEN=.+' .env.local || echo "MISSING: add VERCEL_TOKEN to .env.local"
       ```

    3. Run the Edge Config seed (sources env from `.env.local` via `dotenv-cli` if needed, or instruct human to source it):
       ```bash
       set -a; source .env.local; set +a
       npm run edge-config:seed
       ```
       Expected stdout (first run): `[seeded] no_show_timeout_min, followup_after_call_min, extension_min, max_extensions_per_ticket, eta_recompute_interval_sec, colors_by_party_size`. Second run should print `[skip]` for each key, then `All keys up to date. Run with --force to overwrite.`

    4. Verify Edge Config reads return seeded values via a one-liner Node script:
       ```bash
       set -a; source .env.local; set +a
       npx tsx -e "import('@vercel/edge-config').then(async ({ get }) => { const v = await get('no_show_timeout_min'); if (v !== 20) { console.error('FAIL: expected 20, got', v); process.exit(1); } console.log('OK: no_show_timeout_min ===', v); });"
       ```

    5. Run KV smoke test:
       ```bash
       set -a; source .env.local; set +a
       npm run smoke:kv
       ```
       Expected stdout: `KV smoke test passed`.

    6. Run seed a second time to confirm idempotency:
       ```bash
       set -a; source .env.local; set +a
       npm run edge-config:seed
       ```
       Expected: 6 lines `[skip] ...` followed by `All keys up to date. Run with --force to overwrite.`

    **Human verification step (cannot be automated — requires live dashboard interaction):**

    7. **Edge Config dashboard propagation test (success criterion #4):**
       - Open Vercel Dashboard → Project → Storage → Edge Config → your config
       - Edit `no_show_timeout_min` from `20` to `5`, save.
       - Wait 15 seconds visibly (per RESEARCH Focus Area 5 "warm function instance may serve a cached value for a few seconds").
       - Run the read assertion:
         ```bash
         set -a; source .env.local; set +a
         npx tsx -e "import('@vercel/edge-config').then(async ({ get }) => { const v = await get('no_show_timeout_min'); console.log('no_show_timeout_min =', v); });"
         ```
         Expected output: `no_show_timeout_min = 5` (NOT 20). This proves PLAT-06 success criterion #4: changes from dashboard take effect on next read without redeploy.
       - Restore the value to `20` in the dashboard (or run `npm run edge-config:seed:force` to restore from `seed.json`).
  </action>
  <verify>
    <automated>set -a; source .env.local 2>/dev/null; set +a; test -n "$EDGE_CONFIG" && test -n "$UPSTASH_REDIS_REST_URL" && test -n "$UPSTASH_REDIS_REST_TOKEN" && test -n "$VERCEL_TOKEN" && npm run edge-config:seed 2>&1 | grep -qE '(\[seeded\]|All keys up to date)' && npm run smoke:kv 2>&1 | grep -q 'KV smoke test passed' && npx tsx -e "import('@vercel/edge-config').then(async (m) => { const v = await m.get('no_show_timeout_min'); if (typeof v !== 'number') process.exit(1); console.log('OK',v); }).catch(()=>process.exit(1))"</automated>
  </verify>
  <acceptance_criteria>
    - First `npm run edge-config:seed` invocation seeds all 6 keys (stdout contains `[seeded]` line listing all 6 keys, OR all are already at seed values)
    - Second `npm run edge-config:seed` invocation prints `[skip]` for all 6 keys and `All keys up to date` (idempotency proven)
    - `npm run smoke:kv` exits 0 with stdout `KV smoke test passed`
    - `@vercel/edge-config` `get('no_show_timeout_min')` returns the seeded number (20 by default)
    - **Human-verified:** dashboard edit (e.g., 20 → 5) propagates to a fresh read within 15 seconds without redeploy
  </acceptance_criteria>
  <what-built>
    - 6 Edge Config keys live in production with D-08 defaults
    - Idempotent seed script proven (won't clobber Phase 4 dashboard demo)
    - Upstash Redis verified reachable (KV substrate ready for Phase 2 pub/sub)
    - PLAT-06 success criterion #4 directly verified: dashboard edit propagates without redeploy
  </what-built>
  <how-to-verify>
    1. Inspect Vercel Dashboard → Storage → Edge Config → confirm 6 keys present with expected values
    2. Confirm `npm run smoke:kv` prints `KV smoke test passed`
    3. Manually edit `no_show_timeout_min` in dashboard from `20` to `5`, wait 15 seconds, re-run the read assertion — expect `5`
    4. Restore to `20` (either via dashboard or `npm run edge-config:seed:force`)
  </how-to-verify>
  <resume-signal>
    Type `approved` after confirming: (a) seed script seeded all 6 keys then was idempotent on second run, (b) `npm run smoke:kv` passed, (c) dashboard edit propagated within 15 seconds without redeploy. If any step fails, describe the error.
  </resume-signal>
  <done>
    Edge Config has 6 operational params live; Upstash KV is verified reachable; the dashboard-propagates-without-redeploy invariant (PLAT-06 SC #4) is proven and ready for Phase 4 demo scenario 5.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Local script → Vercel REST API | `scripts/edge-config-seed.ts` sends `VERCEL_TOKEN` to `api.vercel.com` |
| Local script → Upstash Redis | `scripts/smoke-test-kv.ts` sends `UPSTASH_REDIS_REST_TOKEN` to Upstash REST endpoint |
| Vercel Dashboard → Edge Config | Human edits key values via browser; values propagate to all readers |
| Production runtime → Edge Config | `@vercel/edge-config get()` reads via `EDGE_CONFIG` connection string |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01 | Information Disclosure (DATA-03) | `VERCEL_TOKEN` in error logs | mitigate | Script catches errors and prints only the parsed JSON response body or top-level message via `console.error(err)`; does NOT print `process.env`, the connection string, or the Authorization header |
| T-02-02 | Tampering | Seed script overwrites Phase 4 dashboard demo values | mitigate | D-07 — script is idempotent by default (compares current value via `get()`, skips if unchanged); `--force` flag is opt-in only and documented |
| T-02-03 | Information Disclosure | `VERCEL_TOKEN` accidentally set as Vercel env var | mitigate | `lib/env.ts` marks it `optional()`; `.env.example` comments "LOCAL ONLY"; checkpoint message in PLAN-01 reinforces; PATCH script throws if missing — would not silently succeed in production runtime |
| T-02-04 | Denial of Service (CONFIG-01) | Edge Config unreachable at workflow runtime → workflow crashes | mitigate | `getConfig<T>(key, fallback)` requires fallback parameter; Phase 2 workflow steps pass D-08 defaults as fallback so behavior is consistent if Edge Config is briefly unreachable |
| T-02-05 | Tampering | Adversary with Vercel project access edits Edge Config to disable safety timers (`no_show_timeout_min: 999999`) | accept | Vercel project access is the trust boundary; same adversary could edit code or env vars. Seed script in repo provides a documented restore path via `npm run edge-config:seed:force`. |
| T-02-06 | Information Disclosure (DATA-02) | Smoke test logs leaking `UPSTASH_REDIS_REST_TOKEN` | mitigate | `Redis.fromEnv()` reads env internally; script logs only `"PONG"` / `"KV smoke test passed"` / fixed test key/value `"hello"` — never the token, never connection string |
| T-02-07 | Tampering | `EDGE_CONFIG` connection string parse fails on Team account format with `?teamId=` | mitigate | Per RESEARCH Focus Area 5, team accounts add `?teamId={TEAM_ID}` query param; `URL.pathname` extraction is unaffected by query params (verified format). If a parse anomaly occurs, the script throws clearly before PATCH attempt — no silent corruption. |
</threat_model>

<verification>
**End-to-end checks for this plan:**
1. `npm run edge-config:seed` (first run) seeds 6 keys via Vercel REST API
2. `npm run edge-config:seed` (second run) skips all keys (idempotency)
3. `@vercel/edge-config get('no_show_timeout_min')` returns 20 from production runtime
4. Vercel dashboard edit propagates to next read within 15 seconds without redeploy (human-verified)
5. `npm run smoke:kv` performs ping/set/get/del round-trip and exits 0
</verification>

<success_criteria>
1. **PLAT-06 (full):** All 6 operational params readable via `@vercel/edge-config`. Dashboard edits propagate without redeploy. Phase 4 demo scenario 5 substrate proven.
2. **Idempotency:** Re-running seed does not overwrite dashboard edits (D-07 satisfied).
3. **KV reachable:** Upstash Redis ping/set/get/del all succeed — substrate for Phase 2 pub/sub proven reachable.
4. **`getConfig<T>()` ready:** Phase 2 workflow code can `import { getConfig } from '@/lib/edge-config'` and compile cleanly.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-02-edge-config-kv-SUMMARY.md` documenting:
- Edge Config ID (extracted from connection string)
- Confirmed seeded values (output of a final read for each key)
- Smoke test output (KV ping latency if observable)
- Confirmed dashboard propagation timing observed (e.g., "edit visible at 12s")
- Any deviations from D-08 defaults (none expected — Phase 2 may refine)
</output>
