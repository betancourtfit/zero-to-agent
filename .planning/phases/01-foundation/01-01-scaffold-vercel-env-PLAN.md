---
phase: 01-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - tsconfig.json
  - next.config.ts
  - app/layout.tsx
  - app/page.tsx
  - app/globals.css
  - components.json
  - components/ui/button.tsx
  - components/ui/input.tsx
  - lib/utils.ts
  - lib/env.ts
  - .env.example
  - .gitignore
  - README.md
  - .vercel/project.json
autonomous: false
requirements:
  - DEMO-01
  - DEMO-02
user_setup:
  - service: vercel
    why: "Project linking + auto-deploy via GitHub integration"
    env_vars:
      - name: VERCEL_TOKEN
        source: "Vercel Dashboard -> Settings -> Tokens (LOCAL ONLY, never set in Vercel dashboard env vars)"
    dashboard_config:
      - task: "Authorize GitHub integration on Vercel project (one-time browser consent)"
        location: "Vercel Dashboard -> Project -> Settings -> Git"
      - task: "Confirm Neon Postgres, Upstash Redis, Edge Config marketplace integrations attached (Phase 0.3 prereq)"
        location: "Vercel Dashboard -> Project -> Storage / Integrations"
  - service: github
    why: "Public repo for DEMO-02 + Vercel auto-deploy trigger"
    dashboard_config:
      - task: "Create public repo via gh CLI or browser"
        location: "github.com (must be PUBLIC per DEMO-02)"
  - service: resend
    why: "Magic-link email sender (used in PLAN-04). RESEND_DOMAIN must be verified before STAFF-01 ships."
    env_vars:
      - name: AUTH_RESEND_KEY
        source: "Resend Dashboard -> API Keys"
      - name: RESEND_DOMAIN
        source: "Resend Dashboard -> Domains (must show 'verified')"
    dashboard_config:
      - task: "Verify domain DNS (SPF/DKIM/DMARC) — 0-48h propagation, BLOCKING for PLAN-04"
        location: "Resend Dashboard -> Domains"

must_haves:
  truths:
    - "Public Vercel deployment URL responds 200 on /"
    - "Production URL is stable across 2 deploys (pilot can bookmark)"
    - ".env.example lists every key used in lib/env.ts"
    - "Fresh clone + vercel env pull + npm install + npm run dev succeeds"
    - "vercel env ls shows every required key in production AND preview AND development"
    - "Public GitHub repo exists with README"
  artifacts:
    - path: "package.json"
      provides: "Next.js 16 app + dependencies pinned"
      contains: "\"next\": \"^16"
    - path: "next.config.ts"
      provides: "Next config (no withWorkflow yet — added Phase 2)"
    - path: "lib/env.ts"
      provides: "Type-safe env access via @t3-oss/env-nextjs + zod"
      exports: ["env"]
    - path: ".env.example"
      provides: "Source-of-truth env key inventory"
      contains: "MAITRE_EMAIL=pilot-maitre@example.com"
    - path: "app/layout.tsx"
      provides: "Root layout with <html lang=\"es\">"
      contains: "lang=\"es\""
    - path: "app/page.tsx"
      provides: "Spanish landing per D-21"
      contains: "Cola de Espera"
    - path: "components/ui/button.tsx"
      provides: "shadcn Button (used by /login in PLAN-04)"
    - path: "components/ui/input.tsx"
      provides: "shadcn Input (used by /login in PLAN-04)"
    - path: "README.md"
      provides: "Project name, stack, quickstart, deploy URL placeholder"
    - path: ".vercel/project.json"
      provides: "Vercel project linked"
  key_links:
    - from: "GitHub main branch push"
      to: "Vercel auto-deploy"
      via: "Vercel GitHub integration"
      pattern: "push to main triggers production deploy"
    - from: "lib/env.ts"
      to: ".env.example"
      via: "every server/client key has matching .env.example line"
      pattern: "createEnv server keys subset of .env.example keys"
---

<objective>
Scaffold a Next.js 16 app, install Phase 1 dependencies, wire shadcn/ui, set up `lib/env.ts` env validation, write `.env.example` as the env key inventory, link to a public GitHub repo, link to Vercel, sync env vars to all 3 environments, and ship an empty-but-deployed app to a stable production Vercel URL.

Purpose: Establish the deploy substrate every later phase pushes to. Without this plan complete, no other plan in Phase 1 can be deployed or verified end-to-end.
Output: A live `<project>.vercel.app` URL responding 200 with Spanish landing page; public GitHub repo; `.env.example` source-of-truth; `lib/env.ts` type-safe env; shadcn `Button` + `Input` ready for the login form.
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
@CLAUDE.md

<interfaces>
<!-- Verbatim canonical snippets from 01-PATTERNS.md and 01-RESEARCH.md. -->
<!-- Executor uses these directly — no codebase exploration needed. -->

From 01-PATTERNS.md `lib/env.ts` (lines 171-208) — copy verbatim:
```typescript
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    DATABASE_URL_UNPOOLED: z.string().url(),
    AUTH_SECRET: z.string().min(1),
    AUTH_RESEND_KEY: z.string().min(1),
    RESEND_DOMAIN: z.string().min(1),
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
    EDGE_CONFIG: z.string().min(1),
    MCP_API_KEY: z.string().min(1),
    MAITRE_EMAIL: z.string().email(),
    VERCEL_TOKEN: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_BASE_URL: z.string().url(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_RESEND_KEY: process.env.AUTH_RESEND_KEY,
    RESEND_DOMAIN: process.env.RESEND_DOMAIN,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    EDGE_CONFIG: process.env.EDGE_CONFIG,
    MCP_API_KEY: process.env.MCP_API_KEY,
    MAITRE_EMAIL: process.env.MAITRE_EMAIL,
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
```

From 01-PATTERNS.md `app/layout.tsx` (lines 455-477) — copy verbatim:
```typescript
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cola de Espera",
  description: "Sistema de reservas para restaurantes",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
```

From 01-PATTERNS.md `app/page.tsx` (lines 493-512) — copy verbatim:
```typescript
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Cola de Espera</h1>
      <p className="text-muted-foreground">
        Gestión de reservas para tu restaurante, sin complicaciones.
      </p>
      <Link
        href="/login"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Ingresar al panel
      </Link>
    </main>
  );
}
```

From 01-PATTERNS.md `.env.example` (lines 1039-1067) — copy verbatim:
```bash
# Database (Neon Postgres — provisioned by Vercel Marketplace)
DATABASE_URL=postgresql://user:pass@ep-pooled.neon.tech/dbname?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://user:pass@ep-direct.neon.tech/dbname?sslmode=require

# Auth.js v5
AUTH_SECRET=change-me-generate-with-npx-auth-secret
AUTH_RESEND_KEY=re_xxxxxxxxxxxx
RESEND_DOMAIN=mail.yourdomain.com

# Upstash Redis (KV — provisioned by Vercel Marketplace)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxxxxxxxxxx

# Vercel Edge Config (provisioned by Vercel Marketplace)
EDGE_CONFIG=https://edge-config.vercel.com/ecfg_xxxx?token=xxxx

# MCP server bearer token (generate: openssl rand -hex 32)
MCP_API_KEY=change-me-generate-with-openssl-rand-hex-32

# App URL (set to production URL after vercel link)
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Maître seed (set real email in .env.local and in all 3 Vercel envs)
MAITRE_EMAIL=pilot-maitre@example.com

# Vercel API token — LOCAL ONLY, never set in Vercel dashboard
# Used only by scripts/edge-config-seed.ts
VERCEL_TOKEN=
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Scaffold Next.js 16 + install dependencies + shadcn init</name>
  <files>package.json, tsconfig.json, next.config.ts, app/layout.tsx, app/page.tsx, app/globals.css, components.json, components/ui/button.tsx, components/ui/input.tsx, lib/utils.ts, .gitignore</files>
  <read_first>
    - .planning/phases/01-foundation/01-PATTERNS.md (sections "next.config.ts", "app/layout.tsx", "app/page.tsx", "Shared Cross-Cutting Conventions" — import alias)
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 1 "Next.js 16 Scaffolding" — verified npm version 16.2.4 + create-next-app flags; Focus Area 9 "shadcn/ui + Tailwind v4")
    - CLAUDE.md (Spanish UI copy rule, English code, no comments unless WHY non-obvious, single Next.js app)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-21 landing copy, D-24 minimal layout, D-25 single app, D-26 lib/ layout)
  </read_first>
  <action>
    1. From repo root `/Users/juanabetancourt/Documents/github/aprender/zero-to-agent`, scaffold the Next.js 16 app **into the current directory** (the repo already has `.planning/`, `CLAUDE.md`, etc.). Run:
       ```bash
       npx --yes create-next-app@latest . \
         --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint --use-npm
       ```
       When the CLI prompts about non-empty directory or any other prompts, accept all defaults that align with these flags. If it complains the directory is non-empty, allow overwriting (existing `.planning/`, `CLAUDE.md`, `.git/`, `brief.md`, `scope_hackathon_mvp.md`, `.env*` files MUST be preserved — verify after scaffold). Pin the resolved Next version in `package.json` at `^16.0.0` minimum (verified 16.2.4 in research).

    2. Install runtime dependencies (Auth + DB + storage + env validation + email):
       ```bash
       npm install next-auth@beta @auth/pg-adapter pg @neondatabase/serverless @upstash/redis @vercel/edge-config @t3-oss/env-nextjs zod resend
       npm install -D tsx @types/pg
       ```

    3. Init shadcn/ui (Tailwind v4 mode, "new-york" style, default options):
       ```bash
       npx --yes shadcn@latest init --yes --base-color neutral --no-src-dir
       npx --yes shadcn@latest add button input
       ```
       This creates `components.json`, `components/ui/button.tsx`, `components/ui/input.tsx`, `lib/utils.ts`. If shadcn writes a `lib/utils.ts`, keep it.

    4. Replace `app/layout.tsx` with the verbatim Spanish layout snippet from `<interfaces>` above (D-24: only `<html lang="es">`, no global chrome).

    5. Replace `app/page.tsx` with the verbatim Spanish landing snippet from `<interfaces>` above (D-21: project name + tagline + link to `/login`). The href `/login` will 404 until PLAN-04 ships — that is expected for Phase 1 wave 1.

    6. Replace `next.config.ts` with the minimal config below (Phase 2 will wrap with `withWorkflow`):
       ```typescript
       import type { NextConfig } from "next";

       const nextConfig: NextConfig = {};

       export default nextConfig;
       ```
       Do NOT add `withWorkflow` yet — the `workflow` package is a Phase 2 dependency and importing it now would fail the build.

    7. Append to `.gitignore` (or create if missing): `.env*.local`, `.vercel`, `.env`. Confirm `.env.local`, `.env.production.local`, `.env.development.local`, and `.vercel/` are excluded. Do NOT exclude `.env.example`.

    8. Verify build succeeds locally:
       ```bash
       SKIP_ENV_VALIDATION=1 npm run build
       ```
       (`SKIP_ENV_VALIDATION` is needed because `lib/env.ts` is created in Task 2; this preliminary build confirms scaffold integrity.)
  </action>
  <verify>
    <automated>test -f package.json && test -f next.config.ts && test -f app/layout.tsx && test -f app/page.tsx && test -f components/ui/button.tsx && test -f components/ui/input.tsx && grep -q '"next":' package.json && grep -q '"next-auth":' package.json && grep -q '"@auth/pg-adapter":' package.json && grep -q '"@neondatabase/serverless":' package.json && grep -q '"@upstash/redis":' package.json && grep -q '"@vercel/edge-config":' package.json && grep -q '"@t3-oss/env-nextjs":' package.json && grep -q '"resend":' package.json && grep -q '"tsx":' package.json && grep -q 'lang="es"' app/layout.tsx && grep -q 'Cola de Espera' app/page.tsx && grep -q 'Ingresar al panel' app/page.tsx && grep -q '\.env\*\.local' .gitignore && grep -q '\.vercel' .gitignore && test -d .planning && test -f CLAUDE.md</automated>
  </verify>
  <acceptance_criteria>
    - `package.json` exists with `next`, `next-auth`, `@auth/pg-adapter`, `pg`, `@neondatabase/serverless`, `@upstash/redis`, `@vercel/edge-config`, `@t3-oss/env-nextjs`, `zod`, `resend` in dependencies
    - `package.json` has `tsx` and `@types/pg` in devDependencies
    - `tsconfig.json` has `"@/*": ["./*"]` in `paths` (set by create-next-app `--import-alias "@/*"`)
    - `app/layout.tsx` contains the literal string `lang="es"`
    - `app/page.tsx` contains the literal strings `Cola de Espera` and `Ingresar al panel`
    - `components/ui/button.tsx` and `components/ui/input.tsx` exist (shadcn-installed)
    - `.gitignore` excludes `.env*.local` and `.vercel`
    - `.planning/` directory still present (NOT deleted by scaffold)
    - `CLAUDE.md` still present
    - `SKIP_ENV_VALIDATION=1 npm run build` exits 0
  </acceptance_criteria>
  <done>
    Next.js 16 app scaffolded, all Phase 1 npm dependencies installed, shadcn `Button` + `Input` ready, Spanish landing page renders the home route, layout uses `<html lang="es">`, gitignore protects secrets, preliminary build passes with env validation skipped.
  </done>
</task>

<task type="auto">
  <name>Task 2: lib/env.ts validation + .env.example + README skeleton</name>
  <files>lib/env.ts, .env.example, README.md, scripts/check-env-sync.sh</files>
  <read_first>
    - .planning/phases/01-foundation/01-PATTERNS.md (sections "lib/env.ts", ".env.example" — full snippets)
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 4 "Env Var Validation" — full lib/env.ts; pre-deploy sync check rationale; RISK-4 — do not import lib/env.ts from proxy.ts)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-18 placeholder values, D-19 server+client schemas, D-20 .env.example as source of truth)
    - app/page.tsx (just created — confirm the landing copy is committed before referencing the deploy URL in README)
  </read_first>
  <action>
    1. Create `lib/env.ts` with the verbatim snippet from `<interfaces>` (full server schema with 11 keys, client schema with `NEXT_PUBLIC_BASE_URL`, complete `runtimeEnv` mapping, `skipValidation` gate). This is the single import point for env vars in production code.

    2. Create `.env.example` at repo root with the verbatim snippet from `<interfaces>` (placeholders only — no real secrets, no real domains). Order matches the comments. `MAITRE_EMAIL=pilot-maitre@example.com` per D-18. `VERCEL_TOKEN=` (intentionally empty, with comment indicating LOCAL ONLY).

    3. Create `scripts/check-env-sync.sh` (executable bash) that asserts every server+client key in `lib/env.ts` `runtimeEnv` block has a matching `^KEY=` line in `.env.example`:
       ```bash
       #!/usr/bin/env bash
       set -euo pipefail
       MISSING=()
       # Extract keys from runtimeEnv block in lib/env.ts
       KEYS=$(awk '/runtimeEnv:/,/^  \},/' lib/env.ts | grep -oE '^    [A-Z_]+:' | tr -d ' :' | sort -u)
       for key in $KEYS; do
         if ! grep -qE "^${key}=" .env.example; then
           MISSING+=("$key")
         fi
       done
       if [ ${#MISSING[@]} -gt 0 ]; then
         echo "ERROR: Keys in lib/env.ts runtimeEnv missing from .env.example:" >&2
         printf '  - %s\n' "${MISSING[@]}" >&2
         exit 1
       fi
       echo "Env sync OK: $(echo "$KEYS" | wc -l | tr -d ' ') keys verified"
       ```
       `chmod +x scripts/check-env-sync.sh`. Add a `package.json` script: `"check:env-sync": "bash scripts/check-env-sync.sh"`.

    4. Create `README.md` skeleton (Spanish project name, English structure for hackathon judges):
       ```markdown
       # Cola de Espera (Restaurant Queue MVP)

       Restaurant waitlist MVP for the hackathon pilot. Spanish chatbot for diners, auth-protected panel for the maître, durable WDK workflow per reservation, all on Vercel.

       **Production URL:** _set after `vercel link` — pilot bookmarks this_

       ## Stack

       - Next.js 16 (App Router, Turbopack, `proxy.ts` not `middleware.ts`)
       - Neon Postgres (`@neondatabase/serverless` for app + `pg.Pool` for Auth.js)
       - Upstash Redis (`@upstash/redis`)
       - Vercel Edge Config (operational params)
       - Auth.js v5 (`next-auth@beta`) + Resend magic-link
       - Tailwind v4 + shadcn/ui

       ## Quickstart (local dev)

       ```bash
       git clone <repo-url>
       cd zero-to-agent
       npm install
       vercel link            # link to existing Vercel project
       vercel env pull .env.local
       npm run db:migrate     # available after PLAN-03
       npm run seed:maitre    # available after PLAN-03
       npm run dev
       ```

       Open http://localhost:3000 — Spanish landing page.

       ## Phase 1 scripts (added across plans)

       - `npm run dev` — local dev server
       - `npm run build` — production build (env validation runs)
       - `npm run check:env-sync` — assert lib/env.ts and .env.example agree
       - `npm run db:migrate` — apply forward-only SQL migrations (PLAN-03)
       - `npm run seed:maitre` — upsert MAITRE_EMAIL into employees (PLAN-03)
       - `npm run edge-config:seed` — seed Edge Config from edge-config/seed.json (PLAN-02)
       - `npm run smoke:kv` — Upstash Redis ping/round-trip (PLAN-02)
       - `npm run test:pg` — two-clients load test (PLAN-03)

       ## Environment variables

       See `.env.example` for the full inventory. Every key listed there must be set in all 3 Vercel environments (production, preview, development) per Pitfall #18.

       ## Project docs

       - `.planning/PROJECT.md` — vision and constraints
       - `.planning/ROADMAP.md` — 4-phase plan
       - `.planning/REQUIREMENTS.md` — 32 v1 requirements
       - `CLAUDE.md` — code style, stack lock, conventions
       ```

    5. Run `npm run check:env-sync` and confirm it reports "Env sync OK: 12 keys verified" (11 server + 1 client). If any key mismatch, fix `.env.example` (do NOT remove keys from `lib/env.ts`).
  </action>
  <verify>
    <automated>test -f lib/env.ts && test -f .env.example && test -f README.md && test -x scripts/check-env-sync.sh && grep -q 'createEnv' lib/env.ts && grep -q 'DATABASE_URL_UNPOOLED' lib/env.ts && grep -q 'MAITRE_EMAIL' lib/env.ts && grep -q 'VERCEL_TOKEN' lib/env.ts && grep -q 'NEXT_PUBLIC_BASE_URL' lib/env.ts && grep -q 'skipValidation' lib/env.ts && grep -q '^DATABASE_URL=' .env.example && grep -q '^DATABASE_URL_UNPOOLED=' .env.example && grep -q '^MAITRE_EMAIL=pilot-maitre@example.com' .env.example && grep -q '^VERCEL_TOKEN=' .env.example && grep -q '^EDGE_CONFIG=' .env.example && grep -q '^UPSTASH_REDIS_REST_URL=' .env.example && grep -q 'Cola de Espera' README.md && grep -q '"check:env-sync":' package.json && bash scripts/check-env-sync.sh</automated>
  </verify>
  <acceptance_criteria>
    - `lib/env.ts` exports `env` from `createEnv()` with both `server` and `client` sections
    - `lib/env.ts` lists all 11 server keys: DATABASE_URL, DATABASE_URL_UNPOOLED, AUTH_SECRET, AUTH_RESEND_KEY, RESEND_DOMAIN, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, EDGE_CONFIG, MCP_API_KEY, MAITRE_EMAIL, VERCEL_TOKEN
    - `lib/env.ts` lists 1 client key: NEXT_PUBLIC_BASE_URL
    - `lib/env.ts` includes `skipValidation: !!process.env.SKIP_ENV_VALIDATION`
    - `.env.example` has every key from `lib/env.ts runtimeEnv` block (verified by `bash scripts/check-env-sync.sh` exit 0)
    - `.env.example` placeholders contain NO real secrets (`AUTH_SECRET=change-me-generate-with-npx-auth-secret`, `MCP_API_KEY=change-me-generate-with-openssl-rand-hex-32`, no live tokens)
    - `README.md` lists production URL placeholder and Spanish project name
    - `package.json` has `"check:env-sync": "bash scripts/check-env-sync.sh"` script
    - `bash scripts/check-env-sync.sh` exits 0 with message "Env sync OK: 12 keys verified"
  </acceptance_criteria>
  <done>
    Type-safe env access centralized in `lib/env.ts`. `.env.example` is the documented source-of-truth for env keys. CI/local-pre-deploy script (`check:env-sync`) prevents drift. README documents the project, stack, and quickstart for DEMO-02.
  </done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 3: Vercel link + GitHub repo + env vars in all 3 environments + first prod deploy</name>
  <files>.vercel/project.json, .env.local (local only — gitignored), README.md (URL update)</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 8 "Vercel Project Linking + Auto-Deploy" — full setup flow; "Pitfall #18 mitigation"; A1 assumption)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-13 main-deploys-prod, D-14 free .vercel.app alias, D-16 env vars in all 3 envs)
    - .planning/research/PITFALLS.md sections #11 (Resend), #18 (env vars), #19 (push to prod each phase)
    - README.md (just created — production URL placeholder needs to be filled after deploy)
    - .env.example (Task 2) — list of keys to provision in Vercel
  </read_first>
  <action>
    This task requires human action because it involves (a) creating a public GitHub repo (browser/CLI auth), (b) `vercel link` (browser auth), (c) Vercel marketplace integration consents (browser), and (d) Resend account setup. Claude automates everything that has a CLI/API path; the human is asked only to authenticate when prompted by `gh auth login` / `vercel login` / browser-based marketplace consent, and to confirm they have completed Phase 0 prerequisite 0.1 (Resend domain verified).

    **Claude's automated steps:**

    1. Verify GitHub CLI authenticated:
       ```bash
       gh auth status || echo "Run 'gh auth login' first"
       ```
       If not authenticated, surface this in the human-action prompt.

    2. Verify Vercel CLI authenticated:
       ```bash
       vercel whoami || echo "Run 'vercel login' first"
       ```

    3. Create public GitHub repo (if not already):
       ```bash
       git init 2>/dev/null || true
       git add -A
       git commit -m "chore(01-foundation): scaffold Next.js 16 + env validation + README" || echo "nothing to commit"
       gh repo create zero-to-agent --public --source=. --remote=origin --push
       ```
       If the repo already exists, just push: `git push -u origin main`.

    4. Link to Vercel (creates `.vercel/project.json`):
       ```bash
       vercel link --yes
       ```
       If `--yes` cannot resolve a project (first time), the human will need to select org + new project name in the interactive prompt. Surface this as part of the checkpoint.

    5. After link, automate marketplace integration check:
       ```bash
       vercel env ls
       ```
       Capture the output. Check that the following env vars are present in production, preview, AND development. If any missing, list them in the checkpoint message:
       - DATABASE_URL, DATABASE_URL_UNPOOLED (Neon)
       - UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (Upstash)
       - EDGE_CONFIG (Edge Config)

    6. For env vars that Claude can set non-interactively (auth + Resend + base URL + maître + MCP key), generate and add them via `vercel env add`:
       ```bash
       # Generate AUTH_SECRET (Auth.js v5 secret) for all 3 envs
       AUTH_SECRET=$(npx --yes auth secret --raw 2>/dev/null || openssl rand -base64 32)
       printf '%s' "$AUTH_SECRET" | vercel env add AUTH_SECRET production
       printf '%s' "$AUTH_SECRET" | vercel env add AUTH_SECRET preview
       printf '%s' "$AUTH_SECRET" | vercel env add AUTH_SECRET development

       # Generate MCP_API_KEY for all 3 envs
       MCP_KEY=$(openssl rand -hex 32)
       printf '%s' "$MCP_KEY" | vercel env add MCP_API_KEY production
       printf '%s' "$MCP_KEY" | vercel env add MCP_API_KEY preview
       printf '%s' "$MCP_KEY" | vercel env add MCP_API_KEY development
       ```
       For `AUTH_RESEND_KEY`, `RESEND_DOMAIN`, `MAITRE_EMAIL`, `NEXT_PUBLIC_BASE_URL` — these need values from the human (Resend dashboard, pilot's email, deployed URL). Surface them in the checkpoint message with explicit `vercel env add` commands the human runs.

    7. Pull all envs to local:
       ```bash
       vercel env pull .env.local
       ```

    8. Trigger first production deploy (must use auto-deploy, NOT `vercel --prod` per D-13):
       ```bash
       git push origin main
       ```
       Wait for deploy to complete. Capture the production URL via `vercel ls --prod | head -2`.

    9. Update `README.md` to replace `_set after \`vercel link\` — pilot bookmarks this_` with the actual production URL (e.g., `https://zero-to-agent.vercel.app`). Commit:
       ```bash
       git add README.md && git commit -m "docs(01-foundation): record production URL in README" && git push origin main
       ```

    10. Run final `vercel env ls` and capture full output for verification.

    **Human-only steps (surface in checkpoint message):**

    Tell the human:
    1. **Confirm Phase 0.1 complete:** Resend domain verified (DNS SPF/DKIM/DMARC propagated). Without this, PLAN-04 cannot ship STAFF-01. Check Resend Dashboard -> Domains for "verified" status.
    2. **If `vercel link` is interactive on first run:** select your Vercel org and choose "Create new project" with name `zero-to-agent` (or your preference — note that `<project-name>.vercel.app` will be the pilot URL).
    3. **If marketplace integrations missing:** open Vercel Dashboard -> Project -> Storage and connect Neon Postgres, Upstash Redis, Edge Config (browser consent required, one-time). Confirm env vars auto-populate, then re-run `vercel env pull .env.local`.
    4. **Set human-required env vars in all 3 envs** (production, preview, development):
       ```bash
       # AUTH_RESEND_KEY (Resend Dashboard -> API Keys)
       vercel env add AUTH_RESEND_KEY production   # paste re_xxxxx
       vercel env add AUTH_RESEND_KEY preview
       vercel env add AUTH_RESEND_KEY development

       # RESEND_DOMAIN (Resend Dashboard -> Domains -> verified domain)
       vercel env add RESEND_DOMAIN production    # e.g. mail.yourdomain.com
       vercel env add RESEND_DOMAIN preview
       vercel env add RESEND_DOMAIN development

       # MAITRE_EMAIL (the pilot's real email)
       vercel env add MAITRE_EMAIL production     # e.g. pilot@restaurant.com
       vercel env add MAITRE_EMAIL preview
       vercel env add MAITRE_EMAIL development

       # NEXT_PUBLIC_BASE_URL (set per environment)
       vercel env add NEXT_PUBLIC_BASE_URL production    # https://<project>.vercel.app
       vercel env add NEXT_PUBLIC_BASE_URL preview       # https://<project>.vercel.app (preview will be overridden per-deploy by Vercel; OK)
       vercel env add NEXT_PUBLIC_BASE_URL development   # http://localhost:3000
       ```
    5. **Do NOT set `VERCEL_TOKEN` in Vercel** — it is local-only. Add to `.env.local` after generating from Vercel Dashboard -> Settings -> Tokens.
    6. **After all env vars set:** `vercel env pull .env.local` again, then trigger a redeploy with `git commit --allow-empty -m "chore: trigger redeploy with full env"` && `git push`.
    7. **Bookmark the production URL** (`<project>.vercel.app`) — this is what the pilot uses. Preview URLs (e.g., `<project>-abc123.vercel.app`) are NOT stable — do NOT bookmark those.
  </action>
  <verify>
    <automated>test -f .vercel/project.json && grep -q 'projectId' .vercel/project.json && gh repo view --json visibility 2>/dev/null | grep -q '"visibility":"PUBLIC"' && vercel env ls 2>&1 | grep -E '(DATABASE_URL|UPSTASH_REDIS_REST_URL|EDGE_CONFIG|AUTH_SECRET|AUTH_RESEND_KEY|RESEND_DOMAIN|MAITRE_EMAIL|MCP_API_KEY|NEXT_PUBLIC_BASE_URL)' | wc -l | awk '$1 >= 9 {exit 0} {exit 1}' && PROD_URL=$(vercel ls --prod 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | head -1) && [ -n "$PROD_URL" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "$PROD_URL/")" = "200" ]</automated>
  </verify>
  <acceptance_criteria>
    - `.vercel/project.json` exists with a `projectId`
    - `gh repo view --json visibility` returns `"visibility":"PUBLIC"` (DEMO-02)
    - `vercel env ls` shows DATABASE_URL, DATABASE_URL_UNPOOLED, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, EDGE_CONFIG, AUTH_SECRET, AUTH_RESEND_KEY, RESEND_DOMAIN, MAITRE_EMAIL, MCP_API_KEY, NEXT_PUBLIC_BASE_URL — each set in production, preview, AND development (3 environments × 11 keys minimum)
    - `vercel ls --prod` returns a stable `<project>.vercel.app` URL
    - `curl -s -o /dev/null -w "%{http_code}" https://<project>.vercel.app/` returns `200`
    - Production URL serves the Spanish landing page (`curl -s https://<project>.vercel.app/ | grep -q 'Cola de Espera'`)
    - README.md has the production URL substituted (no longer the placeholder string)
    - Resend domain status is "verified" (human confirms, blocking for PLAN-04)
  </acceptance_criteria>
  <what-built>
    - Public GitHub repo at `github.com/<user>/zero-to-agent` (DEMO-02)
    - Vercel project linked via `.vercel/project.json`
    - All required env vars set in production, preview, AND development (Pitfall #18 mitigation)
    - First production deploy triggered via `git push origin main` (proves D-13 auto-deploy wiring)
    - Stable `<project>.vercel.app` URL responds 200 (DEMO-01)
    - README.md updated with the live production URL (DEMO-02)
  </what-built>
  <how-to-verify>
    1. Run `gh repo view --web` to confirm the repo is public
    2. Run `vercel env ls` to confirm all 11 env keys present in 3 environments (production, preview, development)
    3. Open the production URL in a browser — expect Spanish landing page with "Cola de Espera" heading and "Ingresar al panel" link
    4. Confirm Resend Dashboard -> Domains shows your domain as "verified" (blocking gate for PLAN-04)
    5. Trigger another deploy with an empty commit; confirm the same URL serves the new build (URL stability)
  </how-to-verify>
  <resume-signal>
    Type `approved` after confirming: (a) Resend domain verified, (b) `vercel env ls` shows all keys in 3 envs, (c) production URL responds 200 in browser, (d) README has the real URL committed. If any step blocks, describe the issue.
  </resume-signal>
  <done>
    Public GitHub repo created, Vercel project linked, all env vars set in all 3 Vercel environments, first production deploy succeeded via auto-deploy, stable `<project>.vercel.app` URL responds 200 with Spanish landing page, README documents the production URL, Resend domain confirmed verified (PLAN-04 unblocked).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Local dev → Vercel | `vercel env pull` syncs secrets from Vercel into `.env.local`; `.env.local` must remain gitignored |
| GitHub repo → Vercel | Push to `main` triggers production deploy; repo is public so source is world-readable |
| Public internet → `<project>.vercel.app` | Any URL on this domain is reachable; only routes whitelisted by Vercel are served |
| Local dev → Resend / Vercel API | `VERCEL_TOKEN` (used by Edge Config seed in PLAN-02) and `AUTH_RESEND_KEY` are sensitive |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01 | Information Disclosure | `.env.example` in public repo | mitigate | Placeholders only (`change-me-generate-with-...`, `pilot-maitre@example.com`); `bash scripts/check-env-sync.sh` ensures no schema drift; manual review pre-commit confirms no real values |
| T-01-02 | Information Disclosure | `.env.local` accidental commit | mitigate | `.gitignore` excludes `.env*.local` (verified by automated grep); `git add -A` will skip; reviewer notes any `.env*` file change |
| T-01-03 | Tampering | `.vercel/project.json` exposing project ID | accept | Project ID alone is not a credential; Vercel auth is via OAuth tokens, not project ID |
| T-01-04 | Information Disclosure | `VERCEL_TOKEN` in production env | mitigate | `lib/env.ts` marks `VERCEL_TOKEN` as `optional()`; `.env.example` documents "LOCAL ONLY"; checkpoint message reinforces "do NOT set in Vercel dashboard"; only `scripts/edge-config-seed.ts` reads it |
| T-01-05 | Spoofing | Pilot bookmarks preview URL instead of production | mitigate | README and checkpoint message explicitly call out the preview vs production URL distinction; production URL is the stable `<project>.vercel.app` alias |
| T-01-06 | Denial of Service | Missing env var fails deploy mid-phase (CONFIG-01) | mitigate | `lib/env.ts` validates at module load — `next build` fails on missing keys; `bash scripts/check-env-sync.sh` is a pre-deploy gate |
| T-01-07 | Information Disclosure | Auth.js secret rotated incorrectly | mitigate | `AUTH_SECRET` generated via `npx auth secret` (high-entropy); set identically in all 3 envs to keep magic-link tokens valid across env transitions |
| T-01-08 | Information Disclosure (DATA-02) | PII in deploy-time logs | mitigate | Phase 1 code does NOT log `user.email`, `error.message` containing PII, or DB connection strings. `scripts/check-env-sync.sh` logs key NAMES only, never values. Migration runner (PLAN-03) logs filenames only. Establishes precedent for SAFE-01 (Phase 2). |
</threat_model>

<verification>
**End-to-end checks for this plan:**
1. Spanish landing page reachable at production URL: `curl -s https://<project>.vercel.app/ | grep 'Cola de Espera'` → exits 0
2. URL stability across deploys: trigger second deploy via empty commit, confirm same URL responds 200
3. Env sync gate: `bash scripts/check-env-sync.sh` exits 0 with "Env sync OK: 12 keys verified"
4. Public repo confirmation: `gh repo view --json visibility` returns `PUBLIC`
5. Local dev quickstart from clean clone: `git clone <url> /tmp/test && cd /tmp/test && vercel env pull .env.local && npm install && SKIP_ENV_VALIDATION=1 npm run build` exits 0
</verification>

<success_criteria>
1. **DEMO-01:** Public Vercel deployment URL responds 200 on `/`, URL stable across at least 2 deploys.
2. **DEMO-02:** Public GitHub repo with working `.env.example` (every key in `lib/env.ts` present), README documents project name + stack + quickstart + production URL.
3. **Pitfall #18 mitigation:** `vercel env ls` shows all 11 server keys + 1 client key set in production AND preview AND development.
4. **Pitfall #19:** First production deploy ships from this phase (proves auto-deploy wiring before Phase 2 needs it for the money-shot demo).
5. **Phase 0 gate confirmation:** Resend domain shows "verified" — PLAN-04 can ship.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-01-scaffold-vercel-env-SUMMARY.md` documenting:
- Production URL (final, the one the pilot bookmarks)
- GitHub repo URL
- npm package versions actually installed (resolved versions from `package-lock.json`)
- Any deviations from the plan (e.g., if shadcn flow varied)
- Any unresolved env vars that block downstream plans (e.g., if RESEND_DOMAIN not yet set)
</output>
