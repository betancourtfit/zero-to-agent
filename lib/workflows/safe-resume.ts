// Race-tolerant wrapper around `resumeHook` from `workflow/api`.
//
// `start(reservationWorkflow, ...)` returns immediately and queues the
// workflow on Vercel's Workflow runtime. There's a small window between
// the workflow being scheduled and the workflow function actually
// reaching `hook.create({token})`. If a service mutation arrives in
// that window (e.g., diner cancels milliseconds after creating), the
// raw `resumeHook(token, payload)` call throws "Hook not found".
//
// This is NOT a durability failure. The DB-backed safety net (D-10)
// has already inserted the event into `reservation_events`. When the
// workflow boots, its first step (`fetchMissedEvents`) re-queries the
// audit log and processes any events that arrived during the boot
// window.
//
// This wrapper:
//   1. Tries `resumeHook` normally
//   2. Catches "Hook not found" / "no hook" errors and logs a warn
//   3. Returns { resumed: false } so callers can react if needed
//   4. Re-throws unknown errors (don't swallow real bugs)

import { resumeHook } from "workflow/api";

import { log } from "@/lib/log";

const HOOK_NOT_FOUND_PATTERN = /hook\s*not\s*found|no\s*hook/i;

interface SafeResumeContext {
  reservation_id: string;
  intent: string;
}

export async function safeResumeHook(
  token: string,
  payload: Record<string, unknown>,
  ctx: SafeResumeContext,
): Promise<{ resumed: boolean }> {
  try {
    await resumeHook(token, payload);
    return { resumed: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (HOOK_NOT_FOUND_PATTERN.test(msg)) {
      log.warn("workflow.resume.hook_not_found_race", {
        token,
        reservation_id: ctx.reservation_id,
        intent: ctx.intent,
      });
      return { resumed: false };
    }
    throw err;
  }
}
