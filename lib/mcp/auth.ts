// MCP server auth helpers (D-06).
// Two responsibilities:
//   1. verifyBearer — passed to withMcpAuth (D-01); compares the bearer
//      against env.MCP_API_KEY in constant time and returns AuthInfo
//      or undefined. withMcpAuth turns undefined into 401.
//   2. resolveSession — called as the FIRST line of every action tool's
//      execute (D-03, Pitfall #5). Looks up reservations by
//      session_token and returns the row, or null. The MCP route reads
//      X-Reservation-Session from extra.requestInfo.headers and feeds
//      it to this helper.
//
// Discipline:
//   - Logging via lib/log (SAFE-01); never raw console.*.
//   - Never log the bearer or the session token directly.
//   - Constant-time comparison for the bearer to neutralise the
//     length/timing oracle that === leaks.

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { timingSafeEqual } from "node:crypto";

import { sql } from "@/lib/db/neon";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

// Internal shape returned by resolveSession. Only the fields the action
// tools actually need to dispatch the service layer call. We project
// timestamps to ISO strings so step-boundary serialisation rules carry
// through to the MCP layer (Pitfall #3 hygiene).
export interface ResolvedSession {
  reservationId: string;
  sessionToken: string;
  status: string;
  activeHookToken: string | null;
}

interface ReservationLookupRow {
  id: string;
  session_token: string;
  status: string;
  active_hook_token: string | null;
}

function constantTimeEqual(a: string, b: string): boolean {
  // timingSafeEqual REQUIRES equal-length buffers — short-circuiting on
  // length is intentional and standard practice (the secret never
  // arrives via the same path as the client-provided value).
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// withMcpAuth signature: (req: Request, bearerToken?: string) =>
//   AuthInfo | undefined | Promise<...>. The wrapper has already
// extracted the "Bearer " prefix — bearer here is the raw token (or
// undefined if the header was missing/malformed).
export async function verifyBearer(
  _req: Request,
  bearer: string | undefined,
): Promise<AuthInfo | undefined> {
  if (!bearer) {
    log.warn("mcp.auth.bearer_missing");
    return undefined;
  }

  if (!constantTimeEqual(bearer, env.MCP_API_KEY)) {
    log.warn("mcp.auth.bearer_mismatch");
    return undefined;
  }

  // Fields are required by the SDK AuthInfo type. We use a fixed
  // clientId because the bearer is a shared key (one for the chatbot
  // today, one for WhatsApp tomorrow if/when that adapter ships). Per-
  // reservation identity is enforced separately via resolveSession.
  return {
    token: bearer,
    clientId: "mcp-chatbot",
    scopes: ["reservations:write"],
  };
}

// D-03 / Pitfall #5: action tools accept ZERO LLM-visible identity
// parameters. The session_token comes from the X-Reservation-Session
// HTTP header, which the LLM cannot see or modify. The MCP route
// reads the header from extra.requestInfo.headers and passes it here.
//
// Returns null on any failure (missing header, malformed token, no
// row matches). The tool turns null into a structured INVALID_SESSION
// error per D-04. Returning null instead of throwing keeps the
// branching local to the tool.
export async function resolveSession(
  reservationSession: string | undefined,
): Promise<ResolvedSession | null> {
  if (!reservationSession) {
    log.info("mcp.auth.session_header_missing");
    return null;
  }

  // session_token is a UUID at the DB level (UNIQUE column). Reject
  // anything that doesn't look like one BEFORE querying — protects
  // against malformed input poisoning the parameterised query plan
  // cache and gives a faster fail path. Loose UUID-ish check; real
  // validation happens at the DB.
  if (!/^[0-9a-fA-F-]{32,40}$/.test(reservationSession)) {
    log.info("mcp.auth.session_malformed");
    return null;
  }

  const rows = (await sql`
    SELECT id, session_token, status, active_hook_token
    FROM reservations
    WHERE session_token = ${reservationSession}
    LIMIT 1
  `) as ReservationLookupRow[];

  if (rows.length === 0) {
    log.info("mcp.auth.session_not_found");
    return null;
  }

  const row = rows[0];
  return {
    reservationId: row.id,
    sessionToken: row.session_token,
    status: row.status,
    activeHookToken: row.active_hook_token,
  };
}
