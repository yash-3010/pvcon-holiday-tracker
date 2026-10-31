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
npm run dev            # dev server on :3000 (DB_FILE defaults to ./data/people.db); predev applies pending migrations
npm run db:generate    # drizzle-kit generate after schema edits (never hand-write migration SQL)
npm run db:migrate     # apply migrations (refuses to touch a legacy holiday-tracker DB)
npm run db:seed        # idempotent seed (super admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
npm run db:reset       # delete ./data/people.db* then migrate + seed (dev only)
npm run db:demo        # demo company in ./data/demo.db (scripts/demo-data.ts), dates relative to today
npm run dev:demo       # dev server against ./data/demo.db (migrated first), no emails; every demo login's password is Demo-Pass-123
npm run db:migrate-legacy -- --from data/legacy/app.db --to data/people-new.db   # old tracker → new DB, verified
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
pino · nodemailer · papaparse · vitest · Playwright (with @axe-core/playwright). Payroll adds @react-pdf/renderer, qrcode, @signpdf/signpdf and
@signpdf/signer-p12 (pinned to 3.3.0, with node-forge), @cantoo/pdf-lib and exceljs.

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
  - Manager scope comes from reporting lines. `SessionUser.employeeId`/`hasReports` are loaded from the DB each request.
    Use `isInScope(db, user, employeeId)` for team actions and `canViewEmployee` for read access
    (`src/server/modules/employees/scope.ts`). Org-wide viewers are in scope for their own record too, so approval
    flows must also refuse the user's own request (`SELF_APPROVAL`).
- **Session truth comes from the DB.**
  - `getCurrentUser()` loads user + roles each request and compares `session_version` to the JWT.
  - Roles and `mustChangePassword` are never read from the JWT.
  - `src/proxy.ts` only makes the logged-in/out redirect (Next 16 renamed `middleware` → `proxy`).
- **Money** is integer minor units (paise) everywhere, using `src/lib/money.ts`. Never use floats for stored amounts.
- **Leave**
  - Balances are only ever `SUM(delta)` of `leave_ledger` per (employee, type, leave year). Never store a balance.
  - Amounts are days in steps of 0.5, from the pure helpers in `src/lib/leave.ts` (`countLeaveDays`, `accrualCredit`,
    `proRatedQuota`), which client previews use too.
  - A request belongs to one leave year. Approvals go through `canDecideLeave` (never one's own leave). Comp-off and
    regularization approvals use the same routing (`src/server/modules/approvals/routing.ts`).
  - Comp-off (CO) availability comes from `comp_off_lots` (`compOffAvailable`), consumed FIFO by expiry, not from the ledger.
  - Weekly offs come from `weeklyOffsForEmployee()`, and holidays from `holidaysForEmployee()`, never from settings or
    tables directly.
  - Attendance hooks (`onLeaveChanged`, `onHolidayChanged`) are called inside the transaction.
- **Attendance**
  - Punches are UTC instants. A punch's attendance date and minutes are local to `locale.timezone`
    (`dateInTimeZone`, `minutesInZone`, `zonedInstant`). Shift times are local `HH:MM` and never cross midnight.
  - `recomputeAttendance` (and `fillMissingAttendance` / `recomputeDateForAll`, which use it) is the only writer of
    `attendance_days` status. Overrides only set the `override_*` columns, then recompute.
  - A `locked` day (payroll approved) is never rewritten, corrected or overridden.
  - Shifts come from `shiftForEmployee()` (the default shift when none is assigned). Shift changes rebuild today only.
  - Today's punch-based status is provisional (`isProvisional`). Read models never write, and future days are never stored.
- **Timesheets**
  - Weeks run Monday–Sunday and are named by their Monday. Durations are minutes in quarter hours (`src/lib/timesheets.ts`).
  - A row is (project, task category); saving replaces the week's entries. Only `draft` and `rejected` weeks change.
  - Who may log to a project comes from `allowedProjects()`; available hours from `workCalendar()` /
    `availableMinutes()`, never from the shift or leave tables directly.
- **Work clock** (`src/server/modules/clock/`, roadmap refinement 84)
  - One clock drives attendance and the timesheet. Clocking in punches in and logs to a project and task. A break is
    an out punch with `starts_break`; the next in resumes. Worked time comes from `dayClock` (`src/lib/clock.ts`).
  - Clock changes go through `startWork` / `takeBreak` / `resumeWork` / `switchTask` / `endWork` only, never through
    raw punches or timers. Each piece of time lands in its timesheet cell through `stopEmployeeTimer`.
  - Attendance always succeeds. When the timesheet can't take time, the clock reports it as `notices` rather than
    refusing.
  - Every clock action returns a fresh `clockSnapshot`, and the client (`src/components/clock/`) counts on from it. A
    week save sends the grid's `version`, so clock time is never overwritten.
- **Payroll**
  - Amounts are paise; formulas work in rupees (`src/lib/payroll/formula/*`, a hand-written parser with whitelisted
    names and functions). `calculatePayslip` (`src/lib/payroll/calculate.ts`) is pure and also runs in the browser
    for previews.
  - Salary revisions start on the 1st of a month. A revision payroll has used is never changed; a correction adds a
    row, and the next run pays arrears.
  - Run lifecycle (`payroll/runs.ts`): draft → computed → approved → released → paid. The approver must differ from
    whoever last computed the run. Approval locks the period's attendance and pays claims, loans, comp-off payouts and
    arrears; revert undoes exactly that. Changing a computed run's inputs sends it back to draft.
  - Released payslips never change: their PDF is stored once with its SHA-256 and served byte for byte. Corrections go
    through the next period.
  - PDF rendering, signing and encryption are async: render in an action's `prepare` (`prepareRelease`), store in the
    handler (`releaseRun`), email in `after`. Forms whose zod schema converts rupees to paise submit
    `form.getValues()` (the raw input), because the action parses again.
- **Sensitive employee data**
  - Bank account and ID numbers are stored with `sealBank()` and shown with `bankView(source, reveal)`
    (`src/server/modules/employees/sensitive.ts`). `reveal` only for `employee.sensitive.view`.
  - Never send `*Enc` columns to client components, and audit only masked views.
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
  - They are triggered by OS cron via `POST /api/cron/<job>` with `Authorization: Bearer $CRON_SECRET`
    (crontab in `DEPLOY.md`).
  - `run` is synchronous, inside a transaction. Async work (email) goes in an optional `deliver`, run after the
    transaction by `runJobByNameAsync` (the cron route and Settings → Jobs use it).
- **Notifications and email**
  - Create notifications with `notify` / `notifyMany` (`notifications/service.ts`) inside the transaction. Each row's
    `email_status` follows the recipient's `users.email_mode` (`instant` | `digest` | `off`).
  - `defineAction` sends pending copies right after commit with `after()`. `notifications:send` catches up every
    10 minutes, and `notifications:digest` sends the daily digest. Never send notification email from a handler.
  - Emails that must always arrive (sign-in, password reset, payslips) use `sendEmail` directly, outside
    transactions.
  - `after` from `next/server` is mocked as a no-op in `tests/setup.ts`.
- **Reports**
  - A report is a `ReportDefinition` in `src/server/modules/reports/<area>.ts`, listed in `registry.ts`.
  - Fields:
    - `permissions`: any of them runs it;
    - `orgWide`: holders see everyone, others their reporting tree;
    - `filters`, and `required` for filters that can't be empty;
    - a synchronous `run(db, ctx, params)` returning columns, rows, an optional chart and a note.
  - Respect `ctx.scope` (use `reportEmployees`). Leave today's provisional attendance out.
  - Values are typed by column: money in paise, `minutes`, `days`, and `percent` as 0–100. The table and
    `/api/exports/[report]` format them, so never pre-format numbers.
- **UI conventions**
  - Status colours (`success`, `warning`, `destructive`, `info`) are tuned for text on their own `/15` tint (WCAG AA).
    Keep them that way.
  - Underline links inside sentences.
  - Pages must not scroll sideways at 390 px. Wide tables scroll inside their card.

## Gotchas

- Read `node_modules/next/dist/docs/` for Next 16 APIs before guessing:
  - `params` and `searchParams` are Promises.
  - `forbidden()` needs `experimental.authInterrupts`.
- While the installed Next.js has a known advisory, `next build` and `next dev` run by an agent stop once with
  `SecurityFatalError` (`experimental.agentUpgrade`). Re-run within 5 minutes and they continue with a warning; this
  includes the e2e server. Don't run the `next upgrade --agent` it suggests, because it installs the newest patch
  however recent. Upgrade Next by hand once a fixed release has had its two-week soak.
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
  A fresh clone of this branch needs `git fetch origin main` first. The old schema is also in `tests/fixtures/legacy-holiday-tracker.sql`.
- The e2e server runs `next dev` on port 3100 and shares `.next` with your dev server. Stop `npm run dev` first.
- E2E helpers live in `tests/e2e/helpers.ts` (`signIn`, `changePassword`, `signInAsAdmin`, `addEmployee`). In dev mode the
  page also has an "Open Next.js Dev Tools" button, so match short button names exactly (`{ name: "Next", exact: true }`).
- E2E specs run alphabetically and share one database. `auth.spec.ts` must run first because it changes the seed admin
  password, so name new specs to sort after it.
- The login limiter allows 20 sign-ins per 15 minutes per client IP, and a password change signs in again. Give each
  spec its own address with `test.use(clientIp(n))`, and pass it to any `browser.newContext()` too. Taken: auth 1,
  core-hr 2, leave 3, time-attendance 4, timesheets 5, payroll 6, accessibility 7, profile-photo 8. Specs share the database, so use names and emails no
  other spec uses.

## Environment

Local development runs in WSL (Ubuntu) with Node ≥ 20.9 (22 LTS recommended). `better-sqlite3` is a native
module: run `npm ci` inside WSL and never copy `node_modules` from Windows. Copy `.env.example` to
`.env.local`, then fill `AUTH_SECRET` and `DATA_ENCRYPTION_KEY` with `openssl rand -base64 32`.

Production is AWS Lightsail (Ubuntu, pm2, Caddy, nightly S3 backup of the database and `UPLOAD_DIR`). `DEPLOY.md`
covers setup, the crontab for every job, backups and restore, updates, and the Holiday Tracker cutover runbook.
