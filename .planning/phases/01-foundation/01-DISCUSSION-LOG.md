# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the gray areas considered.

**Date:** 2026-04-25
**Phase:** 01-foundation
**Areas presented:** Migration tooling, Edge Config seeding, Maître auth gate timing, Deploy + URL stability
**User selection:** ninguna (defer all decisions to Claude using research-backed defaults)

---

## User response

When asked which gray areas to discuss, the user responded "ninguna" — accepting that Claude would make all Phase 1 implementation decisions using research-backed defaults from PROJECT.md, ROADMAP.md, REQUIREMENTS.md, research/SUMMARY.md, and research/PITFALLS.md.

The interactive `AskUserQuestion` was attempted twice; both responses came back empty, after which a plain-text numbered list was offered. The user replied "ninguna".

---

## Gray areas presented and Claude's resolution

### Migration tooling

| Option | Description | Selected |
|--------|-------------|----------|
| Raw `schema.sql` + custom runner | DDL in `db/schema.sql`, forward-only migrations in `db/migrations/`, `npm run db:migrate` tracks applied files in `_migrations` table | ✓ |
| Drizzle ORM | Type-safe queries + migration tooling, schema-as-code in TS | |
| Prisma | Schema-as-DSL + migrations, codegen client | |
| Kysely | Query builder + raw migrations, type-safe without schema-as-code | |

**Rationale:** 7-day sprint, fixed 3-table schema (+ Auth.js auto), solo dev. ORM type-safety doesn't pay back the install/learn overhead at this scale. Raw SQL keeps the schema explicit and demo-friendly.

### Edge Config seeding

| Option | Description | Selected |
|--------|-------------|----------|
| Committed JSON + idempotent seed script | `edge-config/seed.json` + `scripts/edge-config-seed.ts` via Items API; only writes if absent or differs | ✓ |
| Manual dashboard entry per environment | Operator edits values in Vercel dashboard one-by-one | |
| Hybrid (script seeds defaults, dashboard overrides) | Script for first-deploy defaults, dashboard for ongoing operational changes | |

**Rationale:** Reproducibility for the pilot + supports the Phase 4 "live edit" demo without losing the ability to re-seed a fresh environment.

### Maître auth gate timing

| Option | Description | Selected |
|--------|-------------|----------|
| `signIn` callback BEFORE link sent + generic copy | Reject unknown emails before token generation; UI says "Si tu email está autorizado, te enviamos un link" | ✓ |
| `session` callback only | Send link to anyone, reject after they click | |
| Hybrid (rate-limited `signIn` + `session` re-validation) | Validate at `signIn` AND re-validate session reads | |

**Rationale:** Saves Resend quota, stops random emails getting magic-links, generic copy avoids leaking existence. Plus `session` callback ALSO re-validates for defense in depth (handles employee removal mid-session).

### Deploy + URL stability

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub auto-deploy + free `.vercel.app` URL | `main` → production, PRs → preview, pilot bookmarks the stable production alias | ✓ |
| Manual `vercel --prod` per phase + free `.vercel.app` | Full control over when prod ships | |
| Custom domain | $10 + DNS propagation; defers shipping by 0–48h | |

**Rationale:** Phase 2 money-shot demo IS `git push` mid-flight, so auto-deploy is required. Custom domain adds DNS overhead that doesn't pay back for the hackathon; pilot can request one post-week-1.

---

## Additional Claude-discretion decisions

These weren't in the gray-area menu but needed defaults to unblock plan-phase:

- **Maître seed:** `MAITRE_EMAIL` env var + `scripts/seed-maitre.ts` (idempotent upsert). Avoids committing real PII; pilot sets their email at deploy time.
- **Env var validation:** `@t3-oss/env-nextjs` + Zod schemas at `lib/env.ts` (server + client). Fails build/start on missing keys — closes Pitfall #18.
- **Empty-app placeholder:** `/` minimal Spanish landing + link to `/login`; `/login` single-input form with generic success copy; `/queue` auth-gated stub showing user email. Phase 3 replaces all three.
- **Repo layout:** Single Next.js app, App Router. `app/`, `lib/`, `db/`, `edge-config/`, `scripts/`, `public/`. No monorepo. `proxy.ts` at repo root.
- **Two-pg-clients gate:** Phase 1 plan includes `scripts/load-test-pg.ts` (10 parallel Auth.js Pool + 10 parallel Neon serverless reads) before merging Phase 1 → main. Resolves SUMMARY.md open question #7.

---

## Deferred Ideas

(See CONTEXT.md `<deferred>` section for the canonical list.)

- Custom domain (post-hackathon)
- Multi-role employees (out of scope v1)
- `/login` design polish (Phase 3)
- `next-themes` / dark mode (out of scope v1)
- Migration rollback (forward-only only)
- `/api/health` endpoint (Phase 4 unless trivially added)
