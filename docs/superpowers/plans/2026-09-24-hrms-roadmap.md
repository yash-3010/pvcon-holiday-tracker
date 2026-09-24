# PVCON People — HRMS Roadmap & Progress Tracker

> **For agentic workers:** This is the master plan. Each phase gets its own detailed, bite-sized plan
> (REQUIRED SUB-SKILL: `superpowers:writing-plans`) written **at the start of that phase**, from the spec
> sections listed below and the code that exists at that point. Execute detailed plans with
> `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.
> Update the **Progress tracker** below whenever a task or phase completes, and commit the update.

**Goal:** Rebuild the PVCON holiday tracker into an integrated HRMS covering Core HR, Attendance, Timesheets,
Leave + Comp-off, Payroll + Payslips and Reports, as specified in
`docs/superpowers/specs/2026-09-24-hrms-overhaul-design.md`.

**Architecture:** Modular monolith in the existing Next.js 16 app.
- Synchronous domain services on SQLite (better-sqlite3 + Drizzle).
- A single `defineAction` pipeline for mutations: auth → zod → permission → transaction → audit.
- RBAC permissions, and DB-verified sessions.

**Tech stack:** See `CLAUDE.md` → Stack.

**Branch:** `feat/hrms-overhaul`. Push after every phase.

---

## Progress tracker

| Phase | Detailed plan | Status |
|---|---|---|
| 0A Foundation — backend | `2026-09-24-phase-0a-foundation-backend.md` | ☑ done (912fd4d) |
| 0B Foundation — UI, auth pages, e2e | `2026-09-24-phase-0b-foundation-ui.md` | ☐ not started |
| 1 Core HR | to be written | ☐ not started |
| 2 Leave, holidays, legacy migration | to be written | ☐ not started |
| 3 Attendance + comp-off | to be written | ☐ not started |
| 4 Timesheets | to be written | ☐ not started |
| 5 Payroll + payslips | to be written | ☐ not started |
| 6 Insight, notifications, polish, deploy | to be written | ☐ not started |

Status values: ☐ not started · ◐ in progress (note last finished task) · ☑ done (note commit hash).

## Spec refinements (decided during planning)

Record here any deliberate deviation from, or addition to, the spec so later phases stay consistent.

1. **Extra permissions**
   - `user.manage`: create logins, reset passwords, enable/disable. Granted to `hr_admin` and `super_admin`.
   - `job.run`: run jobs manually. Granted to `super_admin`.
   - Only holders of `role.assign` may grant `hr_admin`, `payroll_admin` or `super_admin`. Holders of
     `user.manage` alone may grant only `employee` and `manager`.
2. **`users.name` column** is added. System accounts without an employee record still need a display name.
3. **Zod schemas shared with client forms** live in `src/lib/validation/<domain>.ts`, not in
   `src/server/modules/*/schemas.ts` (the spec's §2.2 layout). This is so client components can import them.
4. **Default DB file** is `./data/people.db`. It is a new file and never the legacy `./data/app.db`.
5. **JWT content**
   - The JWT carries only `uid` and `sv` (session version). Roles and must-change-password flags are read
     from the DB on every request.
   - Password change and reset bump `session_version`, then re-sign-in the current browser.
6. **Session length** is 12 hours (was 7 days).
7. **Payroll salary revisions** are effective only from the 1st of a month (spec §4.6 already states this; restated for emphasis).
8. **Settings UI split**
   - Phase 0 builds the Company/Locale, Security, Users & roles, Audit log and Jobs pages.
   - Each later phase adds its own settings page for its settings key: attendance, leave, compOff, payroll, employee.
9. **Role changes revoke sessions.** `setUserRoles` bumps the target's `session_version` when their role set
   actually changes, so their other sessions end and they sign in again. A user changing their own roles is
   exempt, so the admin is not signed out mid-action.

## Cross-phase integration map

Build each phase so these seams exist. Later phases consume them.

| Producer | Seam | Consumers |
|---|---|---|
| Phase 1 employees | `employees.user_id`, `reporting_manager_id`, `getReportingTree(db, employeeId)`, `SessionUser.employeeId` | every approval flow, scopes, dashboards |
| Phase 1 employees | `employee_events` writer `recordEmployeeEvent()` | payroll salary revisions, exits |
| Phase 2 leave | `approved leave for (employee, date)` query + `onLeaveChanged` hook → attendance recompute | attendance (3), timesheets (4), payroll LOP (5) |
| Phase 2 holidays | `holidaysForEmployee(db, employeeId, range)` (fixed + selected optional) | attendance, leave day count, timesheets, payroll working days |
| Phase 3 attendance | `attendance_days` rows + `recomputeAttendance(db, employeeId, from, to)` | comp-off (3), timesheet reconciliation (4), payroll (5), reports (6) |
| Phase 3 comp-off | CO leave type + `comp_off_lots` FIFO consume/restore on leave approve/cancel | leave (2 hooks), payroll payout (5) |
| Phase 5 payroll | approval locks `attendance_days.locked` for period | attendance edits (3) must respect lock |
| Phase 0 | `notify()`, `writeAudit()`, `defineAction`, `runJob()`, `saveUpload()`, `canAccessFile()`, `getSetting()` | all phases |

Phase 2 is built before Phase 3, so it defines an attendance-recompute hook interface that is a no-op until
Phase 3 implements it:
- `src/server/modules/attendance/hooks.ts` exports `onLeaveChanged(tx, employeeId, from, to)`.

---

## Phase 0 — Foundation

Detailed plans: `2026-09-24-phase-0a-foundation-backend.md`, `2026-09-24-phase-0b-foundation-ui.md`.
Spec: §2, §3, §4.1, §6, §7 (framework only), §9, §10, §11.

**Exit criteria:**
- The seeded super admin can log in, is forced to change their password, and sees the sidebar shell.
- They can manage company/locale/security settings, create users with roles, reset passwords and
  enable/disable users, view the audit log, run jobs, and see notifications.
- RBAC unit tests and the auth e2e pass. `npm run verify` is green.

---

## Phase 1 — Core HR

Spec: §4.2, §5.1, §3.2 (manager scope), §5.7 (profile change approvals), §6 routes `/org/*`, `/me/profile`, `/me/documents`.

Task outline (the detailed plan expands each into TDD steps):

1. Schema:
   - `departments`, `designations`, `employees`, `employee_documents`, `employee_events`,
     `checklist_templates`, `employee_checklists`, `profile_change_requests`.
   - `profile_change_requests` columns: id, employee_id, fields JSON (encrypted where sensitive), status,
     approver_id, decided_at, note.
   - Generate the migration.
2. Validation schemas in `src/lib/validation/employees.ts`, `org.ts`.
3. Employee code generator: `nextEmployeeCode(db)` using `employee` settings (prefix + digits).
4. Sensitive-field helpers: encrypt/decrypt/mask bank account and ID numbers. Unmask only with `employee.sensitive.view`.
5. Org services: departments and designations CRUD with archive, audit, and cycle checks on department parent.
6. Employee service:
   - create, which optionally creates the linked user through the users service;
   - update job/personal/bank;
   - manager change with cycle prevention (a manager cannot report to their own report);
   - `recordEmployeeEvent`.
7. Reporting tree: `getReportingTree(db, managerEmployeeId)` (recursive CTE) and `isInScope(db, user, employeeId)`.
   - Extend `SessionUser` with `employeeId` and `hasReports`.
   - Anyone with ≥1 direct report gets manager scope for approvals even without the manager role.
8. Exit flow:
   - resignation → `on_notice` → last working date;
   - `employee:lifecycle` job sets `exited` on LWD+1, disables the user and bumps `session_version`;
   - probation-end reminders (notify HR).
9. Checklists: templates CRUD; instantiate onboarding on create and offboarding on resignation; tick items.
10. Documents: upload via `saveUpload`, categories, and a file access resolver
    (the employee themself, HR with `document.manage`, managers in scope).
11. Profile change requests: an employee edits personal/bank fields → pending → HR approves → applied + audit.
12. CSV bulk import with `papaparse`:
    - template download;
    - dry-run preview with per-row errors;
    - commit in one transaction.
13. UI:
    - `/org/employees` (DataTable + filters), `/org/employees/new` (wizard), `/org/employees/[id]` (tabs;
      the Salary/Attendance/Leave/Timesheets tabs render "available after Phase N" empty states until those phases exist).
    - `/org/directory`, `/org/chart` (tree from reporting lines), `/org/departments`, `/org/designations`,
      `/org/import`, `/org/checklists`.
    - `/me/profile`, `/me/documents`.
    - Settings → Employee (code prefix).
14. Link the seeded super admin to an optional employee record via the UI (no automatic link).
15. E2E: HR creates an employee with a login → the employee logs in and sees their profile → the employee
    requests a phone change → HR approves.

**Exit criteria:** HR can onboard, edit, and exit employees. Directory and org chart work. Scope helpers are unit-tested.

---

## Phase 2 — Leave, holidays, legacy migration

Spec: §4.5 (except the comp-off tables), §5.4, §5.7 (leave tab), §8, §7 (`leave:accrue`, `leave:year-end`).

1. Schema: `leave_types`, `leave_ledger`, `leave_requests`, `holidays`, `holiday_year_config`, `holiday_selections`.
2. Pure `countLeaveDays({ start, end, startHalf, endHalf, weeklyOffs, holidays, countWeekends })`, heavily unit-tested.
   - Covers half days, sandwich rule, holidays and optional picks.
3. Ledger service:
   - `balanceOf(db, employeeId, leaveTypeId, year)`;
   - `postLedger()`;
   - `grantForYear()` (pro-rated for joiners, rounded to 0.5);
   - `accrueMonth()`;
   - `yearEnd()` (carry forward + lapse).
4. Leave types CRUD plus seed defaults (CL, SL, LWP, CO). CO is system-managed and cannot be deleted.
5. Holiday service:
   - calendar CRUD, CSV import, copy from previous year;
   - optional picks with quota and locked past picks;
   - `holidaysForEmployee()`.
6. Leave request service:
   - apply, with every validation in spec §5.4;
   - approve, which posts a ledger debit and calls `attendance/hooks.onLeaveChanged` (no-op stub now);
   - reject, cancel, withdraw;
   - HR apply-on-behalf; adjustments with a mandatory note.
7. Approval routing: to the reporting manager, falling back to HR admins; notifications to the approver and the employee.
8. Jobs `leave:accrue` (monthly) and `leave:year-end` (yearly), registered in the registry.
9. UI:
   - `/me/leave` (balances, apply sheet with a live day count, history);
   - `/approvals` (leave tab);
   - `/leave/requests`, `/leave/balances` (with adjustments), `/leave/types`, `/leave/holidays`;
   - `/team/calendar`;
   - Settings → Leave.
10. **Legacy migration** `scripts/migrate-legacy.ts --from data/legacy/app.db --to data/people.db`, following spec §8.
    - Integration test against a fixture legacy DB built in the test from the old schema
      (`git show 489c251:src/db/migrations/0000_init.sql`).
    - Verify balances per the old `getUserBalance` logic, re-implemented in the script with the date bug fixed.
    - Exit non-zero on any mismatch.
11. E2E: apply leave → manager approves → balance drops → cancel restores it.

**Exit criteria:** Leave flows e2e pass. The migration runs clean against the real legacy DB copy and reports matching balances.

---

## Phase 3 — Attendance + comp-off

Spec: §4.3, §4.5 (comp-off tables), §5.2, §5.5, §7 (`attendance:close-day`, `compoff:expire`).

1. Schema: `shifts`, `attendance_punches`, `attendance_days`, `regularization_requests`, `comp_off_claims`,
   `comp_off_lots`, `comp_off_consumptions`. Add `employees.shift_id` if Phase 1 left it out.
2. Pure `computeAttendanceDay(input)`, covering every precedence branch of spec §5.2:
   - auto mode, late/early/overtime, off-day worked, admin override.
3. Punch service:
   - clock in/out, derived clock state, multiple sessions per day;
   - converts timezone to the local date;
   - IP recorded.
4. `recomputeAttendance(db, employeeId, from, to)`. Implement `attendance/hooks.onLeaveChanged` with it.
   - Holiday and shift changes trigger a recompute for affected employees and dates.
5. Regularization request/approve, within the settings window. Payroll locks are respected (a locked day refuses changes).
6. `attendance:close-day` job: auto clock-out + compute yesterday for all active employees.
7. Comp-off:
   - eligibility from `off_day_worked`, with the half/full thresholds taken from settings or the shift;
   - claim → approve → lot + ledger credit;
   - FIFO consume/restore inside the leave approve/cancel services for the CO type;
   - `compoff:expire` job with 7-day warnings;
   - payout resolution stored as a pending input, consumed by Phase 5.
8. UI:
   - dashboard clock widget;
   - `/me/attendance` (calendar, claim comp-off prompts, regularize);
   - `/me/comp-off` (lots and expiries);
   - `/approvals` (regularization and comp-off tabs);
   - `/time/attendance` (today board), `/time/muster` (grid), `/time/shifts`, `/leave/comp-off` (admin);
   - Settings → Attendance and Comp-off.
9. E2E: clock in/out → attendance present; work on a Saturday (seed punches) → claim → approve → apply CO leave → balance consumed.

**Exit criteria:** Punch → attendance → comp-off → CO leave works end to end. Muster roll renders a month.

---

## Phase 4 — Timesheets

Spec: §4.4, §5.3, §7 (`timesheet:remind`).

1. Schema: `clients`, `projects`, `project_members`, `task_categories`, `timesheets`, `timesheet_entries`, `running_timers`.
2. Services:
   - clients/projects/members/categories CRUD;
   - timesheet week get-or-create;
   - upsert entries (validations in spec §5.3);
   - submit/approve/reject;
   - timer start/stop;
   - attendance reconciliation (variance per day).
3. Reminder jobs: Friday reminder to employees, Monday reminder to managers.
4. Utilization math, pure and tested: available hours from the attendance calendar, logged, billable %.
5. UI:
   - `/me/timesheets` (week list), `/me/timesheets/[week]` (grid with holidays, leave and attendance rows; timer);
   - `/approvals` (timesheets tab);
   - `/time/projects`, `/time/projects/[id]` (members, budget burn), `/time/clients`, `/time/categories`.
6. E2E: log hours → submit → manager approves → the week is locked.

**Exit criteria:** Timesheet flow e2e passes. Utilization numbers are unit-tested.

---

## Phase 5 — Payroll + payslips

Spec: §4.6, §5.6 (entire section, including payslip verification/signing/email), §5.7 (claims tab).

1. Formula engine (pure, extensive tests):
   - `lexer.ts`, Pratt `parser.ts`, `evaluate.ts` (whitelisted functions/identifiers, length limit);
   - `graph.ts` (topological order, cycle detection);
   - malicious-input tests.
2. Schema: `salary_components`, `salary_structures`, `salary_structure_components`, `employee_salaries`,
   `payroll_runs`, `payroll_inputs`, `payslips`, `payslip_lines`, `payslip_verifications`, `loans`,
   `loan_repayments`, `expense_claims`.
3. Pure calculator `calculatePayslip(input)` covering:
   - components in dependency order, `_RATE` vs earned, proration, `balance` component, rounding;
   - net capping with warnings, explanations.
4. Attendance summary for a period: `TOTAL_DAYS`, `LOP_DAYS`, `PAID_DAYS`, per spec §5.6, including projection for future days.
5. Components/structures CRUD with formula validation and live preview. Seed a sensible default structure:
   BASIC 50% of monthly CTC, HRA 40% of BASIC, SPECIAL balance.
6. Employee salary service: revisions (1st of month), preview, `recordEmployeeEvent('salary_revised')`.
7. Payroll run service:
   - create → gather inputs (manual, claims, loans, comp-off payouts, arrears, exit settlement/encashment) → compute;
   - review (variance, warnings, hold/exclude);
   - approve (maker-checker; locks attendance; claims paid; loan repayments);
   - release, mark paid, revert (super_admin, not after release), off-cycle runs.
8. Arrears computation for backdated revisions.
9. Loans (EMI schedule) and expense claims (submit → manager approve → included → paid).
10. Payslip PDF (`@react-pdf/renderer`):
    - layout per spec §5.6, with amount in words and a YTD column;
    - draft watermark preview;
    - frozen PDF stored at release with its sha256;
    - verification code + QR (`qrcode`);
    - optional PAdES signing (`@signpdf/*`) when `PAYSLIP_SIGN_P12_*` is set;
    - optional password-protected email copy (`@cantoo/pdf-lib`).
11. Public `/verify/[code]`: rate-limited, masked name, net-pay match check, lookups logged.
12. Bank advice + payroll register exports (`exceljs`).
13. UI:
    - `/payroll/runs`, `/payroll/runs/[id]` (inputs, register, drill-down, warnings, actions);
    - `/payroll/components` (formula editor with preview), `/payroll/structures`, `/payroll/salaries`,
      `/payroll/loans`, `/payroll/claims`;
    - `/me/payslips`, `/me/payslips/[id]`, `/me/claims`;
    - Settings → Payroll.
14. E2E: full run lifecycle (maker ≠ checker) → release → employee downloads PDF → verify page confirms it.

**Exit criteria:**
- The payroll e2e passes.
- The calculator and formula engine have exhaustive unit tests.
- The stored PDF hash matches on re-download.

---

## Phase 6 — Insight, notifications, polish, deploy

Spec: §5.8, §5.9, §5.10, §5.11 remainder, §4.1 announcements, §6 PWA/accessibility, §7 remaining jobs, §11 full suite, DEPLOY.

1. Email notifications for every event in spec §5.8, with per-user email opt-out; `notifications:digest` job.
2. Role-aware dashboards (employee / manager / HR-admin) with recharts widgets.
3. Reports centre `/reports` + `/reports/[slug]` for every report in spec §5.10, plus `/api/exports/[report]` (XLSX/CSV, audited).
4. Announcements (CRUD, pinned, publish/expiry, dashboard widget).
5. PWA manifest + icons from `public/brand`, installable; mobile layout pass.
6. Accessibility pass (keyboard, focus, contrast) and performance pass (indexes, N+1 queries).
7. Rewrite `DEPLOY.md`:
   - new env vars and crontab entries for every job;
   - backups including `UPLOAD_DIR`;
   - legacy cutover runbook (spec §8);
   - pm2 reload flow.
   Rewrite `README.md`.
8. Full e2e regression; `npm run verify` green; final review with `superpowers:requesting-code-review`.

**Exit criteria:** All reports export. Docs are ready for production cutover. The full test suite is green.
