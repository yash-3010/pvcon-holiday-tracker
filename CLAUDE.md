# PVCON People — project guide for Claude

Internal HR platform for PVCON Consulting (single company, ~5–200 staff). It is being rebuilt from a small
holiday tracker into a full HRMS: Core HR, Attendance, Timesheets, Leave + Comp-off, Payroll + Payslips,
Reports. The work happens on branch `feat/hrms-overhaul`; `main` still runs the old holiday tracker in production.

## Source of truth

| Document | Purpose |
|---|---|
| `docs/superpowers/specs/2026-09-24-hrms-overhaul-design.md` | Approved design spec: modules, data model, business rules, phases |
| `docs/superpowers/plans/2026-09-24-hrms-roadmap.md` | Phase roadmap + **progress tracker** (update it when a phase or task finishes) |
| `docs/superpowers/plans/2026-09-24-phase-0a-foundation-backend.md` | Detailed plan, Phase 0 part A (backend foundation) |
| `docs/superpowers/plans/2026-09-24-phase-0b-foundation-ui.md` | Detailed plan, Phase 0 part B (shell, UI, auth pages, e2e) |

The spec is approved. Do not re-open decisions recorded there (generic payroll, SQLite, single company,
attendance + timesheets, comp-off flow, payslip verification design) unless the user asks.
If the code or a plan refines the spec (e.g. an extra permission), note the refinement in the roadmap's
"Spec refinements" section.

## Workflow

1. Check the roadmap progress tracker to find the current phase/task.
2. A phase without a detailed plan → write one first with the `superpowers:writing-plans` skill
   (save as `docs/superpowers/plans/YYYY-MM-DD-phase-N-<name>.md`), based on the spec sections listed
   in the roadmap and on the code that already exists.
3. Execute plans task by task (`superpowers:executing-plans` or `superpowers:subagent-driven-development`),
   TDD for all logic: failing test → implementation → passing test → commit.
4. One commit per plan task (Conventional Commits, e.g. `feat(leave): ...`). Commit messages end with the
   co-author line given by the harness.
5. End of each phase: `npm run verify` green, e2e for the phase green, roadmap tracker updated, commit, push
   `feat/hrms-overhaul`.
6. Stop and ask the user only for genuine product decisions not covered by the spec.

## Commands

```bash
npm run dev            # dev server on :3000 (DB_FILE defaults to ./data/people.db)
npm run db:generate    # drizzle-kit generate after schema edits (never hand-write migration SQL)
npm run db:migrate     # apply migrations (refuses to touch a legacy holiday-tracker DB)
npm run db:seed        # idempotent seed (super admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
npm run db:reset       # delete ./data/people.db* then migrate + seed (dev only)
npm test               # vitest unit + integration
npm run test:e2e       # playwright (starts its own dev server on :3100 with ./data/e2e.db)
npm run typecheck
npm run lint
npm run verify         # typecheck + lint + test + build — must be green before a phase is done
```

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind v4 · Radix (`radix-ui`
monopackage) · cva · `@tanstack/react-table` v8 · react-hook-form + zod v4 · sonner · cmdk · next-themes ·
recharts · SQLite (better-sqlite3, WAL) + Drizzle ORM 0.45 · Auth.js v5 beta (Credentials, JWT) · bcryptjs ·
pino · nodemailer · vitest · Playwright. Later phases add @react-pdf/renderer, qrcode, @signpdf/*,
@cantoo/pdf-lib, exceljs, papaparse.

## Architecture rules

- **Layout**
  - `src/app/**`: routes. Server actions are colocated in `actions.ts` next to the route that uses them.
  - `src/server/**`: server-only domain code.
    - `db/`: schema, client, migrations.
    - `modules/<domain>/service.ts`: business logic.
    - `modules/<domain>/queries.ts`: read models.
    - `auth/`, `actions/`, `jobs/`, `lib/`.
  - `src/lib/**`: isomorphic code, safe for client components.
    - Pure date/money utilities, permissions, zod validation schemas in `src/lib/validation/<domain>.ts`, shared types.
  - `src/components/ui`: design-system primitives. `src/components/shell`: app shell. `src/components/<feature>`: feature UI.
- **Services are synchronous.** better-sqlite3 transactions cannot contain `await`
  (the transaction function must not return a promise).
  - Every service function takes `db: DbLike` as its first argument and uses Drizzle's sync API:
    `.all()`, `.get()`, `.run()`, `.returning().get()`.
  - Async work (bcrypt, file reads, email, PDF) happens outside the transaction:
    in `prepare` / `after` hooks of `defineAction`, or before/after calling services.
- **Mutations go through `defineAction`** (`src/server/actions/define.ts`), in this order:
  1. session check;
  2. zod validation with field errors;
  3. permission check (a string, or a function for scope checks);
  4. `prepare` (async);
  5. `handler` (sync, inside a transaction, gets `{ tx, user, audit }`);
  6. revalidate;
  7. `after` (async side effects).
  - It returns `ActionResult<T>` (`{ ok: true, data } | { ok: false, error, code, fieldErrors? }`).
  - Throw `DomainError(code, message)` for business-rule violations.
  - Every mutation calls `audit(...)`. The one exception is a user's personal read-state (e.g. marking
    notifications read).
- **Reads** happen in Server Components via `queries.ts` functions that take `db` and apply the user's scope.
- **Authorization**
  - Permissions and roles live in `src/lib/auth/permissions.ts`.
  - Pages call `requirePermission()` / `requireUser()` from `src/server/auth/session.ts`. Actions use `permission`.
  - Never trust client-side checks. The UI only hides things.
- **Session truth comes from the DB.**
  - `getCurrentUser()` loads user + roles each request and compares `session_version` to the JWT.
  - Roles and `mustChangePassword` are never read from the JWT.
  - `src/proxy.ts` only makes the logged-in/out redirect (Next 16 renamed `middleware` → `proxy`).
- **Money** is integer minor units (paise) everywhere, using `src/lib/money.ts`. Never use floats for stored amounts.
- **Dates**
  - Calendar dates are `YYYY-MM-DD` strings. Use `src/lib/dates.ts` (pure UTC math).
  - **Never** call `toISOString()` on a local-midnight `Date`. That was the old app's IST off-by-one bug.
  - Timestamps are ISO-8601 UTC strings. Company timezone comes from settings (`locale.timezone`, default `Asia/Kolkata`).
- **Schema**
  - Lives in `src/server/db/schema/*.ts` and is re-exported from `schema/index.ts`.
  - Schema files use **relative imports only** (drizzle-kit does not resolve `@/` aliases).
  - Use `timestamps()` from `src/server/db/columns.ts`.
  - Generate migrations with `npm run db:generate -- --name <change>`. Never edit generated SQL by hand.
- **Settings** are typed key/value rows (`company_settings`).
  - Definitions and defaults live in `src/lib/validation/settings.ts`.
  - Access them with `getSetting(db, key)` / `updateSetting(...)`.
- **Files**
  - Uploads go through `saveUpload()`, which sniffs magic bytes and enforces a size limit.
  - Downloads only go through `/api/files/[id]` with `canAccessFile()`.
  - Add new access rules to the resolver list in `src/server/modules/files/access.ts`.
- **Jobs**
  - Jobs are idempotent (`job_runs(job, run_key)` unique). They are registered in `src/server/jobs/registry.ts`.
  - They are triggered by OS cron via `POST /api/cron/<job>` with `Authorization: Bearer $CRON_SECRET`.

## Gotchas

- Read `node_modules/next/dist/docs/` for Next 16 APIs before guessing:
  - `params` and `searchParams` are Promises.
  - `forbidden()` needs `experimental.authInterrupts`.
- `lucide-react` is 1.x. Use canonical icon names (`House`, `Ellipsis`, `LoaderCircle`) rather than the
  legacy aliases (`Home`, `MoreHorizontal`, `Loader2`). Check a name exists with
  `grep -o " Name," node_modules/lucide-react/dist/lucide-react.d.ts`.
- `@tanstack/react-table` is pinned to v8. v9 has a different API.
- `server-only` is imported only by files that must never reach the client and are never used by `tsx`
  scripts or vitest: `src/server/db/index.ts`, `src/server/auth/session.ts`, `src/server/actions/define.ts`,
  `src/auth.ts`. Vitest aliases `server-only` to a stub.
- Server-action return values must be plain serializable objects.
- Do not use `xlsx` (SheetJS npm build has known vulnerabilities). Use `exceljs`. Never use `eval`/`new Function`.
  The payroll formula engine has its own parser.
- Legacy DB safety:
  - The old holiday-tracker database (tables `users(role)`, `leaves`, `leave_policy`, …) is **never** migrated in place.
  - `npm run db:migrate` refuses to run on it.
  - Phase 2's `scripts/migrate-legacy.ts` reads it and writes a new DB.
  - Keep a copy at `data/legacy/app.db` for development. The whole `data/` directory is gitignored.
- Reference the old implementation with `git show 489c251:<path>` (e.g. `src/lib/leaves.ts`, `src/db/schema.ts`).
- The e2e server runs `next dev` on port 3100 and shares `.next` with your dev server. Stop `npm run dev` first.

## Environment

Local development runs in WSL (Ubuntu) with Node ≥ 20.9 (22 LTS recommended). `better-sqlite3` is a native
module: run `npm ci` inside WSL and never copy `node_modules` from Windows. Copy `.env.example` to
`.env.local`, then fill `AUTH_SECRET` and `DATA_ENCRYPTION_KEY` with `openssl rand -base64 32`.

Production is AWS Lightsail (Ubuntu, pm2, Caddy, nightly S3 backup): see `DEPLOY.md`. It is rewritten
in Phase 6 to cover cron jobs, uploads backup and the legacy cutover runbook.
