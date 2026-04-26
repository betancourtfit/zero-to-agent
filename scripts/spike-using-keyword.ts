// Spike A (D-15): Verify the TypeScript 5.2+ `using` keyword (explicit resource
// management) compiles AND runs cleanly on Vercel Node 20.
//
// WHY: lib/workflows/reservation.ts wants `using hook = createHook(...)` so the
// hook auto-disposes when the workflow scope exits (Pitfall #1 step discipline +
// Pitfall #4 freeze-shape friendliness — fewer try/finally blocks = fewer chances
// to introduce side effects in the router body).
//
// FALLBACK if `using` fails: rewrite hooks as
//   const hook = createHook(token); try { ... } finally { await hook.dispose(); }
// Either decision is recorded in lib/workflows/_README.md "Spike Findings".

async function main(): Promise<void> {
  let disposed = false;

  const resource: Disposable = {
    [Symbol.dispose]() {
      disposed = true;
      console.log("[spike-A] Symbol.dispose called — using keyword works");
    },
  };

  {
    using _r = resource;
    console.log("[spike-A] using keyword compiled and entered scope");
  } // <- _r should auto-dispose here

  if (!disposed) {
    throw new Error("Symbol.dispose was not invoked when scope exited");
  }

  console.log("[spike-A] PASS");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[spike-A] FAIL:", msg);
  console.log(
    "[spike-A] Fallback: rewrite as `const hook = createHook(...); try {} finally { await hook.dispose(); }`",
  );
  process.exit(1);
});

// Force ES module scoping so `main` is not a global symbol — prevents
// "Duplicate function implementation" errors when scripts/spike-*.ts files
// share an identical top-level function name in the same TS program.
export {};
