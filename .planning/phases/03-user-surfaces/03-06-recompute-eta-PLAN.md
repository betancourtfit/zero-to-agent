---
phase: 03-user-surfaces
plan: 06
type: execute
wave: 4
depends_on: [03-04, 03-05]
files_modified:
  - lib/workflows/reservation.ts
  - lib/workflows/_README.md
  - __tests__/workflow-recompute-eta.test.ts
  - .planning/phases/03-user-surfaces/03-06-PATH-DECISION.md
autonomous: false
requirements: [PLAT-08]
requirements_addressed: [PLAT-08]
must_haves:
  truths:
    - "PLAT-08 ships in one of two forms: Path C (`generateText` from `ai` SDK called inside the existing `recompute_eta` step body, with deterministic temperature: 0 + try/catch fallback to formula) OR Path D (the existing deterministic formula stays — the workflow-shape narrative is preserved by NOT touching the step boundary)."
    - "Step boundary count and order in `lib/workflows/reservation.ts` are UNCHANGED (D-11 freeze rule from Phase 2 honored)."
    - "If Path C is taken: on workflow replay, the LLM is NOT re-called — step output is sampled-once-and-stored per Phase 2 D-13. Result is deterministic across replays."
    - "If Path C output is unparseable / out of range / LLM call fails: fall back to formula `position * avg_turnover_min` inside the same step body. Workflow never returns an invalid eta_min."
    - "`lib/workflows/_README.md` Shape History gains a new entry documenting WHEN the body swap happened, WHICH path was chosen, and WHY (deterministic-on-replay rationale)."
    - "Money-shot smoke test (`npm run smoke:money-shot --dry-run`) and MCP smoke (`npm run smoke:mcp`) BOTH still green after the change. No regression to Phase 2 contracts."
  artifacts:
    - path: "lib/workflows/reservation.ts"
      provides: "recompute_eta step body — body-only change per D-11"
      contains: "recompute"
    - path: "lib/workflows/_README.md"
      provides: "shape-history entry recording the Phase 3 body swap"
      contains: "Shape History"
    - path: ".planning/phases/03-user-surfaces/03-06-PATH-DECISION.md"
      provides: "decision record: Path C or Path D + dry-run comparison data"
      contains: "DECISION:"
    - path: "__tests__/workflow-recompute-eta.test.ts"
      provides: "asserts Path C fallback to formula on LLM failure / unparseable output"
      min_lines: 40
  key_links:
    - from: "lib/workflows/reservation.ts"
      to: "ai package generateText (Path C only)"
      via: "import"
      pattern: "from \"ai\""
    - from: "lib/workflows/_README.md"
      to: "lib/workflows/reservation.ts"
      via: "shape-history reference"
      pattern: "recompute_eta"
---

<objective>
Resolve PLAT-08 (DurableAgent ETA) via the Path C decision documented in CONTEXT D-20 (REVISED) and RESEARCH §0. Either swap the body of the existing `recompute_eta` step to call `generateText` from the `ai` SDK (Path C) OR keep the deterministic formula (Path D — cut list #1) — the user gates this decision at execute time based on a 4h-capped dry-run comparison (D-21). The plan ships BOTH paths' code in the SAME plan; the executor chooses based on a checkpoint.

Purpose: This is the LAST Phase 3 requirement. PLAT-08 is on the cut list at #1 — the entire plan is structured so the user can ship Path D in 30 minutes if Path C's dry-run doesn't justify the 4h cost. Either way, Phase 3 closes with PLAT-08 marked done.

Output: A workflow file with the `recompute_eta` body either swapped (Path C) or unchanged (Path D), plus a documented decision record + a Shape History entry in `_README.md`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/03-user-surfaces/03-CONTEXT.md
@.planning/phases/03-user-surfaces/03-RESEARCH.md
@.planning/phases/03-user-surfaces/03-PATTERNS.md
@.planning/phases/02-backend-core/02-CONTEXT.md
@lib/workflows/reservation.ts
@lib/workflows/_README.md
@lib/services/reservations.ts
@CLAUDE.md

<interfaces>
Workflow shape (FROZEN per D-11):
- Step count and order CANNOT change.
- Step BODIES may change (this is allowed and is what Phase 3 uses).
- Step input/output must remain plain JSON (no Date, no functions, no class instances) — Pitfall #3.
- The persisted step return value is what's replayed; the body's side effects are NOT replayed.

The `recompute_eta` step (or its current equivalent — verify by grep before touching) lives in `lib/workflows/reservation.ts`. PATTERNS.md notes:
> "Phase 2 ships only the formula at `lib/services/reservations.ts → estimateEtaMin`; the step shell does not yet exist in `lib/workflows/reservation.ts`. Phase 3 plan-phase agent should confirm whether this step exists or needs to be created."

If the step shell does NOT exist in the workflow router, this plan downgrades to Path D automatically (creating a new step would change shape — forbidden by D-11). The verification checkpoint catches this.

AI SDK v6 generateText contract (RESEARCH.md lines 1086-1125):
```typescript
import { generateText } from "ai";

const { text } = await generateText({
  model: "anthropic/claude-sonnet-4.6", // DOT — locked
  temperature: 0,
  system: "Devolvés solo un número entero positivo. Sin texto, sin markdown, sin explicación.",
  prompt: `Estimación de espera en minutos para posición ${position} con grupo de ${partySize}, turnover promedio ${avgTurnoverMin} min/mesa. Responde solo con el número.`,
  maxOutputTokens: 8,
});
const parsed = Number(text.trim());
if (Number.isFinite(parsed) && parsed >= 0 && parsed < 240) return { eta_min: Math.round(parsed) };
// else fall through to formula
```

Edge Config getTypedConfig (Phase 1, used inside steps per Phase 2 ARCHITECTURE Pattern 5):
```typescript
const avgTurnoverMin = await getTypedConfig<number>("no_show_timeout_min", 15);
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Locate the existing `recompute_eta` step in `lib/workflows/reservation.ts` and capture baseline</name>
  <files>.planning/phases/03-user-surfaces/03-06-PATH-DECISION.md</files>
  <read_first>
    - lib/workflows/reservation.ts (FULL FILE — Phase 2 D-11 freeze; before changing anything, read end-to-end so the shape is known)
    - lib/workflows/_README.md (Shape History entries from Phase 2 plan 02-04)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-20 (Path C body), D-21 (4h cap + dry-run comparison criteria), D-22 (deterministic-on-replay rules)
    - .planning/phases/03-user-surfaces/03-RESEARCH.md §0 Critical Finding (Path verdicts table)
    - lib/services/reservations.ts → estimateEtaMin (the formula being potentially replaced)
  </read_first>
  <action>
1. Grep for the recompute step:
```bash
grep -n "recompute\\|eta_min\\|estimateEta" lib/workflows/reservation.ts
```

2. Three possible outcomes:
   - **Outcome A — step exists with formula body:** PERFECT. The body can be swapped to Path C. Note line range in PATH-DECISION.md.
   - **Outcome B — step exists but body is just `Promise.resolve()` / placeholder:** Path C still works (replace the placeholder with either the formula or generateText). Note in PATH-DECISION.md.
   - **Outcome C — no recompute step exists in the workflow router:** This blocks Path C entirely (creating a new step violates D-11). Force Path D. Note in PATH-DECISION.md.

3. If outcome C: skip directly to task 4 (Path D — keep formula at service layer; document why PLAT-08 ships as "deterministic formula" rather than "LLM-driven"). The Track 2 narrative is preserved by `lib/services/reservations.ts → estimateEtaMin` already existing in Phase 2 — the ETA IS computed deterministically, just not via LLM.

4. Create `.planning/phases/03-user-surfaces/03-06-PATH-DECISION.md` with this template (do NOT fill DECISION yet — that comes in task 3 checkpoint):
```markdown
# Plan 03-06 — Path Decision Record

**Created:** [today]
**Outcome of grep for `recompute_eta` in lib/workflows/reservation.ts:** [A | B | C above]
**Lines (if A or B):** [N-M]

## Baseline (current behavior before plan 03-06)

[Paste the existing step body here verbatim, or "no step exists" if Outcome C.]

## Path C — `generateText` inside step body

[Paste the proposed Path C snippet here verbatim from CONTEXT D-20, ready for implementation in task 2.]

## Path D — keep formula

[Paste the existing formula reference: `lib/services/reservations.ts → estimateEtaMin` lines [X-Y], no workflow change.]

## Dry-Run Comparison (filled by task 3)

| Reservation # | Position | Party Size | Formula ETA (min) | LLM ETA (min) | Actual seated_at-created_at (min) | LLM cost ($) |
|---------------|----------|------------|-------------------|---------------|------------------------------------|--------------|
| (10+ rows from seed-demo + manual workflow runs) | | | | | | |

## DECISION

[Filled at task 3 checkpoint. One of:]
- `PATH-C` — LLM ETA is within 25% of actual on demo data AND cost <$0.01 per recompute. Implement task 2 swap.
- `PATH-D` — LLM ETA is NOT measurably better OR cost too high. Keep formula. Skip task 2.
- `PATH-D-FORCED` — recompute_eta step does not exist in current workflow (Outcome C). Cannot ship Path C without violating D-11.
```

5. Do NOT modify `lib/workflows/reservation.ts` in this task. Only investigate.
  </action>
  <verify>
    <automated>grep -n "recompute\\|eta_min\\|estimateEta" lib/workflows/reservation.ts && test -f .planning/phases/03-user-surfaces/03-06-PATH-DECISION.md</automated>
  </verify>
  <acceptance_criteria>
    - `.planning/phases/03-user-surfaces/03-06-PATH-DECISION.md` exists
    - It records Outcome A / B / C explicitly
    - If A or B: it contains the verbatim baseline step body
    - If A or B: it contains the proposed Path C snippet
    - DECISION line is present but unfilled (`[Filled at task 3 checkpoint]`)
    - `lib/workflows/reservation.ts` is UNCHANGED (`git diff lib/workflows/reservation.ts` is empty)
  </acceptance_criteria>
  <done>
The decision-record skeleton is in place. The user (and the executor at task 3 checkpoint) has visibility into the current shape and the proposed change.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement Path C — swap `recompute_eta` body to use `generateText` (only if outcome A or B)</name>
  <files>lib/workflows/reservation.ts, __tests__/workflow-recompute-eta.test.ts</files>
  <read_first>
    - .planning/phases/03-user-surfaces/03-06-PATH-DECISION.md (the baseline body lives here; do NOT re-grep — single source of truth for this task)
    - .planning/phases/03-user-surfaces/03-RESEARCH.md §"Recompute ETA — Path C" lines 1086-1125 (canonical body)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-20 (REVISED), D-22 (deterministic-on-replay invariants)
    - lib/workflows/_README.md (read the freeze rules section again — anything outside step BODY is forbidden)
    - lib/log.ts (for the warn-on-LLM-failure log line)
  </read_first>
  <behavior>
    - Test 1 (deterministic-on-replay): given the same `(position, partySize, avgTurnoverMin)` inputs and a successful LLM response, the step returns the same `eta_min` value. (Mock generateText to return "23".)
    - Test 2 (LLM failure fallback): when generateText throws, the step returns `position * avgTurnoverMin` as the formula fallback. (Mock generateText to reject.)
    - Test 3 (unparseable output fallback): when generateText returns `"twenty"` (not a number), the step returns the formula. Log warns.
    - Test 4 (out-of-range output fallback): when generateText returns `"500"` (>240 ceiling), the step returns the formula.
    - Test 5 (negative output fallback): when generateText returns `"-5"`, the step returns the formula.
    - Test 6 (no LLM call when feature flag off): if `process.env.PLAT_08_LLM_ENABLED === "false"`, the step returns the formula directly without calling generateText (env-flag escape hatch in case the LLM costs spike during pilot).
  </behavior>
  <action>
**Skip this task entirely if PATH-DECISION.md DECISION is `PATH-D` or `PATH-D-FORCED`.**

1. If DECISION is `PATH-C`:
   - Open `lib/workflows/reservation.ts` and locate the `recompute_eta` step body (line range from PATH-DECISION.md).
   - Add the import at the top of the file (alongside existing `workflow` imports — DO NOT alter the workflow imports themselves):
```typescript
import { generateText } from "ai";
import { getTypedConfig } from "@/lib/edge-config";  // may already be imported
import { log } from "@/lib/log";  // may already be imported
```

2. Replace ONLY the body of the `recompute_eta` step (between the `"use step"` directive line and the `return` line — DO NOT rename the function, change its signature, or move its position):
```typescript
async function recomputeEta(
  reservationId: string,
  position: number,
  partySize: number,
): Promise<{ eta_min: number }> {
  "use step";
  const avgTurnoverMin = await getTypedConfig<number>("no_show_timeout_min", 15);
  const formulaEta = Math.max(0, position * avgTurnoverMin);

  // Path C — env-flag-gated LLM consultation. Determinism is guaranteed because the
  // step's RETURN VALUE is sampled-once-and-stored by WDK; on replay, the LLM is not
  // re-called (D-22). Try/catch ensures we always return a valid integer eta_min.
  if (process.env.PLAT_08_LLM_ENABLED === "false") {
    return { eta_min: formulaEta };
  }
  try {
    const { text } = await generateText({
      model: "anthropic/claude-sonnet-4.6",
      system: "Devolvés solo un número entero positivo. Sin texto, sin markdown, sin explicación.",
      prompt: `Estimación de espera en minutos para posición ${position} con grupo de ${partySize}, turnover promedio ${avgTurnoverMin} min/mesa. Responde solo con el número.`,
      temperature: 0,
      maxOutputTokens: 8,
    });
    const parsed = Number.parseInt(text.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed < 240) {
      return { eta_min: parsed };
    }
    log.warn("workflow.recompute_eta.unparseable", { reservation_id: reservationId, raw: text.slice(0, 32) });
  } catch (err) {
    log.warn("workflow.recompute_eta.llm_failed", { reservation_id: reservationId });
  }
  return { eta_min: formulaEta };
}
```

3. NOTHING ELSE in `lib/workflows/reservation.ts` may change. Verify the diff:
```bash
git diff lib/workflows/reservation.ts | head -100
# Expected: only changes inside the recompute_eta function body, plus the new top-of-file imports
# Forbidden: any change to the router function, hook definitions, step count, step order, or step signatures
```

4. Add `__tests__/workflow-recompute-eta.test.ts` exercising the 6 behaviors above. Mock `generateText` from `ai` (use `node:test` `mock.module` or import-isolation pattern). Mock `getTypedConfig` to return 15. Run via `npx tsx --test`.

5. Add the env-flag escape hatch to `.env.example`:
```
# PLAT-08 — set to "false" to bypass LLM ETA recompute and fall back to formula
# (operational lever during pilot if AI Gateway costs spike or LLM behaves oddly)
PLAT_08_LLM_ENABLED=true
```

6. The body keeps `temperature: 0` and `maxOutputTokens: 8` (D-22). The LLM has no room to ramble. Cost per call: ~$0.0001-$0.001 depending on model.

7. **CRITICAL safety check:** verify by reading the diff that step boundaries are intact. The frozen invariants are:
   - Number of `"use step"` directives in the file UNCHANGED
   - Order of step calls in the workflow router UNCHANGED
   - Step input/output types UNCHANGED (Plain JSON only — `{eta_min: number}` qualifies)
   - The router function (the function with `"use workflow"` directive) UNCHANGED
   Run a quick comparison:
```bash
git diff lib/workflows/reservation.ts | grep -E '^\\+.*"use (step|workflow)"' | wc -l
# Expected: 0 (no new step or workflow directives added)
```
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -F 'generateText' lib/workflows/reservation.ts && grep -F 'temperature: 0' lib/workflows/reservation.ts && npx tsx --test __tests__/workflow-recompute-eta.test.ts && test "$(git diff lib/workflows/reservation.ts | grep -cE '^\\+.*\"use (step|workflow)\"')" = "0"</automated>
  </verify>
  <acceptance_criteria>
    - `lib/workflows/reservation.ts` imports `generateText` from `"ai"`
    - The recompute_eta function uses `temperature: 0` and `maxOutputTokens: 8` (deterministic + cost-bounded)
    - The function has try/catch with formula fallback on any error
    - The function validates parsed number: `Number.isFinite && >= 0 && < 240` before returning the LLM value
    - Env flag `PLAT_08_LLM_ENABLED === "false"` bypasses the LLM (operational kill switch)
    - `git diff lib/workflows/reservation.ts | grep -cE '^\\+.*"use (step|workflow)"'` == 0 (NO new step/workflow directives added — D-11 freeze intact)
    - Step input + return type signatures unchanged (only body changed — verify by reading diff before/after the function brace)
    - `__tests__/workflow-recompute-eta.test.ts` exists and exercises the 6 behaviors above; runs via `tsx --test` exiting 0
    - `.env.example` documents the `PLAT_08_LLM_ENABLED` flag
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
The workflow body is swapped. Phase 2's deterministic ETA still ships when LLM is unavailable; Path C delivers Track 2's "ETA estimated by an LLM" narrative when it is.
  </done>
</task>

<task type="checkpoint:decision" gate="blocking">
  <name>Task 3: User decides Path C vs Path D based on dry-run data</name>
  <files>.planning/phases/03-user-surfaces/03-06-PATH-DECISION.md</files>
  <read_first>
    - .planning/phases/03-user-surfaces/03-06-PATH-DECISION.md (filled with baseline + Path C snippet from task 1)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-21 (decision criteria: 25% accuracy AND <$0.01 per recompute)
  </read_first>
  <decision>
    Should PLAT-08 ship as Path C (LLM-driven ETA inside step body) or Path D (deterministic formula only)?
  </decision>
  <context>
    Path C requires up to 4h of dry-run comparison work (D-21). The decision criteria are objective:
    1. **Accuracy:** LLM ETA within 25% of actual `seated_at - created_at` for at least 8 of 10 sample reservations.
    2. **Cost:** <$0.01 per recompute (verifiable via Vercel AI Gateway dashboard or Anthropic console).

    If both criteria pass → ship Path C (task 2 stays committed).
    If either fails → revert task 2 (`git restore lib/workflows/reservation.ts __tests__/workflow-recompute-eta.test.ts .env.example`) and ship Path D.

    Path D is endorsed by PROJECT.md cut list #1 explicitly. Track 2 narrative is partially preserved (deterministic formula IS computing the ETA; we just don't tell the LLM about it for v1).
  </context>
  <options>
    <option id="path-c">
      <name>PATH-C — Ship LLM-driven ETA</name>
      <pros>
        - Track 2 narrative is fully delivered ("ETA estimated by LLM inside durable workflow")
        - Future-proofs for Phase 4 / v2 LLM tuning
        - Costs are bounded by `temperature: 0` + `maxOutputTokens: 8`
      </pros>
      <cons>
        - 2-4h of dry-run validation required
        - Adds AI Gateway dependency to the workflow execution path (was previously DB-only)
        - If criteria not met, this work is wasted (revert needed)
      </cons>
      <action>Run the dry-run comparison: trigger 10+ workflow runs against seed-demo + manual fixtures; record formula vs LLM ETA vs actual; verify cost <$0.01 per call. If both criteria pass, fill DECISION: PATH-C in PATH-DECISION.md and commit. If criteria fail, revert task 2 and choose path-d below.</action>
    </option>
    <option id="path-d">
      <name>PATH-D — Keep formula (cut #1 honored)</name>
      <pros>
        - Zero dry-run cost
        - Already deployed (Phase 2 estimateEtaMin)
        - Zero AI Gateway dependency in critical path
        - Phase 3 closes immediately
      </pros>
      <cons>
        - Track 2 narrative is weaker ("deterministic ETA" instead of "LLM-driven ETA")
        - The Phase 4 demo video must spin the formula as a feature, not a fallback
      </cons>
      <action>If task 2 was implemented, revert: `git restore lib/workflows/reservation.ts __tests__/workflow-recompute-eta.test.ts .env.example`. Fill DECISION: PATH-D in PATH-DECISION.md. Skip directly to task 4 (Shape History entry).</action>
    </option>
    <option id="path-d-forced">
      <name>PATH-D-FORCED — recompute step doesn't exist</name>
      <pros>
        - No work to do; the formula at lib/services/reservations.ts→estimateEtaMin already serves PLAT-08's intent
      </pros>
      <cons>
        - Adding a new step now would violate D-11 freeze
        - Track 2 narrative depends on the formula carrying it
      </cons>
      <action>If task 1 found Outcome C: nothing to revert (task 2 was skipped). Fill DECISION: PATH-D-FORCED with rationale. Document in Shape History (task 4) that PLAT-08 ships as a deferred-LLM cut and the workflow shape is intentionally minimal.</action>
    </option>
  </options>
  <resume-signal>Type one of: "path-c" / "path-d" / "path-d-forced" — match your DECISION line in PATH-DECISION.md.</resume-signal>
</task>

<task type="auto">
  <name>Task 4: Update `lib/workflows/_README.md` Shape History with the chosen path</name>
  <files>lib/workflows/_README.md</files>
  <read_first>
    - lib/workflows/_README.md (current Shape History from Phase 2 plan 02-04 — add a new entry, do NOT modify existing entries)
    - .planning/phases/03-user-surfaces/03-06-PATH-DECISION.md (the DECISION line — quote it verbatim)
  </read_first>
  <action>
1. Append a new entry to the Shape History section. Format matches existing Phase 2 entries:
```markdown
## Shape History

[existing Phase 2 entries unchanged]

### [today's date] — Phase 3 plan 03-06 — recompute_eta body swap

**Decision:** [PATH-C | PATH-D | PATH-D-FORCED] (see `.planning/phases/03-user-surfaces/03-06-PATH-DECISION.md`)

**What changed:** [one of:]
- PATH-C: Body of the existing `recompute_eta` step now calls `generateText` from the AI SDK (model `anthropic/claude-sonnet-4.6`, temperature 0, maxOutputTokens 8) with try/catch fallback to the deterministic formula `position * avg_turnover_min`. Step boundary count, order, and signature UNCHANGED.
- PATH-D: No change to the workflow file. PLAT-08 ships via the deterministic formula at `lib/services/reservations.ts → estimateEtaMin` (Phase 2 plan 02-03). Cut list #1 honored.
- PATH-D-FORCED: Workflow router does not contain a `recompute_eta` step. Adding one would violate D-11 freeze. PLAT-08 ships as the Phase 2 deterministic formula at the service layer.

**Why:** [Path C — Track 2 LLM-driven ETA narrative within deterministic-on-replay constraints. | Path D — dry-run criteria not met (LLM accuracy <25% match OR cost >$0.01/recompute). | Path D forced — step does not exist; freeze rule forbids adding it.]

**Rule reminder for future plans:** The recompute_eta step's BODY may continue to evolve. Step COUNT and ORDER cannot. If you need a new step, append at the end of the router (D-11 append-safe rule) and gate its execution behind an Edge Config feature flag so existing in-flight reservations don't break.
```

2. Do NOT touch any other section of `_README.md`. The freeze rules text from Phase 2 stays verbatim.

3. Run a final shape sanity check on the workflow file:
```bash
grep -c '"use step"' lib/workflows/reservation.ts
# Expected: same count as Phase 2 plan 02-04 final state (~10 — confirm with the Shape History entry)

grep -c '"use workflow"' lib/workflows/reservation.ts
# Expected: 1 (single router function)
```
  </action>
  <verify>
    <automated>grep -F "Phase 3 plan 03-06" lib/workflows/_README.md && grep -E "PATH-C|PATH-D|PATH-D-FORCED" lib/workflows/_README.md</automated>
  </verify>
  <acceptance_criteria>
    - `lib/workflows/_README.md` Shape History section gains exactly one new entry for plan 03-06
    - The entry references one of PATH-C / PATH-D / PATH-D-FORCED
    - The entry references `.planning/phases/03-user-surfaces/03-06-PATH-DECISION.md`
    - The entry contains the rule reminder for future plans (append-only, feature-flag gating)
    - No existing Shape History entries modified (`git diff lib/workflows/_README.md` shows only additions)
    - Step count in `lib/workflows/reservation.ts` matches the Phase 2 final-state count (verify by re-running grep against current file vs the value documented in the existing Shape History)
  </acceptance_criteria>
  <done>
The decision is durable. Future contributors reading `_README.md` will know exactly when and why the recompute_eta body changed (or didn't), and the freeze rules remain unviolated.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: Final Phase 3 closeout — money-shot smoke + chatbot smoke + manual ETA verification</name>
  <files>(no files modified — verification only)</files>
  <read_first>
    - .planning/phases/03-user-surfaces/03-06-PATH-DECISION.md (final DECISION)
    - lib/workflows/_README.md (Shape History entry just added)
  </read_first>
  <what-built>
    - PLAT-08 shipped as Path C (LLM-driven ETA in step body) OR Path D (deterministic formula)
    - Workflow shape unchanged (D-11 freeze respected)
    - `_README.md` Shape History updated
    - Decision record at `.planning/phases/03-user-surfaces/03-06-PATH-DECISION.md`
    - Phase 3 ALL 19 requirements now shipped (DINER-01..08 + STAFF-02..09 + PLAT-08 + SAFE-02 + SAFE-03)
  </what-built>
  <how-to-verify>
1. Run the Phase 2 smoke harness — both must remain green:
```bash
npm run smoke:mcp
npm run smoke:money-shot --dry-run
```
   Expected: both exit 0. If either fails, the workflow change broke a Phase 2 contract — revert task 2 and downgrade to Path D.

2. Run all `__tests__` files — full suite green:
```bash
find __tests__ -name "*.test.ts" -exec npx tsx --test {} \\;
```
   Expected: all pass.

3. **Live ETA verification (Path C only — skip if Path D):**
   - Open `https://zero-to-agent-xi.vercel.app/` and register a new diner.
   - Open `/queue` as the maître. Note the ETA shown on the new card.
   - In Vercel logs (`vercel logs --follow`): look for `workflow.recompute_eta.llm_failed` or `workflow.recompute_eta.unparseable` warnings — should be 0 in normal operation.
   - In Vercel AI Gateway dashboard: confirm the model `anthropic/claude-sonnet-4.6` shows usage with cost <$0.01/call.

4. **Operational kill switch test (Path C only — skip if Path D):**
   - Set `PLAT_08_LLM_ENABLED=false` in Vercel env (preview env is fine; don't hit prod).
   - Trigger a workflow recompute by extending an active reservation.
   - Verify ETA returned matches the formula `position * avg_turnover_min` (no LLM call in logs).
   - Reset env var.

5. **Money-shot LIVE rehearsal (optional — requires user action; documented as known step in PROJECT.md cut list, NOT a hard gate for plan 06):** if Skew Protection (B2) has been toggled in Vercel dashboard:
   - Run `npm run smoke:money-shot` (no --dry-run flag) against prod.
   - Expected: deploy mid-flight succeeds; reservations survive.
   If Skew Protection is still off, skip — this is Phase 4 polish.

6. **Phase 3 close:**
   - All 19 phase requirements ship: DINER-01..08, STAFF-02..09, PLAT-08, SAFE-02, SAFE-03.
   - Update `.planning/STATE.md` Phase Progress table: Phase 3 → Complete, 19/19.
   - Last commit message: `feat(03-06): PLAT-08 — recompute_eta body swap (Path X) — Phase 3 closes`.
   - `git push origin main` for the final auto-deploy.

If all 5 verification steps pass: type "approved". Phase 3 closes. Phase 4 (pilot-hardening + demo) can now plan via `/gsd-plan-phase 4`.

If any fail: report which; the most likely failure is the smoke:money-shot regression (workflow change broke replay). Revert and re-evaluate Path C vs Path D.
  </how-to-verify>
  <resume-signal>Type "approved" to close Phase 3.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| workflow step body ↔ AI Gateway | LLM call from inside `recompute_eta` step (Path C only). Inputs are workflow-internal numerics (position, party_size, avg_turnover) — NOT user-supplied text. |
| workflow event log ↔ step output | LLM-generated `eta_min` is sampled-once-and-stored; on replay, the persisted value is replayed (deterministic). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-06-01 | Spoofing / Tampering | LLM prompt injection from user input | mitigate | The recompute_eta prompt builds from `position`, `partySize`, `avgTurnoverMin` — ALL workflow-internal numerics from DB. NO user-supplied text reaches the LLM here. The `name`/`email`/`phone` PII never enter the workflow file. |
| T-03-06-02 | Tampering | LLM returns malicious / unbounded value | mitigate | Range gate: `Number.isFinite && >= 0 && < 240`. Anything else falls through to formula. `maxOutputTokens: 8` makes long responses impossible. |
| T-03-06-03 | Tampering | Non-determinism breaks workflow replay | mitigate | Step output is sampled-once-and-stored (Phase 2 D-13 + WDK contract). On replay, the LLM is NOT re-called — the persisted `eta_min` integer is what's replayed. `temperature: 0` further reduces variance for the FIRST call (matters for human-perceived consistency, not for replay). |
| T-03-06-04 | Information Disclosure | AI Gateway logs the prompt | accept | Prompt contains only numerics (no PII). AI Gateway dashboard shows token usage but not values that could de-anonymize a diner. |
| T-03-06-05 | Denial of Service | Spike in ETA recompute frequency burns AI Gateway budget | mitigate | Edge Config `eta_recompute_interval_sec` controls cadence (Phase 1 seeded). `PLAT_08_LLM_ENABLED=false` env flag is the operational kill switch. `temperature: 0` + `maxOutputTokens: 8` keeps cost <$0.001/call. |
| T-03-06-06 | Repudiation | Which run computed which ETA? | mitigate | Workflow event log persists each step's output (Phase 2 contract). The LLM call's output is captured at step level — auditable per workflow run. |
| T-03-06-07 | Tampering / Freeze violation | Plan accidentally adds a new step | mitigate | Acceptance criteria explicitly grep for `^\\+.*"use (step|workflow)"` in the diff — must be 0. CI guard. |

No high-severity threats. Path C is bounded and reversible via env flag. Path D has zero attack surface change from Phase 2.
</threat_model>

<verification>
- `npm run smoke:mcp` exits 0
- `npm run smoke:money-shot --dry-run` exits 0
- Full test suite green (every `__tests__/*.test.ts` passes)
- `git diff lib/workflows/reservation.ts` shows ONLY changes inside the recompute_eta function body + new top-of-file imports (Path C) OR no diff (Path D)
- `_README.md` Shape History entry exists for plan 03-06
- PATH-DECISION.md DECISION line is filled
- 19/19 Phase 3 requirements complete
</verification>

<success_criteria>
- 1 of 19 phase requirements ships: PLAT-08
- Total Phase 3 ships: 19/19 (DINER-01..08 + STAFF-02..09 + PLAT-08 + SAFE-02 + SAFE-03)
- Workflow shape FROZEN invariant preserved
- Operational kill switch (`PLAT_08_LLM_ENABLED`) exists for the pilot week
- Phase 3 closes; Phase 4 can plan
</success_criteria>

<output>
After completion, create `.planning/phases/03-user-surfaces/03-06-recompute-eta-SUMMARY.md` with:
- Final DECISION (Path C / Path D / Path D-FORCED)
- If Path C: cost-per-call observed in dry-run, accuracy %, sample size
- Smoke harness results (mcp, money-shot --dry-run)
- Final Phase 3 requirement coverage: 19/19
- Production deploy SHA
- D-31 push confirmation
- Closing note: ".planning/STATE.md updated to Phase 3 = Complete; Phase 4 unblocked."
</output>
