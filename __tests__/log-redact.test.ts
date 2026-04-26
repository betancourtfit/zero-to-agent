// SAFE-01 regression suite for lib/log.ts → redactPII.
// Run with: npx tsx --test __tests__/log-redact.test.ts
//
// The 6 cases below match the spec in
// .planning/phases/02-backend-core/02-CONTEXT.md D-23.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { redactPII, PII_KEYS } from "../lib/log.ts";

describe("redactPII", () => {
  it("masks nested email in payload (dot-notation key match is not required — leaf 'email' key matches)", () => {
    const out = redactPII({ payload: { email: "test@example.com" } }) as {
      payload: { email: string };
    };
    assert.equal(out.payload.email, "[REDACTED]");
    // Defence-in-depth: the raw substring must not survive anywhere.
    assert.ok(!JSON.stringify(out).includes("test@example.com"));
  });

  it("masks phones inside arrays — last 4 digits preserved", () => {
    const out = redactPII({ contacts: ["+5491112345678"] }) as {
      contacts: string[];
    };
    const masked = out.contacts[0];
    assert.ok(masked.endsWith("5678"), `expected to end with 5678, got: ${masked}`);
    assert.ok(!masked.includes("549111234"), `raw phone digits leaked: ${masked}`);
    assert.ok(masked.startsWith("+"), `+ prefix should be preserved: ${masked}`);
  });

  it("redacts mixed PII keys: a known-PII key wins over value-pattern detection", () => {
    const out = redactPII({
      name: "Juan Pérez",
      email: "j@example.com",
      note: "contact me at jc@example.com",
      party_size: 4,
    }) as Record<string, unknown>;

    // Known PII keys: full [REDACTED].
    assert.equal(out.name, "[REDACTED]");
    assert.equal(out.email, "[REDACTED]");
    // Non-PII string still gets value-level email masking.
    assert.equal(out.note, "contact me at j****@example.com");
    // Pass-through scalar.
    assert.equal(out.party_size, 4);
  });

  it("respects depth-cap (depth 4): values at depth 5 are not recursed into", () => {
    // Build a depth-5 nesting. After 4 levels of recursion, the inner string
    // is left untouched (escape valve to keep the redactor cheap on huge objects).
    const deep = {
      d1: { d2: { d3: { d4: { email: "leak@example.com" } } } },
    };
    const out = redactPII(deep) as {
      d1: { d2: { d3: { d4: { email: string } } } };
    };
    // The depth-4 leaf is the un-walked terminus.
    assert.equal(
      out.d1.d2.d3.d4.email,
      "leak@example.com",
      "depth-cap should leave depth-5 strings unmodified — adjust PII_KEYS or refactor if this fires for real PII paths",
    );
  });

  it("passes through plain objects without PII unchanged", () => {
    const input = {
      reservation_id: "abc-123",
      status: "waiting",
      eta_min: 12,
      ok: true,
      tags: ["window", "vip"],
    };
    const out = redactPII(input);
    assert.deepEqual(out, input);
  });

  it("regression: redactPII(reservationRow) leaks no name/email/phone substrings", () => {
    // Fixture matching the schema columns from db/migrations/0001_init.sql.
    const reservationRow = {
      id: "9f3e1d4a-2bcd-4f7a-9b1c-1234567890ab",
      session_token: "11111111-2222-3333-4444-555555555555",
      name: "Marisol Gutiérrez",
      email: "marisol@talos.lat",
      phone: "+541123456789",
      party_size: 4,
      status: "waiting",
      workflow_run_id: "wf_abc123",
      eta_min: 18,
      extension_count: 0,
      no_show_deadline: "2026-04-26T22:30:00Z",
      called_at: null,
      ended_at: null,
      created_at: "2026-04-26T22:00:00Z",
      updated_at: "2026-04-26T22:00:00Z",
    };

    const redacted = JSON.stringify(redactPII(reservationRow));

    assert.ok(
      !redacted.includes("Marisol"),
      `name leaked in redacted output: ${redacted}`,
    );
    assert.ok(
      !redacted.includes("Gutiérrez"),
      `name leaked in redacted output: ${redacted}`,
    );
    assert.ok(
      !redacted.includes("marisol@talos.lat"),
      `email leaked in redacted output: ${redacted}`,
    );
    assert.ok(
      !redacted.includes("541123456789"),
      `phone leaked in redacted output: ${redacted}`,
    );

    // Non-PII columns survive untouched.
    const out = redactPII(reservationRow) as Record<string, unknown>;
    assert.equal(out.id, reservationRow.id);
    assert.equal(out.status, "waiting");
    assert.equal(out.party_size, 4);
  });

  it("PII_KEYS covers all PII columns from schema 0001_init.sql (name, email, phone)", () => {
    // Centralised list keeps tests honest as the schema grows.
    const keysLower = PII_KEYS.map((k) => k.toLowerCase());
    for (const required of ["name", "email", "phone"]) {
      assert.ok(
        keysLower.includes(required),
        `PII_KEYS missing required column: ${required}`,
      );
    }
  });
});
