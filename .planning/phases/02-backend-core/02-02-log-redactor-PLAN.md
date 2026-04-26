---
phase: 02-backend-core
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/log.ts
  - __tests__/log-redact.test.ts
  - .eslintrc.json (optional: add console.log allow-list rule)
autonomous: true
requirements:
  - SAFE-01

must_haves:
  truths:
    - "lib/log.ts exports log.info, log.warn, log.error, redactPII, PII_KEYS"
    - "redactPII walks object tree depth 4, masks emails + phones + known PII keys"
    - "__tests__/log-redact.test.ts has 6+ test cases covering all redaction paths"
    - "PII_KEYS covers all schema columns from 0001_init.sql (name, email, phone)"
  artifacts:
    - path: "lib/log.ts"
      provides: "PII redactor + structured logger — replaces all raw console.log in production code"
      exports: ["log", "redactPII", "PII_KEYS"]
    - path: "__tests__/log-redact.test.ts"
      provides: "6+ test cases for redactPII"
      contains: "node:test"

---

<objective>
Create `lib/log.ts` — the PII redactor and structured logger for the entire project. Exports `log.info/warn/error` + `redactPII()` helper. Used everywhere in `lib/services/*`, `lib/workflows/*`, MCP handlers, SSE handlers, and staff API endpoints. Replaces raw `console.*` calls outside `lib/log.ts`.

Purpose: SAFE-01 — prevent PII exposure in Vercel logs visible to anyone with project access. The redactor is the foundation that every later phase depends on for safe logging.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/02-backend-core/02-CONTEXT.md
@.planning/research/PITFALLS.md (Pitfall #15)
@.planning/phases/01-foundation/01-PATTERNS.md (PII discipline preview)
@CLAUDE.md

<interfaces>
From 02-CONTEXT.md D-21 — `lib/log.ts` shape:
```typescript
// lib/log.ts
// PII redactor + structured logger for all production code.
// Raw console.* outside this file is forbidden in production.

export const PII_KEYS = readonly string[] — centralized list of known PII field names
export function redactPII(value: unknown): unknown — walks tree depth 4
export const log = {
  info(event: string, ctx?: Record<string, unknown>): void
  warn(event: string, ctx?: Record<string, unknown>): void
  error(event: string, errOrCtx?: unknown, ctx?: Record<string, unknown>): void
}
```

From 02-CONTEXT.md D-23 — test cases for `__tests__/log-redact.test.ts`:
1. nested-email-in-payload
2. phone-in-array
3. mixed PII keys
4. depth-cap behavior (depth 4+ should not recurse)
5. no-PII passthrough
6. regression: `redactPII(reservationRow)` against a fixture row — asserts no `name`/`email`/`phone` substring leaks

From 01-PATTERNS.md — language convention: code/comments in English, Spanish for user copy.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create lib/log.ts with redactPII + structured logger</name>
  <files>lib/log.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-21 (full redactPII spec: email regex, phone regex, known PII keys, depth 4 cap)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-22 (deferred: AI SDK telemetry routing through redactPII — Phase 3)
    - .planning/phases/01-foundation/01-PATTERNS.md (language convention: English code)
  </read_first>
  <action>
    1. Create `lib/log.ts` with:
       - `PII_KEYS` array: `['name', 'email', 'phone', 'full_name', 'phone_number', 'payload.name', 'payload.email', 'payload.phone']`
       - `redactPII(value)` function:
         - Walks the value tree to depth 4
         - For each string value: applies email regex → masks local part (`j****@talos.lat`)
         - For each string value: applies Argentine phone regex (loose: `+54...`, `5491...`, `11-...`) → masks all but last 4 digits
         - For each known-PII KEY in the object: masks the value entirely (`[REDACTED]`)
         - Returns the transformed value (preserves structure)
       - `log` object with `info(event, ctx?)`, `warn(event, ctx?)`, `error(event, errOrCtx?, ctx?)`:
         - Each writes structured JSON via `console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...redactPII(ctx) }))`
         - `error()` handles both `error(event, ctx)` and `error(event, err, ctx)` overloads
         - Vercel's log shipping picks up JSON natively
    2. No external dependencies — pure `console.log` output, no Pino, no Winston (post-pilot).
  </action>
  <verify>
    <automated>test -f lib/log.ts && grep -q 'PII_KEYS' lib/log.ts && grep -q 'redactPII' lib/log.ts && grep -q 'export.*log' lib/log.ts && grep -q 'info' lib/log.ts && grep -q 'warn' lib/log.ts && grep -q 'error' lib/log.ts && grep -q 'depth' lib/log.ts</automated>
  </verify>
  <acceptance_criteria>
    - `lib/log.ts` exports `PII_KEYS` (array of known PII field names)
    - `lib/log.ts` exports `redactPII(value)` that walks tree to depth 4
    - `redactPII` masks emails: local part becomes `j****@domain.com`
    - `redactPII` masks Argentine-format phones: all but last 4 digits masked
    - `redactPII` masks known-PII keys entirely: `[REDACTED]`
    - `lib/log.ts` exports `log` object with `info`, `warn`, `error` methods
    - `log.*` writes structured JSON with `ts`, `level`, `event` fields
    - No external dependencies added (pure console.log)
  </acceptance_criteria>
  <done>
    `lib/log.ts` is the PII redactor and structured logger. All production code will import `log` from here instead of using raw `console.*`.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create __tests__/log-redact.test.ts with 6+ test cases</name>
  <files>__tests__/log-redact.test.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-23 (6 specific test cases required)
    - .planning/phases/01-foundation/01-PATTERNS.md (language convention)
  </read_first>
  <action>
    1. Create `__tests__/log-redact.test.ts` using Node's built-in `node:test` (no vitest dependency):
       - Test 1: nested-email-in-payload — `redactPII({ payload: { email: "test@example.com" } })` → email local part masked
       - Test 2: phone-in-array — `redactPII({ contacts: ["+5491112345678"] })` → phone masked except last 4 digits
       - Test 3: mixed PII keys — object with both email field AND a known-PII key field
       - Test 4: depth-cap behavior — nested object at depth 5 should NOT be recursed into
       - Test 5: no-PII passthrough — plain object with no PII fields passes through unchanged
       - Test 6: regression — `redactPII(reservationRow)` against a fixture row with name/email/phone columns, assert no raw PII substring leaks
    2. Run tests: `npx tsx --test __tests__/log-redact.test.ts`
    3. All 6 tests must pass.
  </action>
  <verify>
    <automated>npx tsx --test __tests__/log-redact.test.ts 2>&1 | grep -q 'all tests passed\|All tests passed'</automated>
  </verify>
  <acceptance_criteria>
    - `__tests__/log-redact.test.ts` exists using `node:test`
    - 6+ test cases: nested-email, phone-in-array, mixed PII keys, depth-cap, no-PII passthrough, regression with reservation row
    - All tests pass when run with `npx tsx --test`
  </acceptance_criteria>
  <done>
    `__tests__/log-redact.test.ts` has 6 test cases covering all redaction paths. SAFE-01 test coverage complete.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Vercel logs → anyone with project access | PII in logs is visible to anyone with Vercel team access; redactPII mitigates |
| `console.log` in production code | Every log path must go through `lib/log.ts`; raw `console.*` outside is forbidden |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-02-01 | Information Disclosure | PII in Vercel logs | mitigate | `redactPII` masks emails, phones, known PII keys; all log paths go through `lib/log.ts` |
| T-02-02-02 | Information Disclosure | `console.log` bypass | mitigate | ESLint custom rule or CI grep step flags raw `console.log/warn/error` outside `lib/log.ts` (real ESLint rule post-pilot; grep for Phase 2) |
| T-02-02-03 | Information Disclosure | `redactPII` misses a PII field | mitigate | `PII_KEYS` is centralized and exported; tests can assert it covers schema columns; Phase 2 adds columns to the list as needed |

</threat_model>

<verification>
**End-to-end checks for this plan:**
1. `grep -q 'PII_KEYS' lib/log.ts` → PII key list exists
2. `grep -q 'redactPII' lib/log.ts` → redactor function exists
3. `grep -q 'export.*log' lib/log.ts` → logger object exported
4. `npx tsx --test __tests__/log-redact.test.ts` → all 6+ tests pass
5. `redactPII` masks emails: `test@example.com` → `t****@example.com`
6. `redactPII` masks phones: `+5491112345678` → `+54911*******678` (last 4 digits preserved)
</verification>

<success_criteria>
1. **SAFE-01:** `lib/log.ts` exports `log.info/warn/error` + `redactPII()` that masks emails, phones, and known PII keys.
2. **Test coverage:** `__tests__/log-redact.test.ts` has 6+ test cases covering all redaction paths.
3. **No dependencies:** Pure `console.log` output, no Pino/Winston added.
4. **PII_KEYS centralized:** Exported array covers schema columns from `0001_init.sql`.
</success_criteria>

<output>
After completion, create `.planning/phases/02-backend-core/02-02-log-redactor-SUMMARY.md` documenting:
- PII_KEYS list
- redactPII behavior summary
- Test results (all 6+ cases passed)
- Any deviations from the spec (e.g., if phone regex needed adjustment for edge cases)
</output>
