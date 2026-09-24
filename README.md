# PVCON People

Internal HR platform for PVCON Consulting: core HR, attendance, timesheets, leave and comp-off, payroll and payslips.

- Design spec: `docs/superpowers/specs/2026-09-24-hrms-overhaul-design.md`
- Roadmap and progress: `docs/superpowers/plans/2026-09-24-hrms-roadmap.md`
- Contributor and agent guide: `CLAUDE.md`

## Local development (WSL / Linux / macOS)

```bash
npm ci
cp .env.example .env.local   # set AUTH_SECRET, DATA_ENCRYPTION_KEY (openssl rand -base64 32), CRON_SECRET
npm run db:migrate
npm run db:seed              # admin@pvcon.in / ChangeMe@2026 (forced change at first sign-in)
npm run dev
```

## Quality gates

```bash
npm run verify     # typecheck + lint + unit/integration tests + build
npm run test:e2e   # Playwright (stop the dev server first)
```

Deployment: see `DEPLOY.md` (rewritten in Phase 6).
