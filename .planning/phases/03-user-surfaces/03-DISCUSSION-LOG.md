# Phase 3: User Surfaces - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `03-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-26
**Phase:** 03-user-surfaces
**Areas presented:** Chatbot UX & push delivery, Diner state persistence & return UX, Maître panel layout / history / undo, DurableAgent ETA scope (PLAT-08)
**Areas selected by user:** none — user replied "ninguna, avancemos" (same pattern as Phase 1 + Phase 2: defer all gray areas to Claude using research-backed defaults)

---

## Gray Area Selection (single multi-select question)

| Option | Description | Selected |
|--------|-------------|----------|
| Chatbot UX & push delivery | Full-page chat at `/` (rec) vs floating widget vs embedded panel; sticky banner (rec) vs in-line system bubble vs toast for proactive push; quick-reply chips (rec) vs inline tool buttons vs LLM-only text for the followup actions | |
| Diner state persistence & return UX | localStorage `{session_token, reservation_id}` (rec) hydrated via `getReservationStatus`; persistent status card ABOVE chat; fresh conversation on every reload; clear localStorage on `seated`/`no_show`/`cancelled` | |
| Maître panel: layout, history, undo | Two routes `/queue` + `/queue/history` (rec) vs single route with toggle; card-grid (rec) vs table; left-border color band (rec) vs full-card-tint vs badge-only; wait-for-server actions (rec) vs optimistic UI; STAFF-09 SHIP (rec) vs cut | |
| DurableAgent ETA scope (PLAT-08) | Formula wrapped in `@workflow/ai/agent` (rec, ships always) vs LLM-tuned (4h-capped spike, ships only if dry-run wins); pure formula without wrapper (rejected — kills Track 2 narrative) | |

**User's choice:** "ninguna, avancemos" (free-text via "Other")

**Notes:** User explicitly delegated all gray areas to Claude using research-backed defaults — same pattern as Phase 1 ("ninguna") and Phase 2 ("ninguno, ejecuta todos"). Indicates strong trust in the research synthesis + carry-forward chain established in PROJECT.md / REQUIREMENTS.md / ROADMAP.md / research files / `01-CONTEXT.md` / `02-CONTEXT.md`. All recommended-default decisions were locked into `03-CONTEXT.md` with full traceability to source documents (D-01 through D-31).

---

## Claude's Discretion

The following areas were NOT user-driven and ship with Claude's default judgment, recorded in `03-CONTEXT.md` `<decisions>` "Claude's Discretion" subsection:

- Exact file boundaries inside `components/chat/` and `components/queue/`
- Exact v0 prompts used to scaffold the components
- Whether the diner status card lives in `app/page.tsx` directly or as a separate component
- Toast library choice (default: shadcn `Sonner`)
- Polling interval for `/queue/history` (default: 30s)
- Connection-dot color thresholds
- Empty-state of `/queue` shows static illustration vs text only (default: text)
- STAFF-09 confirm dialog component (default: shadcn `AlertDialog`)
- Verbose vs minimal LLM "thinking" intermediate text (default: minimal)
- Whether AI SDK `experimental_telemetry` is enabled at all (default: enabled with `recordInputs:false, recordOutputs:false` per D-23)
- Final wording of all Spanish copy (must align with D-26 tone — rioplatense, empathic, recoverable)
- Server-side message-history truncation in `useChat` (default: defer)
- Whether the chatbot greets the returning diner by name (default: NO — privacy + scope)

---

## Deferred Ideas (mentioned during scoping, parked for later phases)

See `03-CONTEXT.md` `<deferred>` section for the full list. Highlights:

- Rate limit + idempotency dedup key + `/api/health` + Slack webhook → Phase 4
- Demo video recording → Phase 4
- Final PII audit → Phase 4
- WhatsApp adapter, multi-tenant scoping, floating-widget embed, multi-day history filter, analytics dashboard → v2 / post-hackathon
- LLM-tuned ETA agent beyond formula → 4h spike WITHIN Phase 3 (D-21); ships only if dry-run wins
- ESLint custom rule for raw `console.*` → Phase 4 polish (carried over from Phase 2)
- Persisting chat history across reloads → v2

---

*Discussion logged: 2026-04-26*
