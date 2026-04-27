// SAFE-02 deterministic fixture asserter for chatbot conversation shapes.
// Run with: npx tsx --test __tests__/chatbot-conversations.test.ts
//
// This file does NOT call the live LLM — it validates the SHAPE of the
// fixture itself and the static constraints from D-04 (5 locked system-prompt
// rules). Live-LLM end-to-end validation is manual (plan 03) and runs the
// fixture conversations through /api/chat after the route ships.
//
// Why deterministic: CI must not burn AI Gateway tokens and must not flake
// due to LLM variance. The fixture is the source of truth for the 5 D-04
// rules; the asserter proves the fixture is internally consistent.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fixtures from "./chatbot-conversations.fixture.json" with { type: "json" };

describe("chatbot conversation fixtures (D-30 SAFE-02)", () => {
  it("has exactly 10 conversation cases", () => {
    assert.equal(fixtures.conversations.length, 10);
  });

  it("every case has the required shape", () => {
    for (const c of fixtures.conversations) {
      assert.equal(typeof c.id, "string", `case ${c.id}: id must be a string`);
      assert.equal(typeof c.label, "string", `case ${c.id}: label must be a string`);
      assert.ok(Array.isArray(c.user_messages), `case ${c.id}: user_messages must be an array`);
      assert.ok(c.user_messages.length > 0, `case ${c.id}: user_messages must not be empty`);
      assert.ok(Array.isArray(c.expected_tool_calls), `case ${c.id}: expected_tool_calls must be an array`);
      assert.equal(typeof c.rule_under_test, "string", `case ${c.id}: rule_under_test must be a string`);
      assert.equal(typeof c.expected_clarification, "boolean", `case ${c.id}: expected_clarification must be a boolean`);
      assert.equal(typeof c.expected_rejection, "boolean", `case ${c.id}: expected_rejection must be a boolean`);
    }
  });

  it("covers all 5 D-04 system prompt rules", () => {
    const rules = new Set(fixtures.conversations.map((c) => c.rule_under_test));
    assert.ok(rules.has("D-04 Rule 1"), "missing D-04 Rule 1 (echo-back-before-confirm)");
    assert.ok(rules.has("D-04 Rule 2"), "missing D-04 Rule 2 (never-fabricate)");
    assert.ok(rules.has("D-04 Rule 3"), "missing D-04 Rule 3 (refuse off-topic)");
    assert.ok(rules.has("D-04 Rule 4"), "missing D-04 Rule 4 (clarify ambiguous inputs)");
    assert.ok(rules.has("D-04 Rule 5"), "missing D-04 Rule 5 (no future booking)");
  });

  it("has at least one valid-registration happy path", () => {
    const happy = fixtures.conversations.find((c) => c.id === "valid-registration");
    assert.ok(happy, "valid-registration case is missing");
    assert.ok(
      (happy.expected_tool_calls as string[]).includes("register_diner"),
      "valid-registration must expect register_diner tool call",
    );
  });

  it("has at least one off-topic refusal case", () => {
    const offTopic = fixtures.conversations.filter((c) => c.expected_rejection === true);
    assert.ok(offTopic.length >= 2, `need at least 2 off-topic / refusal cases, found ${offTopic.length}`);
  });

  it("ambiguous-party case expects clarification (no tool call)", () => {
    const c = fixtures.conversations.find((c) => c.id === "ambiguous-party");
    assert.ok(c, "ambiguous-party case is missing");
    assert.equal(c.expected_clarification, true, "ambiguous-party: expected_clarification must be true");
    assert.equal(c.expected_tool_calls.length, 0, "ambiguous-party: expected_tool_calls must be empty");
  });

  it("system_prompt_excerpts covers all 5 D-04 rules", () => {
    const excerpts = fixtures.system_prompt_excerpts;
    assert.ok(excerpts.rule_1_echo_back, "rule_1_echo_back excerpt is missing");
    assert.ok(excerpts.rule_2_never_fabricate, "rule_2_never_fabricate excerpt is missing");
    assert.ok(excerpts.rule_3_refuse_off_topic, "rule_3_refuse_off_topic excerpt is missing");
    assert.ok(excerpts.rule_4_clarify, "rule_4_clarify excerpt is missing");
    assert.ok(excerpts.rule_5_no_future_booking, "rule_5_no_future_booking excerpt is missing");
  });

  it("no PII in fixture (no real email addresses or phone numbers)", () => {
    const json = JSON.stringify(fixtures);
    // Only example.com style emails are permitted — no real domains
    const realEmailPattern = /[a-zA-Z0-9._%+-]+@(?!example\.com|example\.test)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const realEmails = json.match(realEmailPattern) ?? [];
    assert.equal(
      realEmails.length,
      0,
      `fixture contains real email addresses: ${realEmails.join(", ")}`,
    );
  });

  it("tool-error-no-retry case has mock_tool_response with ok:false", () => {
    const c = fixtures.conversations.find((c) => c.id === "tool-error-no-retry");
    assert.ok(c, "tool-error-no-retry case is missing");
    assert.ok(
      "mock_tool_response" in c && c.mock_tool_response,
      "tool-error-no-retry: mock_tool_response is missing",
    );
    const resp = c.mock_tool_response as { ok: boolean };
    assert.equal(resp.ok, false, "tool-error-no-retry: mock_tool_response.ok must be false");
  });

  it("extend and cancel natural-language cases have context.has_active_reservation", () => {
    for (const id of ["extend-natural-language", "cancel-natural-language"]) {
      const c = fixtures.conversations.find((c) => c.id === id);
      assert.ok(c, `${id} case is missing`);
      const ctx = (c as { context?: { has_active_reservation?: boolean } }).context;
      assert.ok(ctx, `${id}: context field is missing`);
      assert.equal(
        ctx.has_active_reservation,
        true,
        `${id}: context.has_active_reservation must be true`,
      );
    }
  });
});
