# PVCON People

The internal HR platform of PVCON Consulting (one company, roughly 5–200 staff). It replaces the old holiday tracker
with a full HRMS. Staff use it in the browser or install it as an app from the browser menu.

| Area | What it covers |
|---|---|
| Core HR | Employee records (bank and ID numbers encrypted), departments, designations, reporting lines, org chart, directory, documents, CSV import, onboarding and exit checklists, profile change requests |
| Attendance | Web clock-in (office or remote), shifts with grace and half-day rules, daily close, muster roll, corrections (regularization), overrides, locking once payroll is approved |
| Timesheets | Weekly grid by project and task category, timer, submit and approve, clients and projects with budgets |
| Leave | Configurable types, accrual or upfront grants, carry-forward and lapse, holidays with optional picks, team calendar, ledger-based balances |
| Comp-off | Claims for work on weekly offs and holidays, expiring lots, optional payout through payroll |
| Payroll | Components and formulas, salary structures and revisions with arrears, maker-checker runs, loans and advances, expense claims, payslip PDFs (signed and password protected when configured), public payslip verification by QR code, bank advice |
| Insight | Role-aware dashboards, announcements, 29 reports with Excel/CSV export |
| Platform | Roles and permissions, audit log, notifications with email (instant, daily digest or off), scheduled jobs, light and dark themes |

**Stack:**

- Next.js 16 (App Router), React 19, TypeScript and Tailwind CSS 4;
- SQLite (better-sqlite3) with Drizzle ORM;
- Auth.js;
- Vitest and Playwright for tests.

## Documentation

| Document | Purpose |
|---|---|
| `docs/superpowers/specs/2026-09-24-hrms-overhaul-design.md` | Approved design: modules, data model, business rules |
| `docs/superpowers/plans/2026-09-24-hrms-roadmap.md` | Phases, progress and spec refinements |
| `docs/superpowers/plans/*.md` | The detailed plan of each phase |
| `CLAUDE.md` | Architecture rules and gotchas for contributors (and coding agents) |
| `DEPLOY.md` | Server setup, scheduled jobs, backups, updates and the move from the Holiday Tracker |

## Local development

Use Linux, macOS or WSL (Ubuntu) on Windows, with Node.js 22 LTS (at least 20.9). `better-sqlite3` is a native
module, so run `npm ci` inside WSL and never copy `node_modules` from Windows.

```bash
npm ci
cp .env.example .env.local
# Fill AUTH_SECRET and DATA_ENCRYPTION_KEY with `openssl rand -base64 32`, and CRON_SECRET with any random string.
npm run db:migrate
npm run db:seed        # super admin admin@pvcon.in / ChangeMe@2026 (a new password is required at first sign-in)
npm run dev            # http://localhost:3000
```

Email is optional: without `SMTP_*` settings, emails are skipped and logged. Jobs can be run by hand under
Settings → Jobs.

To try the migration from the old Holiday Tracker, copy its database to `data/legacy/app.db`. Then:

```bash
npm run db:migrate-legacy -- --from data/legacy/app.db --to data/people-new.db
```

It never modifies the old file and verifies every leave balance against the old app.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server on port 3000 (`DB_FILE` defaults to `./data/people.db`) |
| `npm run build` / `npm run start` | Production build and server |
| `npm run db:generate -- --name <change>` | Generate a migration after a schema change (never hand-write migration SQL) |
| `npm run db:migrate` | Apply migrations (refuses to touch a Holiday Tracker database) |
| `npm run db:seed` | Idempotent defaults and the first super admin |
| `npm run db:reset` | Delete `./data/people.db*`, migrate and seed (development only) |
| `npm run db:migrate-legacy -- --from <old> --to <new>` | Build a new database from the Holiday Tracker's, verified |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright). They start their own server on port 3100 with `./data/e2e.db`, so stop `npm run dev` first. |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run verify` | Typecheck, lint, tests and build: must pass before a change is done |

The `data/` folder (databases and uploads) is ignored by git.
