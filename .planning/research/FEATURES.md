# Feature Research — Restaurant Queue / Waitlist (2026)

**Domain:** Restaurant digital waitlist / cola de espera
**Researched:** 2026-04-25
**Confidence:** HIGH for table stakes (verified across 5+ competitors), MEDIUM for chatbot-specific UX risks (extrapolated from booking-bot literature), HIGH for pilot safety considerations
**Context for prioritization:** Solo dev, ~7 days, single restaurant pilot (<20 concurrent diners), hackathon judge audience, real users start same week

---

## Executive Summary

The 2026 restaurant waitlist market is mature and converged on a small set of expectations. Every major player (Yelp Guest Manager, OpenTable, SevenRooms, Toast Tables, Waitlist Me, NextMe, TablesReady, Simple Host, BentoBox) ships the same 6–8 core features and competes on price, integrations, and AI quote accuracy. **Table stakes are very narrow and very deep** — diners and hosts have ~20 years of muscle memory.

The proposed scope (`scope_hackathon_mvp.md`) covers all true table stakes for a pilot of this size, with two notable substitutions:
- **SMS replaced with in-page SSE push** — defensible for hackathon, but a real production risk because the dominant competitor pattern is SMS (closed-tab works). Mitigation already in scope: narrate this in the demo video.
- **Conversational entry replacing the form** — this is the differentiator AND the riskiest UX bet. Table-stakes here is "the chatbot must not feel like a worse form."

For a single-restaurant pilot of <20 concurrent diners with judges watching:
- **The "money shot" is durability** (workflow surviving deploy with live tickets). Not feature breadth.
- **The piloto-safety gate is correctness** (no LLM hallucinated reservations, no PII in logs, no lost tickets).
- **The judge-impressing differentiator** is the MCP-server-as-product framing + the Edge Config live-edit moment, not feature competition with Toast.

---

## Feature Landscape

### Table Stakes (Users / Hosts / Judges Walk if Missing)

#### Table stakes — Diner (chatbot)

| Feature | Why Expected | Complexity | In Scope? | Notes |
|---------|--------------|------------|-----------|-------|
| Get on the list with name + party size + contact | Universal across every competitor (Yelp, OpenTable, Toast, SevenRooms, Waitlist Me, TablesReady) | S | YES (DINER-01) | Bare minimum. Email + phone both = belt-and-suspenders, OK to keep both for the pilot. |
| Confirmation with position in queue | Yelp shows position, NextMe shows position, every "virtual waiting room" surface shows it | S | YES (DINER-02) | Position number is the single most important psychological anchor — without it diners walk. |
| Estimated wait time / ETA | Yelp Guest Manager quotes wait times "with up to 96% accuracy" as a marketing claim; Olo Host built ML for this; absence = "how long?" calls flood the host | M | YES (DINER-02 + PLAT-08) | Even a *bad* ETA is better than no ETA. ETA accuracy itself is differentiator territory; *having* an ETA is table stakes. |
| Push notification "your table is ready" | Universal — the entire category exists to replace the buzzer/yell-the-name pattern | M | YES (DINER-03) — via SSE | **RISK:** every competitor uses SMS because tab-closed still receives. Scope acknowledges this; demo video must narrate it. |
| Way to cancel / I'm not coming | Common in TablesReady, Waitlist Me 2-way chat, every modern stack | S | YES (DINER-06) | Both for diner courtesy and host throughput. |
| Way to ask "how long now?" / status check | Universal pattern; Yelp pushes position updates passively, others let diner re-check | S | YES (DINER-07) | The chatbot affordance is great here vs SMS clunkiness. |
| No PII leak (no names/phones in URLs, server logs, error messages) | GDPR + general privacy expectation; restaurants are data controllers | S | PARTIAL — call out explicitly | **Real-pilot critical.** Scope mentions HTTPOnly cookies; need explicit "no PII in console.log" rule. |

#### Table stakes — Host / Maître (panel)

| Feature | Why Expected | Complexity | In Scope? | Notes |
|---------|--------------|------------|-----------|-------|
| Auth-protected panel | Universal; SevenRooms/Toast/etc all require login | S | YES (STAFF-01) | Magic-link via Auth.js is fine for 1 role. |
| Active queue list, ordered (oldest first) | This is the literal job — every product does this | S | YES (STAFF-02) | Cronological is correct for waitlist; reservation systems sort by time-of-reservation. |
| See per-ticket: name, party size, time waiting, status, ETA | Standard host stand card layout (Toast Tables, SevenRooms, Eat App, Simple Host) | S | YES (STAFF-03) | "Time waiting" derived from `created_at` — make sure it's live. |
| One-tap "call this party" → triggers diner notification | Single most-used button in every host stand product | S | YES (STAFF-05) | The button people press 50x/night. Must be obvious, large, with confirmation. |
| One-tap "seated / mark present" → closes ticket | Counterpart to "call". Closes the loop. | S | YES (STAFF-06) | Same tier of importance as Call. |
| Live updates without manual refresh | Toast Tables, SevenRooms, etc. auto-sync — anything else feels broken on a busy night | M | YES (STAFF-07) — SSE | SSE is fine; just handle reconnect. |
| Closed-tickets / history view (today only) | Standard separation: active stays clean; history exists for audit and "wait, did I seat them?" | S | YES (STAFF-08) | Today is enough. Multi-day reporting is later. |
| Visual differentiation by party size | NextMe brands this; every competent system color-codes; helps host pattern-match the room at a glance | S | YES (STAFF-04) | Edge Config-driven palette is a clever touch. |

#### Table stakes — Hackathon judge (demo video)

| Feature | Why Expected | Complexity | In Scope? | Notes |
|---------|--------------|------------|-----------|-------|
| Working public deploy URL | Hackathon submission requirement | S | YES (DEMO-01) | Non-negotiable. |
| Public GitHub repo with README | Hackathon submission requirement | S | YES (DEMO-02 + DEMO-04) | README must explain the value prop in 30 seconds of reading. |
| Demo video showing the agent doing real work | Vercel AI Gateway hackathon definition: "agent takes a task, reasons, acts, returns output" | S | YES (DEMO-03) | The agent (chatbot) needs visible tool-calling moments. Make the LLM "thinking" → "calling create_reservation" → "got result" legible if possible. |
| Visible AI Gateway / WDK / MCP usage | Track 1 + Track 2 framing — judges look for stack alignment | S | YES (PLAT-01, PLAT-03, AI Gateway) | Already built into the stack. Mention each by name in video narration. |

---

### Differentiators (Competitive / Demo Edge)

| Feature | Value Proposition | Complexity | In Scope? | Notes |
|---------|-------------------|------------|-----------|-------|
| **Conversational entry replacing the form** | No competitor in the established list ships this (all use form/QR + SMS); modern UX feel; showcases AI SDK + tool-calling | M | YES (DINER-01 via chatbot) | This is THE product differentiator. Must feel as fast as a form OR the differentiator becomes a liability. See "chatbot UX risk" below. |
| **Backend exposed as public MCP server** | Novel framing: any agent (this chatbot today, WhatsApp tomorrow, voice tomorrow-tomorrow) consumes the same tools. "API as agent surface." | M | YES (PLAT-01) | Strong narrative for judges: "we built a product, but also a platform." Mention by name in video. |
| **Workflow durability across deploys** | Unique to WDK; no competitor markets this because their backends are stateless + DB; this is the WDK money shot | M | YES (PLAT-03) | Demo it live: `git push` with reservations in flight, show timers held. This single moment justifies Track 1 selection. |
| **Live config edit without redeploy** (Edge Config) | Restaurants change rules ("now 2 min no-show timeout because it's slow Wednesday lunch") without devs; no competitor markets this granularity | S | YES (PLAT-06) | Demo it: drop `no_show_timeout_min` from 10 → 2 mid-video. Makes "100% Vercel" feel like a deliberate choice not a constraint. |
| **AI-driven ETA estimator** (DurableAgent) | Olo Host markets this; P.F. Chang's claims +20% accuracy lift; differentiates from naive average-of-recent | M | YES (PLAT-08) | Don't over-engineer for the pilot. A weighted average of last N seatings × party_size is enough; the *fact that it's an agent* matters more than the model quality at this scale. |
| **Proactive follow-up at minute 1** ("are you on your way?") | Ready Text and Simple Host advertise 2-way SMS for this; the workflow elegance (timer-as-event) is differentiating in the *implementation*, not the feature | S | YES (DINER-04, workflow step 6) | The implementation (workflow `waitForEvent` with timeout) is the differentiator. The user-facing feature is table-stakes-adjacent. |
| **Conversational extension** ("dame 5 más") | Simple Host's 2-way SMS is the closest analog. Conversational ("dame 5 más") feels much more human than the SMS pattern of "Reply EXTEND" | S | YES (DINER-05) | LLM intent-mapping to `extend_wait` tool. Dial in the system prompt to handle Spanish colloquialisms ("dale", "ya casi llego", "estoy cerca"). |
| **Session resume across visits** (24h cookie) | Almost no diner-facing app does this elegantly; treats the diner as a known entity within the wait window | S | DEFERRED (top of cut list) | Nice-to-have. If time permits, ships. If not, fresh session is fine — most waits are <60 min anyway, so the cookie value materializes only for the rare diner who closes the tab and forgets. |

---

### Anti-Features (Deliberately NOT to Build for v1)

| Feature | Why Commonly Built / Requested | Why Wrong for THIS Project | Alternative |
|---------|-------------------------------|----------------------------|-------------|
| **Floor plan / table assignment** (Toast Tables, Eat App, SevenRooms all have this) | "Real" host stands need to drag tables; AI auto-assigns by party | Pilot is single restaurant <20 concurrent; the host knows their tables; building drag-drop + table state model = 2+ days; explicitly "out of scope" in PROJECT.md | List-only view. Host knows the room. |
| **Real SMS / WhatsApp** | Industry standard; works tab-closed | Twilio/Meta credentials, message templates, opt-in consent, deliverability — easily 2 days; PROJECT.md explicitly excludes WhatsApp from v1 | Document in video that production = WhatsApp; hackathon = SSE in tab. The MCP server is *ready* for a WhatsApp client to plug in. |
| **Reservations (future date/time)** | OpenTable, Resy, SevenRooms, Toast all do reservations | This is "cola de espera" not "reservas"; PROJECT.md explicitly excludes "ordering / payment / mesa management"; reservations require calendaring + capacity model + cancellation policy | Walk-in / on-the-spot waitlist only. |
| **Multi-restaurant / multi-tenant** | Every commercial product is multi-tenant | One restaurant in the pilot. Multi-tenant adds auth scoping, restaurant_id everywhere, dashboard switcher = 1+ day risk. PROJECT.md excludes this. | Hardcode `restaurant_id` (or skip). |
| **Mobile native app for diners** | Yelp/OpenTable have apps; "join from your couch" is their pitch | Web embed + cookie session ≈ 90% of the value at 5% of the cost; the chatbot lives in a web page already | The web page IS the app. |
| **Mobile native app for hosts** | Toast's iPad-native app is best-in-class | Responsive web on tablet works fine for <20 concurrent; native = App Store + 2 platforms + push certs = scope killer | shadcn/ui responsive on tablet/phone. |
| **CRM / guest history / loyalty integration** | SevenRooms' main wedge ("personalized recognition"); diners returning gets noted | PII storage explosion; no value at pilot scale; explicit anti-feature for hackathon (zero return on judge time) | None for v1. |
| **POS integration** (Toast, Square, Lightspeed) | Toast Tables markets this hard; closes the loop with payment | No POS at pilot; out of scope per PROJECT.md ("nada de pedidos, pagos") | None. |
| **Historical analytics / dashboards** | Every commercial product has trend charts | Today-only history is enough; analytics = nice graphs that judges glance at and don't deeply value vs. workflow durability | `/queue/history` for today only. Vercel Analytics if free; nothing custom. |
| **No-show prediction ML** | Resy markets a 90% no-show reduction (bot-driven, not human-no-show); lots of vendors hype this | Requires history; pilot has zero history; LLM prediction at 0 data points = theater | Skip. The deterministic timeout + manual `no_show_manual` button covers v1. |
| **Multi-language (i18n / English)** | International products do this | Pilot is Spanish; PROJECT.md excludes; judges read subtitles | Spanish only. |
| **Web push / service worker** | Solves "tab closed" problem | Service worker + push subscription + permission UX = 1+ day risk; PROJECT.md excludes; out-of-band notification belongs to WhatsApp evolution | Document in video; SSE-only in v1. |
| **Diner accounts / login** | "Returning diner" personalization | Cookie session covers the only meaningful return path (within hours); accounts = email verification, password recovery, GDPR data export = scope killer | Cookie only. |
| **Priority / VIP queue** | Some high-end products differentiate VIP | No business need at pilot; opens fairness questions | One queue, FIFO. |
| **Custom branding / theming per restaurant** | Multi-tenant products need this | One restaurant, generic branding per PROJECT.md; rebrand later if pilot wants | Generic look. |
| **In-restaurant kiosk (self-check-in tablet at door)** | Yelp Kiosk, NextMe self-check-in | Same flow as the web embed but on a tablet at the door — *the maître taking names IS the kiosk for v1*; building dedicated kiosk mode = nice but parallel UX surface | The maître's panel is also the kiosk; or just open the web embed on a door tablet. |
| **Pre-payment / deposit to hold spot** | Resy/Tock fight no-shows with deposits | Requires payment integration; PII + financial data; explicit anti-feature in PROJECT.md | None. Manual `no_show` covers it. |
| **Ratings / review prompt after seating** | OpenTable, Yelp loop diners back into reviews | Out of v1 scope; closes loop with another product (reviews) | None. |
| **Voice / phone-based entry** (Slang AI, Hostie, Loman AI) | $50–500/mo voice agents for restaurants exist | Massive scope; voice = STT + TTS + telephony provider + huge latency challenges; the MCP server *can* be consumed by a voice agent later | None for v1. Mention as MCP roadmap. |

---

### Tarpit Features — Look Easy, Eat Days

These deserve their own callout because they look like 4-hour tasks and become 2-day tasks. **Do not start any of these in week 1.**

| Tarpit | Why It Looks Easy | Why It Isn't | What to Do Instead |
|--------|-------------------|--------------|---------------------|
| "Just add SMS via Twilio" | Twilio docs are great | Phone verification, message templates, opt-in consent text, A2P 10DLC registration in US, deliverability monitoring, Spanish character encoding (GSM-7 vs UCS-2 doubles segments), "STOP" handling = 2+ days | SSE in tab + narrate WhatsApp roadmap |
| "Quick analytics dashboard" | shadcn has chart components | Defining the metrics, picking time windows, aggregating across closed reservations, handling edge cases (empty days, midnight rollover, timezone) = 1+ day | Vercel Analytics if free; nothing custom |
| "Chatbot remembers diner across visits" | Cookie + lookup, easy! | Edge cases: cookie present but reservation closed; cookie present but workflow finished; cookie present but session_token expired; what does the chatbot say? = a long afternoon of LLM prompt-shaping | Cut-list this; if it ships, ship the happy path only |
| "Smart table assignment" | Just match party_size to table.seats | Tables that combine, tables that split, tables that "no, that one's reserved", server station rotation = days of rules | Skip entirely (anti-feature) |
| "Real-time ETA with confidence interval" | Display `eta ± 3 min` | Computing the interval honestly requires history; faking it is anti-trust | Single number; "estimated" wording |

---

## Chatbot-Specific UX Risks (the Conversational Bet)

This is the highest-variance design choice in the project. Form > Chatbot for entry **unless the chatbot is at least as fast and at least as forgiving**. Documenting risks explicitly:

### UX risks of conversation-only entry

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| LLM asks too many questions / feels slow | HIGH | System prompt MUST batch ("dame nombre, email, teléfono y cuántos son"), accept all-at-once input, never re-ask if already given |
| LLM hallucinates a confirmation without calling the tool | MEDIUM | Tool result is the only source of truth; UI banner "Reserva creada · #1234 · posición N" comes from `create_reservation` return, not LLM output text |
| LLM creates duplicate reservations on retry | MEDIUM | Idempotency key in `create_reservation` (already in scope Fase 11) — dedupe on email + party_size within 30s |
| Diner abandons mid-conversation (drops off after entering name) | MEDIUM | No partial reservations in DB. Only commit when all 4 fields are present. Don't show position to a half-registered diner. |
| Latency (LLM call + tool call + LLM call) feels worse than form submit | MEDIUM | Streaming response from `useChat` masks latency; show "anotándote..." optimistic state during tool call |
| LLM misinterprets cancel as extend (or vice versa) | HIGH risk, low frequency | After-tool confirmation: chatbot must echo back the action ("listo, te cancelé la reserva — si fue por error, escribime") |
| LLM accepts inputs the system can't honor ("reservame para mañana 8pm") | HIGH | System prompt: "este chatbot es solo para sumarte a la cola en este momento; no acepta reservas para otro día/hora" — bounce out of scope |

### Partial state handling — what users actually say

Real diner inputs the LLM must handle (from booking-bot literature + restaurant industry knowledge):

| Diner input | Right behavior | Wrong behavior |
|-------------|----------------|----------------|
| "Somos 4 o 5" | Pick a value and confirm: "Te anoto para 5 (el más grande), avisame si confirmás 4" | Hallucinate one number; refuse; loop forever asking for clarification |
| "Tal vez llevamos un bebé" | Treat as adults count for party_size; mention "el bebé no cuenta como mesa adicional" | Add 0.5; refuse; ask 3 follow-ups |
| "Están abiertos?" | Answer if Edge Config or system prompt knows hours; otherwise "estamos atendiendo ahora si estás viendo este chat" | Make up hours |
| "Cuánto tarda más o menos?" (before being on the list) | Quote a generic average + invite to join; don't run the ETA agent for a non-customer | Refuse to answer until they give name |
| "Mi nombre es Juan, somos 3, tel 555..." (everything in one message) | Parse all at once; only ask what's missing | Ask each question sequentially anyway |
| "Cancelar" without context, no cookie | "No te encuentro en la cola. ¿Querías sumarte?" | Cancel a random reservation; error out |
| "Dame 5 más" before being called | "Cuando te llamemos podés pedir más tiempo. Por ahora seguimos con la espera estimada de X min" | Call `extend_wait` (will fail) and confuse the diner |

### Bare minimum system prompt (LLM as competent host)

The system prompt MUST contain:
1. **Identity:** "Sos el host del restaurante [Nombre]. Tu trabajo es anotar comensales en la cola de espera para hoy."
2. **Scope guardrail:** "Solo manejás la cola de espera de este momento. No tomás reservas para otra fecha/hora. No tomás pedidos. No respondés sobre el menú."
3. **Field list:** "Necesitás 4 datos: nombre, email, teléfono, cantidad de personas. Pedilos en una sola pregunta y aceptá si vienen todos juntos."
4. **Tone:** "Cálido, breve, en español rioplatense (vos)."
5. **Tool usage:** "Cuando tengas los 4 datos, llamá a `create_reservation`. Para consultar estado, `get_reservation_status`. Para más tiempo después de ser llamado, `extend_wait`. Para cancelar, `cancel_reservation`."
6. **Echo confirmations:** "Después de cada acción, confirmá brevemente lo que hiciste."
7. **Refuse politely:** "Si te piden algo fuera de scope, derivá: 'eso no lo manejo desde acá; consultá con el restaurante directo'."
8. **Don't invent:** "Nunca inventes posición, ETA, ni hora. Solo decí lo que devuelven las herramientas."

---

## Real-Pilot Safety Considerations (Same-Week Production)

These are not "differentiators" or "anti-features" — they're a separate axis: **"won't embarrass the restaurant when a real diner uses it on Wednesday."**

| Safety concern | Severity | Mitigation | In Scope? |
|----------------|----------|------------|-----------|
| LLM creates a reservation with malformed phone, then can't be reached | HIGH | Zod validation in `create_reservation` rejects clearly bad data; LLM re-asks | YES (PLAT-01 mentions Zod via Fase 5) |
| PII (name, phone, email) leaked in `console.log` / serverless logs | HIGH | Explicit logging policy: no PII in logs ever; structured logger that redacts; review log statements pre-deploy | PARTIAL — call out explicitly, add to Fase 11 |
| Cookie or `session_token` predictable / brute-forceable | HIGH | UUIDv4 random (already in scope); HTTPOnly + Secure + SameSite=Lax (already in scope) | YES |
| Workflow crashes mid-flow and a diner is stuck (status forever `waiting`) | HIGH | WDK durability is the answer; add observability — every workflow run should be traceable in Vercel Workflow dashboard | YES (WDK design) |
| Diner loses the tab → never sees "table ready" → marked `no_show` → walks in confused | HIGH | This WILL happen with SSE-only. Mitigations: (a) "no_show" message must say "if you're here, please show this screen to a host"; (b) host has manual override to undo `no_show` | PARTIAL — needs explicit error-recovery UX |
| LLM goes off-topic / says something inappropriate (LLM jailbreak) | MEDIUM | System prompt with refusal patterns; AI Gateway model is Claude Sonnet 4.6 (well-aligned); no user-generated prompts in system prompt | PARTIAL — add to system prompt |
| Two diners get the same position number due to race | MEDIUM | Position computed at read time via `ROW_NUMBER() OVER (ORDER BY created_at)`; never stored as truth | YES (computed in PLAT-01 Fase 5) |
| The MCP endpoint is publicly callable → spam / abuse | MEDIUM | Rate limit (5 req/min per IP) already in scope (Fase 11); MCP API key validation already in scope | YES |
| Restaurant changes mind about timeouts mid-shift; needs to re-deploy | LOW (great for demo, real for ops) | Edge Config solves this. Train the maître on which knobs to touch (or do it for them). | YES (PLAT-06) |
| The chatbot greeting fires before the page loads → diner sees blank | LOW | Loading state; greet on first user message instead of on mount | Detail for Fase 8 |
| A diner on iOS Safari has cookies disabled / private mode | LOW | The flow still works for *one* session — the cookie just doesn't survive a tab close. Acceptable. | Accept |
| The maître loses internet during service | MEDIUM (real cafe networks are bad) | SSE reconnect logic; on reconnect, refetch active queue; show "reconnecting" banner | YES (STAFF-07 + PLAT-07) |
| The "no-show" notification lands while the diner is on their way → angry diner | HIGH (UX of the message matters) | Message wording must be apologetic, not accusatory ("creímos que ya no venías; si llegás avisanos") + offer manual override | Detail for Fase 6 / Fase 8 |

---

## Cross-Reference: Scope Features → Categorization

Going through every requirement in `PROJECT.md` and tagging it.

### Diner requirements

| ID | Requirement | Category | v1 Verdict |
|----|-------------|----------|------------|
| DINER-01 | Conversational registration | DIFFERENTIATOR (the bet) + table-stakes outcome | KEEP — it's the product thesis |
| DINER-02 | Confirmation with position + ETA | TABLE STAKES | KEEP — non-negotiable |
| DINER-03 | Push "tu mesa está lista" | TABLE STAKES (via SSE = compromise) | KEEP — narrate compromise |
| DINER-04 | Follow-up at minute 1 | DIFFERENTIATOR (workflow elegance) | KEEP — sells WDK |
| DINER-05 | Conversational extension | DIFFERENTIATOR | KEEP — sells the chatbot |
| DINER-06 | Conversational cancel | TABLE STAKES | KEEP |
| DINER-07 | Status check | TABLE STAKES | KEEP |
| DINER-08 | Auto no-show + notification | TABLE STAKES (auto) + safety (notification wording) | KEEP — refine wording |

### Staff requirements

| ID | Requirement | Category | v1 Verdict |
|----|-------------|----------|------------|
| STAFF-01 | Magic-link auth | TABLE STAKES | KEEP |
| STAFF-02 | Active queue chronological | TABLE STAKES | KEEP |
| STAFF-03 | Card with key fields | TABLE STAKES | KEEP |
| STAFF-04 | Color by party size | TABLE STAKES (visual differentiation) + DIFFERENTIATOR (Edge Config-driven) | KEEP |
| STAFF-05 | Call button | TABLE STAKES | KEEP — most-used button |
| STAFF-06 | Mark seated | TABLE STAKES | KEEP — most-used button #2 |
| STAFF-07 | Real-time updates | TABLE STAKES | KEEP |
| STAFF-08 | History view today | TABLE STAKES | KEEP |

### Platform requirements

| ID | Requirement | Category | v1 Verdict |
|----|-------------|----------|------------|
| PLAT-01 | MCP server with 4 tools | DIFFERENTIATOR (framing) | KEEP — core narrative |
| PLAT-02 | Identity validation | TABLE STAKES (safety) | KEEP — non-negotiable for pilot |
| PLAT-03 | WDK workflow per reservation | DIFFERENTIATOR (the money shot) | KEEP — Track 1 thesis |
| PLAT-04 | Postgres persistence | TABLE STAKES | KEEP |
| PLAT-05 | KV pub/sub | TABLE STAKES (for real-time) | KEEP |
| PLAT-06 | Edge Config for parameters | DIFFERENTIATOR (live demo moment) | KEEP — bonus video moment |
| PLAT-07 | SSE from Route Handlers | TABLE STAKES (for real-time) | KEEP |
| PLAT-08 | DurableAgent ETA | DIFFERENTIATOR | KEEP — but keep model simple |

### Demo requirements

| ID | Requirement | Category | v1 Verdict |
|----|-------------|----------|------------|
| DEMO-01 | Public Vercel deploy | TABLE STAKES (judge) | KEEP |
| DEMO-02 | Public GitHub repo | TABLE STAKES (judge) | KEEP |
| DEMO-03 | 90s video, 6 scenarios | TABLE STAKES (judge) | KEEP — narrative drives perception |
| DEMO-04 | README | TABLE STAKES (judge) | KEEP |

### Verdict on scope completeness

**No table stakes are missing from the planned feature list.** Every must-have is represented.

**Two anti-features risks in scope to watch:**
- DurableAgent ETA (PLAT-08) — DIFFERENTIATOR but easy to over-engineer. Cap effort: 4 hours max for Fase 10. If ETA looks weak, fall back to a deterministic formula and still expose it via `@workflow/ai/agent` so the framing holds.
- Cookie 24h (already cut-listed) — correct call to defer.

**Gaps not in scope but should be addressed:**
1. **Explicit logging-policy rule** ("no PII in logs") in Fase 11 hardening checklist.
2. **No-show wording UX** — the message a diner gets when auto-marked no-show; needs to be apologetic + recoverable. Detail for Fase 6 + Fase 8.
3. **Manual "undo no-show" affordance for the maître** — the diner who *did* show up after the timer fired needs a fix. Add to STAFF panel as a small action on history items, or a toggle.
4. **"Out-of-scope" refusal patterns in the chatbot system prompt** — what does it say to "reservame para mañana"? Detail for Fase 8.
5. **Echo-back confirmations after every tool call** — system prompt rule. Detail for Fase 8.

---

## Feature Dependencies

```
DINER-01 (chat alta)
    ├──requires──> PLAT-01 (MCP create_reservation)
    │                  ├──requires──> PLAT-04 (Postgres reservations)
    │                  └──requires──> PLAT-03 (workflow start)
    └──requires──> PLAT-02 (session_token + API key validation)

DINER-02 (confirmación con posición + ETA)
    ├──requires──> PLAT-01 (returns position + eta)
    └──enhances──> PLAT-08 (ETA via DurableAgent)

DINER-03 (push "tu mesa lista")
    ├──requires──> STAFF-05 (call button → emits event)
    ├──requires──> PLAT-03 (workflow consumes event)
    ├──requires──> PLAT-05 (KV pub/sub)
    └──requires──> PLAT-07 (SSE delivery)

DINER-04 (follow-up minuto 1)
    └──requires──> PLAT-03 (workflow timer step 6)

DINER-05/06/07 (extend / cancel / status via chat)
    ├──requires──> PLAT-01 (extend_wait, cancel, get_status tools)
    └──requires──> PLAT-02 (session_token validation per tool)

DINER-08 (auto no-show)
    ├──requires──> PLAT-03 (workflow timeout step 7)
    └──requires──> PLAT-06 (no_show_timeout_min from Edge Config)

STAFF-* (panel)
    ├──requires──> STAFF-01 (Auth.js)
    │                  └──requires──> Resend + AUTH_SECRET + employees table
    ├──requires──> PLAT-04 (read reservations)
    └──requires──> PLAT-07 (live updates via SSE)

DEMO-03 (video)
    ├──requires──> ALL DINER + STAFF + PLAT-06 (Edge Config moment) + PLAT-03 (deploy money shot)
    └──requires──> DEMO-01 (live URL)
```

### Dependency notes

- **PLAT-03 (WDK) is the single chokepoint.** If it doesn't work, DINER-03/04/05/06/08 all degrade. Build it first / build it solid (Fase 6 is correctly placed early-mid in the runbook).
- **PLAT-01 (MCP) and PLAT-03 (WDK) must be built together or in tight sequence** — the MCP tools dispatch to the workflow. Fase 5 builds tools that "for now don't dispatch", Fase 6 wires them up. This is correct sequencing.
- **PLAT-07 (SSE) and PLAT-05 (KV pub/sub) are coupled.** Build them together. Fase 6 includes pub/sub publishing; Fase 8 + 9 include SSE consumption. Make sure pub/sub channel naming convention is locked before either side is built.
- **DEMO-03 depends on ALL active requirements** — 80% of "demo doesn't work" is "one feature broke and cascaded into the demo flow." Schedule a full dry-run end-to-end at end of Fase 11.

---

## MVP Definition

### Launch With (v1) — Hackathon submission + restaurant pilot week

The full PROJECT.md Active list, with two refinements:

- [ ] All DINER-01 through DINER-08
- [ ] All STAFF-01 through STAFF-08
- [ ] All PLAT-01 through PLAT-08
- [ ] All DEMO-01 through DEMO-04
- [ ] **NEW** Explicit no-PII logging policy (Fase 11)
- [ ] **NEW** Maître affordance to undo `no_show` for a diner who showed up late (small action in `/queue/history`)
- [ ] **NEW** No-show diner notification text reviewed for tone (apologetic, recoverable)
- [ ] **NEW** Chatbot system prompt includes refusal patterns for out-of-scope requests

### Cut-List Order if Time Pressures

(Refining the existing cut list)

1. **Cookie 24h diner persistence** — already cut-listed; correct.
2. **Manual "undo no-show"** — gate behind "if Fase 9 finishes early"; if not, document as known gap, fix in week 2 of pilot.
3. **DurableAgent ETA quality** — replace agent with a hardcoded weighted-average formula if Fase 10 runs over; still expose via `@workflow/ai/agent` wrapper so Track 2 framing holds.
4. **Edge Config bonus moment in video** — if recording runs over, drop scenario 5 from the video and keep scenarios 1, 2, 3, 4, 6.

### Add After Validation (v1.x — first 2 weeks of real pilot use)

- [ ] WhatsApp out-of-band notification (the "tab closed" gap; consume the same MCP from a WA client) — solves the #1 likely real-pilot complaint
- [ ] Manual undo no-show + manual move-to-end-of-queue for the maître — based on what real shifts surface
- [ ] Maître note field per ticket ("alergia", "cumpleaños") — table stakes in all competitor products; deferrable for week 1 only
- [ ] Diner-side "estoy llegando, 5 min" before being called (proactive ETA update) — based on whether real diners ask for this

### Future Consideration (v2+)

- [ ] Multi-restaurant / multi-tenant
- [ ] Real SMS via Twilio (with full A2P 10DLC, opt-in, deliverability)
- [ ] Native mobile app for hosts
- [ ] Voice agent consuming MCP (showcases the platform thesis even more)
- [ ] Reservation system (planned dates) layered on top of waitlist
- [ ] CRM / guest history
- [ ] Analytics dashboard with metrics: quote-to-seat variance, no-show rate, peak-hour throughput
- [ ] POS integration (Toast, Square)
- [ ] No-show prediction ML (after enough history accumulates)
- [ ] Floor plan + table assignment
- [ ] Pre-payment / deposits
- [ ] Loyalty / rewards
- [ ] i18n (English first)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Note |
|---------|------------|---------------------|----------|------|
| Conversational alta | HIGH | M | P1 | The product thesis |
| Confirmation + position + ETA | HIGH | S | P1 | Table stakes |
| Push "table ready" via SSE | HIGH | M | P1 | Compromise version of universal feature |
| Maître call/seated buttons | HIGH | S | P1 | Most-used controls |
| Workflow durability across deploy | HIGH (judges) / LOW (diners) | M | P1 | The Track 1 money shot |
| MCP server framing | HIGH (judges) / N/A (diners) | M | P1 | The Track 2 framing |
| Edge Config live edit | MEDIUM (judges) | S | P1 | Demo moment |
| Auto no-show + notification | HIGH | S | P1 | Closes the loop |
| Conversational extend/cancel | MEDIUM | S | P1 | Sells the chat UX |
| Follow-up at minute 1 | MEDIUM | S | P1 | Sells WDK timer |
| Color by party size | LOW | S | P1 | Cheap, big perceptual win |
| Auth.js + history view | MEDIUM | S | P1 | Table stakes for the maître |
| ETA via DurableAgent | MEDIUM (judges) / LOW (diners) | M | P2 | Cap at 4h; fall back to formula if over |
| Cookie 24h | LOW | S | P2 | Cut-list #1 |
| Maître undo no-show | MEDIUM (real users) | S | P2 | Add if Fase 9 has slack |
| Diner notes / preferences | MEDIUM | S | P3 | Defer to v1.1 |
| Floor plan / tables | LOW (this scale) | L | P3 | Anti-feature for v1 |
| WhatsApp | HIGH | L | P3 | v1.1 priority |
| Multi-tenant | LOW (one pilot) | L | P3 | v2 |
| Native apps | LOW | XL | P3 | v2+ |
| Reservations (dated) | MEDIUM | L | P3 | v2 |

**Priority key:**
- P1: Must have for launch (hackathon + pilot week 1)
- P2: Should have, add if time permits within hackathon week
- P3: Defer to post-hackathon

---

## Competitor Feature Analysis

| Feature | Yelp Guest Manager | OpenTable | SevenRooms | Toast Tables | Waitlist Me / TablesReady | Our Approach |
|---------|---------------------|-----------|------------|--------------|---------------------------|--------------|
| Diner entry | App + web form + kiosk | App + web | QR/SMS/host | Web/host | Web/QR/host | **Web chatbot** (DIFFERENTIATOR) |
| Notifications | App push | App push + SMS | SMS | SMS | SMS, 2-way chat | **In-tab SSE** (compromise; narrate) |
| Position display | Yes (live) | Yes | Yes | Yes | Yes | Yes |
| ETA | "96% accurate" claim | Yes | Yes | Yes | Yes | Yes (DurableAgent) |
| Two-way ("more time") | Limited | Limited | Yes | Yes | Yes | **Conversational** (DIFFERENTIATOR) |
| Cancel from diner | Yes | Yes | Yes | Yes | Yes | **Conversational** |
| Auto no-show | Manual mostly | Manual | Manual + smart | Manual | Manual + auto | **Auto via WDK timer** |
| Floor plan / tables | Yes | Yes | Yes | Yes | Some | **NO** (anti-feature for pilot) |
| POS integration | Optional | Optional | Optional | Native | Some | **NO** |
| Multi-restaurant | Yes | Yes | Yes | Yes | Yes | **NO** (single pilot) |
| Pricing entry | $99/mo (was) → $300/mo | ~$249+/mo | Enterprise | Bundle | $24–$50/mo | **Free / pilot** |
| Workflow durability story | None marketed | None marketed | None marketed | None marketed | None marketed | **Yes, via WDK** (DIFFERENTIATOR) |
| MCP / agent-consumable backend | None | None | None | None | None | **Yes** (DIFFERENTIATOR) |
| Live config edit no-redeploy | None marketed | None marketed | None marketed | None marketed | None marketed | **Yes, Edge Config** (DEMO MOMENT) |

### Where we win vs. where we lose

**We win:**
- Workflow durability (no competitor markets this)
- MCP-as-platform framing (no competitor exposes their backend this way)
- Conversational UX (no incumbent does this)
- Live config edit (no competitor markets this)

**We lose (and it's OK for the pilot):**
- SMS / out-of-band notification (every competitor has it; we narrate WhatsApp roadmap)
- Floor plan + table assignment (every premium tier has it; we don't need it at this scale)
- POS / payment / loyalty integrations (every premium tier has it; explicitly out of scope)
- Multi-restaurant (every product is multi-tenant; explicitly out of scope)

---

## Sources

- [Yelp Guest Manager / Yelp Waitlist features](https://business.yelp.com/resources/articles/waitlist-management/?domain=restaurants)
- [Yelp WaitList G2 Reviews 2026](https://www.g2.com/products/yelp-waitlist/reviews)
- [Best restaurant waitlist apps 2026 — Restaurant Booking System](https://restaurantbookingsystem.com/best/restaurant-waitlist-apps/)
- [Best Virtual Queue Apps for Restaurants 2026 — ScanQueue](https://scanqueue.com/blog/best-virtual-queue-apps-restaurants)
- [The 10 Best Restaurant Waitlist Apps 2026 — Eat App](https://restaurant.eatapp.co/blog/best-restaurant-waitlist-management-systems)
- [Yelp Waitlist vs Eat App 2026](https://restaurant.eatapp.co/blog/yelp-waitlist)
- [OpenTable Waitlist vs Eat App 2026](https://restaurant.eatapp.co/blog/opentable-waitlist)
- [WaitlistMe Alternatives — Eat App](https://restaurant.eatapp.co/blog/top-waitlistme-alternatives-competitors)
- [NextMe vs Waitlist Me Comparison](https://nextmeapp.com/waitlistme/)
- [SevenRooms — Improving Restaurant Waitlist Management](https://sevenrooms.com/blog/improving-restaurant-waitlist-management/)
- [SevenRooms — Waitlist as Hospitality Extension](https://sevenrooms.com/blog/restaurant-waitlist-hospitality-guide/)
- [Toast Tables Launch — Toast POS Blog](https://pos.toasttab.com/news/introducing-toast-tables-reservation-waitlist-management)
- [Toast Tables Usage Guide](https://central.toasttab.com/s/article/Using-Toast-Tables-Waitlist)
- [TablesReady — Smart Waitlist Management](https://www.tablesready.com/)
- [TablesReady — Guest Messaging Features](https://www.tablesready.com/features/guest-messaging-waitlist-features)
- [Waitlist Me — Free Text Message Alerts](https://www.waitlist.me/features)
- [Simple Host — SMS Notifications Two-Way](https://www.simplehostapp.com/sms-notifications)
- [BentoBox Restaurant Waitlist Software](https://www.getbento.com/products/waitlist/)
- [Restaurant Waitlist Best Practices 2026 — WaitQ](https://waitq.app/blog/best-practices-restaurant-waitlist-management)
- [Waitlist Me alternatives — Popmenu](https://get.popmenu.com/post/waitlist-me-alternatives)
- [Yelp Engineering — Architecting Wait Time Predictions](https://engineeringblog.yelp.com/2019/12/architecting-wait-time-estimations.html)
- [Olo Host — AI for restaurant waitlist quote times](https://www.olo.com/blog/11-ways-olo-uses-ai-to-fuel-restaurant-growth)
- [AI Reduces Restaurant Wait Times — Loman.ai](https://loman.ai/blog/ai-for-reducing-restaurant-wait-times-a-guide)
- [Slang AI — Voice AI for restaurants](https://www.slang.ai/)
- [Hostie — AI conversational concierge for restaurants](https://hostie.ai/)
- [Voiceflow — AI Call Agent for Restaurants 2026](https://www.voiceflow.com/blog/ai-call-agent-for-restaurants)
- [Yelp updated AI assistant — TechCrunch April 2026](https://techcrunch.com/2026/04/21/yelps-updated-ai-assistant-can-answer-questions-and-book-a-restaurant-or-service-in-one-conversation/)
- [LLM Hallucinations in Conversational AI for Customer Service — Tandfonline 2025](https://www.tandfonline.com/doi/full/10.1080/10447318.2025.2580540)
- [Stop AI Agent Hallucinations — DEV Community](https://dev.to/aws/stop-ai-agent-hallucinations-4-essential-techniques-2i94)
- [LLM hallucination examples — Evidently AI](https://www.evidentlyai.com/blog/llm-hallucination-examples)
- [Carbonara — Restaurant Data Protection Principles](https://www.carbonaraapp.com/restaurant-data-protection-principles/)
- [Restaurant Data Privacy Best Practices 2025 — Fishbowl](https://www.fishbowl.com/blog/restaurant-data-privacy)
- [Restaurant Tablet Best Practices — Cuboh](https://www.cuboh.com/blog/restaurant-tablet-best-practices)
- [Vercel AI Gateway Hackathon 2026](https://vercel.com/i/ai-gateway-hackathon)
- [Vercel Hackathon Winners](https://vercel.com/blog/hackathon-winners)
- [Restaurant Waitlist Metrics — Tablein](https://www.tablein.com/blog/restaurant-waitlist-metrics)
- [QSR Automations — Restaurant Metrics](https://qsrautomations.com/blog/guest-management/restaurant-metrics/)

---
*Feature research for: Restaurant digital waitlist (chatbot embed + maître panel + MCP backend)*
*Researched: 2026-04-25*
