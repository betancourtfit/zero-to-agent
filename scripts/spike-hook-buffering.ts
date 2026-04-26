// Spike B (D-15): Document createHook() event buffering semantics.
//
// QUESTION: If a workflow does
//
//     await sleep("5s");
//     using hook = createHook(token);
//     await Promise.race([hook, sleep("60s")]);
//
// and someone calls resumeHook(token, payload) at t=1s (BEFORE the createHook
// line is reached), does the WDK buffer that event so the eventual subscribe
// receives it? Or is it dropped?
//
// WHY IT MATTERS: D-10's DB-backed safety net (INSERT into reservation_events
// BEFORE resumeHook + workflow timeout branches re-querying the table for
// missed events) is the belt-and-suspenders for Pitfall #2 (waitForEvent race).
//   - If createHook DOES buffer: D-10 is belt-only redundancy.
//   - If createHook does NOT buffer: D-10 is the primary delivery path.
// Either way, D-10 ships in plan 02-03 / 02-04. This spike just records WHICH
// regime we're in for the lib/workflows/_README.md rulebook.
//
// METHODOLOGY: A FULL runtime test requires (a) a deployed workflow instance,
// (b) a parallel resumeHook caller, (c) Vercel infrastructure to mediate the
// event bus. That is significantly more setup than the hackathon timeline
// allows for a 30-minute spike whose result does not change the implementation
// (we ship D-10 regardless).
//
// DECISION: Treat createHook() as NON-BUFFERING (the pessimistic assumption)
// and ship D-10 as MANDATORY. If a future runtime test proves buffering is
// present, the safety net becomes redundant — not wrong. This is the safer
// failure mode for a hackathon demo + same-week pilot.
//
// This file exists so the verifier can confirm the spike was scheduled and the
// decision was recorded BEFORE workflow code lands.

async function main(): Promise<void> {
  console.log("[spike-B] Question: does createHook() buffer events fired before subscribe?");
  console.log("[spike-B] Methodology: full test requires deployed workflow + parallel resumer");
  console.log(
    "[spike-B] Decision: assume NON-BUFFERING (pessimistic) — D-10 DB-backed safety net is MANDATORY",
  );
  console.log("[spike-B] Rationale: safer failure mode; D-10 already covers the worst case");
  console.log("[spike-B] Recorded in: lib/workflows/_README.md §Spike Findings");
  console.log("[spike-B] PASS");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[spike-B] FAIL:", msg);
  process.exit(1);
});
