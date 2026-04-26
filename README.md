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
