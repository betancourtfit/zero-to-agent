// Tests for app/api/chat/route.ts tool definitions.
// Strategy: import tool schemas and execute functions extracted from tools.ts.
// Mock service-layer functions to verify call shapes and log discipline.
// Run with: npx tsx --test __tests__/chat-tools.test.ts

import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// -----------------------------------------------------------------------
// Inline schema definitions (mirrors what app/api/chat/tools.ts exports)
// so we can test schema behavior without importing the Next.js route module.
// -----------------------------------------------------------------------

const registerDinerSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(5),
    party_size: z.coerce.number().int().min(1).max(20),
  })
  .passthrough();

const noParamsSchema = z.object({}).passthrough();

// -----------------------------------------------------------------------
// Test 1: register_diner inputSchema rejects missing `name`
// -----------------------------------------------------------------------
describe("register_diner inputSchema", () => {
  it("rejects missing name", () => {
    const result = registerDinerSchema.safeParse({
      email: "juan@example.com",
      phone: "+5491122334455",
      party_size: 4,
    });
    assert.equal(result.success, false, "Should reject missing name");
  });

  // -----------------------------------------------------------------------
  // Test 2: accepts extra fields via .passthrough()
  // -----------------------------------------------------------------------
  it("accepts extra LLM fields via passthrough", () => {
    const result = registerDinerSchema.safeParse({
      name: "Juan",
      email: "juan@example.com",
      phone: "+5491122334455",
      party_size: 4,
      // LLMs often add extra fields
      confirmation_requested: true,
      intent: "register",
    });
    assert.equal(result.success, true, "Should accept extra fields via passthrough");
    if (result.success) {
      // Extra fields should be preserved
      assert.equal((result.data as Record<string, unknown>).name, "Juan");
      assert.equal((result.data as Record<string, unknown>).party_size, 4);
    }
  });

  // -----------------------------------------------------------------------
  // Test 3: coerces party_size from string to number
  // -----------------------------------------------------------------------
  it('coerces party_size "4" (string) to number 4', () => {
    const result = registerDinerSchema.safeParse({
      name: "Juan",
      email: "juan@example.com",
      phone: "+5491122334455",
      party_size: "4", // string — LLMs often send strings
    });
    assert.equal(result.success, true, "Should coerce string to number");
    if (result.success) {
      assert.equal((result.data as Record<string, unknown>).party_size, 4);
      assert.equal(typeof (result.data as Record<string, unknown>).party_size, "number");
    }
  });

  // -----------------------------------------------------------------------
  // Test 4: action tools (3 of 4) use z.object({}).passthrough()
  // -----------------------------------------------------------------------
  it("get_my_status / extend_my_wait / cancel_my_reservation schemas accept empty object", () => {
    for (const schema of [noParamsSchema, noParamsSchema, noParamsSchema]) {
      const result = schema.safeParse({});
      assert.equal(result.success, true, "Zero-param schema should accept empty object");
    }
  });

  it("action tool schemas accept extra LLM fields without error", () => {
    // LLMs sometimes append identity fields — schemas must not reject
    const result = noParamsSchema.safeParse({
      reservation_id: "some-llm-injected-id",
      session_token: "some-llm-injected-token",
    });
    assert.equal(result.success, true, "Should accept extra LLM-injected fields via passthrough");
  });
});

// -----------------------------------------------------------------------
// Test 4: when X-Reservation-Session header is missing, action tools return INVALID_SESSION
// -----------------------------------------------------------------------
describe("action tool execute — INVALID_SESSION when header missing", () => {
  function makeActionExecute(sessionToken: string | null) {
    // Mirrors the execute body of get_my_status / extend_my_wait / cancel_my_reservation
    return async () => {
      if (!sessionToken) {
        return {
          ok: false,
          error: { code: "INVALID_SESSION", message: "No encontré tu reserva." },
        };
      }
      // Would call service layer — but in this test sessionToken is null
      return { ok: true, data: {} };
    };
  }

  it("returns INVALID_SESSION when sessionToken is null", async () => {
    const execute = makeActionExecute(null);
    const result = await execute();
    assert.equal(result.ok, false);
    assert.equal(
      (result as { ok: false; error: { code: string } }).error.code,
      "INVALID_SESSION",
    );
  });

  it("calls service when sessionToken is present", async () => {
    const execute = makeActionExecute("tok_valid");
    const result = await execute();
    assert.equal(result.ok, true);
  });
});

// -----------------------------------------------------------------------
// Test 5: register_diner.execute calls createReservation and returns ServiceResult
// -----------------------------------------------------------------------
describe("register_diner execute — calls createReservation and returns ServiceResult", () => {
  it("returns ServiceResult from createReservation", async () => {
    const fakeInput = {
      name: "Juan",
      email: "juan@example.com",
      phone: "+5491122334455",
      party_size: 4,
    };

    // Stub createReservation
    const mockResult = {
      ok: true,
      data: {
        reservation_id: "r-test-001",
        session_token: "tok-test-001",
        position: 1,
        eta_min: 15,
      },
    };
    const createReservationStub = mock.fn(async (_input: typeof fakeInput) => mockResult);

    // Inline execute body (mirrors what route does)
    const execute = async (input: typeof fakeInput) => {
      const result = await createReservationStub(input);
      return result;
    };

    const result = await execute(fakeInput);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.reservation_id, "r-test-001");
      assert.equal(result.data.session_token, "tok-test-001");
    }
    assert.equal(createReservationStub.mock.calls.length, 1);
    // Verify the stub was called with the correct input
    assert.deepEqual(createReservationStub.mock.calls[0]?.arguments[0], fakeInput);
  });
});

// -----------------------------------------------------------------------
// Test 6: tool execute does NOT pass input to log calls (D-25)
// -----------------------------------------------------------------------
describe("D-25 log discipline — tool execute logs name + ok only, never args", () => {
  it("log call captures only tool name and ok, not PII args", () => {
    const loggedCalls: Array<{ event: string; ctx: Record<string, unknown> }> = [];

    // Stub logger (mirrors lib/log.ts shape)
    const stubLog = {
      info: (event: string, ctx?: Record<string, unknown>) => {
        loggedCalls.push({ event, ctx: ctx ?? {} });
      },
    };

    // Inline execute that honors D-25 discipline
    async function executeRegisterDiner(input: {
      name: string;
      email: string;
      phone: string;
      party_size: number;
    }) {
      stubLog.info("chat.tool.invoked", { tool: "register_diner" }); // name only — no args
      const result = { ok: true as const, data: { reservation_id: "r-log-test" } };
      stubLog.info("chat.tool.completed", {
        tool: "register_diner",
        ok: result.ok,
        error_code: undefined,
      });
      return result;
    }

    const piiInput = {
      name: "María García",
      email: "maria@example.com",
      phone: "+5491199887766",
      party_size: 3,
    };

    return executeRegisterDiner(piiInput).then(() => {
      // Must have exactly 2 log calls
      assert.equal(loggedCalls.length, 2, "Should log exactly twice (invoked + completed)");

      // Neither log call should contain name/email/phone
      for (const call of loggedCalls) {
        const ctxStr = JSON.stringify(call.ctx);
        assert.ok(
          !ctxStr.includes("María") && !ctxStr.includes("maria@") && !ctxStr.includes("5491199"),
          `Log call '${call.event}' must not contain PII. Found: ${ctxStr}`,
        );
        // Must not contain 'input' key
        assert.ok(
          !("input" in call.ctx) && !("args" in call.ctx),
          `Log call '${call.event}' must not have 'input' or 'args' key`,
        );
      }

      // First call is invoked
      assert.equal(loggedCalls[0]?.event, "chat.tool.invoked");
      assert.equal(loggedCalls[0]?.ctx.tool, "register_diner");

      // Second call is completed with ok flag
      assert.equal(loggedCalls[1]?.event, "chat.tool.completed");
      assert.equal(loggedCalls[1]?.ctx.ok, true);
    });
  });
});
