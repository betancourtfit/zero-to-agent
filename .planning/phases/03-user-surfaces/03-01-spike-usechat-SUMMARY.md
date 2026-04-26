---
phase: 03-user-surfaces
plan: "01"
subsystem: ai-sdk-spike
tags:
  - spike
  - ai-sdk-v6
  - useChat
  - safe-02
  - fixtures
dependency_graph:
  requires:
    - "02-03 (service layer — ServiceResult<T> shape mocked in spike)"
    - "02-04 (workflow — package.json already had workflow dep)"
  provides:
    - "AI SDK v6 package versions (ai@6.0.168, @ai-sdk/react@3.0.170, @ai-sdk/anthropic@3.0.71)"
    - "D-30 spike assertions: A/B/C/D all PASS"
    - "SAFE-02 10-conversation fixture with shape asserter"
    - "Decision: PROCEED-UNCHANGED — plan 03 chatbot route can proceed"
  affects:
    - "03-03-chatbot (plan 03 consumes spike findings and fixture)"
tech_stack:
  added:
    - "ai@^6.0.168"
    - "@ai-sdk/react@^3.0.170"
    - "@ai-sdk/anthropic@^3.0.71"
  patterns:
    - "MockLanguageModelV3 + simulateReadableStream from ai/test for spike assertions"
    - "readUIMessageStream on result.toUIMessageStream() for client-side UIMessage reconstruction"
    - "node:test + tsx --test for CI-safe deterministic fixture validation"
key_files:
  created:
    - "scripts/spike-usechat-lifecycle.ts"
    - "__tests__/chatbot-conversations.fixture.json"
    - "__tests__/chatbot-conversations.test.ts"
    - ".planning/phases/03-user-surfaces/03-01-SPIKE-RESULTS.md"
  modified:
    - "package.json (added ai, @ai-sdk/react, @ai-sdk/anthropic deps + spike:usechat + test:fixtures scripts)"
decisions:
  - "PROCEED-UNCHANGED: all 4 D-30 assertions PASS, no CONTEXT.md edits needed before plan 03"
  - "convertToModelMessages is ASYNC in v6 (source says async, .d.ts omits async keyword) — plan 03 MUST await it"
  - "@ai-sdk/react and @ai-sdk/anthropic are NOT versioned as @6 — they are @3.x; dist-tag ai-v6 confirms compatibility"
metrics:
  duration: "~30 minutes"
  completed: "2026-04-26"
  tasks_completed: 2
  files_created: 4
  files_modified: 1
---

# Phase 3 Plan 01: AI SDK v6 useChat Lifecycle Spike Summary

**One-liner:** AI SDK v6 useChat spike confirms all 4 D-30 assertions PASS; one footgun found (`convertToModelMessages` is async — must await); 10-conversation SAFE-02 fixture committed; decision: PROCEED-UNCHANGED.

---

## What Was Built

**Task 1 — AI SDK v6 deps + spike script (`scripts/spike-usechat-lifecycle.ts`):**

Installed `ai@^6`, `@ai-sdk/react@^3` (equivalent of ai-sdk v6 for react), `@ai-sdk/anthropic@^3`. Built a ~356 LOC spike script using `MockLanguageModelV3` + `simulateReadableStream` from `ai/test` to validate three core D-30 questions without live LLM calls.

**Task 2 — 10-conversation SAFE-02 fixture + asserter:**

Created `__tests__/chatbot-conversations.fixture.json` with 10 fixture cases covering all 5 D-04 locked system-prompt rules (echo-back, never-fabricate, refuse off-topic, clarify ambiguous, no future booking). The shape asserter runs via `npm run test:fixtures` in CI deterministically — no live LLM, no tokens burned.

---

## Spike Assertion Outcomes

| Assertion | Result | Notes |
|-----------|--------|-------|
| ASSERT-A: tool-result parts surface on client | **PASS** | `messages[].parts[type="tool-register_diner"]` present with `state="output-available"` |
| ASSERT-B: `part.output.data.reservation_id` readable | **PASS** | `part.output.ok && part.output.data.reservation_id === "r-spike-1"` verified |
| ASSERT-C: `stopWhen: stepCountIs(5)` halts at 5 | **PASS** | Loop mock LLM called exactly 5 times, stream terminated |
| ASSERT-D: `transport.headers` fn re-evaluates per request | **PASS** | `Resolvable<T>` function form called on every `sendMessages()` |

**Final decision:** PROCEED-UNCHANGED

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `convertToModelMessages` is async in v6 — fixed by awaiting**
- **Found during:** Task 1 spike execution
- **Issue:** The `.d.ts` type signature declares `function convertToModelMessages(...)` without `async`, but the source is `export async function`. Passing the result directly to `streamText({ messages })` caused runtime `InvalidPromptError: received Promise`.
- **Fix:** Added `await convertToModelMessages(uiMessages)` in both `runAssertAB()` and `runAssertC()`. Added inline comment documenting the footgun.
- **Files modified:** `scripts/spike-usechat-lifecycle.ts`
- **Commit:** `1b5ef6a` (fixed in same task commit after discovery)

**2. [Rule 1 - Bug] `result.toUIMessageStream()` destructuring loses `this` binding**
- **Found during:** Task 1 spike execution (ASSERT-A/B showing `fullStream undefined`)
- **Issue:** `const { toUIMessageStream } = result; toUIMessageStream()` fails because the method uses internal `this` references. Must be called as `result.toUIMessageStream()`.
- **Fix:** Call as bound method. Additionally, cast `AsyncIterableStream` to the compatible `ReadableStream` type accepted by `readUIMessageStream`.
- **Files modified:** `scripts/spike-usechat-lifecycle.ts`
- **Commit:** `1b5ef6a`

---

## Impact on Plan 03 (chatbot route + page)

| Area | Decision |
|------|----------|
| `await convertToModelMessages(uiMessages)` in `/api/chat` | **MANDATORY** — runtime error without it |
| D-08 localStorage hydration | **CONFIRMED** — iterate parts, match `type === "tool-register_diner"`, check `state === "output-available"` |
| `stopWhen: stepCountIs(5)` | **CONFIRMED** — Pitfall #8 mitigation works |
| `DefaultChatTransport headers` function form | **CONFIRMED** — re-evaluates on every request; D-02 pattern is safe |
| CONTEXT.md D-04 system prompt rules | **NO CHANGE** — structurally validated by fixture |
| CONTEXT.md D-08 localStorage hydration | **NO CHANGE** — confirmed by ASSERT-A/B |

---

## Known Stubs

None — this is a spike plan. All artifacts are dev-only (scripts/, __tests__/).

---

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. Spike uses synthetic data only.

---

## Self-Check: PASS

- [x] `scripts/spike-usechat-lifecycle.ts` exists (356 LOC)
- [x] `__tests__/chatbot-conversations.fixture.json` exists (valid JSON, 10 conversations)
- [x] `__tests__/chatbot-conversations.test.ts` exists (10 tests, all pass)
- [x] `.planning/phases/03-user-surfaces/03-01-SPIKE-RESULTS.md` exists with DECISION: PROCEED-UNCHANGED
- [x] Commits `1b5ef6a` and `ba994a1` exist in git log
- [x] `npm run spike:usechat` outputs 4 ASSERT lines all PASS
- [x] `npm run test:fixtures` exits 0 with 10 pass
