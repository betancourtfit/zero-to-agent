---
phase: 02-backend-core
plan: 02
subsystem: infra
tags: [logging, pii-redaction, safe-01, structured-logs, vercel-logs, node-test, tsx]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Repo layout (lib/ subdirs), tsx + Node 20.19.4 toolchain, ES module convention, schema 0001_init.sql columns name/email/phone — the regression fixture mirrors this row shape"
  - phase: 02-backend-core
    provides: "Plan 02-01 wired the workflow SDK; this plan is dashboard-independent and lands in parallel with the user resolving B2 (Skew Protection)"
provides:
  - "lib/log.ts — PII redactor + structured logger; the single sink replacing raw console.* in Phase 2+ production code"
  - "redactPII(value, depth?) — depth-4 walk that masks emails (j****@domain), masks phones (last 4 digits, AR-style loose match), and replaces known-PII key values with [REDACTED]"
  - "PII_KEYS exported as the canonical list (case-insensitive match): name, email, phone, full_name, phone_number, payload.name, payload.email, payload.phone"
  - "log.info/warn/error — one-JSON-line-per-entry emitter with ts/level/event keys; log.error supports both (event, ctx) and (event, err, ctx) overloads with err.message run through redactPII"
  - "__tests__/log-redact.test.ts — 7 cases covering all D-23 redaction paths; runs via npx tsx --test, exit 0 on green"
  - "Test convention: Node built-in node:test + tsx (no vitest dep); first test file in the project"
affects:
  - 02-03-service-layer (every service-layer function logs through this)
  - 02-04-workflow (every workflow step logs through this)
  - 02-05-mcp-server (every MCP tool handler logs through this)
  - 02-06-sse (every SSE handler logs through this; query-string session_token redaction relies on D-21 redactor — see D-28)
  - 02-07-staff-api (every staff endpoint logs through this)
  - 02-08-smoke (smoke scripts can read structured JSON lines for assertions)
  - 03-x (chatbot AI SDK telemetry will route through redactPII per D-22)
  - 04-x (post-pilot Pino/Winston swap is internal to this file; public API stays stable)

# Tech tracking
tech-stack:
  added:
    - "node:test (built-in test runner — no new npm dep)"
  patterns:
    - "Single redaction sink at lib/log.ts; raw console.* outside this file forbidden in production code (enforcement deferred — see Deviations)"
    - "PII_KEYS centralized + exported so tests can assert schema-column coverage as the schema grows"
    - "Loose AR phone regex with negative lookbehind/lookahead on hex chars + hyphens — keeps UUIDs from being mistaken for phone numbers"
    - "Tests run as `npx tsx --test __tests__/<name>.test.ts`; exit code is the truth signal (TAP output is incidental)"
    - "Email redaction runs BEFORE phone redaction so digit runs inside email local parts are not re-eaten by the phone regex"
    - "Depth cap (4) is observable: depth-5 strings are intentionally left untouched so an audit can grep for un-redacted nested structures"

key-files:
  created:
    - "lib/log.ts (155 lines, no external deps)"
    - "__tests__/log-redact.test.ts (134 lines, 7 test cases)"
    - "__tests__/ directory (first tests directory in the repo)"
  modified: []

key-decisions:
  - "Phone regex hardened with hex-aware boundaries to prevent UUID false-positives (Rule 1 auto-fix surfaced by the regression test) — minimum-digit threshold raised from 7 to 8"
  - "Test runner: Node built-in node:test via tsx (no vitest dependency added) per CONTEXT D-23 default"
  - "ESLint custom rule for raw console.* DEFERRED — eslint.config.mjs is a flat config, not the legacy .eslintrc.json the plan optionally referenced; see Deviations for the path forward"
  - "Email mask uses domain-preserving form (j****@domain.com) per D-21 invariant; full email redaction is reserved for known-PII KEY matches"
  - "Phone mask preserves a leading + and the last 4 digits, dropping all separators in the masked output for a compact, recognisably-phonelike result"
  - "log.error err overload serialises Error to { name, message, stack } and runs the whole payload through redactPII — error.message is a known PII leak path per Pitfall #15"

patterns-established:
  - "Pattern: when the redactor's regex misbehaves on a non-PII string (UUID, ID, year), tighten the regex with a negative lookbehind/lookahead AND raise the minimum-digit floor — both belt-and-suspenders against future false positives"
  - "Pattern: regression tests in __tests__/ assert no raw PII substring leaks in the JSON-stringified output (negative assertion is the strongest contract)"
  - "Pattern: a logger module's tests are non-negotiable because every other module's logging calls assume the contract holds — first new file in the repo to ship with same-PR tests"

requirements-completed: [SAFE-01]

# Metrics
duration: 3min
completed: 2026-04-26
---

# Phase 02 Plan 02: Log Redactor Summary

**`lib/log.ts` ships the canonical PII redactor + structured logger for Phase 2+ — masks emails to `j****@domain`, AR phones to last-4-digits, and known-PII keys to `[REDACTED]`, with a 7-case Node:test suite that caught a UUID false-positive in the phone regex during execution.**

## Performance

- **Duration:** ~3 min (executor wall time)
- **Started:** 2026-04-26T06:11:31Z
- **Completed:** 2026-04-26T06:14:45Z
- **Tasks:** 2 implementation tasks committed (3 commits total — one Rule 1 auto-fix landed between tasks)
- **Files created:** 2 (lib/log.ts, __tests__/log-redact.test.ts)
- **Files modified:** 0
- **Auto-fix commits:** 1 (phone regex tightening)

## Accomplishments

- `lib/log.ts` exports `PII_KEYS`, `redactPII(value, depth?)`, and the `log` object with `info`/`warn`/`error` methods — the full surface area future plans depend on per CONTEXT D-21
- The redactor walks objects/arrays to depth 4, masks emails (preserving first char + domain), masks phones (preserving leading `+` and last 4 digits), and redacts known-PII keys with `[REDACTED]` — case-insensitive key match handles `Name` / `EMAIL` / mixed case rows from any source
- `__tests__/log-redact.test.ts` runs all 7 tests green via `npx tsx --test`; the 6th case (regression with a full reservation row fixture) caught a real bug — UUIDs were being partially masked by the loose phone regex
- The bug was fixed in-flight (Rule 1 auto-fix) by adding negative lookbehind/lookahead on hex chars + hyphens AND raising the minimum-digit threshold from 7 to 8 — both belt-and-suspenders
- `SKIP_ENV_VALIDATION=1 npm run build` still succeeds (Phase 1 + 02-01 work intact); the new module compiles cleanly under Next.js 16 + the workflow plugin
- No new npm dependencies added — pure `console.log` output as D-21 specifies; future Pino swap is internal-only

## Task Commits

Each task was committed atomically (conventional `<type>(02-02)` prefix):

1. **Task 1: Create `lib/log.ts`** — `81dae58` (feat)
2. **Rule 1 auto-fix: tighten phone regex against UUIDs** — `87fa419` (fix)
3. **Task 2: Create `__tests__/log-redact.test.ts`** — `f8d91f2` (test)

_Note: the auto-fix commit lands BETWEEN Task 1 and Task 2 so a `git bisect` at any commit hash sees a code state where the test suite would pass at that commit (the fix is part of the implementation, the test merely surfaced the latent bug)._

## Files Created/Modified

- `lib/log.ts` — PII redactor + structured logger. Exports `PII_KEYS`, `redactPII`, `log`. No external deps.
- `__tests__/log-redact.test.ts` — 7-case regression suite. Uses `node:test` + `node:assert/strict`. Run with `npx tsx --test __tests__/log-redact.test.ts`.

## Decisions Made

- **Test runner:** `node:test` via `tsx` (CONTEXT D-23 default). Avoids adding `vitest` for a 2-file footprint; matches the project's `tsx` script convention.
- **Email-then-phone redaction order:** if phone ran first, the digit run inside an email's local part (e.g., `user1234@x.com`) would be re-masked. Email-first preserves the email mask shape (`u****@x.com`).
- **`redactPII(reservationRow)` regression fixture:** mirrors the column shape of `db/migrations/0001_init.sql` exactly. Future schema changes that add PII columns must update both `PII_KEYS` and the fixture.
- **Phone regex hardening:** UUIDs are non-PII but were being mangled. Fixed with hex-char/hyphen negative lookbehind+lookahead AND `MIN_PHONE_DIGITS = 8` (Argentine phones are 10+ digits — 8 is a safe floor).
- **`log.error` err handling:** `error.message` is a known PII leak path (an exception thrown deep inside a service can quote the offending diner email). The err overload serialises the Error and runs the whole payload through `redactPII` — no special-case for stack lines (they're rare PII vectors and the cost of redacting them is negligible).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Phone regex was masking digit runs inside UUIDs**
- **Found during:** Task 2 (regression test case 6 with the reservation-row fixture)
- **Issue:** The first-pass loose phone regex `(\+?\d[\d\s().-]{6,}\d)` matched the inner digit run of a UUID (e.g., the `1234567890` in `9f3e1d4a-2bcd-4f7a-9b1c-1234567890ab`), producing the false mask `9f3e1d4a-2bcd-4f7a-9b1c-******7890ab`. UUIDs are not PII, but mangling them in logs makes log forensics painful.
- **Fix:** Added negative lookbehind `(?<![\da-fA-F-])` and negative lookahead `(?![\da-fA-F-])` to require the matched run to be bounded by non-hex/non-hyphen characters; raised `MIN_PHONE_DIGITS` from 7 to 8 as a belt-and-suspenders floor.
- **Files modified:** `lib/log.ts`
- **Verification:** Re-ran `npx tsx --test __tests__/log-redact.test.ts` → 7/7 pass. Spot-checked: `+5491112345678` → `+*********5678` ✓; `11-2345-6789` → `******6789` ✓; UUID untouched ✓.
- **Committed in:** `87fa419` (separate `fix` commit between Task 1 and Task 2 commits)

**2. [Rule 4 — Architectural] ESLint custom rule for raw `console.*` deferred**
- **Found during:** Task 1 prep (`.eslintrc.json` doesn't exist; project uses `eslint.config.mjs` flat config)
- **Issue:** The plan's optional file `.eslintrc.json (optional: add console.log allow-list rule)` references a config format the project doesn't use. The flat-config equivalent (`no-console` rule with file-based override) is straightforward but writing it correctly requires reading current `eslint-config-next` rule set + verifying a flat-config override pattern works in CI. Out of scope for this plan's "make the redactor land safely" objective.
- **Resolution:** Documented the path forward — add to `eslint.config.mjs` a `no-restricted-syntax` rule banning `CallExpression[callee.object.name='console']` outside `lib/log.ts` — and noted that CONTEXT.md D-21 already lists this as a CI grep step fallback (Phase 2 acceptable). Real ESLint rule lands in Phase 4 polish.
- **Verification:** N/A — no code change.
- **Tracking:** No commit. Recorded here so plan-phase 02-08 (smoke) can decide whether to add the CI grep step as part of money-shot prep.

---

**Total deviations:** 2 (1 Rule 1 auto-fix + 1 Rule 4 deferred architectural call)
**Impact on plan:** The Rule 1 fix is a real correctness win — without it, the redactor was actively damaging non-PII data in logs. The Rule 4 deferral matches CONTEXT.md D-21's own fallback path and is appropriately scoped to a later polish pass. No scope creep, no plan-shape changes.

## Issues Encountered

- **Plan's automated verification grep checked for the literal string "all tests passed"** which `node:test` TAP output does not emit. Worked around by checking `exit code 0` instead — that's the correct truth signal regardless of TAP-protocol changes. Worth correcting in future plans that use `node:test`.

## Threat Flags

None — `lib/log.ts` is itself the mitigation for `T-02-02-01`; no new surface introduced. The regex hardening tightens (not loosens) the redaction guarantee.

## Threat Model Coverage

| Threat ID | Mitigation Status | Evidence |
|-----------|-------------------|----------|
| T-02-02-01 (PII in Vercel logs) | mitigated | `redactPII` masks emails, phones, known-PII keys; `log.*` is the single sink |
| T-02-02-02 (`console.log` bypass) | partially mitigated | Convention documented in `lib/log.ts` header comment; ESLint rule deferred (see deviation #2). Phase 2 falls back to PR-time grep + code review per CONTEXT.md D-21. |
| T-02-02-03 (`redactPII` misses a PII field) | mitigated | `PII_KEYS` is centralised + exported; test case 7 asserts `name`/`email`/`phone` coverage; new schema columns require an explicit `PII_KEYS` update + fixture update |

## Self-Check

**Created files:**
- FOUND: `lib/log.ts`
- FOUND: `__tests__/log-redact.test.ts`

**Commits:**
- FOUND: `81dae58` (feat: add lib/log.ts)
- FOUND: `87fa419` (fix: tighten phone regex)
- FOUND: `f8d91f2` (test: add __tests__/log-redact.test.ts)

**Verification re-run:**
- `npx tsx --test __tests__/log-redact.test.ts` → exit 0, 7/7 pass
- `SKIP_ENV_VALIDATION=1 npm run build` → success

## Self-Check: PASSED

## Next Plan Readiness

- **Plan 02-03 (service layer):** unblocked. Every function in `lib/services/*` will import `log` from `@/lib/log` and use `log.info("reservation.create.start", { ... })` style structured events.
- **Plan 02-04 (workflow):** unblocked (depends on 02-01 + Skew Protection enable, NOT on this plan). When workflow steps emit logs, they use `log.*` from this module.
- **Plan 02-05+ (MCP, SSE, staff API):** all consume `log.*`. The signature is locked: `log.info(event, ctx?)`, `log.warn(event, ctx?)`, `log.error(event, errOrCtx?, ctx?)`.
- **No blockers introduced.** B1 (Resend domain) and B2 (Skew Protection) remain unchanged.

---
*Phase: 02-backend-core*
*Plan: 02-log-redactor*
*Completed: 2026-04-26*
