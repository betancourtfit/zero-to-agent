---
phase: 01-foundation
plan: 04
type: execute
wave: 3
depends_on:
  - 01
  - 03
files_modified:
  - lib/auth/auth.config.ts
  - lib/auth/auth.ts
  - app/api/auth/[...nextauth]/route.ts
  - proxy.ts
  - app/login/page.tsx
  - app/queue/page.tsx
  - next-auth.d.ts
autonomous: false
requirements:
  - STAFF-01
  - DEMO-01
  - DEMO-02

must_haves:
  truths:
    - "Maître navigates /login, enters email, receives Resend magic-link, clicks it, lands on /queue authenticated"
    - "Email NOT in employees gets generic Spanish success copy AND no row inserted in verification_token"
    - "Email IN employees with active=true gets the email AND a verification_token row inserted"
    - "/queue is unreachable without session (proxy redirects to /login; server component double-gates)"
    - "Session callback re-validates employees.active on every read (D-11)"
    - "Magic-link email subject is the Spanish string 'Tu link para entrar al panel'"
    - "Production deploy of this plan still serves 200 on / and the auth flow works end-to-end on the live URL"
  artifacts:
    - path: "lib/auth/auth.config.ts"
      provides: "Edge-lean Auth.js config for proxy.ts (Resend provider + authorized callback)"
      exports: ["authConfig"]
    - path: "lib/auth/auth.ts"
      provides: "Full Auth.js config with @auth/pg-adapter + signIn (D-09) + session (D-11) + sendVerificationRequest (D-12) callbacks"
      exports: ["handlers", "auth", "signIn", "signOut"]
    - path: "app/api/auth/[...nextauth]/route.ts"
      provides: "Next.js route handler exporting GET/POST from Auth.js"
    - path: "proxy.ts"
      provides: "Next.js 16 proxy at repo root, matcher /queue/:path*, redirects unauthed to /login"
    - path: "app/login/page.tsx"
      provides: "Spanish login form with generic success copy (D-10, D-22)"
    - path: "app/queue/page.tsx"
      provides: "Auth-gated stub rendering 'Hola {email} — panel próximamente' (D-23)"
    - path: "next-auth.d.ts"
      provides: "Module augmentation so session.user.email is typed correctly"
  key_links:
    - from: "proxy.ts"
      to: "lib/auth/auth.config.ts"
      via: "import { authConfig } from '@/lib/auth/auth.config'"
      pattern: "NextAuth\\(authConfig\\)"
    - from: "lib/auth/auth.ts"
      to: "lib/db/pool.ts"
      via: "PostgresAdapter(pool)"
      pattern: "PostgresAdapter\\(pool\\)"
    - from: "lib/auth/auth.ts signIn callback"
      to: "employees table"
      via: "sql`SELECT id, active FROM employees WHERE email = ${user.email}`"
      pattern: "SELECT.*FROM employees WHERE email"
    - from: "lib/auth/auth.ts session callback"
      to: "employees table"
      via: "sql`SELECT active FROM employees WHERE email = ${session.user.email}`"
      pattern: "SELECT active FROM employees"
    - from: "lib/auth/auth.ts sendVerificationRequest"
      to: "Resend API"
      via: "dynamic import('resend') + resend.emails.send()"
      pattern: "Tu link para entrar al panel"
    - from: "app/queue/page.tsx"
      to: "lib/auth/auth.ts auth()"
      via: "Server Component double-gate (defense in depth)"
      pattern: "const session = await auth\\(\\)"
---

<objective>
Wire Auth.js v5 + Resend magic-link end-to-end so the maître can navigate to `/login`, enter their email, receive a Spanish magic-link email, click it, and land on the auth-gated `/queue` route showing their email. Enforce the `employees`-table gate (D-09, D-10, D-11) so only seeded maîtres can authenticate, and only then if `active = true`.

Purpose: This is the final ROADMAP success criterion #1 for Phase 1 — without it, STAFF-01 fails and the pilot has no panel access. Phase 0 prerequisite 0.1 (Resend domain verified) is the blocking gate; PLAN-01 Task 3 confirmed verification before proceeding.
Output: Working magic-link flow from `/login` to authenticated `/queue` stub. Spanish UI throughout. Generic success copy regardless of email match (anti-enumeration). Database session strategy enables mid-session deactivation per D-11.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/01-PATTERNS.md
@.planning/phases/01-foundation/01-01-scaffold-vercel-env-PLAN.md
@.planning/phases/01-foundation/01-03-db-migrations-seed-PLAN.md
@CLAUDE.md

<interfaces>
<!-- Verbatim canonical snippets from 01-PATTERNS.md and 01-RESEARCH.md -->
<!-- Research correction embedded inline:
     - proxy.ts runs on Node.js (NOT Edge) in Next.js 16. The split between auth.config.ts and auth.ts
       is motivated by performance / cold-start (avoid loading the PG adapter on every proxy request),
       NOT by Edge incompatibility. Do NOT add `export const runtime` of any kind to proxy.ts.
-->

From 01-PATTERNS.md `lib/auth/auth.config.ts` (lines 281-307) — copy verbatim:
```typescript
import type { NextAuthConfig } from "next-auth";
import Resend from "next-auth/providers/resend";

export const authConfig: NextAuthConfig = {
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: `noreply@${process.env.RESEND_DOMAIN ?? "resend.dev"}`,
      name: "Restaurant Queue",
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnQueue = nextUrl.pathname.startsWith("/queue");
      if (isOnQueue) return isLoggedIn;
      return true;
    },
  },
};
```

From 01-PATTERNS.md `lib/auth/auth.ts` (lines 326-384) — copy verbatim:
```typescript
import NextAuth from "next-auth";
import PostgresAdapter from "@auth/pg-adapter";
import Resend from "next-auth/providers/resend";
import { authConfig } from "./auth.config";
import { pool } from "@/lib/db/pool";
import { sql } from "@/lib/db/neon";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PostgresAdapter(pool),
  session: { strategy: "database" },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: `noreply@${process.env.RESEND_DOMAIN}`,
      async sendVerificationRequest({ identifier: email, url, provider }) {
        const { Resend: ResendClient } = await import("resend");
        const resend = new ResendClient(provider.apiKey);
        await resend.emails.send({
          from: provider.from!,
          to: email,
          subject: "Tu link para entrar al panel",
          html: `<p>Hacé clic para entrar al panel:</p><p><a href="${url}">Ingresar</a></p><p>Este link expira en 24 horas.</p>`,
        });
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    // D-09: Fires BEFORE the Resend email is dispatched.
    // email.verificationRequest === true on the first call only.
    async signIn({ user, email }) {
      if (email?.verificationRequest) {
        if (!user.email) return false;
        const rows = await sql`
          SELECT id, active FROM employees WHERE email = ${user.email}
        `;
        // D-10: Return false silently — UI shows generic copy regardless
        if (rows.length === 0 || !rows[0].active) return false;
      }
      return true;
    },

    // D-11: Re-validate employees.active on every session read
    async session({ session, user }) {
      if (!session.user?.email) return session;
      const rows = await sql`
        SELECT active FROM employees WHERE email = ${session.user.email}
      `;
      if (rows.length === 0 || !rows[0].active) {
        return { ...session, user: undefined } as typeof session;
      }
      return session;
    },
  },
});
```

From 01-PATTERNS.md `app/api/auth/[...nextauth]/route.ts` (lines 433-435) — copy verbatim:
```typescript
export { GET, POST } from "@/lib/auth/auth";
```

From 01-PATTERNS.md `proxy.ts` (lines 113-129) — copy verbatim:
```typescript
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  if (req.nextUrl.pathname.startsWith("/queue") && !isLoggedIn) {
    return Response.redirect(new URL("/login", req.url));
  }
});

export const config = {
  matcher: ["/queue/:path*"],
};
```

From 01-PATTERNS.md `app/login/page.tsx` (lines 528-572) — copy verbatim:
```typescript
"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await signIn("resend", { email, redirect: false });
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <p className="text-center text-muted-foreground">
          Si tu email está autorizado, te enviamos un link en breve.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Acceder al panel</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
        <Input
          type="email"
          placeholder="tu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <Button type="submit">Enviar link</Button>
      </form>
    </main>
  );
}
```

From 01-PATTERNS.md `app/queue/page.tsx` (lines 590-608) — copy verbatim:
```typescript
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";

export default async function QueuePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <p className="text-lg">
        Hola {session.user.email} — panel próximamente
      </p>
    </main>
  );
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Wire Auth.js (split config + adapter + callbacks + route handler + proxy)</name>
  <files>lib/auth/auth.config.ts, lib/auth/auth.ts, app/api/auth/[...nextauth]/route.ts, proxy.ts, next-auth.d.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-PATTERNS.md (sections "lib/auth/auth.config.ts", "lib/auth/auth.ts", "app/api/auth/[...nextauth]/route.ts", "proxy.ts" — all verbatim snippets)
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 3 "Auth.js v5 Split Config" — full context including signIn callback timing; RISK-1 — proxy.ts runs Node.js NOT Edge; RISK-2 — signIn fires BEFORE email; RISK-3 — users.id is integer; Focus Area 10 §"Threat 2 — Email existence timing attack"; "Pitfall: Generic login copy requires NOT reading the error query param")
    - .planning/phases/01-foundation/01-CONTEXT.md (D-09, D-10, D-11, D-12, D-26, D-27)
    - lib/db/neon.ts (PLAN-03 — `sql` tagged template export)
    - lib/db/pool.ts (PLAN-03 — `pool` export for adapter)
    - .env.local (PLAN-01 Task 3 — confirm AUTH_SECRET, AUTH_RESEND_KEY, RESEND_DOMAIN populated)
  </read_first>
  <action>
    1. Create `lib/auth/auth.config.ts` with the verbatim snippet from `<interfaces>` above. Critical invariants:
       - **No imports of `pg`, `@auth/pg-adapter`, `lib/db/pool.ts`, or `lib/env.ts`.** This file must stay lean — proxy.ts loads it on every matched request. Reads `process.env.AUTH_RESEND_KEY` and `process.env.RESEND_DOMAIN` directly.
       - **Reason for split: cold-start performance / minimize proxy.ts dependency footprint, NOT Edge incompatibility** (research correction RISK-1). proxy.ts runs on Node.js by default in Next.js 16. Do NOT document this file as "Edge-safe" in any future comment — describe as "minimal config for proxy.ts request-path interception".
       - `pages.signIn` and `pages.error` both point to `/login` (per D-10, errors must NOT leak via different routing).
       - The `authorized` callback here gates `/queue/*` at the proxy level. The full `signIn` and `session` callbacks (with DB queries) live in `auth.ts`.

    2. Create `lib/auth/auth.ts` with the verbatim snippet from `<interfaces>`. Critical invariants:
       - **Imports `pool` from `@/lib/db/pool` and `sql` from `@/lib/db/neon`** — the only file that does both.
       - Spreads `...authConfig` THEN overrides `providers` with a fresh `Resend({...})` that includes the custom `sendVerificationRequest`. This is intentional — the lean `auth.config.ts` Resend provider is replaced here with a heavier one that uses the `resend` npm package.
       - `adapter: PostgresAdapter(pool)` wires Auth.js to the `users`/`accounts`/`sessions`/`verification_token` tables migrated by PLAN-03.
       - `session: { strategy: "database" }` is mandatory for D-11 (re-validate `employees.active` on every session read). JWT strategy bypasses the DB on session reads — D-11 would not work.
       - `signIn` callback (D-09): When `email?.verificationRequest === true`, queries `employees` by `user.email`. Returns `false` if the email is not in `employees` OR if `active = false`. Returning `false` from this callback **before the email is dispatched** prevents Resend from sending the magic-link entirely (RISK-2 confirmed).
       - The `signIn` callback uses `user.email` (NOT `user.id`) because `user.id` may be null on first login attempt for an email — Auth.js may insert the `users` row before calling the callback, but `user.email` is always populated from the form submission (RISK-3 edge-case note in research).
       - D-10 mitigation: `signIn` returns `false` silently. The login page (Task 2) must NOT read `?error=Verification` query param so the user sees the same generic copy regardless.
       - `session` callback (D-11): Queries `employees.active` by `session.user.email` on every session read. If the row is missing or `active = false`, returns a session with `user: undefined` so subsequent `auth()` calls treat the request as unauthenticated and the next navigation redirects to `/login`.
       - `sendVerificationRequest` (D-12): Spanish subject `"Tu link para entrar al panel"`. Body uses voseo-friendly Spanish (`Hacé clic`). Dynamic `import("resend")` keeps the package out of the module-load critical path. The `provider.apiKey` and `provider.from` are populated from the Resend provider config above. Body is brand-neutral (no restaurant name) per CLAUDE.md and PROJECT.md key decisions.

    3. Create `app/api/auth/[...nextauth]/route.ts` with the verbatim one-liner from `<interfaces>`:
       ```typescript
       export { GET, POST } from "@/lib/auth/auth";
       ```
       Auth.js v5 `handlers` export is destructured into GET and POST and re-exported. This single line wires the catch-all route (`/api/auth/signin`, `/api/auth/callback/resend`, `/api/auth/session`, `/api/auth/signout`, etc.).

    4. Create `proxy.ts` at the **repo root** (NOT `middleware.ts`, NOT in `src/`, NOT in `app/`) with the verbatim snippet from `<interfaces>`. Critical invariants:
       - **No `export const runtime`** of any kind. proxy.ts runs Node.js by default in Next.js 16; setting `runtime` throws a build error (research RISK-1).
       - Imports only from `@/lib/auth/auth.config` (NOT `@/lib/auth/auth` — would pull `pg.Pool`, the whole point of the split).
       - Matcher is `["/queue/:path*"]` — only protects the queue routes. `/`, `/login`, `/api/auth/*` remain public so the magic-link callback can land.
       - Redirects unauthenticated `/queue/*` requests to `/login` via `Response.redirect(new URL("/login", req.url))`.

    5. Create `next-auth.d.ts` at repo root for module augmentation so `session.user.email` is typed as `string | null | undefined` correctly (it is by default in Auth.js v5, but pinning prevents breakage if other code paths add type narrowing). Minimal augmentation:
       ```typescript
       import type { DefaultSession } from "next-auth";

       declare module "next-auth" {
         interface Session {
           user: {
             email?: string | null;
           } & DefaultSession["user"];
         }
       }
       ```
       Confirm `tsconfig.json` `include` array picks up root `*.d.ts` files (default Next.js scaffold does).

    6. Run a build to confirm everything compiles end-to-end:
       ```bash
       npm run build
       ```
       This will execute `lib/env.ts createEnv()` at module load — confirms env vars are populated correctly. If build fails on missing env, the human did not complete PLAN-01 Task 3 setup; surface clearly.
  </action>
  <verify>
    <automated>test -f lib/auth/auth.config.ts && test -f lib/auth/auth.ts && test -f app/api/auth/\[...nextauth\]/route.ts && test -f proxy.ts && test -f next-auth.d.ts && grep -q 'import Resend from "next-auth/providers/resend"' lib/auth/auth.config.ts && grep -q 'authorized({' lib/auth/auth.config.ts && grep -qv 'PostgresAdapter' lib/auth/auth.config.ts && grep -qv '@auth/pg-adapter' lib/auth/auth.config.ts && grep -qv "from \"pg\"" lib/auth/auth.config.ts && grep -qv "from '@/lib/db/pool'" lib/auth/auth.config.ts && grep -q 'PostgresAdapter(pool)' lib/auth/auth.ts && grep -q 'strategy: "database"' lib/auth/auth.ts && grep -q 'signIn({ user, email })' lib/auth/auth.ts && grep -q 'email?.verificationRequest' lib/auth/auth.ts && grep -q 'SELECT id, active FROM employees WHERE email' lib/auth/auth.ts && grep -q 'session({ session, user })' lib/auth/auth.ts && grep -q 'SELECT active FROM employees WHERE email' lib/auth/auth.ts && grep -q 'sendVerificationRequest' lib/auth/auth.ts && grep -q 'Tu link para entrar al panel' lib/auth/auth.ts && grep -q "export { GET, POST } from \"@/lib/auth/auth\"" app/api/auth/\[...nextauth\]/route.ts && grep -q 'import { authConfig } from "@/lib/auth/auth.config"' proxy.ts && grep -qv 'export const runtime' proxy.ts && grep -q 'matcher: \["/queue/:path\*"\]' proxy.ts && grep -q 'declare module "next-auth"' next-auth.d.ts && npm run build</automated>
  </verify>
  <acceptance_criteria>
    - `lib/auth/auth.config.ts` exports `authConfig: NextAuthConfig` with Resend provider, `pages.signIn = "/login"`, `pages.error = "/login"`, and `authorized` callback gating `/queue`
    - `lib/auth/auth.config.ts` does NOT import `pg`, `@auth/pg-adapter`, `lib/db/pool.ts`, `lib/db/neon.ts`, or `lib/env.ts`
    - `lib/auth/auth.ts` imports `PostgresAdapter`, `pool`, `sql`, and the lean `authConfig`; exports `handlers, auth, signIn, signOut`
    - `lib/auth/auth.ts` uses `session: { strategy: "database" }`
    - `lib/auth/auth.ts signIn` callback queries `employees` by `user.email` and returns `false` on missing or inactive
    - `lib/auth/auth.ts session` callback re-queries `employees.active` and nullifies `session.user` on missing/inactive
    - `lib/auth/auth.ts sendVerificationRequest` uses Spanish subject `"Tu link para entrar al panel"` and dynamic `import("resend")`
    - `app/api/auth/[...nextauth]/route.ts` is the literal one-line re-export
    - `proxy.ts` is at repo root, imports only `lib/auth/auth.config.ts`, has matcher `["/queue/:path*"]`, has NO `export const runtime`
    - `next-auth.d.ts` declares module augmentation for the `Session` interface
    - `npm run build` exits 0 (confirms env validation passes and types compile)
  </acceptance_criteria>
  <done>
    Split-config Auth.js wired with all three D-09/D-10/D-11 callbacks. Spanish magic-link copy ready (D-12). Proxy at repo root with `/queue` matcher. Build passes — env validation works, all types compile.
  </done>
</task>

<task type="auto">
  <name>Task 2: Build /login + /queue Spanish UI pages</name>
  <files>app/login/page.tsx, app/queue/page.tsx</files>
  <read_first>
    - .planning/phases/01-foundation/01-PATTERNS.md (sections "app/login/page.tsx", "app/queue/page.tsx" — verbatim snippets; "Auth guard (defense-in-depth)" cross-cutting pattern)
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 9 "Phase 1 scope constraint"; Focus Area 10 §"Email existence timing attack" mitigation; "Pitfall: Generic login copy requires NOT reading the error query param")
    - .planning/phases/01-foundation/01-CONTEXT.md (D-10 generic copy, D-22 single-input form, D-23 stub copy)
    - components/ui/button.tsx (PLAN-01 — shadcn Button)
    - components/ui/input.tsx (PLAN-01 — shadcn Input)
    - lib/auth/auth.ts (Task 1 — server-side `auth()` helper)
  </read_first>
  <action>
    1. Create `app/login/page.tsx` with the verbatim snippet from `<interfaces>`. Critical invariants:
       - `"use client"` directive (form submission handler needs client-side state).
       - Uses shadcn `Input` and `Button` (installed by PLAN-01 Task 1).
       - Uses `signIn` from `next-auth/react` with `redirect: false` so the user stays on the login page after submit (so the generic success copy renders, not an Auth.js error redirect).
       - **D-10 enforcement: The `submitted` state shows the SAME copy regardless of whether the email matched `employees`.** The success message is the literal Spanish string `"Si tu email está autorizado, te enviamos un link en breve."` — no other variation, no `?error=Verification` parsing. This is the core anti-enumeration mitigation.
       - Spanish copy: heading `"Acceder al panel"`, button label `"Enviar link"`, placeholder `"tu@email.com"`. Tone is neutral-friendly per SAFE-03 (the broader "empathic and recoverable" rule applies to ALL user copy, not just no-show messages).
       - The `email` input has `type="email"` and `required` for HTML5 client validation. `autoComplete="email"` for browser UX.

    2. Create `app/queue/page.tsx` with the verbatim snippet from `<interfaces>`. Critical invariants:
       - Server Component (NO `"use client"`) — calls server-side `auth()` from `@/lib/auth/auth`.
       - Defense-in-depth double-gate: even though `proxy.ts` already redirects unauth requests, this server component ALSO checks `session?.user` and calls `redirect("/login")` from `next/navigation`. If the proxy matcher silently fails (e.g., misconfigured matcher in a future change), this gate still protects the route.
       - Renders the literal Spanish stub `Hola {session.user.email} — panel próximamente`. Phase 3 replaces this entirely with the live queue panel.
       - Imports `redirect` from `next/navigation` and `auth` from `@/lib/auth/auth`.

    3. Confirm imports resolve correctly via build:
       ```bash
       npm run build
       ```
  </action>
  <verify>
    <automated>test -f app/login/page.tsx && test -f app/queue/page.tsx && grep -q '"use client"' app/login/page.tsx && grep -q 'import { signIn } from "next-auth/react"' app/login/page.tsx && grep -q 'from "@/components/ui/button"' app/login/page.tsx && grep -q 'from "@/components/ui/input"' app/login/page.tsx && grep -q 'Si tu email está autorizado, te enviamos un link en breve' app/login/page.tsx && grep -q 'Acceder al panel' app/login/page.tsx && grep -q 'Enviar link' app/login/page.tsx && grep -qv 'searchParams' app/login/page.tsx && grep -qv 'error=' app/login/page.tsx && grep -qv '"use client"' app/queue/page.tsx && grep -q 'import { redirect } from "next/navigation"' app/queue/page.tsx && grep -q 'import { auth } from "@/lib/auth/auth"' app/queue/page.tsx && grep -q 'await auth()' app/queue/page.tsx && grep -q 'redirect("/login")' app/queue/page.tsx && grep -q 'panel próximamente' app/queue/page.tsx && npm run build</automated>
  </verify>
  <acceptance_criteria>
    - `app/login/page.tsx` is a Client Component using shadcn `Input` + `Button`
    - `app/login/page.tsx` calls `signIn("resend", { email, redirect: false })` on submit
    - `app/login/page.tsx` shows the literal Spanish string `"Si tu email está autorizado, te enviamos un link en breve."` after submit, regardless of validation result
    - `app/login/page.tsx` does NOT read `searchParams` or `?error=` (D-10 anti-enumeration)
    - `app/queue/page.tsx` is a Server Component (no `"use client"`)
    - `app/queue/page.tsx` calls `await auth()` and `redirect("/login")` if no session — defense in depth
    - `app/queue/page.tsx` renders the literal Spanish string `Hola {session.user.email} — panel próximamente`
    - `npm run build` exits 0 with `/login` and `/queue` listed as routes
  </acceptance_criteria>
  <done>
    Spanish `/login` form with anti-enumeration generic copy. Auth-gated `/queue` stub with double-gate (proxy + server-component). Build compiles all routes.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: End-to-end magic-link round-trip verification (live deploy)</name>
  <files>(no new files — operational E2E verification step)</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 11 "SC1 — Auth round-trip" verification checklist; "Common Pitfalls" section)
    - .planning/phases/01-foundation/01-CONTEXT.md (success criterion #1 in ROADMAP)
    - .env.local (must include all 11 keys including AUTH_RESEND_KEY, RESEND_DOMAIN, MAITRE_EMAIL)
    - All files created in this plan's Tasks 1-2
  </read_first>
  <action>
    Claude automates everything testable via CLI/API; the human performs the email-click step (truly cannot be automated — requires inbox access and manual link click in browser).

    **Claude's automated steps:**

    1. Push all Phase 1 work to production:
       ```bash
       git add lib/auth/ app/api/ app/login/ app/queue/ proxy.ts next-auth.d.ts
       git commit -m "feat(01-foundation): wire Auth.js v5 magic-link with employees gate (D-09/D-10/D-11/D-12)"
       git push origin main
       ```
       Wait for Vercel deploy. Capture the production URL from `README.md`:
       ```bash
       PROD_URL=$(grep -oE 'https://[a-z0-9-]+\.vercel\.app' README.md | head -1)
       echo "Production URL: $PROD_URL"
       ```

    2. Verify routes return expected status codes (after deploy completes):
       ```bash
       sleep 30  # crude wait for deploy
       test "$(curl -s -o /dev/null -w '%{http_code}' "$PROD_URL/")" = "200"
       test "$(curl -s -o /dev/null -w '%{http_code}' "$PROD_URL/login")" = "200"
       # /queue without session → proxy redirects → expect 307 (Next.js redirect status)
       REDIRECT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$PROD_URL/queue")
       test "$REDIRECT_STATUS" = "307" || test "$REDIRECT_STATUS" = "302" || test "$REDIRECT_STATUS" = "200"
       # If 200, the server component double-gate may have rendered redirect; check Location header
       curl -s -I "$PROD_URL/queue" | grep -qE '(location:|Location:)' || echo "NOTE: /queue may render via server-component redirect"
       ```

    3. Verify Spanish copy on `/login`:
       ```bash
       curl -s "$PROD_URL/login" | grep -q 'Acceder al panel'
       ```

    4. Test the **rejection path** end-to-end via API (no human needed). Submit an unauthorized email (NOT in `employees`), then check that NO row was inserted in `verification_token`:
       ```bash
       set -a; source .env.local; set +a
       UNAUTH_EMAIL="not-the-maitre-$(date +%s)@example.com"

       # Get CSRF token from Auth.js
       CSRF_RESPONSE=$(curl -s -c /tmp/auth-cookies.txt "$PROD_URL/api/auth/csrf")
       CSRF=$(echo "$CSRF_RESPONSE" | npx tsx -e "process.stdin.on('data', d => { const o = JSON.parse(d.toString()); console.log(o.csrfToken); })")

       # Submit signin request for unauthorized email
       curl -s -b /tmp/auth-cookies.txt -c /tmp/auth-cookies.txt \
         -X POST "$PROD_URL/api/auth/signin/resend" \
         -d "email=${UNAUTH_EMAIL}&csrfToken=${CSRF}&callbackUrl=${PROD_URL}/queue" \
         -o /dev/null

       # Wait briefly for any DB write
       sleep 2

       # Confirm NO verification_token row was inserted for the unauthorized email
       npx tsx -e "
       import('pg').then(async ({ Client }) => {
         const c = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
         await c.connect();
         const { rows } = await c.query('SELECT identifier FROM verification_token WHERE identifier = \$1', ['${UNAUTH_EMAIL}']);
         if (rows.length !== 0) {
           console.error('FAIL: D-09 broken — verification_token row inserted for unauthorized email');
           process.exit(1);
         }
         console.log('OK: D-09 enforced — no verification_token for unauthorized email');
         await c.end();
       });
       "
       ```
       Expected: `OK: D-09 enforced — no verification_token for unauthorized email`. This proves the `signIn` callback correctly returned `false` BEFORE Resend was invoked.

    5. Test the **acceptance path** initiation via API. Submit the maître email, then check that a `verification_token` row WAS inserted:
       ```bash
       set -a; source .env.local; set +a

       # Re-fetch CSRF (cookies may have rotated)
       CSRF_RESPONSE=$(curl -s -c /tmp/auth-cookies-2.txt "$PROD_URL/api/auth/csrf")
       CSRF=$(echo "$CSRF_RESPONSE" | npx tsx -e "process.stdin.on('data', d => { const o = JSON.parse(d.toString()); console.log(o.csrfToken); })")

       # Submit signin request for the maître email
       curl -s -b /tmp/auth-cookies-2.txt -c /tmp/auth-cookies-2.txt \
         -X POST "$PROD_URL/api/auth/signin/resend" \
         -d "email=${MAITRE_EMAIL}&csrfToken=${CSRF}&callbackUrl=${PROD_URL}/queue" \
         -o /dev/null

       sleep 3  # wait for Resend API call + DB write

       npx tsx -e "
       import('pg').then(async ({ Client }) => {
         const c = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
         await c.connect();
         const { rows } = await c.query('SELECT identifier, expires FROM verification_token WHERE identifier = \$1', [process.env.MAITRE_EMAIL]);
         if (rows.length === 0) {
           console.error('FAIL: D-09 over-strict — no verification_token row for authorized maitre');
           process.exit(1);
         }
         console.log('OK: verification_token row inserted for maitre, expires:', rows[0].expires);
         await c.end();
       });
       "
       ```
       Expected: `OK: verification_token row inserted for maitre, expires: <future-date>`.

    **Human-only steps (cannot be automated — inbox + browser link click):**

    6. **Open the maître inbox** (whatever email is in `MAITRE_EMAIL`).
    7. **Confirm the email arrived** (within 1 minute of step 5). Sender: `noreply@<RESEND_DOMAIN>`. Subject: `"Tu link para entrar al panel"`. **NOT in spam folder** (proves Phase 0.1 Resend domain verification worked).
    8. **Click the magic-link** in the email body. Browser should:
       - Navigate to `<PROD_URL>/api/auth/callback/resend?...`
       - Auth.js validates the token, deletes the row from `verification_token`, creates a row in `sessions`, sets a session cookie.
       - Redirects to `<PROD_URL>/queue`.
       - `/queue` renders `Hola <maître-email> — panel próximamente`.
    9. **Confirm the email displayed on `/queue`** matches `MAITRE_EMAIL`.
    10. **Test the D-11 mid-session deactivation** (optional but valuable):
        - In a separate terminal, run:
          ```bash
          set -a; source .env.local; set +a
          npx tsx -e "
          import('pg').then(async ({ Client }) => {
            const c = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
            await c.connect();
            await c.query('UPDATE employees SET active = false WHERE email = \$1', [process.env.MAITRE_EMAIL]);
            console.log('Maitre deactivated');
            await c.end();
          });
          "
          ```
        - Refresh `/queue` in the browser. The `session` callback (D-11) re-queries `employees.active`, finds `false`, nullifies the user, and the server-component double-gate redirects to `/login`. Expected: redirected to `/login`.
        - Re-activate via `npm run seed:maitre` (the script's `ON CONFLICT DO UPDATE SET active = true` re-enables).
    11. **Logout test**: navigate to `<PROD_URL>/api/auth/signout` (or use a logout button if you add one). Should clear the session and redirect to `/login`. Refreshing `/queue` should redirect to `/login`.
  </action>
  <verify>
    <automated>PROD_URL=$(grep -oE 'https://[a-z0-9-]+\.vercel\.app' README.md | head -1) && [ -n "$PROD_URL" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "$PROD_URL/")" = "200" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "$PROD_URL/login")" = "200" ] && curl -s "$PROD_URL/login" | grep -q 'Acceder al panel' && set -a && source .env.local && set +a && npx tsx -e "import('pg').then(async ({Client})=>{const c=new Client({connectionString:process.env.DATABASE_URL_UNPOOLED});await c.connect();const{rows}=await c.query('SELECT email FROM employees WHERE email=\$1 AND active=true',[process.env.MAITRE_EMAIL]);if(rows.length!==1){console.error('Maitre not active');process.exit(1)}console.log('OK: maitre active');await c.end()})"</automated>
  </verify>
  <acceptance_criteria>
    - Production deploy succeeded after pushing this plan's commits (HTTP 200 on `/`)
    - `/login` returns 200 and contains the Spanish heading `"Acceder al panel"`
    - `/queue` without session returns a redirect (307/302) to `/login`, OR renders 200 with server-side redirect headers
    - **D-09 negative path:** Submitting an unauthorized email does NOT insert a row in `verification_token` (Resend was not invoked)
    - **D-09 positive path:** Submitting `MAITRE_EMAIL` DOES insert a row in `verification_token` with a future `expires` timestamp
    - **Human-verified:** Magic-link email arrives in maître inbox (not spam), Spanish subject `"Tu link para entrar al panel"`, click lands on `/queue` showing `Hola <email> — panel próximamente`
    - **Human-verified (optional but tested):** Deactivating `employees.active = false` mid-session and refreshing `/queue` redirects to `/login` (D-11)
    - `MAITRE_EMAIL` row in `employees` has `active = true` after the round-trip
  </acceptance_criteria>
  <what-built>
    - Auth.js v5 magic-link flow live in production
    - `/login` Spanish form
    - `/queue` auth-gated stub showing the maître's email
    - D-09 employees-gate verified (negative + positive paths)
    - D-12 Spanish email subject + body verified live
    - D-11 session re-validation verified (optional)
    - All Phase 1 work pushed to production via `git push origin main`
  </what-built>
  <how-to-verify>
    1. Visit `<PROD_URL>/login` in a browser — confirm Spanish form
    2. Enter a NON-maître email, submit — confirm generic Spanish success copy ("Si tu email está autorizado..."); confirm NO email in your inbox
    3. Enter the `MAITRE_EMAIL`, submit — confirm same generic copy; check inbox
    4. Open the magic-link email in the maître inbox — confirm Spanish subject "Tu link para entrar al panel" and that it's NOT in spam
    5. Click the link — confirm browser lands on `/queue` showing `Hola <maître-email> — panel próximamente`
    6. (Optional D-11 test) Run the deactivate SQL above, refresh `/queue`, confirm redirect to `/login`. Re-activate.
    7. Logout via `/api/auth/signout`, confirm redirect to `/login`, confirm `/queue` no longer accessible
  </how-to-verify>
  <resume-signal>
    Type `approved` after confirming: (a) magic-link email arrived in maître inbox (NOT spam), (b) clicking the link landed on `/queue` showing the maître's email, (c) unauthorized email submission produced no email and no `verification_token` row, (d) `/queue` without session redirects to `/login`. If anything fails (especially "email in spam" — that means Resend domain verification is incomplete and PLAN-04 is broken in production), describe the issue.
  </resume-signal>
  <done>
    STAFF-01 success criterion fully met: maître completes the magic-link round-trip end-to-end on the live production URL. D-09 (employees gate before email send), D-10 (generic copy), D-11 (mid-session re-validation), D-12 (Spanish subject/body) all enforced and verified. Phase 1 ROADMAP success criterion #1 satisfied. The pilot can now bookmark `<PROD_URL>` and log in.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Public internet → `/login` | Anyone can submit any email; `signIn` callback gates which emails get magic-links |
| Resend → maître inbox | Magic-link transmitted over email; HTTPS+SPF+DKIM+DMARC required (Phase 0.1) |
| Browser → `/api/auth/callback/resend` | Magic-link click; token validated against `verification_token` table |
| Cookie → `auth()` server helper | Session cookie validated against `sessions` table on every request |
| `auth()` → `employees` table | D-11 re-validates `active` on every session read |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-01 (AUTH-01) | Spoofing | Magic-link replay attack | mitigate | Auth.js single-use enforcement: `verification_token` row deleted on first successful click; subsequent clicks fail. Built-in. Plus 24h `expires` (default Auth.js). HTTPS-only deployment via Vercel. |
| T-04-02 (AUTH-01) | Information Disclosure | Magic-link token leaked via email forwarding / referrer | accept | Inherent risk of magic-link auth; mitigated by single-use + short expiry. Vercel forces HTTPS so referrer cannot leak token to plaintext destinations. The pilot uses their own inbox — same trust as any password reset flow. |
| T-04-03 (AUTH-01) | Information Disclosure | Email enumeration via `/login` response variation (D-10 violation) | mitigate | `app/login/page.tsx` shows literal generic copy `"Si tu email está autorizado, te enviamos un link en breve."` regardless of `signIn` callback result. Code does NOT read `searchParams.error`. `pages.error: "/login"` in `auth.config.ts` ensures Auth.js error redirects also land on the same `/login` page (whose UI is independent of the error param). Verified by acceptance criteria grep. |
| T-04-04 (AUTH-01) | Brute force | Adversary submits many emails to enumerate via DB load timing | accept | Rate limiting is Phase 4 (DEMO-03 pilot-readiness gate, ROADMAP success criterion 1a). Phase 1 accepts this risk for the 7-day window — pilot scale is <20 concurrent diners; DB load on `employees` lookup is negligible. |
| T-04-05 (AUTH-02) | Authorization Bypass | Non-employee with stolen magic-link token accesses `/queue` | mitigate | The only way to GET a magic-link is to first pass `signIn` callback's `employees` check (D-09). Even if a token were stolen mid-transit, the legitimate recipient was an employee. Token also single-use. |
| T-04-06 (AUTH-02) | Elevation of Privilege | Employee deactivated mid-session retains panel access | mitigate | D-11: `session` callback re-queries `employees.active` on every session read. If `active = false`, `session.user` is nullified, server-component double-gate in `/queue` triggers `redirect("/login")`. Tested in human checkpoint step 10. |
| T-04-07 (AUTH-02) | Authorization Bypass | proxy.ts matcher misconfigured, allows `/queue` without auth | mitigate | Defense-in-depth: `app/queue/page.tsx` Server Component also calls `await auth()` and `redirect("/login")` if no session. Both gates required. |
| T-04-08 (DATA-02) | Information Disclosure | Auth.js debug logs leak emails to Vercel logs | mitigate | NextAuth defaults `debug: false`. Code does NOT enable debug. The `signIn` callback returns `false` silently (no `console.log(email)`). The `session` callback also no-logs. `lib/log.ts` PII helper lands in Phase 2 (SAFE-01) — Phase 1 simply does not log auth-flow PII. |
| T-04-09 (DATA-02) | Information Disclosure | `sendVerificationRequest` logs email or URL to console on failure | mitigate | The Resend SDK throws on send failure; the error propagates up to Auth.js which logs only the provider id (not the email or URL). Code does NOT add `console.log` around the send. If Resend fails, Auth.js redirects to `/login` (per `pages.error`) — no PII leak. |
| T-04-10 (CONFIG-01) | Denial of Service | RESEND_DOMAIN env var unset → magic-link from `noreply@undefined` → bounces | mitigate | `lib/env.ts` validates `RESEND_DOMAIN: z.string().min(1)`. Build fails if missing. PLAN-01 Task 3 setup explicitly required setting it in all 3 envs. `auth.config.ts` falls back to `resend.dev` only if undefined at module load (defensive — would still bounce in production but not crash the build). |
| T-04-11 | Tampering | Adversary signs CSRF tokens to spoof signin requests | mitigate | Auth.js v5 built-in CSRF protection: `/api/auth/csrf` issues per-session token, validates on POST to `/api/auth/signin/resend`. Verified by Task 3 step 4 — automated test fetches CSRF before submitting. |
| T-04-12 (AUTH-01) | Spoofing | Magic-link delivered to spam folder → maître locked out | mitigate | Phase 0.1 prerequisite required Resend domain verification (SPF/DKIM/DMARC). PLAN-01 Task 3 confirmed "verified" status before this plan ran. Human verification step 7 in Task 3 explicitly checks "NOT in spam folder". If found in spam at this stage, Phase 0.1 was incomplete and pilot is blocked — fix before declaring Phase 1 done. |
</threat_model>

<verification>
**End-to-end checks for this plan:**
1. `/login` returns 200 with Spanish heading `"Acceder al panel"`
2. `/queue` without session redirects (307/302) to `/login` (proxy + server-component double-gate)
3. POST `/api/auth/signin/resend` with unauthorized email creates NO `verification_token` row (D-09 negative)
4. POST `/api/auth/signin/resend` with `MAITRE_EMAIL` creates a `verification_token` row (D-09 positive)
5. Human: magic-link email arrives in maître inbox (NOT spam), Spanish subject, click lands on `/queue` with email displayed
6. Human (optional): deactivating `employees.active = false` mid-session causes next `/queue` request to redirect to `/login` (D-11)
7. Logout clears session; subsequent `/queue` request redirects to `/login`
8. Production deploy of all Phase 1 work serves 200 on `/` and the auth flow is fully live
</verification>

<success_criteria>
1. **STAFF-01 (full):** Magic-link round-trip from `/login` → inbox → click → `/queue` works end-to-end on the live production URL. Validates against `employees` table per D-09. Generic copy regardless of email match per D-10. Re-validates `active` per D-11. Spanish subject/body per D-12.
2. **DEMO-01 still satisfied:** Production URL serves 200 after this plan's deploy.
3. **DEMO-02 still satisfied:** All committed code in public repo; nothing logged that leaks secrets.
4. **Phase 1 complete:** All 5 ROADMAP success criteria for Phase 1 satisfied across PLAN-01..04.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-04-auth-magic-link-SUMMARY.md` documenting:
- Final production URL (the pilot's bookmark)
- Confirmed end-to-end flow timestamps (e.g., "submit→email arrived in 8s, click→/queue in 1s")
- Confirmation that magic-link arrived in inbox, not spam (Phase 0.1 success)
- Whether D-11 mid-session deactivation was tested (yes/no — it's optional)
- Any deviations from the plan (e.g., if `sendVerificationRequest` needed adjustments for Resend SDK version)
- Phase 1 closeout: confirm all 5 ROADMAP success criteria pass and Phase 1 → Phase 2 transition is unblocked
</output>
