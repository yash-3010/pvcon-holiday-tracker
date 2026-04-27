# PVCON Holiday Tracker

Minimal holiday & leave tracker for PVCON Consulting. Replaces the Excel sheet.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- SQLite via Drizzle ORM + better-sqlite3
- Auth.js v5 (Credentials, JWT) — domain-restricted to `@pvcon.in`
- bcryptjs password hashes
- Plus Jakarta Sans, brand colors `#202f63` / `#92b353`
- Deploys to AWS Lightsail (~$5/mo). See `DEPLOY.md`.

## Local dev

```bash
npm install
npm run db:migrate
npm run db:seed              # seeds users, 2026 holidays, existing leaves from xlsx
npm run dev
```

Open <http://localhost:3000>.

### Default accounts

All start with password `Pvcon@1234`, forced change on first login.

- `admin@pvcon.in` (admin)
- `yash@pvcon.in`, `sonam@pvcon.in`, `raj@pvcon.in`, `almas@pvcon.in`

## Scripts

- `npm run dev` — dev server
- `npm run build` / `npm run start` — production
- `npm run db:generate` — drizzle-kit generate (after schema changes)
- `npm run db:migrate` — apply migrations
- `npm run db:seed` — seed from xlsx (`SEED_XLSX` env override)
- `npm run db:reset` — wipe + reseed (DEV ONLY)

## Features

**Employee**
- Dashboard: CL/SL balance, optional holidays picked, unpaid taken, upcoming leaves
- Leaves: add/edit/cancel, half-day support, auto working-days calc (skips weekends + holidays)
- Holidays: pick up to 6 optional holidays
- Profile: change password

**Admin** (`admin@pvcon.in`)
- Team summary
- Users: add (generates `Pvcon@<rand4>` temp password), reset, deactivate, delete
- Holiday calendar editor
- Leave policy editor
- Drill-down per user

## Schema

`src/db/schema.ts` — users, holidays, holiday_selections, leaves, leave_policy, user_year_balance.

## Deploy

See [DEPLOY.md](./DEPLOY.md).
