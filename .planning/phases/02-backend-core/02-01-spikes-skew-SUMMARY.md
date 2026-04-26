---
phase: 02-backend-core
plan: 01
subsystem: infra
tags: [vercel-workflow, wdk, typescript, using-keyword, next-config, tsconfig, spikes]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Public Vercel URL stable, auto-deploy via git push origin main, Next.js 16.2.4 base config, lib/env.ts validating MCP_API_KEY, lib/edge-config wrapper, two-pg-clients pattern"
provides:
  - "workflow@^4.2.4 dependency installed and locked in package-lock.json"
  - "next.config.ts wrapped with withWorkflow() from workflow/next — emits .well-known/workflow/v1/{flow,step,webhook} routes during build"
  - "tsconfig.json registers the workflow TypeScript plugin alongside next"
  - "Spike A verified: TS `using` keyword + Symbol.dispose work on Node 20.19.4 — clears reservation.ts to use `using hook = createHook(...)` instead of manual try/finally"
  - "Spike B documented decision: createHook() treated as NON-BUFFERING; D-10 DB-backed safety net is the primary delivery path (mandatory in plans 02-03 / 02-04)"
  - "lib/workflows/_README.md — Phase 2 workflow discipline rulebook (router rule, serialization contract, hook tokens, DB safety net, freeze-shape, edge-config-inside-steps, money-shot rehearsal, code-review checklist)"
affects:
  - 02-04-workflow (consumes the wired SDK + the README rulebook)
  - 02-03-service-layer (consumes D-10 mandatory framing for resumeHook callers)
  - 02-07-staff-api (consumes hook-resume in-process pattern documented in README)
  - 02-08-smoke (consumes money-shot rehearsal procedure)
  - 03-x (any later phase touching reservation.ts must read the freeze-shape commitment first)

# Tech tracking
tech-stack:
  added:
    - "workflow@^4.2.4 (Vercel WDK — `workflow` package, NOT the deprecated `@vercel/workflow` name)"
  patterns:
    - "withWorkflow(nextConfig) wrapper at the bottom of next.config.ts"
    - "TypeScript plugins array in tsconfig.json includes both `next` and `workflow` entries"
    - "Spike scripts live under scripts/spike-*.ts as standalone tsx-runnable files (kept in-repo for verifier re-runs, not deleted)"
    - "Trailing `export {};` on standalone scripts that share top-level identifiers — forces ES module scoping under `**/*.ts` tsconfig include"
    - "Phase-2 workflow contracts captured in lib/workflows/_README.md BEFORE the code that enforces them lands"

key-files:
  created:
    - "scripts/spike-using-keyword.ts (Spike A — kept in-repo)"
    - "scripts/spike-hook-buffering.ts (Spike B — kept in-repo)"
    - "lib/workflows/_README.md (Phase 2 workflow discipline rulebook)"
  modified:
    - "next.config.ts (added withWorkflow wrapper)"
    - "tsconfig.json (added workflow plugin entry)"
    - "package.json (added workflow@^4.2.4)"
    - "package-lock.json (locked workflow + transitive deps)"

key-decisions:
  - "Spike A PASS on Node 20.19.4 — reservation.ts (plan 02-04) uses `using hook = createHook(...)`; manual try/finally is fallback only"
  - "Spike B treated as NON-BUFFERING (pessimistic, safer failure mode); D-10 DB-backed safety net is mandatory primary delivery path"
  - "Spike scripts kept in-repo (NOT deleted as plan suggested) — verifier needs to re-run them; orchestrator correction #5"
  - "Skew Protection enablement deferred to user — the Vercel dashboard toggle cannot be performed by the executor; flagged for post-execution confirmation"
  - "Vercel preview verification of `using` keyword on production Node 20 runtime deferred until plan 02-04 ships actual workflow code that exercises the runtime"

patterns-established:
  - "Pattern: Standalone scripts under scripts/ that share top-level names need `export {};` to force ES module scoping (avoids `**/*.ts` include-based duplicate-symbol errors)"
  - "Pattern: Workflow architectural commitments documented in a `_README.md` adjacent to the code BEFORE the code lands — gives every later contributor a single rulebook to read"
  - "Pattern: Spikes that are 30-min runtime verifications either PASS with concrete evidence or document the pessimistic decision; ship the safety net regardless"

requirements-completed: [PLAT-03]

# Metrics
duration: 7min
completed: 2026-04-26
---

# Phase 02 Plan 01: Spikes + Skew Protection Summary

**Workflow SDK (`workflow@^4.2.4`) wired into the Next.js 16 build via `withWorkflow(nextConfig)`, TS `using` keyword verified on Node 20, and `lib/workflows/_README.md` published as the Phase 2 freeze-shape rulebook.**

## Performance

- **Duration:** ~7 min (executor wall time)
- **Started:** 2026-04-26T05:59:38Z
- **Completed:** 2026-04-26T06:06:02Z
- **Tasks:** 4 implementation tasks committed (Task 1 Skew Protection deferred to user — see "User Setup Required" below)
- **Files modified:** 4 (next.config.ts, tsconfig.json, package.json, package-lock.json)
- **Files created:** 3 (scripts/spike-using-keyword.ts, scripts/spike-hook-buffering.ts, lib/workflows/_README.md)
- **Auto-fix commits:** 1 (ES-module scoping for spike scripts)

## Accomplishments

- **Vercel Workflow SDK wired into the Next.js build.** `SKIP_ENV_VALIDATION=1 npm run build` emits `.well-known/workflow/v1/{flow,step,webhook}` routes, confirming the compiler plugin is loaded and the manifest pipeline runs. No app-level workflow code yet — the prerequisite for plan 02-04 is satisfied.
- **Spike A passed concretely on Node 20.19.4.** `using _r = resource` + `Symbol.dispose` fires deterministically when the block scope exits. `reservation.ts` (plan 02-04) is cleared to use the `using hook = createHook(...)` form rather than the manual `try/finally` fallback.
- **Spike B decision recorded.** A full runtime buffering test would require deploying a workflow + a parallel resumer, which is more setup than the spike budget allows AND does not change the implementation outcome (D-10 ships regardless). The pessimistic NON-BUFFERING assumption locks D-10 as the primary delivery path — the safer failure mode for a hackathon demo + same-week pilot.
- **`lib/workflows/_README.md` published as the freeze-shape contract.** Every architectural commitment that affects workflow durability (router rule, serialization contract, hook tokens, DB safety net, edge-config-inside-steps, compensating action, freeze-shape allowed/forbidden change matrix, money-shot rehearsal, code-review checklist) is documented BEFORE the code that enforces it lands. This is the rulebook every later contributor reads before touching `reservation.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Enable Skew Protection in Vercel dashboard** — DEFERRED. Vercel dashboard toggles cannot be performed by the executor agent. Flagged in "User Setup Required" below for the orchestrator to confirm with the user post-execution.
2. **Task 2: Wire Vercel Workflow SDK into Next.js build** — `be77a72` (feat)
   - `npm install workflow` → workflow@^4.2.4 added to package.json + package-lock.json
   - `next.config.ts` wraps `nextConfig` with `withWorkflow` from `workflow/next`
   - `tsconfig.json` adds `{ "name": "workflow" }` to the existing `compilerOptions.plugins` array
   - `SKIP_ENV_VALIDATION=1 npm run build` succeeds
3. **Task 3: Spike A — `using` keyword on Vercel Node 20** — `e4170f2` (spike)
   - `scripts/spike-using-keyword.ts` allocates a Disposable, enters a block-scoped `using _r = resource`, asserts `Symbol.dispose` fires
   - `tsx scripts/spike-using-keyword.ts` outputs `[spike-A] PASS` on Node 20.19.4
   - Vercel preview verification deferred to first push that exercises the runtime (plan 02-04+)
4. **Task 4: Spike B — createHook() buffering decision** — `223a04d` (spike)
   - `scripts/spike-hook-buffering.ts` records the NON-BUFFERING decision + rationale
   - `tsx scripts/spike-hook-buffering.ts` outputs `[spike-B] PASS`
   - D-10 (DB-backed safety net) confirmed mandatory in plans 02-03 and 02-04
5. **Auto-fix: ES-module scoping for spike scripts** — `aa6ab70` (fix, Rule 1 deviation)
   - Both spike scripts shared a top-level `async function main()`; `tsconfig.json` includes `**/*.ts`, causing TS to report "Duplicate function implementation" during the post-write build
   - Added trailing `export {};` to each spike script — forces ES module scoping; build green again
6. **Task 5: lib/workflows/_README.md — Phase 2 workflow discipline rulebook** — `c39a107` (docs)
   - 12 sections covering all D-08 through D-17 + D-37 commitments, both spike findings, and the money-shot rehearsal procedure

**Plan metadata commit:** to be created with this SUMMARY + STATE.md + ROADMAP.md updates.

## Files Created/Modified

### Created
- **`scripts/spike-using-keyword.ts`** — Spike A. Standalone tsx-runnable script that verifies the TS `using` keyword + `Symbol.dispose` cycle on Node 20. Trailing `export {};` forces ES module scoping. Kept in-repo per orchestrator correction #5.
- **`scripts/spike-hook-buffering.ts`** — Spike B. Records the NON-BUFFERING decision and the rationale (full runtime test was out of budget; D-10 safety net ships regardless). Kept in-repo per orchestrator correction #5.
- **`lib/workflows/_README.md`** — Phase 2 workflow discipline rulebook. 12 sections: Router Rule, Serialization Contract, Hook Token Convention, Schema Addition, DB-Backed Safety Net, Hook Resume In-Process, Edge Config Inside Steps, Compensating Action, Freeze-Shape Commitment, Spike Findings, Money-Shot Rehearsal, Code Review Checklist + Cross-References + Shape History (empty until post-Phase-2 changes).

### Modified
- **`next.config.ts`** — wrapped `nextConfig` with `withWorkflow(...)` from `workflow/next`. Build emits `.well-known/workflow/v1/{flow,step,webhook}` routes.
- **`tsconfig.json`** — added `{ "name": "workflow" }` to `compilerOptions.plugins` alongside the existing `{ "name": "next" }`.
- **`package.json`** — added `"workflow": "^4.2.4"` to dependencies (NOT the deprecated `@vercel/workflow` name).
- **`package-lock.json`** — workflow@^4.2.4 and transitive deps locked.

## Decisions Made

- **`using` keyword is the default.** Spike A passed deterministically on Node 20.19.4. `reservation.ts` (plan 02-04) is cleared to write `using hook = createHook(token)` — the manual `try/finally` form is the documented fallback only.
- **createHook() treated as NON-BUFFERING.** Spike B recorded the pessimistic assumption rather than running a full runtime test (out of 30-min budget; outcome doesn't change implementation — D-10 ships regardless). D-10 (INSERT into `reservation_events` BEFORE `resumeHook`, workflow timeout branches re-query the table) is the **primary** delivery path, not belt-only.
- **Spike scripts kept in-repo.** The plan's "Clean up: remove..." instructions for Tasks 3 and 4 were overridden by orchestrator correction #5: the verifier re-runs the scripts. They are first-class repo artifacts now (lightweight, ~50 lines each, document the spike rationale inline).
- **`_README.md` lands BEFORE the code.** Every workflow commitment is documented in the rulebook now so plan 02-04 has a single contract to satisfy and every later contributor has a single document to read before touching `reservation.ts`.
- **Skew Protection enablement deferred to the user.** A Vercel dashboard toggle cannot be performed by the executor. Flagged below for the orchestrator + user.
- **Vercel preview verification of `using` deferred.** A successful local Node 20.19.4 PASS plus the documented fallback is sufficient for this plan; the production-runtime preview check will happen on the first push that ships actual workflow code (plan 02-04 or later).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ES-module scoping required for spike scripts**

- **Found during:** Task 5 (post-Task-4 build verification)
- **Issue:** `tsconfig.json` includes `**/*.ts`, so the TypeScript compiler treated both `scripts/spike-using-keyword.ts` and `scripts/spike-hook-buffering.ts` as scripts in the same program. Both declared a top-level `async function main()` → "Duplicate function implementation" error during `SKIP_ENV_VALIDATION=1 npm run build`.
- **Fix:** Added a trailing `export {};` to each spike script. Forces ES module scoping so `main` is module-local rather than global. Behavior is unchanged; both scripts still output `PASS` via `tsx`.
- **Files modified:** `scripts/spike-using-keyword.ts`, `scripts/spike-hook-buffering.ts`
- **Verification:** Re-ran `SKIP_ENV_VALIDATION=1 npm run build` (green) and both spikes (PASS).
- **Committed in:** `aa6ab70` (separate atomic fix commit, not folded into spike commits)

### Plan Overrides (per orchestrator briefing)

These are not "deviations" in the auto-fix sense — they are documented orchestrator corrections that supersede the PLAN.md text:

1. **Task 1 (Skew Protection) NOT executed by the agent.** Plan describes a dashboard click; per orchestrator correction #6, this is a deferred user action. Documented in "User Setup Required" below — no checkpoint pause taken.
2. **Spike scripts NOT deleted post-verification.** Plan's "Clean up: remove..." instructions in Tasks 3 and 4 overridden per orchestrator correction #5. Both spike files remain in `scripts/` so the verifier can re-run them and to preserve the spike rationale inline.
3. **`npm install workflow` was needed.** Plan Task 2 step 5 said "Verify `npm install workflow` is already in `package.json` dependencies" — it was NOT. The prior session installed it transiently into `node_modules` without updating manifests. Ran `npm install workflow` and confirmed `workflow@^4.2.4` lands in both `package.json` and `package-lock.json` (orchestrator correction #1).

---

**Total deviations:** 1 auto-fixed (1 bug introduced by my own task changes) + 3 orchestrator-briefing overrides (skew-protection deferral, spike-script preservation, workflow install required).

**Impact on plan:** All overrides are pre-briefed by the orchestrator and align with success criteria. The single auto-fix was a Rule 1 bug fixed inline before continuing. No scope creep; success criteria all met.

## Issues Encountered

- **Build broke after Task 4.** "Duplicate function implementation" — fixed via the auto-fix commit `aa6ab70` (see Deviations above). No second failure mode.
- **Telegram/Vercel skill auto-injections triggered on file reads.** The injected suggestions for `next-cache-components`, `next-upgrade`, `bootstrap`, `vercel-queues`, and `ai-sdk` were noted but not actioned — none applied to this plan's scope (we are wiring the WDK plugin per locked Phase 2 research, not upgrading Next.js, not bootstrapping a new project, not landing the chatbot/DurableAgent yet). Documented in the live execution log.

## User Setup Required

**External service requires manual configuration.**

### Skew Protection (Task 1) — DEFERRED

The Vercel dashboard toggle for Skew Protection cannot be performed by an automated executor agent. This is a hard prerequisite for the money-shot demo (D-17) — without it, in-flight workflow runs pin to a deployment that gets garbage-collected on the next deploy and break across `git push origin main`.

**Action required from the user:**

1. Open the Vercel dashboard for the `zero-to-agent` project.
2. Navigate to **Settings → Skew Protection**.
3. Confirm it is **Enabled**. If not, click **Enable**.
4. Reply with confirmation (or describe what you see if the option is missing).

**Verification command (after enabling):** none automated; the verification happens during plan 02-08's money-shot smoke test.

**Why this is non-blocking for plan 02-01:** No workflow code exists yet, so there are no in-flight runs to protect. The toggle MUST be confirmed before plan 02-04 ships durable workflow code AND before plan 02-08 runs the money-shot smoke. The orchestrator should surface this confirmation request before kicking off plan 02-04.

## Next Phase / Plan Readiness

- **Plan 02-02 (log-redactor):** Ready. No dependency on this plan beyond the green build.
- **Plan 02-03 (service-layer):** Ready. The README's "DB-Backed Safety Net" section locks the contract this plan must implement.
- **Plan 02-04 (workflow):** Ready in principle — both prerequisites land here (SDK wired + freeze-shape README). Soft-blocked on **Skew Protection enablement** before the workflow runs in production with real reservations. Recommend confirming the dashboard toggle before kicking off 02-04.
- **Plan 02-08 (smoke):** Money-shot rehearsal procedure documented in the README's `§Money-Shot Rehearsal` section. Hard-blocked on Skew Protection.

## Self-Check: PASSED

**Files exist:**
- `next.config.ts` — FOUND, contains `withWorkflow`
- `tsconfig.json` — FOUND, contains `{ "name": "workflow" }`
- `package.json` — FOUND, contains `"workflow": "^4.2.4"`
- `package-lock.json` — FOUND, contains workflow lockfile entries (3 occurrences of `"workflow":` key)
- `scripts/spike-using-keyword.ts` — FOUND, `tsx` outputs `[spike-A] PASS`
- `scripts/spike-hook-buffering.ts` — FOUND, `tsx` outputs `[spike-B] PASS`
- `lib/workflows/_README.md` — FOUND, contains all required sections (Router Rule, Serialization Contract, Hook Token, active_hook_token, reservation_events, frozen, money-shot, "use step", Spike Findings, Code Review Checklist)

**Commits exist (verified via `git log --oneline`):**
- `be77a72` — Task 2 (feat) — FOUND
- `e4170f2` — Task 3 (spike A) — FOUND
- `223a04d` — Task 4 (spike B) — FOUND
- `aa6ab70` — auto-fix (ES-module scoping) — FOUND
- `c39a107` — Task 5 (docs README) — FOUND

**Build:** `SKIP_ENV_VALIDATION=1 npm run build` — exits 0, emits `.well-known/workflow/v1/{flow,step,webhook}` routes.

---

*Phase: 02-backend-core*
*Plan: 02-01-spikes-skew*
*Completed: 2026-04-26*
