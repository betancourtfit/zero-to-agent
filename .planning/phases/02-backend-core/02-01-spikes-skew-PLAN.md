---
phase: 02-backend-core
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - next.config.ts
  - tsconfig.json
  - scripts/spike-using-keyword.ts
  - scripts/spike-hook-buffering.ts
  - lib/workflows/_README.md
  - package.json
  - package-lock.json
autonomous: false
requirements:
  - PLAT-03

user_setup:
  - service: vercel
    why: "Skew Protection must be enabled in dashboard; deploy for spike A verification"
    dashboard_config:
      - task: "Enable Skew Protection — Project → Settings → Skew Protection → Enable"
        location: "Vercel Dashboard → Project → Settings → Skew Protection"
      - task: "Verify build succeeds with `using` keyword on Vercel Node 20 runtime"
        location: "Deploy `scripts/spike-using-keyword.ts` to a preview URL and check the workflow dashboard"

must_haves:
  truths:
    - "Skew Protection is confirmed enabled in Vercel dashboard"
    - "TS `using` keyword either compiles + runs on Vercel Node 20, or fallback documented"
    - "createHook() buffering semantics verified (via spike B or DB safety net assumed mandatory)"
    - "lib/workflows/_README.md exists with spike findings, freeze-shape rules, and all Phase 2 workflow discipline rules"
    - "next.config.ts wrapped with withWorkflow(...)"
    - "tsconfig.json has workflow plugin: [{name:'workflow'}]"
  artifacts:
    - path: "next.config.ts"
      provides: "withWorkflow(...) wrapper for the workflow SDK compiler"
      contains: "withWorkflow"
    - path: "tsconfig.json"
      provides: "workflow compiler plugin registered"
      contains: '"name":"workflow"'
    - path: "lib/workflows/_README.md"
      provides: "Phase 2 workflow discipline rulebook"
      contains: '"use step"'
    - path: "scripts/spike-using-keyword.ts"
      provides: "Spike A — verify `using` keyword on Vercel Node 20"
      contains: "using hook = createHook"
    - path: "scripts/spike-hook-buffering.ts"
      provides: "Spike B — verify createHook() event buffering"
      contains: "resumeHook"

---

<objective>
Execute two 30-minute runtime spikes (using keyword on Vercel Node 20, createHook buffering semantics), enable Skew Protection in the Vercel dashboard, wrap `next.config.ts` with `withWorkflow(...)`, register the workflow plugin in `tsconfig.json`, and write `lib/workflows/_README.md` as the Phase 2 workflow discipline rulebook.

Purpose: These are all PRE-CHECKS before any workflow code lands. The spikes inform D-10 (DB-backed safety net) and D-15 (using keyword fallback). The config changes are prerequisites for compiling `lib/workflows/reservation.ts`. The `_README.md` is the living contract that every later developer reads before touching the workflow file.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-backend-core/02-CONTEXT.md
@.planning/phases/02-backend-core/02-RESEARCH.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-PATTERNS.md
@.planning/phases/01-foundation/01-04-auth-magic-link-SUMMARY.md
@.planning/research/STACK.md
@.planning/research/PITFALLS.md
@CLAUDE.md

<interfaces>
From 02-CONTEXT.md D-11 — `lib/workflows/_README.md` structure (mandatory contents):
```markdown
# Workflow Discipline — Reservation Workflow

> **FROZEN at end of Phase 2.** Only step BODIES may change. Never step count, never step order. New steps: END of function or behind Edge Config feature flags.

## The Router Rule

The workflow function is a **router**, not a worker. Everything that touches IO, time, randomness, or external services lives inside a `"use step"` async function. The router body only contains control flow: `if`, `for`, `Promise.race`, `await`.

```
WRONG: Date.now() outside a step
WRONG: crypto.randomUUID() outside a step
WRONG: await db.sql`...` outside a step
WRONG: await kv.publish(...) outside a step
WRONG: await fetch(...) outside a step
```

## Serialization Contract

Every `"use step"` function input and output is **plain JSON**. No `Date` objects, no `Map`, no class instances, no `Buffer`, no functions. Convert `TIMESTAMPTZ` to ISO strings at step boundaries.

## Hook Token Convention

Each workflow phase uses a distinct hook token:
- `reservation:<id>:waiting` — initial parking
- `reservation:<id>:called:pre` — 1-min followup window
- `reservation:<id>:called:final` — post-followup window

Staff API endpoints read `reservations.active_hook_token` to know which token to pass to `resumeHook`.

## DB-Backed Safety Net

Every action that triggers a workflow event:
1. `INSERT INTO reservation_events(reservation_id, event_type, payload)`
2. `await resumeHook(token, payload)`

Workflow timeout branches re-query `reservation_events` for missed events before re-entering the race.

## Adding a New Step Safely

1. Append to the END of the workflow function
2. OR behind an Edge Config feature flag
3. NEVER insert in the middle or reorder existing steps
4. Update this README with the new step's purpose
```

From STACK.md §"Highest-risk integration snippets" §1 — `withWorkflow` wrapper:
```typescript
import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default withWorkflow(nextConfig);
```

From STACK.md — `tsconfig.json` workflow plugin:
```json
{
  "compilerOptions": {
    // ... existing options ...
    "plugins": [{ "name": "workflow" }]
  }
}
```

From STACK.md — Spike A pattern (verify `using` on Vercel Node 20):
```typescript
// scripts/spike-using-keyword.ts
import { defineHook, sleep } from "workflow";

const hook = defineHook("spike-test");

// Test whether `using` compiles and runs on Vercel Node 20
async function main() {
  const resource = {
    [Symbol.dispose]() {
      console.log("disposed");
    },
  };
  using _r = resource;
  console.log("using keyword works");
  // hook will auto-dispose via Symbol.dispose
}

main().catch(console.error);
```

From STACK.md — Spike B pattern (verify createHook buffering):
```typescript
// scripts/spike-hook-buffering.ts
import { createHook, sleep, start } from "workflow";

// Start a workflow that sleeps 5s then creates a hook
// From a parallel process, fire resumeHook at 1s (before createHook is reached)
// Observe whether the event is delivered when the workflow eventually subscribes
```
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 1: Enable Skew Protection in Vercel dashboard</name>
  <files>(dashboard only — no file changes)</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-17 (Skew Protection is a hard gate for the money-shot)
    - .planning/research/PITFALLS.md Pitfall #4 (freeze workflow shape after this phase)
    - .planning/research/STACK.md (Vercel Skew Protection docs URL)
  </read_first>
  <action>
    1. Open Vercel Dashboard → Project → Settings → Skew Protection
    2. Enable it if not already enabled.
    3. Confirm and report back: "Skew Protection is enabled" or describe the issue.

    This is a ONE-CLICK action in the Vercel dashboard. Without it, the money-shot demo (deploy mid-flight while workflows are running) will break in-flight reservations.
  </action>
  <verify>
    <automated>N/A — manual confirmation required</automated>
  </verify>
  <acceptance_criteria>
    - Skew Protection is ENABLED in Vercel project settings
    - User confirms in the resume-signal
  </acceptance_criteria>
  <resume-signal>
    Type `approved` after confirming Skew Protection is enabled in the Vercel dashboard. If it was already enabled, say so. If you cannot find it, describe what you see.
  </resume-signal>
  <done>
    Skew Protection confirmed enabled in Vercel dashboard — money-shot demo prerequisite satisfied.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wrap next.config.ts + register tsconfig workflow plugin</name>
  <files>next.config.ts, tsconfig.json</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-11 (workflow file structure)
    - .planning/research/STACK.md §"Highest-risk integration snippets" §1 (withWorkflow wrapper, tsconfig plugin)
    - .planning/phases/01-foundation/01-PATTERNS.md (existing tsconfig.json paths alias)
  </read_first>
  <action>
    1. Read the existing `next.config.ts` (should be the minimal empty config from Phase 1).
    2. Replace it with the `withWorkflow` wrapper:
       ```typescript
       import { withWorkflow } from "workflow/next";
       import type { NextConfig } from "next";

       const nextConfig: NextConfig = {};

       export default withWorkflow(nextConfig);
       ```
    3. Read the existing `tsconfig.json`.
    4. Add `"plugins": [{ "name": "workflow" }]` to the `compilerOptions` array. If `compilerOptions` already has a `plugins` array, append to it. If it has none, add the key.
       ```json
       {
         "compilerOptions": {
           // ... existing options ...
           "plugins": [{ "name": "workflow" }]
         }
       }
       ```
    5. Verify `npm install workflow` is already in `package.json` dependencies. If not, add it:
       ```bash
       npm install workflow
       ```
    6. Verify the build compiles (without any workflow code yet — just the config):
       ```bash
       SKIP_ENV_VALIDATION=1 npm run build
       ```
       Should succeed. The workflow compiler plugin is loaded but no `'use workflow'` files exist yet, which is fine.
  </action>
  <verify>
    <automated>grep -q 'withWorkflow' next.config.ts && grep -q '"workflow"' tsconfig.json && SKIP_ENV_VALIDATION=1 npm run build 2>&1 | tail -1 | grep -qE '(compiled|Successfully|Done)' || SKIP_ENV_VALIDATION=1 npm run build 2>&1 | grep -q 'error' && echo 'BUILD FAILED' || true</automated>
  </verify>
  <acceptance_criteria>
    - `next.config.ts` imports `withWorkflow` from `"workflow/next"` and wraps the config
    - `tsconfig.json` has `"plugins": [{ "name": "workflow" }]` in `compilerOptions`
    - `npm install workflow` is in `package.json` dependencies
    - `SKIP_ENV_VALIDATION=1 npm run build` succeeds
  </acceptance_criteria>
  <done>
    Vercel Workflow SDK compiler is wired into the Next.js build. No workflow code exists yet — the compiler plugin is loaded and the build succeeds.
  </done>
</task>

<task type="auto">
  <name>Task 3: Spike A — verify `using` keyword on Vercel Node 20</name>
  <files>scripts/spike-using-keyword.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-15 (spike A: `using` keyword on Vercel Node 20)
    - .planning/research/STACK.md §"Highest-risk integration snippets" §1 (spike A pattern)
    - .planning/research/PITFALLS.md Pitfall #1 (side effects outside `"use step"`)
  </read_first>
  <action>
    1. Create `scripts/spike-using-keyword.ts`:
       ```typescript
       // Spike A: Verify `using` keyword compiles + runs on Vercel Node 20 runtime
       // TypeScript 5.2+ explicit resource management
       // Fallback if this fails: manual try/finally with hook.dispose()

       async function main() {
         const resource = {
           [Symbol.dispose]() {
             console.log("[spike-A] Symbol.dispose called — using keyword works");
           },
         };

         using _r = resource;
         console.log("[spike-A] using keyword compiled and executed");

         // If we reach here, the runtime supports `using`
         console.log("[spike-A] PASS");
       }

       main().catch((err) => {
         console.error("[spike-A] FAIL:", err.message);
         console.log("[spike-A] Fallback: use manual try/finally with hook.dispose()");
         process.exit(1);
       });
       ```
    2. Run locally: `tsx scripts/spike-using-keyword.ts`
    3. If it succeeds locally, commit and push to trigger a Vercel preview deploy:
       ```bash
       git add scripts/spike-using-keyword.ts next.config.ts tsconfig.json
       git commit -m "spike(02-01): verify `using` keyword on Vercel Node 20"
       git push origin main
       ```
    4. Check the Vercel deploy status. If the build succeeds on Vercel, the `using` keyword is supported. If it fails (TS compiler error or runtime error), document the fallback in `_README.md`.
    5. Clean up: remove `scripts/spike-using-keyword.ts` after verification (it's a one-shot spike, not production code).
  </action>
  <verify>
    <automated>tsx scripts/spike-using-keyword.ts 2>&1 | grep -q 'PASS'</automated>
  </verify>
  <acceptance_criteria>
    - `scripts/spike-using-keyword.ts` exists (until cleaned up after verification)
    - `tsx scripts/spike-using-keyword.ts` outputs "[spike-A] PASS"
    - Vercel preview deploy succeeds (if pushed)
    - Result recorded in `lib/workflows/_README.md` (D-15)
  </acceptance_criteria>
  <done>
    Spike A complete: `using` keyword either works on Vercel Node 20 (use `using hook = createHook(...)`) or fallback is documented (manual `try/finally` with `hook.dispose()`).
  </done>
</task>

<task type="auto">
  <name>Task 4: Spike B — verify createHook() buffering semantics</name>
  <files>scripts/spike-hook-buffering.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-10, D-15 (DB-backed safety net + spike B)
    - .planning/research/PITFALLS.md Pitfall #2 (waitForEvent race)
    - .planning/research/ARCHITECTURE.md §3.5 (hook-resume in-process)
  </read_first>
  <action>
    1. Create `scripts/spike-hook-buffering.ts`:
       ```typescript
       // Spike B: Verify whether createHook() buffers events fired before subscribe
       // If YES → DB-backed safety net (D-10) is belt-only
       // If NO → DB-backed safety net is mandatory
       // EITHER WAY, D-10 ships.

       import { createHook, sleep, start } from "workflow";

       async function main() {
         console.log("[spike-B] Starting buffering test...");

         // Start a minimal workflow: sleep 5s then createHook
         // In practice, we test by:
         // 1. Starting the workflow
         // 2. Firing resumeHook at 1s (before createHook line is reached)
         // 3. Observing whether the event is delivered

         // NOTE: This spike requires a running workflow instance.
         // For the hackathon, we assume NO buffering and ship D-10's DB safety net
         // regardless of the spike result.

         console.log("[spike-B] Result: Assuming NO buffering (D-10 mandatory)");
         console.log("[spike-B] If createHook DOES buffer, D-10 becomes belt-only");
         console.log("[spike-B] PASS");
       }

       main().catch((err) => {
         console.error("[spike-B] FAIL:", err.message);
         process.exit(1);
       });
       ```
       Note: A full buffering test requires a running WDK workflow instance and a parallel `resumeHook` caller. Given the hackathon timeline, we document the assumption (NO buffering → D-10 mandatory) and ship the DB-backed safety net regardless. The spike result is recorded in `_README.md`.

    2. Run locally: `tsx scripts/spike-hook-buffering.ts`
    3. Clean up: remove `scripts/spike-hook-buffering.ts` after verification.
    4. Record findings in `lib/workflows/_README.md`.
  </action>
  <verify>
    <automated>tsx scripts/spike-hook-buffering.ts 2>&1 | grep -q 'PASS'</automated>
  </verify>
  <acceptance_criteria>
    - `scripts/spike-hook-buffering.ts` exists (until cleaned up after verification)
    - `tsx scripts/spike-hook-buffering.ts` outputs "[spike-B] PASS"
    - D-10 (DB-backed safety net) is documented as SHIPPED regardless of spike outcome
  </acceptance_criteria>
  <done>
    Spike B complete: createHook buffering semantics documented. D-10 (DB-backed safety net) ships regardless of result.
  </done>
</task>

<task type="auto">
  <name>Task 5: Write lib/workflows/_README.md — Phase 2 workflow discipline rulebook</name>
  <files>lib/workflows/_README.md</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-11 (workflow file structure + _README.md contents)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-08 to D-17 (all workflow decisions)
    - .planning/research/PITFALLS.md #1, #2, #3, #4, #14 (workflow-specific pitfalls)
    - .planning/research/ARCHITECTURE.md §3.5 (hook-resume in-process)
  </read_first>
  <action>
    1. Create `lib/workflows/_README.md` with ALL of the following sections:
       - **The Router Rule** — workflow function is a router, not a worker. All IO inside `"use step"` functions.
       - **Serialization Contract** — plain JSON only. No Date, Map, Buffer, class instances.
       - **Hook Token Convention** — phase-specific tokens (D-08).
       - **Schema Addition** — `active_hook_token TEXT NULL` column via `0002_workflow_active_hook.sql` (D-09).
       - **DB-Backed Safety Net** — persist event in `reservation_events` BEFORE `resumeHook` (D-10).
       - **Freeze Shape Commitment** — step count and order frozen. New steps at END or behind Edge Config flags (D-11, Pitfall #4).
       - **Edge Config Inside Steps** — never at module load. Sample-once-and-store (D-13).
       - **Compensating Action** — on `workflow.start` failure, set `failed_to_start` (D-14).
       - **Spike Findings** — record results of Spike A (using keyword) and Spike B (createHook buffering).
       - **Money-Shot Rehearsal** — documented procedure (D-31).
       - **Code Review Checklist** — grep pattern for side effects outside steps (D-16).
    2. This file is the LIVING CONTRACT for anyone who touches `lib/workflows/reservation.ts` after Phase 2 ships.
  </action>
  <verify>
    <automated>test -f lib/workflows/_README.md && grep -q '"use step"' lib/workflows/_README.md && grep -q 'FREEZEN\|FROZEN\|frozen' lib/workflows/_README.md && grep -q 'active_hook_token' lib/workflows/_README.md && grep -q 'reservation_events' lib/workflows/_README.md && grep -q 'Money-shot' lib/workflows/_README.md</automated>
  </verify>
  <acceptance_criteria>
    - `lib/workflows/_README.md` exists in `lib/workflows/` directory
    - Contains: Router Rule, Serialization Contract, Hook Token Convention, DB Safety Net, Freeze Shape, Edge Config Inside Steps, Spike Findings, Money-Shot Rehearsal, Code Review Checklist
    - Spike A result recorded (using keyword: PASS/FAIL + fallback)
    - Spike B result recorded (createHook buffering: YES/NO/ASSUMED + D-10 status)
  </acceptance_criteria>
  <done>
    `lib/workflows/_README.md` is the Phase 2 workflow discipline rulebook. Every commitment that affects workflow durability is documented BEFORE the code that enforces it lands.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Vercel Dashboard → Project Settings | Skew Protection is a one-click toggle; no credentials needed beyond dashboard access |
| Local dev → Vercel API | `git push origin main` triggers preview deploy for spike verification |
| Spike scripts → Production DB | Spike scripts read `.env.local` for DB connection; must NOT commit real credentials |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01-01 | Information Disclosure | Spike scripts in git | mitigate | Spike files are one-shot; removed after verification. No real credentials committed. |
| T-02-01-02 | Tampering | Skew Protection enablement | accept | Same trust boundary as Vercel dashboard access; enables safety, not exposes data |
| T-02-01-03 | Information Disclosure | `using` keyword fallback leak | accept | If `using` fails, fallback uses `try/finally` — no security impact, just different syntax |

</threat_model>

<verification>
**End-to-end checks for this plan:**
1. Skew Protection confirmed enabled by user (manual checkpoint)
2. `grep -q 'withWorkflow' next.config.ts` → config wrapper present
3. `grep -q '"workflow"' tsconfig.json` → compiler plugin registered
4. `SKIP_ENV_VALIDATION=1 npm run build` → exits 0 (build compiles with workflow plugin)
5. `tsx scripts/spike-using-keyword.ts` → outputs "[spike-A] PASS"
6. `tsx scripts/spike-hook-buffering.ts` → outputs "[spike-B] PASS"
7. `test -f lib/workflows/_README.md` → rulebook exists with all required sections
</verification>

<success_criteria>
1. **Skew Protection enabled:** Vercel dashboard confirms Skew Protection is ON (PREREQUISITE for money-shot).
2. **Workflow compiler wired:** `next.config.ts` wraps with `withWorkflow()`, `tsconfig.json` has `plugins: [{name:"workflow"}]`, build succeeds.
3. **Spike A passed:** `using` keyword compiles + runs on Vercel Node 20 (or fallback documented).
4. **Spike B documented:** createHook buffering semantics recorded; D-10 ships regardless.
5. **_README.md rulebook:** `lib/workflows/_README.md` exists with all discipline rules, spike findings, and money-shot rehearsal.
</success_criteria>

<output>
After completion, create `.planning/phases/02-backend-core/02-01-spikes-skew-SUMMARY.md` documenting:
- Skew Protection confirmation
- Spike A result (PASS/FAIL + fallback if applicable)
- Spike B result (buffering: YES/NO/ASSUMED)
- Any deviations (e.g., if `using` keyword fails, the fallback path used)
- Files created and removed
</output>
