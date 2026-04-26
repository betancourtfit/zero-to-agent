// PII redactor + structured logger for all production code.
// SAFE-01 / Pitfall #15: every log path goes through here.
// Raw console.* outside this file is forbidden — Vercel logs are visible
// to anyone with project access, and a single console.log(reservation)
// leaks diner email/phone/name.

export const PII_KEYS: readonly string[] = [
  "name",
  "email",
  "phone",
  "full_name",
  "phone_number",
  "payload.name",
  "payload.email",
  "payload.phone",
] as const;

const PII_KEY_SET: ReadonlySet<string> = new Set(
  PII_KEYS.map((k) => k.toLowerCase()),
);

const MAX_DEPTH = 4;

const EMAIL_RE = /\b([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

// Loose AR phone matcher: optional +, optional country/area, 7+ digits with
// allowed separators. Covers +5491112345678, 5491112345678, 11-2345-6789,
// (11) 2345-6789, etc. Last 4 digits preserved.
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/g;

const REDACTED = "[REDACTED]";

function maskEmail(input: string): string {
  return input.replace(EMAIL_RE, (_match, first, _rest, domain) => {
    return `${first}****@${domain}`;
  });
}

function maskPhone(input: string): string {
  return input.replace(PHONE_RE, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 7) return match;
    const last4 = digits.slice(-4);
    const maskedDigits = "*".repeat(digits.length - 4) + last4;
    // Reconstruct preserving a leading + if the original had one,
    // dropping all separators (the masked form is intentionally compact).
    const sign = match.trimStart().startsWith("+") ? "+" : "";
    return `${sign}${maskedDigits}`;
  });
}

function redactString(value: string): string {
  // Email first — phone regex would otherwise eat digit runs inside emails.
  return maskPhone(maskEmail(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function redactPII(value: unknown, depth: number = 0): unknown {
  if (depth >= MAX_DEPTH) {
    // Stop recursing. Leave the value as-is so depth-cap is observable
    // (a future audit can grep for un-redacted nested structures).
    return value;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactPII(item, depth + 1));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      const keyLower = key.toLowerCase();
      if (PII_KEY_SET.has(keyLower)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactPII(raw, depth + 1);
    }
    return out;
  }

  // Numbers, booleans, null, undefined, Date, Error, etc.: pass through.
  // (Errors get specialised handling in log.error below.)
  return value;
}

type LogLevel = "info" | "warn" | "error";

interface LogLine {
  ts: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, event: string, ctx?: Record<string, unknown>): void {
  const redacted = ctx ? (redactPII(ctx) as Record<string, unknown>) : undefined;
  const line: LogLine = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(redacted ?? {}),
  };
  // Single JSON line per log entry. Vercel ingests this natively.
  console.log(JSON.stringify(line));
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

export const log = {
  info(event: string, ctx?: Record<string, unknown>): void {
    emit("info", event, ctx);
  },

  warn(event: string, ctx?: Record<string, unknown>): void {
    emit("warn", event, ctx);
  },

  // Two overloads: error(event, ctx) and error(event, err, ctx).
  // err is serialised to { name, message, stack } and run through redactPII
  // (a thrown error.message can contain a diner email — Pitfall #15).
  error(event: string, errOrCtx?: unknown, ctx?: Record<string, unknown>): void {
    let merged: Record<string, unknown> | undefined;

    if (isError(errOrCtx)) {
      const errPayload = {
        err: {
          name: errOrCtx.name,
          message: errOrCtx.message,
          stack: errOrCtx.stack,
        },
      };
      merged = { ...errPayload, ...(ctx ?? {}) };
    } else if (errOrCtx && typeof errOrCtx === "object") {
      merged = { ...(errOrCtx as Record<string, unknown>), ...(ctx ?? {}) };
    } else if (ctx) {
      merged = ctx;
    }

    emit("error", event, merged);
  },
};
