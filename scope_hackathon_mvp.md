# Scope MVP — Versión Hackathon (chatbot embed + MCP + 100% stack Vercel)

> Versión 3 del scope. Cambios mayores respecto a la versión anterior:
> - El comensal ya no usa un formulario: interactúa con un **chatbot embed** que toma sus datos en conversación.
> - El backend se expone como **MCP server propio** → cualquier agente lo puede consumir (el chatbot de Vercel ahora, el de WhatsApp después). Esto **unifica Track 1 (WDK) y Track 2 (v0 + MCP) en un único entregable**.
> - **Stack 100% nativo Vercel:** Vercel Postgres (Neon) + Vercel KV (Upstash) + Vercel Edge Config + Auth.js + SSE. Sin terceros.
> - **Cookie de 24 h** para mantener sesión del comensal entre visitas.

---

## 1. Cambios clave respecto al scope anterior

| Antes | Ahora |
|---|---|
| Formulario `/join` para alta | Chatbot embed conversacional |
| Backend con Server Actions / REST | Backend expuesto como **MCP server** |
| Supabase + Clerk | **100% Vercel: Vercel Postgres + Auth.js + SSE + Edge Config** |
| Sin sesión persistente del comensal | Cookie 24 h (`reservation_session`) |
| Track 1 principal, Track 2 "tomado prestado" | **Track 1 + Track 2 unificados**: WDK detrás + MCP server delante |
| Parámetros en tabla `restaurant_config` | **Vercel Edge Config** (cambios sin redeploy) |

---

## 2. Componentes a construir

### A. Frontend del comensal — chatbot embed (público)

**Página `/`**: landing con un chatbot conversacional embebido (estilo widget de soporte).

- **Conversación de alta:** el chatbot saluda, recolecta progresivamente:
  - Nombre
  - Email
  - Teléfono
  - Cantidad de personas
- **Construcción del agente (Track 1+2):**
  - Frontend con AI SDK `useChat`.
  - Modelo vía AI Gateway (`anthropic/claude-sonnet-4-6`).
  - El agente tiene **tool-calling sobre nuestro MCP server** (sus tools: `create_reservation`, `get_reservation_status`, `extend_wait`, `cancel_reservation`).
- **Confirmación:** al completar el alta el chatbot muestra el resumen, posición en la cola y ETA estimada.
- **Sesión persistente (cookie 24 h):**
  - Al crear la reserva, el backend devuelve `reservation_id` y se setea cookie `reservation_session` (HTTPOnly, SameSite=Lax, 24 h).
  - Si el comensal vuelve a abrir la web dentro de 24 h, el chatbot reanuda la conversación con su estado actual ("Hola Juana, tu mesa está esperando, posición 3, ETA 12 min").
  - La cookie sólo apunta al `reservation_id`; la fuente de verdad es el backend.
- **Notificaciones in-page (mientras el comensal tiene la pestaña abierta):**
  - **SSE** desde un Route Handler de Next.js (`/api/events/[reservation_id]`) — sin dependencia adicional, totalmente nativo Vercel.
  - El stream se mantiene abierto y el workflow WDK publica eventos a un canal en **Vercel KV** (Upstash Redis pub/sub) que el route handler consume y reenvía al cliente.
  - Cuando el estado pasa a `called` → el chatbot lanza un mensaje proactivo: **"¡Tu mesa está lista! Te esperamos en la entrada."**
  - **Al minuto 1** desde `called`, si no hubo interacción, mensaje de seguimiento con dos quick-replies: **"¿Estás en camino? Pedí más tiempo o cancelá."**
- **Acciones del comensal en el chat:**
  - "Necesito más tiempo" / "Estoy llegando" → tool `extend_wait`.
  - "Cancelar" / "No voy a ir" → tool `cancel_reservation`.
  - "¿Cómo voy?" → tool `get_reservation_status`.

> El comensal sólo conversa. El LLM decide qué tools usar y nuestro MCP es la fuente de verdad.

### B. Frontend del empleado — panel del maître (auth)

- **`/login`** (Auth.js con email magic-link, sesión guardada en Vercel Postgres).
- **`/queue`** — panel:
  - **Lista de reservas activas, ordenadas cronológicamente (más antiguas primero).** Sólo del día.
  - Cada tarjeta: nombre, cantidad de personas, hora de llegada, tiempo en espera, estado, ETA.
  - Codificación visual por tamaño de grupo (colores).
  - Acciones por reserva:
    - **Llamar** → la mesa está lista, dispara el flujo de notificación al comensal.
    - **Marcar presentado** → el comensal llegó y se está sentando, cierra el ticket.
  - Auto-refresh en tiempo real.
- **`/queue/history`** — vista secundaria con reservas cerradas del día (`seated`, `no_show`, `cancelled`). Cuando un ticket termina, se mueve aquí automáticamente y desaparece de la lista activa.

### C. Backend — MCP server + WDK workflows

**Tres responsabilidades:**

1. **MCP server público** (consumido por el chatbot embed hoy, por el chatbot de WhatsApp del cliente mañana).
2. **API privada** consumida por el panel del empleado (auth con Auth.js).
3. **Workflows WDK durables** que orquestan el ciclo de vida de cada reserva.

**Tools MCP expuestas:**

| Tool | Quién lo usa | Descripción |
|---|---|---|
| `create_reservation` | Chatbot del comensal | Crea reserva, dispara `reservationWorkflow`, devuelve `reservation_id` + posición + ETA. |
| `get_reservation_status` | Chatbot del comensal | Devuelve estado actual, posición, ETA. |
| `extend_wait` | Chatbot del comensal | Suma `extension_min` al `no_show_deadline`. |
| `cancel_reservation` | Chatbot del comensal | Cancela y termina el workflow. |

**API privada (auth) consumida por el panel del empleado:**

| Endpoint | Acción |
|---|---|
| `GET /api/queue` | Lista de reservas activas ordenadas cronológicamente. |
| `GET /api/queue/history?date=...` | Historial del día. |
| `POST /api/queue/[id]/call` | Dispara evento `call` al workflow. |
| `POST /api/queue/[id]/seated` | Dispara evento `seated` al workflow. |

> El empleado **no** pasa por MCP. Tiene API auth tradicional. El MCP es para los agentes que hablan con el comensal.

### D. Persistencia y plumbing — 100% Vercel

- **Vercel Postgres (Neon):** tablas `reservations`, `reservation_events`, `employees`, `users` y `sessions` (estas últimas dos manejadas por el adapter de Auth.js).
- **Vercel KV (Upstash Redis):** pub/sub para los pushes en tiempo real al chatbot del comensal y al panel del empleado. El workflow publica eventos en canales `reservation:<id>` y `queue:active`; los Route Handlers SSE leen y reenvían a los clientes.
- **Vercel Edge Config:** parámetros configurables del restaurante (`no_show_timeout_min`, `followup_after_call_min`, `extension_min`, etc.) — se actualizan desde el dashboard de Vercel **sin redeploy**.
- **Auth.js** (ex NextAuth) con email magic-link y adapter de Vercel Postgres. Cero costo, suficiente para 1 rol.

---

## 3. Modelo de datos (Vercel Postgres)

```sql
-- reservations
id                       uuid pk
name                     text not null
email                    text not null
phone                    text not null
party_size               int  not null
status                   text check (status in ('waiting','called','seated','no_show','cancelled'))
position                 int                  -- computed/cached
estimated_wait_min       int                  -- ETA cacheada
no_show_timeout_min      int  default 10
no_show_deadline         timestamptz
extension_count          int  default 0
created_at               timestamptz default now()
called_at                timestamptz
ended_at                 timestamptz
workflow_run_id          text                 -- referencia a la instancia WDK
session_token            text unique          -- cookie 24h del comensal
session_expires_at       timestamptz

-- reservation_events (audit log)
id                       uuid pk
reservation_id           uuid fk
event_type               text  -- 'created' | 'called' | 'extended' | 'cancelled' | 'seated' | 'no_show_auto' | 'no_show_manual' | 'followup_sent'
actor                    text  -- 'diner' | 'employee:<id>' | 'system'
payload                  jsonb
created_at               timestamptz default now()

-- employees (vinculados a la tabla users de Auth.js)
id                       uuid pk
user_id                  uuid fk -- referencia a users(id) (tabla de Auth.js)
email                    text
role                     text check (role in ('maitre','admin'))
restaurant_id            uuid

-- users / accounts / sessions / verification_tokens
-- Las crea automáticamente el adapter de Auth.js para Vercel Postgres
-- (no las definimos manualmente)
```

> Los **parámetros configurables** (no_show_timeout_min, followup_after_call_min, extension_min, session_ttl_hours) viven en **Vercel Edge Config**, NO en una tabla. Se actualizan desde el dashboard de Vercel sin redeploy y se leen con `@vercel/edge-config` desde los workflows y desde los Route Handlers.

---

## 4. Flujo del workflow WDK

Una instancia de `reservationWorkflow` por cada reserva. Vive desde el alta hasta el cierre.

```
reservationWorkflow(reservationId):

  // === FASE EN ESPERA ===
  1. step: load reservation, status = 'waiting', persist session_token + cookie hint
  2. step: compute position + ETA (DurableAgent estimator)
  3. loop while status === 'waiting':
       event = waitForEvent(['call', 'cancel', 'recompute'], { timeout: 30s })
       if 'call':       break to 4
       if 'cancel':     status='cancelled'; goto end
       if 'recompute' or timeout: re-run step 2

  // === FASE LLAMADO (mesa lista) ===
  4. step: status='called', called_at=now,
           no_show_deadline = now + no_show_timeout_min,
           push notification to diner channel ("TU MESA ESTÁ LISTA")

  // Pre-follow-up: 1 min para una respuesta temprana
  5. event = waitForEvent(
       ['seated','extend','cancel','no_show_manual'],
       { timeout: followup_after_call_min }
     )
     if 'seated':         status='seated'; goto end
     if 'no_show_manual': status='no_show'; goto end-no-show
     if 'cancel':         status='cancelled'; goto end
     if 'extend':         no_show_deadline += extension_min; goto 7   // ya respondió, no follow-up
     if timeout (sin interacciones): goto 6

  // === FOLLOW-UP PROACTIVO ===
  6. step: push follow-up to diner channel:
        "¿Estás en camino? [Pedir más tiempo] [Cancelar]"
        log event 'followup_sent'

  // === LOOP FINAL hasta resolución ===
  7. loop while status === 'called':
       event = waitForEvent(
         ['seated','extend','cancel','no_show_manual'],
         { timeout: time_until_no_show_deadline }
       )
       if 'seated':         status='seated'; goto end
       if 'extend':         no_show_deadline += extension_min; extension_count++; continue loop
       if 'cancel':         status='cancelled'; goto end
       if 'no_show_manual': status='no_show'; goto end-no-show
       if timeout:          status='no_show'; goto end-no-show

  end-no-show:
     step: push notification to diner ("Marcamos tu reserva como no-show porque no llegamos a verte")
     // ticket sale de la lista activa, queda en /queue/history

  end:
     step: persist final status, ended_at=now, archive ticket
```

**Por qué este shape vende WDK:**

- El workflow está suspendido la mayor parte del tiempo (esperando humanos / timers). Cero CPU consumida.
- Sobrevive deploys/crashes — el "money shot" de la demo.
- Los timers son `waitForEvent` con timeout (no cron jobs).
- Idempotencia gratis en cada step.

---

## 5. Tools del MCP server (firmas)

```ts
// Tool: create_reservation
input:  { name: string, email: string, phone: string, party_size: int }
output: { reservation_id, position, eta_min, session_token }

// Tool: get_reservation_status
input:  { reservation_id }
output: { status, position, eta_min, no_show_deadline?, extension_count }

// Tool: extend_wait
input:  { reservation_id }
output: { new_no_show_deadline, extension_count }
errors: 'not_in_called_state' | 'max_extensions_reached'

// Tool: cancel_reservation
input:  { reservation_id }
output: { ok: true }
errors: 'already_finalized'
```

Cada tool valida el `reservation_id` contra el `session_token` (la cookie del comensal) o contra una API key del chatbot — para que un comensal no pueda manipular la reserva de otro.

---

## 6. Acciones detalladas (revisadas)

### 6.1 Crear reserva (comensal vía chatbot)

- El comensal abre la web → chatbot saluda → recolecta nombre, email, teléfono, cantidad de personas.
- Al tener todo, el LLM llama a `create_reservation` (MCP).
- Backend: crea row en Vercel Postgres, lanza `reservationWorkflow`, genera `session_token`, devuelve datos.
- Frontend: setea cookie `reservation_session=<token>` (24 h) y muestra confirmación con posición y ETA.
- **Vuelta del comensal dentro de 24 h:** el frontend lee la cookie → llama `get_reservation_status` → el chatbot reanuda la conversación con contexto.

### 6.2 Llamar al comensal (empleado)

- Empleado toca "Llamar" en `/queue`.
- API privada `POST /api/queue/[id]/call` → emite evento `call` al workflow.
- Workflow pasa a `called`, fija `no_show_deadline`, dispara push al canal del comensal.
- En el chatbot del comensal aparece el mensaje "TU MESA ESTÁ LISTA".

### 6.3 Follow-up automático al minuto 1

- Si pasa `followup_after_call_min` (default 1) sin que el comensal responda y sin que el empleado lo marque presentado, el workflow envía un segundo push:
  *"¿Estás en camino? [Pedir más tiempo] [Cancelar]"*
- El comensal responde dentro del chat — el LLM mapea su intención a `extend_wait` o `cancel_reservation`.

### 6.4 Extender tiempo (comensal)

- Disparado por el comensal vía chatbot (tool `extend_wait`).
- Suma `extension_min` (default 5) al `no_show_deadline`.
- El loop final del workflow continúa con el nuevo timeout.
- Audit log + badge "extendido" en el panel del empleado.
- **Importante:** una vez `called`, el comensal está notificado. Si pidió más tiempo, no lo marcamos como `no_show` — sabemos que viene.

### 6.5 Cancelar (comensal)

- Disparado por el comensal vía chatbot (tool `cancel_reservation`).
- Workflow pasa a `cancelled`, ticket sale de la lista activa, va a historial.

### 6.6 Marcar presentado (empleado)

- Empleado toca "Marcar presentado" en `/queue` cuando el comensal llega.
- API privada `POST /api/queue/[id]/seated` → emite evento `seated` al workflow.
- Workflow pasa a `seated`, ticket sale de la lista activa, va a historial.

### 6.7 No-show automático

- Si vence `no_show_deadline` (después de `no_show_timeout_min` + extensiones acumuladas) sin que llegue ningún evento, el workflow:
  - Marca status `no_show`.
  - Envía notificación al comensal: *"Marcamos tu reserva como no-show porque no llegamos a verte."*
  - Mueve el ticket a `/queue/history`.
- No requiere acción del empleado ni cron — el `waitForEvent` con timeout lo resuelve solo.

---

## 7. Sesión del comensal (cookie 24 h)

- **Cookie:** `reservation_session`, HTTPOnly, Secure, SameSite=Lax, expira en 24 h.
- **Valor:** `session_token` (UUID v4 random, persistido en `reservations.session_token`).
- **Lookup:** `session_token` → `reservation_id`.
- **Vencimiento:** la cookie expira a las 24 h. Si el comensal vuelve después y la reserva sigue activa, el chat lo trata como nuevo (el caso es muy borde porque el flujo entero de espera dura horas, no días).
- **Privacidad:** las tools MCP que actúan sobre una reserva validan que el `session_token` provisto por el frontend coincida con el de la DB para esa `reservation_id`.

---

## 8. Stack final — 100% nativo Vercel

| Capa | Tecnología | Motivación |
|---|---|---|
| Hosting + framework | **Vercel** + Next.js 15 (App Router) | Base del hackathon |
| Workflows durables | **Vercel Workflow (WDK)** — `@vercel/workflow` + `@workflow/ai/agent` | **Track 1** |
| MCP Server | **MCP en Vercel** (`@vercel/mcp-adapter`, hosteado en el mismo proyecto) | **Track 2** |
| LLM | **AI SDK** + **AI Gateway** (modelo: `anthropic/claude-sonnet-4-6`) | Pro tip hackathon |
| Chatbot UI | AI SDK `useChat` + shadcn/ui | UX rápida y limpia |
| DB | **Vercel Postgres** (powered by Neon) | Marketplace nativo, `POSTGRES_URL` auto |
| Cache / pub-sub | **Vercel KV** (powered by Upstash Redis) | Marketplace nativo, ideal para SSE fan-out |
| Config dinámica | **Vercel Edge Config** | Cambios de parámetros sin redeploy — **demo gold** |
| Auth empleados | **Auth.js** + adapter Vercel Postgres (email magic-link) | Open source, deploya en Vercel |
| Realtime | **SSE** desde Route Handlers de Next.js + Vercel KV pub/sub | Cero dependencia externa |
| UI | **v0** + shadcn/ui + Tailwind | **Track 2** + look pro rápido |
| Analytics (bonus) | **Vercel Analytics** + **Speed Insights** | Polish gratis |
| Repo | GitHub público | Requisito hackathon |

**Variables de entorno auto-provisionadas al hacer `vercel link` + provisión de los servicios:**

- `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`
- `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`
- `EDGE_CONFIG`
- `AI_GATEWAY_API_KEY`

Cero credenciales de terceros que setear manualmente.

---

## 9. Parámetros configurables (Vercel Edge Config)

Todos viven en Edge Config. Se editan desde el dashboard de Vercel; los workflows y handlers los leen con `get('key')` de `@vercel/edge-config`. Sin redeploy, sin migración, sin DB write.

| Parámetro | Default | Comentario |
|---|---|---|
| `no_show_timeout_min` | 10 min | Tiempo desde `called` hasta auto `no_show` |
| `followup_after_call_min` | 1 min | Cuándo se manda el follow-up proactivo |
| `extension_min` | 5 min | Cuánto suma cada `extend_wait` |
| `max_extensions_per_ticket` | 3 | Máximo de extensiones acumuladas |
| `session_ttl_hours` | 24 h | Vida de la cookie del comensal |
| `eta_recompute_interval_sec` | 30 | Refresh del estimador en `waiting` |
| `colors_by_party_size` | `{1-2: gray, 3-4: green, 5-6: yellow, 7+: blue}` | Colores del panel |

**Demo bonus:** durante el video, abrir el dashboard de Vercel y bajar `no_show_timeout_min` de 10 a 2 minutos en vivo → el workflow lo respeta sin reiniciar.

---

## 10. Casos de uso para la demo (video 90 s)

1. **Alta conversacional:** el comensal abre la web → chatbot lo saluda → conversa naturalmente y se anota → ve confirmación. (Demuestra: chatbot + MCP + tool-calling + AI Gateway.)
2. **Vuelta con cookie:** cierra la pestaña, vuelve a abrir 5 min después → el chatbot lo reconoce con su estado actual. (Demuestra: persistencia de sesión + MCP get_status.)
3. **Llamado + extensión proactiva:** maître toca "Llamar" en su panel → comensal recibe "MESA LISTA" vía SSE → al minuto 1 le aparece el follow-up → el comensal escribe "voy llegando, dame 5 más" → el LLM mapea a `extend_wait`. (Demuestra: agente conversacional + workflow durable + UX humana.)
4. **No-show automático:** otro ticket llamado nunca responde → vence el timer → el workflow lo marca solo como `no_show` y le manda mensaje al comensal → cae al historial. (Demuestra: durabilidad de WDK sin cron.)
5. **Edge Config en vivo (bonus):** abrir dashboard de Vercel → cambiar `no_show_timeout_min` de 10 a 2 → el siguiente ticket llamado respeta el nuevo valor sin redeploy. (Demuestra: dominio del stack Vercel.)
6. **🎬 Money shot — deploy en vivo:** con 3 reservas vivas y una llamada, hacer `git push`. Tras el deploy, todos los tickets siguen vivos, los timers no se desfasaron, la cola se reanuda. (Demuestra: durabilidad real, único de WDK.)

---

## 11. Definition of Done del MVP

- [ ] **Chatbot embed funcional** en `/`: alta conversacional + status + extend + cancel.
- [ ] **MCP server desplegado** con las 4 tools del comensal, accesible públicamente.
- [ ] **Cookie de sesión 24 h** funcionando (alta + vuelta + estado correcto).
- [ ] **Persistencia en Vercel Postgres** con todas las tablas (`reservations`, `reservation_events`, `employees`, + las de Auth.js).
- [ ] **Vercel KV** provisto y conectado para pub/sub de eventos.
- [ ] **Vercel Edge Config** con todos los parámetros y leído desde workflows + handlers.
- [ ] **SSE** funcional desde Route Handlers para chatbot del comensal y panel del empleado.
- [ ] **Workflow WDK** por reserva, cubriendo el ciclo de vida completo (`waiting → called → seated|no_show|cancelled`) con rama `extend` y follow-up al minuto 1.
- [ ] **No-show automático** notifica al comensal y mueve a historial.
- [ ] **Panel del empleado** (`/queue`) con auth **Auth.js**, lista cronológica más antiguas primero, botones "Llamar" y "Marcar presentado".
- [ ] **`/queue/history`** con reservas cerradas del día.
- [ ] **DurableAgent** estimando ETA (mínimo en `create_reservation` y `get_reservation_status`).
- [ ] Deploy en Vercel + URL pública + repo público.
- [ ] Video demo de 90 s con los 6 casos de uso.

---

## 12. Notas para discutir antes de arrancar

1. **MCP en Vercel:** confirmar el adapter/template oficial — los docs apuntan a `vercel.com/docs/mcp/deploy-mcp-servers-to-vercel`. Vale la pena clonar el template antes de escribir lógica.
2. **Vercel Postgres + WDK:** los workflows leen/escriben con `@vercel/postgres` directo (Postgres puro). Sin RLS, sin clientes intermedios.
3. **Auth.js minimalista:** un solo proveedor (email magic-link) y una sola tabla extra (`employees` con role). El seed inicial puede ser un script `scripts/seed-employee.ts` que se corre 1 vez.
4. **SSE y serverless:** las funciones serverless de Vercel tienen un timeout (típicamente 5 min en hobby, hasta 15 min en pro). Para el hackathon es suficiente — la pestaña del chatbot se reconecta sola si el stream se corta. Documentar esto.
5. **Pub/sub con Vercel KV:** Upstash Redis soporta pub/sub. El workflow hace `KV.publish('reservation:<id>', event)` y el handler SSE hace `KV.subscribe`. Alternativa más simple: usar `LIST` con `LPUSH` + `BLPOP`.
6. **¿Qué pasa si la pestaña está cerrada cuando lo llaman?** Hoy no recibe el push. El follow-up en WhatsApp resolvería esto en producción; en hackathon vale aclararlo en el video. (Opción nice-to-have: web push notification con Vercel + service worker, suma complejidad.)
7. **Identidad del MCP caller:** además del `session_token`, sumar una API key del chatbot para que solo nuestros frontends/clientes autorizados puedan crear reservas (evita abuso público del MCP).
8. **Migración futura a stack del cliente:** si post-hackathon el cliente prefiere Supabase, el cambio es acotado: `POSTGRES_URL` apunta a Supabase, se desinstala `@vercel/edge-config` y los parámetros se mueven a una tabla, y el pub/sub se reemplaza por Supabase Realtime. El core (WDK + MCP server + chatbot) queda intacto.

---

## 13. Runbook de inicialización guiada para Claude Code

> Esta sección está pensada para que **Claude Code (con acceso a tu Vercel)** te lleve fase por fase. Cada fase tiene: qué hace el agente, qué necesita de vos, y cómo verificar antes de avanzar. El agente debe **detenerse al final de cada fase** y esperar tu OK explícito antes de seguir.

### Fase 0 — Pre-requisitos humanos (~10 min)

Antes de iniciar la sesión con Claude Code, dejá listo lo siguiente:

| # | Item | Cómo conseguirlo | Variable / archivo |
|---|---|---|---|
| 0.1 | **Vercel Personal Access Token** (full scope) | Dashboard Vercel → Settings → Tokens → Create | `VERCEL_TOKEN` |
| 0.2 | **GitHub CLI autenticado** | `gh auth login` (una vez) | `gh auth status` debe decir OK |
| 0.3 | **AI Gateway API Key** | Dashboard Vercel → AI Gateway → Create Key | `AI_GATEWAY_API_KEY` |
| 0.4 | **Resend API Key** (para magic-link de Auth.js) | resend.com → API Keys → Create. Verificar dominio remitente o usar `onboarding@resend.dev` para dev | `RESEND_API_KEY` |
| 0.5 | **Vercel MCP server agregado a Claude Code** | `claude mcp add vercel <endpoint oficial>` (ver `vercel.com/docs/agent-resources/vercel-mcp`) | — |
| 0.6 | **Skill de Vercel/WDK** instalado en Claude Code | `npx skills add vercel/wdk` (validar nombre actual) | — |
| 0.7 | **Una cuenta de Vercel + GitHub asociadas** | Dashboard Vercel → Settings → Login Connections | — |

**Verificación de Fase 0:** abrir una terminal y correr:
```bash
echo $VERCEL_TOKEN | head -c 5     # debe mostrar 5 caracteres del token
gh auth status                      # OK
echo $AI_GATEWAY_API_KEY | head -c 5
echo $RESEND_API_KEY | head -c 5
```

→ ✅ Si todo responde, OK para arrancar la sesión.

---

### Prompt inicial para Claude Code

Pegale esto al iniciar la sesión:

> Vamos a construir el proyecto descripto en `scope_hackathon_mvp.md`. Trabajá fase por fase según la sección 13 (Runbook). Reglas:
> 1. Al **inicio** de cada fase, mostrame un resumen de lo que vas a hacer.
> 2. Al **final** de cada fase, mostrame el resultado y los comandos de verificación. **Esperá mi OK explícito antes de pasar a la siguiente fase.**
> 3. Si necesitás un click humano que no podés automatizar, pausá y avisame con un mensaje claro: "ACCIÓN MANUAL: ..." y los pasos exactos.
> 4. Si te trabás con un error, no inventes — pausá, mostrame el error y proponé 1-2 hipótesis.
> 5. Hacé `git commit` al final de cada feature funcional con mensajes descriptivos.
> 6. Hacé `vercel deploy` al final de cada fase que cambie infra o que valga la pena ver corriendo.
> Empezá por Fase 1. Antes, confirmá que tenés acceso a todas las variables de Fase 0.

---

### Fase 1 — Scaffolding del proyecto (~10 min)

**Hace el agente:**
- `npx create-next-app@latest restaurant-queue --typescript --tailwind --app --no-src-dir`
- `cd restaurant-queue`
- `git init && git add . && git commit -m "chore: initial scaffold"`
- `gh repo create restaurant-queue --public --source=. --push`
- Instalar dependencias base: `npm i @vercel/postgres @vercel/kv @vercel/edge-config ai @ai-sdk/react @ai-sdk/anthropic next-auth @auth/pg-adapter zod`
- Instalar dev deps: shadcn/ui CLI, drizzle (opcional), tsx
- `npx workflow@latest` para WDK + wrap `next.config.ts` con `withWorkflow`
- `npx shadcn@latest init` con tema neutro
- Crear estructura de carpetas: `app/`, `lib/`, `lib/db/`, `lib/workflows/`, `lib/mcp/`, `components/`

**Te toca:** nada (todo CLI).

**Verificación:**
- `git log` muestra el commit inicial.
- Repo en GitHub accesible.
- `npm run dev` levanta en `localhost:3000` con la home de Next.js default.
- `next.config.ts` envuelto con `withWorkflow`.

→ Esperar tu OK.

---

### Fase 2 — Linkeo a Vercel + provisión de storage (~10 min)

**Hace el agente:**
- `vercel link` con el `VERCEL_TOKEN` (no interactivo).
- Vía **Vercel MCP**: crear el proyecto en Vercel si no existe, asociarlo al repo de GitHub para auto-deploys.
- Vía **Vercel MCP / API**:
  - Provisionar **Vercel Postgres** (Neon) → genera `POSTGRES_URL` etc.
  - Provisionar **Vercel KV** (Upstash) → genera `KV_URL` etc.
  - Crear **Vercel Edge Config** → genera `EDGE_CONFIG`.
- Setear env vars en preview + production: `AI_GATEWAY_API_KEY`, `RESEND_API_KEY`, `AUTH_SECRET` (generado), `MCP_API_KEY` (generado para autorizar el chatbot).
- `vercel env pull .env.local` para tener todo local.
- Primer `vercel deploy` (deploy vacío para tener URL pública desde ya).

**Te toca, posiblemente:**
- 🟡 **ACCIÓN MANUAL si aparece:** la primera integración del Marketplace puede pedir consent en el browser. El agente te debe avisar con el link exacto a clickear.

**Verificación:**
- `vercel env ls` muestra todas las vars en los 3 entornos.
- `cat .env.local` tiene `POSTGRES_URL`, `KV_URL`, `EDGE_CONFIG`, etc.
- Deploy URL pública responde 200.
- Dashboard de Vercel muestra los 3 productos provisionados (Postgres, KV, Edge Config).

→ Esperar tu OK.

---

### Fase 3 — Schema de DB + migraciones (~15 min)

**Hace el agente:**
- Crear `lib/db/schema.sql` con tablas `reservations`, `reservation_events`, `employees` + tablas de Auth.js (`users`, `accounts`, `sessions`, `verification_tokens`).
- Script `lib/db/migrate.ts` que corre el SQL contra `POSTGRES_URL`.
- Cliente Postgres tipado en `lib/db/client.ts`.
- `npm run db:migrate` corre la migración.
- Seed básico: `scripts/seed.ts` que inserta 1 empleado de prueba (con tu email de Fase 0).

**Te toca:** confirmarle al agente con qué email querés que cree el empleado seed.

**Verificación:**
- Conectarse a la DB con `vercel postgres connect` y `\dt` debe listar las tablas.
- `SELECT * FROM employees` devuelve tu fila.

→ Esperar tu OK.

---

### Fase 4 — Auth.js con magic-link (~20 min)

**Hace el agente:**
- Setup de `@auth/core` v5 con provider Email (Resend).
- Adapter `@auth/pg-adapter` apuntando a Vercel Postgres.
- Middleware que protege `/queue/*`.
- Página `/login` con form + `signIn('email', ...)`.
- Helper `getCurrentEmployee()` que valida sesión + devuelve la fila de `employees`.
- Deploy de prueba.

**Te toca:** probar el flujo end-to-end recibiendo el email del magic-link en tu inbox.

**Verificación:**
- Entrar a `<deploy-url>/login` → ingresar email → recibir mail → click en link → llegar a `/queue` autenticado.
- Si no estás en `employees`, debe rechazar el acceso.

→ Esperar tu OK.

---

### Fase 5 — MCP server + 4 tools del comensal (~30 min)

**Hace el agente:**
- `app/mcp/[transport]/route.ts` usando `@vercel/mcp-adapter`.
- Tools: `create_reservation`, `get_reservation_status`, `extend_wait`, `cancel_reservation`.
- Validación con Zod de cada input.
- Validación de identidad: header `X-MCP-API-Key` (chatbot) + `session_token` para acciones sobre reservas existentes.
- Las tools, por ahora, sólo escriben/leen DB — todavía no disparan el workflow (eso viene en Fase 6).
- Tests rápidos con `curl` o un script.

**Te toca:** nada.

**Verificación:**
- `curl -X POST <deploy-url>/mcp -H "X-MCP-API-Key: $MCP_API_KEY" ...` para `create_reservation` devuelve un `reservation_id`.
- `SELECT * FROM reservations` muestra la fila.
- `get_reservation_status` con el `session_token` devuelve el estado.

→ Esperar tu OK.

---

### Fase 6 — WDK workflows (~45 min) — ⚙️ corazón del Track 1

**Hace el agente:**
- `lib/workflows/reservationWorkflow.ts` con `"use workflow"`.
- Steps con `"use step"`: `loadReservation`, `computeETA`, `notifyDiner`, `persistStatus`.
- Implementar el flujo completo de la sección 4 del scope: waiting → called → seated/no_show/cancelled, con follow-up al minuto 1 y rama `extend`.
- Modificar las tools del MCP para que disparen / consulten el workflow.
- Endpoint privado para el panel: `POST /api/queue/[id]/call` y `seated`.
- Publicación de eventos a Vercel KV pub/sub desde los steps de notificación.

**Te toca:** nada (puede ser largo, pedile updates intermedios).

**Verificación:**
- Crear una reserva vía MCP → el workflow arranca (visible en el dashboard de Workflow en Vercel).
- Llamar a la reserva vía API privada → status pasa a `called`, deadline seteado.
- Si esperás el `no_show_timeout_min`, el ticket pasa solo a `no_show`.
- `vercel deploy` y repetir → los workflows en curso siguen vivos. **Acá ya tenés el money shot funcional.**

→ Esperar tu OK.

---

### Fase 7 — Edge Config para parámetros (~10 min)

**Hace el agente:**
- Poblar Edge Config con: `no_show_timeout_min: 10`, `followup_after_call_min: 1`, `extension_min: 5`, `max_extensions_per_ticket: 3`, `session_ttl_hours: 24`, `colors_by_party_size: {...}`.
- Helper `lib/config.ts` con `getConfig(key)` cacheado.
- Reemplazar literales en los workflows y handlers.

**Te toca:** confirmar los defaults (o pedirle ajustes).

**Verificación:**
- Cambiar `no_show_timeout_min` desde el dashboard de Vercel.
- Crear un nuevo ticket llamado → respeta el nuevo valor sin redeploy.

→ Esperar tu OK.

---

### Fase 8 — Frontend del comensal (chatbot embed) (~45 min)

**Hace el agente:**
- Página `/` con AI SDK `useChat` apuntando a `/api/chat`.
- Route `/api/chat` con `streamText`, modelo vía AI Gateway, system prompt del "host del restaurante".
- Tool-calling expuesto al LLM apuntando al MCP server (in-process).
- Cookie `reservation_session` (HTTPOnly, 24 h) seteada al volver `create_reservation`.
- Al cargar la página, si hay cookie válida → llama `get_reservation_status` y reanuda el contexto.
- SSE client (`EventSource`) escuchando `/api/events/[reservation_id]` para pushes proactivos del workflow.
- UI con shadcn/ui (cards de chat, banner de "MESA LISTA", quick replies para extend/cancel).

**Te toca:** revisar el system prompt del chatbot y dar feedback de tono. **Importante: probarlo con inputs raros** ("somos 4 o 5", "hola, tengo reserva pero no sé si llegamos", etc.).

**Verificación:**
- Abrir la página, registrar una reserva conversando, recibir confirmación.
- Cerrar pestaña, volver a abrir → el chatbot te reconoce con tu estado actual.
- Desde otra ventana, llamar a la reserva → la pestaña recibe el push y muestra "MESA LISTA".

→ Esperar tu OK.

---

### Fase 9 — Panel del empleado (~40 min)

**Hace el agente:**
- `/queue` (auth) — lista cronológica más antiguas primero, cards con colores por tamaño de grupo.
- Acciones por card: "Llamar" / "Marcar presentado".
- Suscripción SSE a `/api/events/queue` para refresh en vivo.
- Badge "extendido" cuando `extension_count > 0`.
- `/queue/history` — cerradas del día.

**Te toca:** revisar UX en móvil/tablet (es el form factor real del maître).

**Verificación:**
- Loguearse → ver la cola.
- Tocar "Llamar" → la pestaña del comensal recibe el push.
- Tocar "Marcar presentado" → el ticket sale de la lista activa, va a historial.

→ Esperar tu OK.

---

### Fase 10 — DurableAgent para ETA (~25 min)

**Hace el agente:**
- `lib/workflows/etaAgent.ts` con `DurableAgent` de `@workflow/ai/agent`.
- Tools del agente: `getActiveReservations`, `getHistoricalTurnoverMin`.
- Lo invocan `create_reservation` y `get_reservation_status` (con cache breve en KV).
- Devuelve `{ eta_min, confidence }`.

**Te toca:** nada.

**Verificación:**
- Crear varias reservas, ver que la ETA tiene sentido y varía con el load.

→ Esperar tu OK.

---

### Fase 11 — Hardening + deploy final (~30 min)

**Hace el agente:**
- Manejo de errores en MCP tools (responder con códigos claros).
- Idempotencia en `create_reservation` (dedupe por email + party_size dentro de 30 s).
- Rate limiting básico con KV (5 req/min por IP en `create_reservation`).
- README con: descripción, stack, cómo correr local, link al deploy, gif del flujo.
- Variables sensibles en `.env.local.example` documentadas.
- `vercel --prod`.
- Smoke test del deploy de producción.

**Te toca:** hacer el smoke test final como humano.

**Verificación:**
- Flujo completo en producción: registrar → llamar → extender → presentar.
- README se ve bien en GitHub.
- URL de producción estable.

→ Esperar tu OK.

---

### Fase 12 — Demo prep (~30 min, mayormente humano)

**Hace el agente:**
- Script `scripts/seed-demo.ts` que crea 3 reservas en distintos estados para empezar la grabación con la cola "viva".
- Documenta el guion del video en `DEMO.md`:
  - 0:00–0:15 — Alta conversacional (escenario 1)
  - 0:15–0:25 — Vuelta con cookie (escenario 2)
  - 0:25–0:50 — Llamado + extensión proactiva (escenario 3)
  - 0:50–1:05 — No-show automático (escenario 4)
  - 1:05–1:15 — Edge Config en vivo (escenario 5)
  - 1:15–1:30 — Money shot del deploy (escenario 6)

**Te toca:**
- Grabar el video (Loom, ScreenStudio, OBS).
- Submit al hackathon: URL de deploy + repo + video.

**Verificación final — Definition of Done de Sección 11.**

---

### Tabla resumen de tiempo

| Fase | Tiempo agente | Tiempo humano |
|---|---|---|
| 0 — Pre-requisitos | — | 10 min |
| 1 — Scaffolding | 10 min | 0 |
| 2 — Vercel + storage | 10 min | 0–5 min (consent) |
| 3 — Schema + migraciones | 15 min | 1 min |
| 4 — Auth.js | 20 min | 5 min (test) |
| 5 — MCP server | 30 min | 0 |
| 6 — WDK workflows | 45 min | 5 min (verificación) |
| 7 — Edge Config | 10 min | 1 min |
| 8 — Chatbot del comensal | 45 min | 15 min (UX review) |
| 9 — Panel del empleado | 40 min | 10 min (UX review) |
| 10 — DurableAgent ETA | 25 min | 0 |
| 11 — Hardening + prod | 30 min | 10 min (smoke) |
| 12 — Demo prep | 15 min | 30 min (grabar + submit) |
| **Total** | **~5h 15m** | **~1h 30m** |

Suficiente margen para 48 h de hackathon, dejando tiempo para imprevistos y polish.
