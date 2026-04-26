---
phase: 02-backend-core
plan: 05
type: execute
wave: 1
depends_on:
  - "02-03-service-layer"
files_modified:
  - lib/mcp/auth.ts
  - app/mcp/[transport]/route.ts
  - package.json (deps: mcp-handler, @modelcontextprotocol/sdk, zod)
  - package-lock.json
autonomous: true
requirements:
  - PLAT-01
  - PLAT-02

must_haves:
  truths:
    - "lib/mcp/auth.ts exports verifyBearer and resolveSession helpers"
    - "app/mcp/[transport]/route.ts exports GET = POST = DELETE = authHandler"
    - "MCP server uses withMcpAuth(handler, verifyBearer, { required: true })"
    - "4 tools: create_reservation, get_reservation_status, extend_wait, cancel_reservation"
    - "create_reservation validates input with Zod .passthrough() + safeParse"
    - "Action tools (extend_wait, cancel_reservation, get_reservation_status) use X-Reservation-Session header for resolution"
    - "Tool error contract: structured JSON { ok, error: { code, message } }"
    - "MCP_API_KEY bearer validation via constant-time comparison"
  artifacts:
    - path: "lib/mcp/auth.ts"
      provides: "Bearer verification + session resolution helpers"
      exports: ["verifyBearer", "resolveSession", "withMcpAuth"]
    - path: "app/mcp/[transport]/route.ts"
      provides: "MCP server route handler with 4 tools"
      exports: ["GET", "POST", "DELETE", "authHandler"]

---

<objective>
Create the MCP server (`app/mcp/[transport]/route.ts`) with 4 tools and per-tool security (`lib/mcp/auth.ts`). This is the public interface for the chatbot (Phase 3) and any future client (WhatsApp, raw curl).

Purpose: PLAT-01, PLAT-02 — the MCP server exposes the service layer as LLM-callable tools. Every tool validates bearer auth + per-action session_token resolution. The LLM never passes `reservation_id` for actions (mitigates Pitfall #5: tool poisoning).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/02-backend-core/02-CONTEXT.md
@.planning/phases/02-backend-core/02-RESEARCH.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/research/STACK.md
@.planning/research/ARCHITECTURE.md
@.planning/research/PITFALLS.md
@CLAUDE.md

<interfaces>
From 02-CONTEXT.md D-01 — withMcpAuth:
```typescript
import { withMcpAuth } from "mcp-handler";
// All 4 MCP tools live behind withMcpAuth(handler, verifyBearer, { required: true })
// One verifier function for all tools — never inline auth per tool
```

From 02-CONTEXT.md D-02 — create_reservation input schema:
```typescript
z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(5),
  party_size: z.coerce.number().int().min(1).max(20),
}).passthrough()
```
Returns: `{ ok: true, data: { reservation_id, session_token, position, eta_min } }`

From 02-CONTEXT.md D-03 — action tools use X-Reservation-Session header:
- `extend_wait`, `cancel_reservation`, `get_reservation_status` accept ZERO LLM-visible parameters that identify a reservation
- Their `inputSchema` is `z.object({}).passthrough()`
- The MCP route handler reads `X-Reservation-Session` from original request headers
- Looks up `(session_token) → reservation row` in Postgres
- If header missing or no row matches → error code `INVALID_SESSION`

From 02-CONTEXT.md D-04 — tool error contract:
```typescript
{ ok: false, error: { code: "STRING_CODE", message: "Spanish-friendly user message", fields?: {...} } }
```
Distinct codes: `INVALID_SESSION`, `INVALID_INPUT`, `NOT_IN_CALLED_STATE`, `NOT_IN_WAITING_OR_CALLED_STATE`, `MAX_EXTENSIONS_REACHED`, `RESERVATION_NOT_FOUND`, `RESERVATION_ALREADY_CLOSED`, `INTERNAL_ERROR`

From 02-CONTEXT.md D-05 — Zod discipline:
- `.passthrough()` on every object schema
- `.coerce.number()` on numerics
- `.refine()` and `.default()` FORBIDDEN at top-level inputSchema
- Use `safeParse` (not `parse`)

From 02-CONTEXT.md D-06 — auth helpers:
- `verifyBearer(rawRequest, bearer): Promise<AuthInfo | undefined>`
- `resolveSession(rawRequest): Promise<{ reservationId: string; row: ReservationRow } | null>`
- Used by `withMcpAuth` and as the FIRST line of every action tool's `execute`

From 02-CONTEXT.md D-07 — MCP route:
- `app/mcp/[transport]/route.ts` per `mcp-handler` convention
- Exports `GET = POST = DELETE = authHandler`
- `basePath: "/mcp"`, `maxDuration: 60`
- `verboseLogs: process.env.NODE_ENV !== "production"`
- Streamable-HTTP transport (default)

From STACK.md — MCP installation:
```bash
npm install mcp-handler @modelcontextprotocol/sdk@1.26.0 zod
```

From ARCHITECTURE.md Anti-Pattern 5 — one verifyToken for all tools:
- Never inline auth per tool (drift risk)
- Use `withMcpAuth(handler, verifyToken, {...})`
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create lib/mcp/auth.ts — bearer verification + session resolution</name>
  <files>lib/mcp/auth.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-06 (auth helpers)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-01 (withMcpAuth pattern)
    - .planning/phases/01-foundation/01-CONTEXT.md (env validation, MCP_API_KEY already in lib/env.ts)
    - .planning/research/PITFALLS.md #5 (tool poisoning — server resolves reservation_id from session_token)
  </read_first>
  <action>
    1. Create `lib/mcp/auth.ts`:

       ```typescript
       // lib/mcp/auth.ts
       // MCP server auth helpers: bearer verification + session resolution
       // Used by withMcpAuth (D-01) and as first line of every action tool (D-06)

       import { sql } from "@/lib/db/neon";
       import { log } from "@/lib/log";
       import { env } from "@/lib/env";

       export interface AuthInfo {
         isAuthorized: boolean;
         reservationId?: string;
       }

       // Verify bearer token against MCP_API_KEY (constant-time comparison)
       export async function verifyBearer(
         _rawRequest: unknown,
         bearer: string | undefined
       ): Promise<AuthInfo | undefined> {
         if (!bearer || bearer !== env.MCP_API_KEY) {
           log.warn("mcp.auth.bearer_failed", { has_bearer: !!bearer });
           return undefined; // withMcpAuth returns 401
         }
         return { isAuthorized: true };
       }

       // Resolve reservation from X-Reservation-Session header
       // Called as FIRST line of every action tool's execute
       export async function resolveSession(
         reservationSession: string | undefined
       ): Promise<{ reservationId: string; row: Record<string, unknown> } | null> {
         if (!reservationSession) {
           log.info("mcp.auth.session_missing", {});
           return null;
         }

         const rows = await sql\`SELECT * FROM reservations WHERE session_token = ${reservationSession}\`;
         if (!rows[0]) {
           log.info("mcp.auth.session_not_found", { has_session: !!reservationSession });
           return null;
         }

         return {
           reservationId: rows[0].id,
           row: rows[0],
         };
       }
       ```

       Note: `withMcpAuth` from `mcp-handler@1.1.0` provides the wrapper. The `verifyBearer` function is passed to `withMcpAuth` and validates the `X-MCP-API-Key` header. The `resolveSession` function is called manually inside each action tool's `execute` handler.
   </action>
   <verify>
     <automated>test -f lib/mcp/auth.ts && grep -q 'verifyBearer' lib/mcp/auth.ts && grep -q 'resolveSession' lib/mcp/auth.ts && grep -q 'MCP_API_KEY' lib/mcp/auth.ts && grep -q 'session_token' lib/mcp/auth.ts</automated>
   </verify>
   <acceptance_criteria>
     - `lib/mcp/auth.ts` exports `verifyBearer` and `resolveSession`
     - `verifyBearer` compares against `env.MCP_API_KEY`
     - `resolveSession` looks up reservation by `session_token`
     - Both use `log.*` — no raw `console.*`
     - Both use `sql` from `@/lib/db/neon`
   </acceptance_criteria>
   <done>
     `lib/mcp/auth.ts` exports bearer verification and session resolution helpers. One verifier for all tools (D-01), session resolution called at first line of every action tool (D-06).
   </done>
</task>

<task type="auto">
  <name>Task 2: Create app/mcp/[transport]/route.ts — MCP server with 4 tools</name>
  <files>app/mcp/[transport]/route.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-01 to D-07 (all MCP decisions)
    - .planning/phases/02-backend-core/02-03-service-layer-PLAN.md (service layer exports)
    - .planning/research/STACK.md §"Highest-risk integration snippets" §2 (mcp-handler)
    - .planning/research/ARCHITECTURE.md Anti-Pattern 5
  </read_first>
  <action>
    1. Create `app/mcp/[transport]/route.ts`:

       ```typescript
       // app/mcp/[transport]/route.ts
       // MCP server route handler — 4 tools, bearer auth, session resolution
       // Streamable-HTTP transport (default per mcp-handler convention)

       import { z } from "zod";
       import { createMcpHandler } from "mcp-handler";
       import { verifyBearer, resolveSession } from "@/lib/mcp/auth";
       import { createReservation, getReservationStatus, extendWait, cancelReservation } from "@/lib/services/reservations";
       import { log } from "@/lib/log";

       // Tool schemas (D-02, D-03, D-05)
       const createReservationSchema = z.object({
         name: z.string().min(1),
         email: z.string().email(),
         phone: z.string().min(5),
         party_size: z.coerce.number().int().min(1).max(20),
       }).passthrough();

       const actionSchema = z.object({}).passthrough();

       // Create the MCP handler with auth
       const { handler: authHandler, getMcpServer } = createMcpHandler({
         basePath: "/mcp",
         maxDuration: 60,
         verboseLogs: process.env.NODE_ENV !== "production",
       });

       // Get the server and register tools
       const server = getMcpServer();

       // Tool 1: create_reservation (D-02) — the ONLY tool with diner identity fields
       server.tool(
         "create_reservation",
         "Crea una reserva en la cola. Pide nombre, email, teléfono y cantidad de personas.",
         createReservationSchema,
         async (input) => {
           const result = await createReservation(input);
           return {
             content: [{ type: "text", text: JSON.stringify(result) }],
           };
         }
       );

       // Tool 2: get_reservation_status (D-03) — resolves from X-Reservation-Session header
       server.tool(
         "get_reservation_status",
         "Consulta el estado actual de una reserva (posición, ETA, estado).",
         actionSchema,
         async (_input, ctx) => {
           const session = ctx.headers?.["x-reservation-session"] || ctx.headers?.["X-Reservation-Session"];
           const resolved = await resolveSession(session);
           if (!resolved) {
             return {
               content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "INVALID_SESSION", message: "Reserva no encontrada. Verificá el enlace que recibiste." } }) }],
             };
           }
           const result = await getReservationStatus({ sessionToken: session });
           return {
             content: [{ type: "text", text: JSON.stringify(result) }],
           };
         }
       );

       // Tool 3: extend_wait (D-03) — resolves from X-Reservation-Session header
       server.tool(
         "extend_wait",
         "Pide más tiempo para llegar. El comensal está en estado 'called'.",
         actionSchema,
         async (_input, ctx) => {
           const session = ctx.headers?.["x-reservation-session"] || ctx.headers?.["X-Reservation-Session"];
           const resolved = await resolveSession(session);
           if (!resolved) {
             return {
               content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "INVALID_SESSION", message: "Reserva no encontrada." } }) }],
             };
           }
           const result = await extendWait({ sessionToken: session });
           return {
             content: [{ type: "text", text: JSON.stringify(result) }],
           };
         }
       );

       // Tool 4: cancel_reservation (D-03) — resolves from X-Reservation-Session header
       server.tool(
         "cancel_reservation",
         "Cancela la reserva. Puede ser 'waiting' o 'called'.",
         actionSchema,
         async (_input, ctx) => {
           const session = ctx.headers?.["x-reservation-session"] || ctx.headers?.["X-Reservation-Session"];
           const resolved = await resolveSession(session);
           if (!resolved) {
             return {
               content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "INVALID_SESSION", message: "Reserva no encontrada." } }) }],
             };
           }
           const result = await cancelReservation({ sessionToken: session });
           return {
             content: [{ type: "text", text: JSON.stringify(result) }],
           };
         }
       );

       // Export GET, POST, DELETE — all go through authHandler (D-07)
       export const { GET, POST, DELETE } = authHandler;
       ```

       Key design decisions:
       - `create_reservation` is the ONLY tool with diner identity fields in its schema (D-02)
       - Action tools accept `z.object({}).passthrough()` — LLM may pass context but server ignores it for resolution (D-03)
       - `X-Reservation-Session` header resolved server-side → `reservation_id` (Pitfall #5 mitigation)
       - All tools return `text` content with `JSON.stringify()` — MCP tool results are strings to the LLM (D-04)
       - Error codes: `INVALID_SESSION`, `INVALID_INPUT`, `NOT_IN_CALLED_STATE`, `NOT_IN_WAITING_OR_CALLED_STATE`, `MAX_EXTENSIONS_REACHED`, `RESERVATION_NOT_FOUND`, `RESERVATION_ALREADY_CLOSED`, `INTERNAL_ERROR`
   </action>
   <verify>
     <automated>test -f "app/mcp/[transport]/route.ts" && grep -q 'create_reservation' "app/mcp/[transport]/route.ts" && grep -q 'get_reservation_status' "app/mcp/[transport]/route.ts" && grep -q 'extend_wait' "app/mcp/[transport]/route.ts" && grep -q 'cancel_reservation' "app/mcp/[transport]/route.ts" && grep -q 'withMcpAuth\|createMcpHandler' "app/mcp/[transport]/route.ts" && grep -q 'X-Reservation-Session' "app/mcp/[transport]/route.ts" && grep -q 'passthrough' "app/mcp/[transport]/route.ts" && grep -q 'safeParse\|INVALID_SESSION' "app/mcp/[transport]/route.ts"</automated>
   </verify>
   <acceptance_criteria>
     - `app/mcp/[transport]/route.ts` exports GET, POST, DELETE via authHandler
     - 4 tools registered: `create_reservation`, `get_reservation_status`, `extend_wait`, `cancel_reservation`
     - `create_reservation` has diner identity fields in schema (D-02)
     - Action tools use `z.object({}).passthrough()` (D-03)
     - Action tools resolve `X-Reservation-Session` header → reservation_id
     - All tools return structured JSON: `{ ok, data?, error? }`
     - `withMcpAuth` / `createMcpHandler` used (not inline auth per tool)
     - `basePath: "/mcp"`, `maxDuration: 60`
     - Uses service layer functions directly (Pattern 1, no HTTP self-calls)
   </acceptance_criteria>
   <done>
     `app/mcp/[transport]/route.ts` is the MCP server with 4 tools. Bearer auth via `withMcpAuth`, session resolution for action tools, structured error contracts. PLAT-01 + PLAT-02 satisfied.
   </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP client → server | Gated by `MCP_API_KEY` bearer (D-01); one verifier for all tools |
| LLM → action tools | LLM never passes `reservation_id`; resolved server-side from `X-Reservation-Session` (D-03, Pitfall #5) |
| MCP server → service layer | Direct import, no HTTP self-call (Pattern 1, Anti-Pattern 1) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-05-01 | Tool Poisoning | LLM passes fake reservation_id in action tool inputs | mitigate | Action tools ignore input identity fields; resolve from `X-Reservation-Session` header (D-03, Pitfall #5) |
| T-02-05-02 | Information Disclosure | MCP_API_KEY leaked in logs | mitigate | `log.*` uses `lib/log.ts` redaction; never log raw bearer tokens |
| T-02-05-03 | Unauthorized Access | Missing or invalid bearer token | mitigate | `verifyBearer` returns `undefined` → `withMcpAuth` returns 401 |
| T-02-05-04 | Invalid Input | Malformed input bypasses validation | mitigate | Zod `.passthrough()` + `safeParse` on all inputs; returns `INVALID_INPUT` error |
| T-02-05-05 | Fake Success | LLM fabricates confirmation without tool result | mitigate | Tool returns `{ ok: false, error: {...} }` on failure; Phase 3 system prompt rule: never fake success (D-04, Pitfall #16) |

</threat_model>

<verification>
**End-to-end checks for this plan:**
1. `test -f "app/mcp/[transport]/route.ts"` → route file exists
2. `grep -q 'create_reservation' "app/mcp/[transport]/route.ts"` → tool 1 present
3. `grep -q 'get_reservation_status' "app/mcp/[transport]/route.ts"` → tool 2 present
4. `grep -q 'extend_wait' "app/mcp/[transport]/route.ts"` → tool 3 present
5. `grep -q 'cancel_reservation' "app/mcp/[transport]/route.ts"` → tool 4 present
6. `grep -q 'passthrough' "app/mcp/[transport]/route.ts"` → Zod passthrough used
7. `grep -q 'X-Reservation-Session' "app/mcp/[transport]/route.ts"` → session resolution present
8. `test -f lib/mcp/auth.ts` → auth helpers exist
9. `grep -q 'verifyBearer' lib/mcp/auth.ts` → bearer verification present
10. `npm run build` → compiles

</verification>

<success_criteria>
1. **lib/mcp/auth.ts:** Exports `verifyBearer` and `resolveSession` helpers.
2. **MCP route:** `app/mcp/[transport]/route.ts` with 4 tools, bearer auth, session resolution.
3. **create_reservation:** Only tool with diner identity fields in schema (D-02).
4. **Action tools:** Use `X-Reservation-Session` header for resolution; LLM never passes reservation_id (D-03).
5. **Error contract:** Structured JSON with distinct error codes (D-04).
6. **No inline auth:** One verifier via `withMcpAuth` (D-01, Anti-Pattern 5).

</success_criteria>

<output>
After completion, create `.planning/phases/02-backend-core/02-05-mcp-SUMMARY.md` documenting:
- Tool descriptions and schemas
- Auth flow (bearer + session resolution)
- Error codes and messages
- Any deviations from the spec
</output>
