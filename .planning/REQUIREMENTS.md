# Requirements: Zero to Agent — Restaurant Queue MVP

**Defined:** 2026-04-25
**Core Value:** Una reserva entra al chatbot, sobrevive deploys/crashes/timers como workflow durable, y se cierra correctamente (`seated`, `no_show` o `cancelled`) sin perder estado.

## v1 Requirements

Requirements for the hackathon MVP and the same-week pilot. Every requirement maps to exactly one of the 4 phases derived from the research (Foundation → Backend Core → User Surfaces → Pilot-Hardening + Demo).

### Comensal — chatbot embed (DINER)

- [ ] **DINER-01**: Comensal puede registrarse en la cola conversando con el chatbot embebido en `/`, proporcionando nombre, email, teléfono y cantidad de personas
- [ ] **DINER-02**: Comensal recibe confirmación con `reservation_id`, posición en la cola y ETA estimada al completar el alta
- [ ] **DINER-03**: Comensal recibe push proactivo "TU MESA ESTÁ LISTA" en la pestaña abierta cuando el maître ejecuta la acción "Llamar"
- [ ] **DINER-04**: Comensal recibe follow-up automático ("¿Estás en camino? [Pedir más tiempo] [Cancelar]") al transcurrir `followup_after_call_min` desde el llamado sin recibir respuesta
- [ ] **DINER-05**: Comensal puede pedir más tiempo en lenguaje natural ("dame 5 más", "voy llegando"), y el sistema extiende el `no_show_deadline` por `extension_min`
- [ ] **DINER-06**: Comensal puede cancelar la reserva en lenguaje natural ("no voy a ir", "cancelar"), y la reserva pasa a `cancelled`
- [ ] **DINER-07**: Comensal puede consultar su estado, posición y ETA en cualquier momento via chat ("¿cómo voy?")
- [ ] **DINER-08**: Si el comensal no llega ni responde dentro del `no_show_deadline` (incluyendo extensiones), el sistema marca la reserva como `no_show` automáticamente y le envía un mensaje empático en el chat

### Maître — panel auth (STAFF)

- [ ] **STAFF-01**: Maître se autentica en `/login` con magic-link enviado por Auth.js v5 + Resend, validando contra la tabla `employees`
- [ ] **STAFF-02**: Maître ve la cola activa del día en `/queue` ordenada cronológicamente (más antiguas primero)
- [ ] **STAFF-03**: Cada tarjeta de reserva muestra nombre, party size, hora de llegada, tiempo en espera, estado actual, ETA, y badge "extendido" si `extension_count > 0`
- [ ] **STAFF-04**: Las tarjetas usan codificación visual de color por tamaño de grupo (`colors_by_party_size` de Edge Config)
- [ ] **STAFF-05**: Maître puede ejecutar "Llamar" en una tarjeta `waiting`, lo que dispara el evento `call` al workflow y el push al comensal
- [ ] **STAFF-06**: Maître puede ejecutar "Marcar presentado" en una tarjeta `called`, lo que cierra la reserva con estado `seated`
- [ ] **STAFF-07**: Panel se actualiza en tiempo real (SSE con snapshot-replay-on-connect) cuando entra una nueva reserva o cambia el estado de una existente
- [ ] **STAFF-08**: Vista `/queue/history` muestra reservas cerradas del día (`seated`, `no_show`, `cancelled`)
- [ ] **STAFF-09**: Maître puede deshacer un `no_show` en `/queue/history` para reabrir la reserva (caso real: el comensal llegó tarde) — añadido por research §FEATURES (gap #2 para safety del piloto)

### Plataforma — backend (PLAT)

- [ ] **PLAT-01**: MCP server público en `app/mcp/[transport]/route.ts` (`mcp-handler@1.1.0` + `withMcpAuth`) expone 4 tools: `create_reservation`, `get_reservation_status`, `extend_wait`, `cancel_reservation`
- [ ] **PLAT-02**: Cada MCP tool valida identidad por bearer `MCP_API_KEY` del chatbot Y por `session_token` del comensal (header `X-Reservation-Session`); el LLM nunca pasa `reservation_id` para acciones — se resuelve server-side desde el session_token (mitiga Pitfall #5: tool poisoning)
- [ ] **PLAT-03**: Workflow WDK (`workflow` package) durable por reserva, ciclo completo `waiting → called → seated|no_show|cancelled` con rama `extend`, usando `createHook()` + `Promise.race(hook, sleep("..."))` (NO `waitForEvent` — esa API no existe). Workflow shape congelado al cierre de Phase 2
- [ ] **PLAT-04**: Persistencia en Neon Postgres (`@neondatabase/serverless` para app + `pg.Pool` para Auth.js adapter) con tablas `reservations`, `reservation_events`, `employees`, y las tablas auto-generadas por Auth.js v5 (`users`, `accounts`, `sessions`, `verification_tokens`)
- [ ] **PLAT-05**: Upstash Redis (`@upstash/redis`) provee pub/sub real (no LIST+BLPOP) para fan-out de eventos a SSE handlers; canales `reservation:<id>` y `queue:active`. Postgres es source of truth, KV es hint
- [ ] **PLAT-06**: Vercel Edge Config almacena parámetros operativos (`no_show_timeout_min`, `followup_after_call_min`, `extension_min`, `max_extensions_per_ticket`, `eta_recompute_interval_sec`, `colors_by_party_size`) — cambios desde dashboard sin redeploy
- [ ] **PLAT-07**: SSE Route Handlers (`/api/events/[reservation_id]` y `/api/events/queue`) implementan snapshot-replay-on-connect (leer estado actual de Postgres, emitir como evento inicial, luego suscribirse a KV) + heartbeat cada 25s + `maxDuration: 800`
- [ ] **PLAT-08**: DurableAgent (`@workflow/ai/agent`) estima ETA dinámicamente desde MCP tools `create_reservation` y `get_reservation_status` (con fallback a fórmula determinística si el agent no entrega valor diferenciado)

### Safety / pilot-readiness (SAFE)

- [ ] **SAFE-01**: Helper `lib/log.ts` redacta automáticamente PII (email, teléfono, nombre completo) de todos los `console.log` y errores enviados a Vercel Observability — para evitar exposición en logs visibles a cualquiera con acceso al proyecto (mitiga Pitfall #15)
- [ ] **SAFE-02**: System prompt del chatbot incluye reglas de rechazo (no responder preguntas off-topic), echo-back de datos antes de confirmar reserva, manejo de inputs ambiguos en español ("somos 4 o 5", "tal vez un bebé"), y NUNCA inventar confirmaciones — la confirmación viene del retorno del tool (mitiga FEATURES.md §chatbot UX risks)
- [ ] **SAFE-03**: Mensaje de no-show automático al comensal usa tono empático y recuperable ("Marcamos tu reserva como no-show porque no llegamos a verte. Si querés volver a anotarte, abrí esta página de nuevo.") en lugar de tono punitivo

### Demo / submission (DEMO)

- [ ] **DEMO-01**: Deploy productivo en Vercel con URL pública estable
- [ ] **DEMO-02**: Repo público en GitHub con código limpio + `.env.example` actualizado + README claro (descripción, stack, cómo correr local, link al deploy)
- [ ] **DEMO-03**: Video demo de 90 segundos cubriendo los 6 escenarios: (1) alta conversacional, (2) vuelta del comensal con estado preservado, (3) llamado + extensión proactiva via chat, (4) no-show automático, (5) Edge Config en vivo, (6) money shot del deploy con tickets vivos sobreviviendo. (Si rehearsal de Edge Config sale mal, escenario 5 se puede recortar — pero los demás son no-cuttable)
- [ ] **DEMO-04**: Script `scripts/seed-demo.ts` crea 3 reservas en distintos estados para que la grabación arranque con la cola "viva"; usado durante desarrollo (no solo en Phase 4) para tener app real funcionando todos los días

## v2 Requirements

Acknowledged but explicitly deferred — not in this milestone's roadmap.

### Comensal (DINER)

- **DINER-09**: Sesión persistente del comensal entre visitas (24h) — usando localStorage o cookie pre-set (NO durante streaming). En cut-list #1 de v1: si entra, vuelve aquí; si no, queda en v2.

### Maître (STAFF)

- **STAFF-10**: Analytics del día (cantidad atendida, tiempo promedio de espera, no-show rate)
- **STAFF-11**: Historial multi-día con filtros y export

### Plataforma (PLAT)

- **PLAT-09**: WhatsApp adapter consumiendo el MCP server (post-hackathon — el MCP queda listo pero no se construye el adapter)
- **PLAT-10**: Web push notifications via service worker (cuando la pestaña está cerrada)
- **PLAT-11**: Multi-tenant / multi-restaurante con row-level scoping
- **PLAT-12**: Migración del stack a Supabase u otro proveedor del cliente

### Safety / monitoring (SAFE)

- **SAFE-04**: Monitoreo / alertas avanzadas (Datadog, Sentry, etc.) — v1 usa solo Vercel Analytics + Speed Insights + un webhook básico de Slack/Discord en workflow failures
- **SAFE-05**: Idempotency total para todos los MCP writes (v1 solo cubre `create_reservation` con dedupe key en KV)

## Out of Scope

Explicitly excluded with reasoning. These prevent scope creep and document anti-features identified by research.

| Feature | Reason |
|---------|--------|
| Cookie de sesión 24h del comensal (cookie set durante streaming) | Pitfall #10: HTTP no permite `Set-Cookie` después que el body empieza a flushearse. Si se quiere persistencia, usar localStorage (v2 DINER-09) o pre-set cookie ANTES del stream. |
| Web push / service workers | Si la pestaña está cerrada, el comensal no recibe el push. La narrativa del video aclara que en producción WhatsApp resolvería esto. Service worker suma demasiada complejidad para 7 días. |
| WhatsApp del comensal | Mencionado como evolución post-hackathon. El MCP queda listo para que un futuro chatbot WhatsApp lo consuma, pero no se construye en v1. |
| Multi-tenant / multi-restaurante | Un solo restaurante (el piloto). Multi-tenant es post-hackathon y es trabajo pesado (RLS, scoping, billing). |
| i18n / inglés / multi-idioma | Spanish only. El piloto es en español; los judges leerán video con subtítulos. |
| Branding del restaurante en el código | Branding genérico para hackathon. Si el piloto necesita rebrand, se hace después con Edge Config. |
| Migración a Supabase / stack del cliente | Documentada como camino futuro pero no se construye. Estamos 100% Vercel para el hackathon. |
| Analytics avanzado / dashboards | Vercel Analytics + Speed Insights gratis si entran fácil; nada custom. (Tarpit identificado por FEATURES.md.) |
| SMS / Twilio integration | Tarpit (A2P 10DLC compliance + opt-in flow = 2 días). SSE en pestaña abierta es suficiente para v1; WhatsApp es el plan a futuro. |
| Floor plan / table assignment / mesa management | Esto es solo cola de espera. Nada de pedidos, pagos o asignación de mesas específicas. (Anti-feature de FEATURES.md.) |
| Reservations dated (book a table for tomorrow at 8pm) | Esto es waitlist para diners ya en el lugar, no booking. Diferente producto. |
| ML para predecir no-show | Tarpit. La heurística simple (timeout + extensiones) cubre el caso. |
| CRM / customer profiles / loyalty | Out of scope para waitlist puro. Anti-feature. |
| POS integration | Anti-feature. Pilot tiny no lo necesita y suma días de integración. |
| Voice / phone-based interaction | Out of scope. Chatbot embed es el canal único v1. |
| Payments / deposits | Out of scope. No hay pagos en este flujo. |
| Real SMS notifications | Sustituido por SSE para v1. WhatsApp es el plan post-hackathon. |
| Native mobile apps | Web-first. PWA o native vienen después. |
| Kiosks / on-site terminals | Out of scope. El comensal usa su propio celular en la web. |
| Ratings / feedback / reviews | Out of scope para waitlist puro. |
| Cron jobs / scheduled tasks | El workflow WDK con `Promise.race(hook, sleep)` reemplaza cualquier cron. Por diseño. |

## Traceability

Empty initially. Populated during roadmap creation by `gsd-roadmapper`. Each requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DINER-01 | TBD | Pending |
| DINER-02 | TBD | Pending |
| DINER-03 | TBD | Pending |
| DINER-04 | TBD | Pending |
| DINER-05 | TBD | Pending |
| DINER-06 | TBD | Pending |
| DINER-07 | TBD | Pending |
| DINER-08 | TBD | Pending |
| STAFF-01 | TBD | Pending |
| STAFF-02 | TBD | Pending |
| STAFF-03 | TBD | Pending |
| STAFF-04 | TBD | Pending |
| STAFF-05 | TBD | Pending |
| STAFF-06 | TBD | Pending |
| STAFF-07 | TBD | Pending |
| STAFF-08 | TBD | Pending |
| STAFF-09 | TBD | Pending |
| PLAT-01 | TBD | Pending |
| PLAT-02 | TBD | Pending |
| PLAT-03 | TBD | Pending |
| PLAT-04 | TBD | Pending |
| PLAT-05 | TBD | Pending |
| PLAT-06 | TBD | Pending |
| PLAT-07 | TBD | Pending |
| PLAT-08 | TBD | Pending |
| SAFE-01 | TBD | Pending |
| SAFE-02 | TBD | Pending |
| SAFE-03 | TBD | Pending |
| DEMO-01 | TBD | Pending |
| DEMO-02 | TBD | Pending |
| DEMO-03 | TBD | Pending |
| DEMO-04 | TBD | Pending |

**Coverage:**
- v1 requirements: 32 total
- Mapped to phases: 0 (filled by roadmapper)
- Unmapped: 32 ⚠️ (will resolve after roadmap created)

---
*Requirements defined: 2026-04-25*
*Last updated: 2026-04-25 after initial definition*
