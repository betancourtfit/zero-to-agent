# Zero to Agent — Restaurant Queue MVP

## What This Is

Sistema de gestión de cola de espera para restaurantes con un **chatbot embed conversacional** para el comensal y un **panel del maître** para el empleado. El backend se expone como **MCP server público** (consumible por cualquier agente: chatbot embed hoy, WhatsApp mañana) y el ciclo de vida de cada reserva se orquesta con **Vercel Workflow (WDK)** durable. Stack 100% nativo Vercel. Construido para un hackathon (deadline ~2026-05-02) con un restaurante piloto real que empieza a usarlo la misma semana.

## Core Value

**Una reserva entra al chatbot, sobrevive deploys/crashes/timers como workflow durable, y se cierra correctamente (`seated`, `no_show` o `cancelled`) sin perder estado.** Si todo lo demás falla, este loop tiene que funcionar — es lo que demuestra WDK + MCP + el valor real para el restaurante.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

**Validated in Phase 1 (Foundation), 2026-04-26 — production at https://zero-to-agent-xi.vercel.app:**
- [x] **STAFF-01**: Maître se autentica con magic-link via Auth.js (round-trip end-to-end live, D-09/D-10/D-11/D-12 enforced)
- [x] **PLAT-04**: Persistencia en Neon Postgres — 7 tablas (4 Auth.js + employees, reservations, reservation_events) + `_migrations` runner; maître seeded
- [x] **PLAT-06**: Vercel Edge Config con 6 parámetros operacionales D-08; cambios desde dashboard propagan sin redeploy (verified 20→5→20)
- [x] **DEMO-01**: Deploy Vercel con URL pública estable (4 deploys al mismo alias)
- [x] **DEMO-02**: Repo público en GitHub (https://github.com/betancourtfit/zero-to-agent)

**Validated in Phase 2 (Backend Core), 2026-04-26 — money-shot proven on production:**
- [x] **PLAT-01**: Service-layer funnel — `lib/services/reservations.ts` (4 funcs) + `lib/services/queue.ts` (4 funcs); MCP, staff API, future WhatsApp all funnel here
- [x] **PLAT-02**: MCP server with 4 tools (bearer + per-tool session_token gate); LLM never sees `reservation_id` for action tools
- [x] **PLAT-03**: WDK durable workflow `waiting → called → seated|no_show|cancelled` survives mid-flight `git push` deploy (UAT 2 confirmed against prod)
- [x] **PLAT-05**: Upstash pub/sub — real `redis.subscribe()`, NO BLPOP. Multi-SSE fan-out verified (UAT 5)
- [x] **PLAT-07**: SSE handlers with snapshot-replay-on-connect, heartbeat 25s, abort cleanup. `maxDuration=300` on Hobby (Pro extends to 800)
- [x] **SAFE-01**: PII redactor `lib/log.ts` — masks email/phone/name/full_name; 7-test suite green
- [x] **DEMO-04**: `seed-demo.ts` 3-state fixture + `smoke-test-mcp.sh` 5-step harness + `smoke-money-shot.sh` deploy-mid-flight harness all shipped

### Active

<!-- Current scope. Building toward these. -->

**Comensal (chatbot embed):**
- [ ] **DINER-01**: Comensal puede registrarse en la cola conversando con el chatbot (nombre, email, teléfono, cantidad de personas)
- [ ] **DINER-02**: Comensal recibe confirmación con posición en la cola y ETA estimada
- [ ] **DINER-03**: Comensal recibe push proactivo "TU MESA ESTÁ LISTA" cuando el maître lo llama
- [ ] **DINER-04**: Comensal recibe follow-up automático al minuto 1 si no responde después del llamado
- [ ] **DINER-05**: Comensal puede pedir más tiempo conversando ("dame 5 más", "voy llegando")
- [ ] **DINER-06**: Comensal puede cancelar conversando ("no voy a ir")
- [ ] **DINER-07**: Comensal puede consultar su estado y posición en cualquier momento
- [ ] **DINER-08**: Si el comensal no llega y no responde, el sistema lo marca `no_show` automáticamente y le notifica

**Maître (panel auth):**
- [x] **STAFF-01**: ✓ Validated in Phase 1 (Foundation)
- [ ] **STAFF-02**: Maître ve la cola activa del día ordenada cronológicamente (más antiguos primero)
- [ ] **STAFF-03**: Cada tarjeta de reserva muestra nombre, party size, hora de llegada, estado, ETA, badge de extensión
- [ ] **STAFF-04**: Codificación visual por tamaño de grupo (colores)
- [ ] **STAFF-05**: Maître puede llamar a una mesa (dispara el push al comensal)
- [ ] **STAFF-06**: Maître puede marcar presentado (cierra el ticket)
- [ ] **STAFF-07**: Panel se actualiza en tiempo real (SSE)
- [ ] **STAFF-08**: Vista `/queue/history` muestra reservas cerradas del día

**Plataforma (backend):**
- [x] **PLAT-01**: ✓ Validated in Phase 2 (Backend Core)
- [x] **PLAT-02**: ✓ Validated in Phase 2 (Backend Core)
- [x] **PLAT-03**: ✓ Validated in Phase 2 (Backend Core)
- [x] **PLAT-04**: ✓ Validated in Phase 1 (Foundation)
- [x] **PLAT-05**: ✓ Validated in Phase 2 (Backend Core)
- [x] **PLAT-06**: ✓ Validated in Phase 1 (Foundation)
- [x] **PLAT-07**: ✓ Validated in Phase 2 (Backend Core)
- [ ] **PLAT-08**: DurableAgent (`@workflow/ai/agent`) estima ETA dinámicamente

**Demo / submission:**
- [x] **DEMO-01**: ✓ Validated in Phase 1 (Foundation)
- [x] **DEMO-02**: ✓ Validated in Phase 1 (Foundation)
- [ ] **DEMO-03**: Video demo de 90s con los 6 escenarios (alta conversacional, vuelta, llamado+extensión, no-show, Edge Config en vivo, money-shot deploy)
- [x] **DEMO-04**: ✓ Validated in Phase 2 (Backend Core)

**Safety / privacy:**
- [x] **SAFE-01**: ✓ Validated in Phase 2 (Backend Core)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Cookie de sesión 24h del comensal** — Primer item del cut list si el tiempo aprieta. Si entra, mejor; si no, cada visita arranca fresca.
- **Web push / service workers** — Si la pestaña está cerrada, el comensal no recibe el push. La narrativa para el video aclara que en producción esto se resuelve con WhatsApp.
- **WhatsApp del comensal** — Mencionado como evolución post-hackathon. El MCP queda listo para que un futuro chatbot de WhatsApp lo consuma, pero no se construye en v1.
- **Multi-tenant / multi-restaurante** — Un solo restaurante (el piloto). Multi-tenant es post-hackathon.
- **i18n / inglés** — Spanish only. El piloto es en español; los judges leerán el video con subtítulos / contexto.
- **Branding del restaurante en el código** — Branding genérico. Si el piloto necesita rebrand, se hace después.
- **Migración a stack del cliente (Supabase)** — Documentada como camino futuro pero no se construye.
- **Analytics avanzado** — Vercel Analytics + Speed Insights gratis si entran fácil; nada custom.
- **Rate limiting sofisticado** — Solo lo básico (5 req/min en `create_reservation` con KV) para evitar abuso obvio del MCP público.
- **Ordering / payment / mesa management** — Esto es solo cola de espera. Nada de pedidos, pagos o asignación de mesas específicas.

## Context

**Quién está construyendo esto:** Solo developer trabajando con Claude Code. Sin teammates.

**Hackathon:** Deadline en menos de 7 días desde 2026-04-25 (~2026-05-02). El nombre exacto del hackathon es "diferente" (no Vercel Ship 2026 oficial — TBD si se necesita explicitar).

**Piloto real:** Hay un restaurante con el que se acordó pilotear el sistema **la misma semana del hackathon**. Esto significa que el código del hackathon = el código que un restaurante real usará con comensales reales en pocos días. La narrativa de "real-world fit" con un piloto de carne y hueso es el diferenciador que se quiere mostrar a los judges.

**Escala del piloto:** Tiny — menos de 20 comensales concurrentes en un pico. No hay preocupaciones de escala; sí hay preocupaciones de correctness y UX (porque son comensales reales con expectativas reales).

**Stack y tracks del hackathon:**
- **Track 1 (WDK):** El workflow durable por reserva con `waitForEvent` + timeouts es el corazón.
- **Track 2 (v0 + MCP):** El MCP server propio que el chatbot consume como tools. Unifica Track 1 + 2 en un único entregable.
- Stack es 100% nativo Vercel — Postgres (Neon), KV (Upstash), Edge Config, Auth.js, AI Gateway, AI SDK, MCP adapter, SSE desde Route Handlers.

**Documento de scope detallado:** `/Users/juanabetancourt/Documents/github/aprender/zero-to-agent/scope_hackathon_mvp.md` contiene la spec completa (12 secciones + runbook de 12 fases). Es la fuente de verdad para arquitectura y modelo de datos. Las fases del runbook (Fase 1–12 del scope) son la base sugerida para el roadmap pero pueden ajustarse al granularity elegido.

**Demo del video (6 escenarios planeados):** alta conversacional → vuelta con cookie → llamado + extensión proactiva → no-show automático → Edge Config en vivo → money shot del deploy con tickets vivos.

## Constraints

- **Timeline**: ~7 días para entregar (hackathon deadline ~2026-05-02) Y mismo período para que el restaurante piloto empiece a usarlo. Sin margen para refactors grandes.
- **Team**: Solo developer. Cualquier item de la cut list ayuda más que features extra.
- **Tech stack (locked)**: Next.js 15 App Router, Vercel hosting, Vercel Workflow (WDK), `@vercel/mcp-adapter`, AI SDK + AI Gateway con `anthropic/claude-sonnet-4-6`, Vercel Postgres (Neon), Vercel KV (Upstash), Vercel Edge Config, Auth.js + `@auth/pg-adapter` + Resend para magic-link, SSE desde Route Handlers, shadcn/ui + Tailwind, v0 para UI rápida.
- **Language**: Spanish only para chatbot y panel. Judges entenderán por contexto / subtítulos del video.
- **Real users**: El piloto empieza la misma semana. Correctness > features. Datos reales de comensales reales — privacidad (HTTPOnly cookies, no logging de PII en logs públicos) importa.
- **Submission requirements**: Repo público GitHub + URL deploy pública + video 90s.
- **Cero credenciales de terceros más allá de Vercel + Resend**: Todas las env vars son auto-provisionadas por integraciones del Marketplace de Vercel (POSTGRES_URL, KV_URL, EDGE_CONFIG, AI_GATEWAY_API_KEY) + RESEND_API_KEY manual.
- **Performance**: SSE en serverless tiene timeout (5–15 min). El cliente debe reconectar si se corta. Documentado como aceptable para hackathon.
- **Cut list priority** (orden en que se sacrifica si se acaba el tiempo):
  1. Cookie 24h persistencia del comensal
  2. (resto se decide en el momento si aplica)

## Key Decisions

<!-- Decisions that constrain future work. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Chatbot conversacional en vez de formulario `/join` | UX moderna + showcase de AI SDK + tool-calling para el video | — Pending |
| Backend expuesto como MCP server público | Unifica Track 1 (WDK) + Track 2 (v0+MCP) en un único entregable; permite reusar para WhatsApp después | — Pending |
| 100% Vercel stack (Postgres + KV + Edge Config + Auth.js) | Cero credenciales externas, env vars auto-provisionadas, "demo gold" + minimiza fricción solo-developer | — Pending |
| WDK con `waitForEvent` + timeouts en vez de cron jobs | Workflow suspendido = cero CPU; sobrevive deploys; idempotencia gratis; ES el money shot del video | — Pending |
| Auth.js con magic-link via Resend | Open source, deploya en Vercel, sin Clerk ni terceros, suficiente para 1 rol (maître) | — Pending |
| SSE desde Route Handlers + Vercel KV pub/sub | Cero dependencia adicional; el workflow publica eventos a `reservation:<id>` y `queue:active`; los handlers SSE leen y reenvían | — Pending |
| Vercel Edge Config para parámetros (no DB) | Cambios sin redeploy es un demo moment fuerte; ideal para parámetros de operación | — Pending |
| Spanish only | Piloto es en español; ahorra trabajo de i18n; judges leen video con subtítulos | — Pending |
| Branding genérico para hackathon | Piloto puede rebrandearse después con Edge Config; no atar el demo a una marca específica | — Pending |
| Cookie 24h primero en cut list | Es nice-to-have UX, no core; el flujo entero de espera dura horas no días | — Pending |
| Modelo LLM: `anthropic/claude-sonnet-4-6` via AI Gateway | Pro-tip del hackathon; balance calidad/costo; sin lock-in al gateway | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-26 after Phase 1 (Foundation) completion — 5/32 requirements validated*
