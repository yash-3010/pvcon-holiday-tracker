# Phase 6 — Insight, notifications, polish, deploy Implementation Plan

> **For agentic workers:** Execute task by task with TDD (failing test → implementation → passing test → commit).
> Like the earlier plans, this fixes **contracts** (files, signatures, rules, test cases); the executor writes the code
> in the style of the existing modules. Record any deviation from the spec in the roadmap's refinements.

**Goal:** Finish the HRMS for production:
- email for every notification (instant, daily digest or off per user) through an outbox, plus announcements;
- role-aware dashboards;
- a reports centre with every report of spec §5.10, each exportable as XLSX or CSV;
- SMTP status and a test email in settings; a PWA manifest; accessibility, mobile and performance passes;
- `DEPLOY.md` and `README.md` for the production cutover.

**Spec:** §5.8 notifications, §5.9 dashboards, §5.10 reports, §5.11 (SMTP status), §4.1 announcements, §6 (PWA,
accessibility, mobile), §7 jobs, §8 cutover runbook, §11 testing.

**Prerequisite:** Phase 5 is complete. Reuse:
- `notify` / `notifyMany` (in-app rows), `sendEmail` / `renderEmail`, `defineAction` (`after`), `runJob`, the job
  registry and `/api/cron/[job]`;
- read models of every module (`todayBoard`, `musterRoll`, `balancesFor`, `employeeTimesheetSummary`, `utilization`,
  `projectDetail`, `listRuns`, `runDetail`, `registerXlsx`, `listLoans`, `listClaims`, `employeeSalaryView`, …);
- the employees scope helpers (`getReportingTree`, `isInScope`, `canViewEmployee`).

## Global Constraints

- Services stay synchronous and take `db` first. Email sending and file generation are async and happen outside
  transactions (`after` hooks, `after()` from `next/server`, or async job delivery).
- A notification is emailed at most once: rows are claimed (`pending` → `sending`) before sending.
- Reports apply the viewer's scope: org-wide permissions see everyone; managers holding a report permission see their
  reporting tree only. Exports are permission-checked and audited (`report.export`).
- Sensitive values (bank, IDs) appear in reports only masked, except the payroll bank advice (`payroll.run`).
- Text that a spreadsheet would read as a formula is escaped in every export.

## Review Focus

1. **Email outbox**: no double sends (claiming), opt-out respected, critical types still sent, SMTP absent → skipped.
2. **Report scoping**: a manager never sees people outside their tree; employees have no reports.
3. **Exports**: audited, formula-safe, numbers as numbers.

---

## File map

| File | Responsibility |
|---|---|
| `src/server/db/schema/system.ts` | + `notifications.email_status`, `email_attempts`, `emailed_at`; `users.email_mode`; `announcements` |
| `src/server/modules/notifications/email.ts` | Outbox: email decision at insert, `deliverNotificationEmails`, `deliverDigests` |
| `src/server/jobs/{notifications-send,notifications-digest}.ts` | Async jobs (outbox safety net, daily digest) |
| `src/server/jobs/runner.ts`, `registry.ts`, `api/cron/[job]` | Async job support (`runJobAsync`) |
| `src/server/modules/announcements/{service,queries}.ts` | Announcements CRUD, publishing |
| `src/server/modules/dashboard/queries.ts` | Dashboard widgets per role |
| `src/server/modules/reports/{types,scope,registry}.ts`, `reports/<area>.ts` | Report definitions and runners |
| `src/server/modules/reports/export.ts` | XLSX/CSV writer shared with payroll exports |
| `src/app/(app)/reports/*`, `src/app/api/exports/[report]/route.ts` | Reports centre and exports |
| `src/app/(app)/announcements/*`, `src/app/(app)/page.tsx`, `src/components/dashboard/*` | UI |
| `src/app/(app)/settings/email/*` | SMTP status and test email |
| `src/app/manifest.ts`, `public/icons/*` | PWA |
| `DEPLOY.md`, `README.md` | Operations |

---

### Task 1: Notification email outbox and preferences

**Files:** Modify `schema/system.ts`, `schema/auth.ts` (migration `0007_notifications_email`), `notifications/service.ts`; Create `notifications/email.ts`; Modify `actions/define.ts`; Test `tests/integration/notification-email.test.ts`

- `users.email_mode`: `instant` (default) | `digest` | `off`.
- `notifications.email_status`: `pending` | `sending` | `sent` | `digest` | `skipped`, `email_attempts`, `emailed_at`.
- `notify` decides at insert: critical types (`account.*`, `payslip.released`) are always `pending`; otherwise by the
  user's mode (`instant` → `pending`, `digest` → `digest`, `off` → `skipped`). Disabled users → `skipped`.
- `deliverNotificationEmails(db, { now, appUrl, limit = 100 })` (async):
  - SMTP not configured → marks pending rows `skipped` and returns 0;
  - claims up to `limit` pending rows created in the last 3 days (`sending`), sends one email each (title, body,
    a link to `APP_URL + link`), marks `sent`; a failure returns the row to `pending` and counts an attempt
    (3 attempts → `skipped`);
  - older pending rows are skipped.
- `deliverDigests(db, { now, appUrl })` (async): per user, the `digest` rows → one email listing them → `sent`.
- `defineAction` schedules `deliverNotificationEmails` with `after()` once an action succeeds (best effort, logged).
- **Tests:** mode decisions; claiming prevents a second send; failures retry then give up; SMTP absent skips;
  a digest groups a user's rows into one email.

- [x] Commit `feat(notifications): email notifications through an outbox`

### Task 2: Async jobs: send and digest

**Files:** Modify `jobs/runner.ts`, `jobs/registry.ts`, `api/cron/[job]/route.ts`, `settings/jobs/actions.ts`; Create `jobs/notifications-send.ts`, `jobs/notifications-digest.ts`; Test `tests/integration/jobs-async.test.ts`

- `JobDefinition.runAsync?(db, now, timeZone): Promise<string>`; `runJobAsync` keeps the `job_runs` idempotency.
- `notifications:send` (every 10 minutes, run key = the 10-minute slot): publishes due announcements (Task 3), then
  delivers the outbox.
- `notifications:digest` (daily 09:00, run key = date).
- **Tests:** an async job runs once per key; a failure is recorded and retried.

- [x] Commit `feat(jobs): run asynchronous jobs for notification email`

### Task 3: Announcements

**Files:** Create `announcements/{service,queries}.ts`, `src/lib/validation/announcements.ts`, `src/app/(app)/announcements/*`; Test `tests/integration/announcements.test.ts`

- Table `announcements` (id, title, body, pinned, publish_at, expires_at, notified_at, created_by, timestamps).
- `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement` (`announcement.manage`); `publishDueAnnouncements(db,
  now)` notifies every active user once (`announcement.published`) when `publish_at` ≤ now.
- `currentAnnouncements(db, now)`: published, not expired, pinned first, newest first.
- `/announcements`: everyone reads current ones; managers of announcements also see scheduled and expired ones and
  edit them in a sheet. Nav: Home → Announcements.
- **Tests:** scheduling, expiry, pinned order, notified once.

- [x] Commit `feat(announcements): add announcements`

### Task 4: Dashboard read models

**Files:** Create `src/server/modules/dashboard/queries.ts`; Test `tests/integration/dashboard-queries.test.ts`

- Employee: `leaveSnapshot` (balances with the comp-off nearest expiry), `latestPayslip`, `upcomingHolidays`,
  `myPendingRequests` (counts by kind), `compOffPrompts`, `teamOutToday` (manager's reports and peers on leave today).
- Manager: `pendingApprovalCount`, `teamToday` (counts by state), `teamUtilization(month)`, `teamLeaveAhead(7 days)`.
- HR/admin: `headcountTrend(12 months)`, `joinersLeavers(month)`, `attendanceToday` (totals), `leavesToday`,
  `openExits`, `openChecklists`, `payrollStatus(month)`, `upcomingCelebrations(14 days)`.
- **Tests:** each with a small fixture; scoping of team widgets.

- [x] Commit `feat(dashboard): add dashboard read models`

### Task 5: Role-aware dashboard

**Files:** Modify `src/app/(app)/page.tsx`; Create `src/components/dashboard/*` (cards, recharts charts)

- Sections by permission: employee (with an employee record), manager (`hasReports` or approvals), HR/admin
  (`employee.view`), payroll (`payroll.run`).
- Charts: headcount trend (line), attendance today (donut), team utilization (bar).

- [x] Commit `feat(dashboard): show role-aware dashboards`

### Task 6: Report framework and exports

**Files:** Create `reports/{types,scope,registry,export}.ts`, `src/app/(app)/reports/{page,[slug]/page}.tsx`,
`src/components/reports/*`, `src/app/api/exports/[report]/route.ts`; Modify `payroll/exports.ts` (shared writer), nav;
Test `tests/integration/reports-framework.test.ts`

- `ReportDefinition { slug, area, title, description, permission (Permission[] any-of), filters, run(db, user, params) }`
  → `{ columns: { key, label, type: text|number|money|date|percent }[], rows, chart?, note? }`.
- Filters: `period` (YYYY-MM), `range` (from–to), `year`, `department`, `employee`, `project`, `run`.
- `reportScope(db, user, orgWide: Permission)`: null (everyone) or the employee ids of the reporting tree.
- `exportReport(result, format)` → XLSX (`exceljs`, typed cells, money as rupees) or CSV (BOM, formula-escaped).
- `/reports`: cards grouped by area, only reports the user may run. `/reports/[slug]`: filter bar (GET params),
  table, chart, export buttons. `/api/exports/[report]?…&format=xlsx|csv`: same checks, audited `report.export`.
- **Tests:** permission filtering, scope, export formats.

- [x] Commit `feat(reports): add the reports centre and exports`

### Task 7: HR and attendance reports

**Files:** Create `reports/hr.ts`, `reports/attendance.ts`; Test `tests/integration/reports-hr-attendance.test.ts`

- HR (`report.hr`, org-wide `employee.view`): headcount (by department on a date), joiners & leavers (range),
  attrition (12 months: leavers ÷ average headcount), employee master (masked sensitive values), birthdays & work
  anniversaries (month).
- Attendance (`report.attendance`, org-wide `attendance.view.all`): muster roll (month), daily status (date),
  late & early (range), overtime (range), remote vs office (range), off-day work (range).

- [x] Commit `feat(reports): add HR and attendance reports`

### Task 8: Leave and timesheet reports

**Files:** Create `reports/leave.ts`, `reports/timesheets.ts`; Test `tests/integration/reports-leave-timesheets.test.ts`

- Leave (`report.leave`, org-wide `leave.view.all`): balances (leave year), leave register (range), utilization by
  type (leave year), comp-off lots & expiries.
- Timesheets (`report.timesheet`, org-wide `timesheet.view.all`): utilization, billable %, project hours, client
  hours, budget burn, missing timesheets (week).

- [x] Commit `feat(reports): add leave and timesheet reports`

### Task 9: Payroll reports

**Files:** Create `reports/payroll.ts`; Test `tests/integration/reports-payroll.test.ts`

- `report.payroll` (org-wide): payroll register (run), component summary (period range), bank advice (run;
  `payroll.run` only), employer cost by department (period), YTD statement (employee, fiscal year), loan register,
  claims register (range), salary revision history (range).

- [x] Commit `feat(reports): add payroll reports`

### Task 10: Notification preferences, SMTP status and test email

**Files:** Modify `src/app/(app)/notifications/*` (email preference), Create `src/app/(app)/settings/email/*`;
Test `tests/integration/notification-preferences.test.ts`

- Notifications page: "Email me" instant | daily digest | off (critical emails always sent), saved per user.
- Settings → Email (`settings.manage`): SMTP status from env (host, port, from; no secrets) and "Send a test email"
  to the admin's own address; outbox counts (pending, failed in the last day).

- [x] Commit `feat(notifications): add email preferences and SMTP status`

### Task 11: PWA and mobile

**Files:** Create `src/app/manifest.ts`, `public/icons/*`; Modify layout metadata; mobile fixes found by screenshots at
390 px

- Manifest: name, short name, start URL `/`, `display: standalone`, theme and background colours from the brand,
  192 and 512 px icons (and maskable), Apple touch icon.
- Mobile pass: dashboard, my attendance, my leave, my timesheets, my payslips, approvals, runs.

- [x] Commit `feat(app): make the app installable and fix mobile layouts`

### Task 12: Accessibility and performance passes

**Files:** Add `@axe-core/playwright` (dev); Create `tests/e2e/zz-accessibility.spec.ts`; fixes; indexes

- Axe checks (serious and critical rules) on the main pages as an admin and as an employee; fix what they report.
- Review query hot spots (dashboard, reports, run detail) for N+1 queries and missing indexes; add indexes with a
  migration where a report scans.

- [x] Commit `fix(a11y): pass accessibility checks on the main pages`
- [x] Commit `perf: add indexes and remove N+1 queries` (if any)

### Task 13: Deployment documentation

**Files:** Rewrite `DEPLOY.md`, `README.md`; update `.env.example`

- `DEPLOY.md`: requirements, environment variables, build and pm2 (reload flow), Caddy, crontab entries for every job
  (`/api/cron/<job>` with `CRON_SECRET`), backups of the database and `UPLOAD_DIR` (sqlite `.backup`, S3), restore,
  the legacy cutover runbook (spec §8), smoke test, rollback.
- `README.md`: what the app is, modules, local setup (WSL), scripts, tests, project docs.

- [x] Commit `docs: rewrite the deployment guide and README`

### Task 14: Final regression, review, documentation

- Full e2e (`npm run test:e2e`), `npm run verify`.
- Code review of the phase (`code-review` skill); fix confirmed findings.
- Roadmap: Phase 6 done, refinements, integration map; CLAUDE.md (notifications, reports).

- [x] Commit `docs: mark Phase 6 done`

Also done during this phase:
- profile photos, deferred here by refinement 18 (`feat(employees): add profile photos`);
- the legacy migration now marks the years the old app closed, so `leave:year-end` doesn't carry them forward twice
  (found while writing the cutover runbook);
- fixes from the phase review:
  - outbox claim recovery and skipping disabled users;
  - masked bank accounts on the report page;
  - signed durations;
  - XLSX text as typed;
  - one entry per person away;
  - photo caching;
- `next-auth` upgraded to 5.0.0-beta.32 for the critical Auth.js advisories. The Next.js, zod and nodemailer fixes
  were days old and are left for a follow-up after their two-week soak.
