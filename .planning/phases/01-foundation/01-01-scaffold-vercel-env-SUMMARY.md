---
phase: 01-foundation
plan: 01
status: complete
completed: 2026-04-26
requirements_validated:
  - DEMO-01
  - DEMO-02
---

# Plan 01-01 SUMMARY: Scaffold Next.js + Vercel + envs

## Production URL

**https://zero-to-agent-xi.vercel.app** — stable across 2 deploys, returns 200 with Spanish landing.

> Note: `zero-to-agent.vercel.app` was already taken globally on Vercel, so the canonical alias is `zero-to-agent-xi.vercel.app`. Pilot bookmarks this URL.

## GitHub Repo

**https://github.com/betancourtfit/zero-to-agent** — public (DEMO-02), GitHub ↔ Vercel auto-deploy connected, productionBranch `main`.

## What was built

| Item | Result |
|------|--------|
| Next.js 16 scaffold | `create-next-app@latest .` (TS, Tailwind v4, App Router, Turbopack) — backed up `.planning/`, `CLAUDE.md`, `.env`, `scope_hackathon_mvp.md` before scaffold, restored after |
| Phase 1 dependencies | `next-auth@beta`, `@auth/pg-adapter`, `pg`, `@neondatabase/serverless`, `@upstash/redis`, `@vercel/edge-config`, `@t3-oss/env-nextjs`, `zod`, `resend` (runtime); `tsx`, `@types/pg` (dev) |
| shadcn/ui init | `button` + `input` components added; `components.json`, `lib/utils.ts` written |
| Spanish layout + landing | `app/layout.tsx` (`<html lang="es">`, "Cola de Espera" metadata); `app/page.tsx` ("Ingresar al panel" link to `/login`) |
| `next.config.ts` | Empty config — `withWorkflow` deferred to Phase 2 (architecture commitment #4) |
| `.gitignore` | Replaced overly-broad `.env*` with `.env` + `.env*.local` so `.env.example` ships (Pitfall #18) |
| `lib/env.ts` | `@t3-oss/env-nextjs` createEnv with 11 server keys + 1 client key + `skipValidation` gate |
| `.env.example` | Source-of-truth env inventory with placeholders only (no real secrets) |
| `scripts/check-env-sync.sh` | Asserts every `runtimeEnv` key has `^KEY=` line in `.env.example`; wired as `npm run check:env-sync` |
| `README.md` | Project name, locked stack, quickstart, Phase 1 npm scripts, prod URL |
| Vercel project linked | `prj_x3PJFtcilwWdRS6nPnBzdwSTewJD` on team `juan-7600s-projects` |
| Auto-deploy proven | 2 production deploys via `git push origin main` webhook, both READY (D-13) |

## Pinned npm versions (resolved)

Runtime dependencies installed (semver from `package.json`, see `package-lock.json` for exact resolved versions):

- `next` `16.2.4`
- `next-auth` `^5.0.0-beta.31`
- `@auth/pg-adapter` `^1.11.2`
- `pg` `^8.20.0`
- `@neondatabase/serverless` `^1.1.0`
- `@upstash/redis` `^1.37.0`
- `@vercel/edge-config` `^1.4.3`
- `@t3-oss/env-nextjs` `^0.13.11`
- `zod` `^4.3.6`
- `resend` `^6.12.2`

Dev dependencies:

- `tsx` `^4.21.0`
- `@types/pg` `^8.20.0`

## Vercel env inventory (final)

All 11 server keys + 1 client key present in production, preview, and development:

```
DATABASE_URL                       Production, Preview, Development
DATABASE_URL_UNPOOLED              Production, Preview, Development
AUTH_SECRET                        Production, Preview, Development
AUTH_RESEND_KEY                    Production, Preview, Development
RESEND_DOMAIN                      Production, Preview, Development
UPSTASH_REDIS_REST_URL             Production, Preview, Development  (mirrored from KV_REST_API_URL)
UPSTASH_REDIS_REST_TOKEN           Production, Preview, Development  (mirrored from KV_REST_API_TOKEN)
EDGE_CONFIG                        Production, Preview, Development
MCP_API_KEY                        Production, Preview, Development
MAITRE_EMAIL                       Production, Preview, Development
NEXT_PUBLIC_BASE_URL               Production, Preview (https://zero-to-agent-xi.vercel.app),
                                   Development (http://localhost:3000)
```

`VERCEL_TOKEN` is intentionally NOT set in Vercel — `lib/env.ts` marks it `optional()`. Used only by local scripts (PLAN-02 `edge-config-seed`).

## Deviations from plan

1. **Vercel marketplace renamed Upstash env vars.** The Upstash KV integration provisions `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel KV-style names) instead of `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (Upstash SDK-style names that the plan + CLAUDE.md lock to). **Resolution:** mirrored both values into the SDK-style names via `vercel api POST /v10/projects/.../env?upsert=true` so `lib/env.ts` works as written. Both naming pairs now coexist; downstream code uses the SDK-style names per the locked decision.

2. **Vercel CLI v52 quirk on Preview env adds.** `vercel env add NAME preview --value V --yes` fails with `git_branch_required` (CLI doesn't auto-confirm "all preview branches" even with `--yes`). **Resolution:** used `vercel api POST /v10/projects/.../env?upsert=true` with `target=["production","preview","development"]` directly. All non-secret-paste env writes used the REST API for reliability; user-secret pastes went through interactive `vercel env add NAME ENV` per env where the prompt allows selecting "Add to all Preview branches".

3. **shadcn CLI flags moved.** `--base-color` and `--no-src-dir` no longer exist in shadcn CLI v4.5. **Resolution:** used `--template next --defaults --yes --force` which produces functionally equivalent output (Next.js template, default base, no src dir).

4. **`AGENTS.md` artifact from create-next-app left in repo.** Not in the plan's `files_modified` but harmless. Left as-is.

5. **`scope_hackathon_mvp.md` committed in scaffold commit.** Was previously untracked at repo root; included in the first commit since it's a project reference document. CLAUDE.md and `.planning/` were properly preserved across the scaffold.

## Verification evidence

- `vercel env ls` shows 18 keys matching the plan's required list (>= 9 required).
- `curl -s -o /dev/null -w '%{http_code}' https://zero-to-agent-xi.vercel.app/` → `200`.
- `curl -s https://zero-to-agent-xi.vercel.app/ | grep -q 'Cola de Espera'` → 0 (match).
- `bash scripts/check-env-sync.sh` → "Env sync OK: 12 keys verified".
- `gh repo view --json visibility` → `"PUBLIC"`.
- 2 deployments READY at the same stable alias — URL stability proven (Pitfall #19, D-13).

## Phase 0 confirmations from user

- ✓ Resend domain verified (DNS SPF/DKIM/DMARC propagated) — confirmed at start of session.
- ✓ Marketplace integrations (Neon Postgres + Upstash Redis + Vercel Edge Config) attached to the project — verified via env injection.
- ✓ All 3 user-secret env values (`AUTH_RESEND_KEY`, `RESEND_DOMAIN`, `MAITRE_EMAIL`) added across production/preview/development by user.

## Unresolved items blocking downstream plans

None. Plans 01-02, 01-03, 01-04 can proceed.

- 01-02 (Edge Config + KV): `EDGE_CONFIG` and `UPSTASH_REDIS_REST_URL/TOKEN` ready; needs to seed Edge Config and write `getConfig()` wrapper.
- 01-03 (DB migrations): `DATABASE_URL` + `DATABASE_URL_UNPOOLED` ready; can run schema migrations.
- 01-04 (Auth.js): `AUTH_SECRET`, `AUTH_RESEND_KEY`, `RESEND_DOMAIN`, `MAITRE_EMAIL` ready; depends on 01-03 for `employees` table.
