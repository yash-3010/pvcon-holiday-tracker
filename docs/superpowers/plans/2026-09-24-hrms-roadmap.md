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
| 0B Foundation — UI, auth pages, e2e | `2026-09-24-phase-0b-foundation-ui.md` | ☑ done (deb1b70) |
| 1 Core HR | `2026-09-25-phase-1-core-hr.md` | ☑ done (049b86d) |
| 2 Leave, holidays, legacy migration | `2026-10-23-phase-2-leave-holidays.md` | ☑ done (05b006a) |
| 3 Attendance + comp-off | `2026-10-24-phase-3-attendance-compoff.md` | ☑ done (f3684ce) |
| 4 Timesheets | `2026-10-24-phase-4-timesheets.md` | ☑ done (ad47353) |
| 5 Payroll + payslips | `2026-10-24-phase-5-payroll.md` | ◐ in progress (plan written) |
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
10. **SMTP status and test email** (spec §5.11) move to Phase 6, alongside email notifications. Phase 0 has no
    SMTP settings page.
11. **Forced password change is enforced on the server.**
    - `executeAction` returns `PASSWORD_CHANGE_REQUIRED` for users with `mustChangePassword`, so no `defineAction`
      mutation runs with an admin-issued temporary password.
    - Route handlers that serve user data must refuse those users too (`/api/files` returns 403). Later routes
      (`/api/exports/*`, payslip PDFs) follow the same rule.
12. **Unexpected action errors carry a reference.** `executeAction` logs `requestId` with the error and returns
    "… (Reference <id>)", so a user's toast can be matched to the log line (spec §9).
13. **Profile change requests cover bank and ID numbers only.** Spec §5.1 lets employees edit their contact fields
    (phone, personal email, address, emergency contact) directly, so the Phase 1 E2E uses a bank change instead of the
    roadmap's phone-change example. A request carries only the values the employee typed; blank keeps the current value.
    Nobody decides their own request (`SELF_APPROVAL`), and approvers need `employee.sensitive.view`.
14. **Core HR schema additions** beyond spec §4.2: `checklist_templates.is_default`/`archived`, `employee_checklists.name`
    and status `open|completed|cancelled`, `profile_change_requests.reason`/`requested_by`. `employees.shift_id` arrives
    with `shifts` in Phase 3.
15. **Team approval permissions.** Anyone with at least one current direct report receives `TEAM_APPROVAL_PERMISSIONS`
    (leave, comp-off, regularization, timesheet and claim approval) for their reporting tree. Later approval flows must
    check scope and refuse the user's own record explicitly (`SELF_APPROVAL`): `isInScope` is false for a manager's
    own record but true for org-wide viewers (`employee.view`).
16. **Approvals inbox starts in Phase 1** with the Profile changes tab (nav item visible to `employee.update`).
    Phase 2 adds the Leave tab and widens the nav item's `anyOf` to the approval permissions.
17. **CSV import** creates employee records only: no logins, no onboarding checklists. Managers are matched by
    `manager_email`; a new manager must be on an earlier row. Commit is all-or-nothing.
18. **Photo upload** (`employees.photo_file_id`) is deferred to the Phase 6 polish pass; the directory shows initials.
19. **Profile visibility.** Managers see Overview, Job, Documents, History and Checklists for their reporting tree;
    Personal and Bank & IDs are limited to the employee and org-wide viewers (`employee.view`). Out-of-scope profile
    URLs return 404.
20. **Exit flow.** HR can withdraw a resignation (on notice → active, open offboarding checklist cancelled). The
    `employee:lifecycle` job never disables the last active super admin's login.
21. **Probation reminders** go to `employee.update` holders once per employee and probation end date, when it is
    within the next 7 days.
22. **LWP debits its own ledger.** Approved leave without pay posts a `taken` row against the LWP type, so its balance goes
    negative and equals the days used. It never touches CL/SL. Spec §8's "no balance debit" is honoured in that no paid
    balance is reduced; migrated unpaid leave is posted the same way.
23. **Leave years.** A request may not cross a leave-year boundary (`CROSSES_LEAVE_YEAR`); its ledger rows use the leave
    year of its start date. `leave.yearStartMonth` is locked once any ledger row exists.
24. **Balance checks count pending requests** (available = balance − pending) when applying. Approval re-checks the
    balance alone.
25. **Self-service rules.**
    - Back-dated requests are allowed only for types with `min_notice_days = 0` (e.g. SL).
    - HR "Record leave" (apply on behalf, `leave.adjust`) is approved at once and skips notice and max-consecutive, but
      not balance, overlap or employment dates.
    - Nobody records, approves or adjusts their own leave (`SELF_APPROVAL`, `SELF_ADJUST`).
    - Employees cancel their own approved leave only before it starts; HR (`leave.adjust`) cancels any, with a note.
26. **Credits stay in half days.**
    - Monthly accrual credits `floorHalf(q·k/12) − floorHalf(q·(k−1)/12)` in month k.
    - Upfront grants are pro-rated by the months left, counting the joining month, rounded to the nearest half day.
    - New employees get their joining year's credits on creation (`syncEntitlements`); later years come from the jobs.
27. **Year end.**
    - Carry-forward is posted as a pair (−c out of the closed year, +c into the next), so a closed year nets to zero.
    - The excess of encashable types lapses until Phase 5 adds encashment.
    - Comp-off is skipped; its lots expire in Phase 3.
28. **Weekly offs** belong to shifts since Phase 3 (see 35). Code reads them only through `weeklyOffsForEmployee` /
    `companyWeeklyOffs`.
29. **Holidays.**
    - The optional-holiday quota is per calendar year; a year with no config allows 0 picks.
    - Picks lock once the date passes.
    - Making an optional holiday fixed clears its picks.
    - Holiday edits never re-price existing requests.
30. **Team calendar** shows org-wide viewers everyone (department filter). Everyone else sees themselves, their reporting
    tree and their peers (same manager). The leave type is masked as "Leave" unless the viewer is the employee, an
    org-wide viewer or a manager above them.
31. **Approvals inbox** opens the first tab with requests waiting unless `?tab=` names one. Notifications deep-link to
    their tab.
32. **Legacy migration.**
    - Old admins become super admins; an admin with leave history also gets an employee record.
    - Optional picks alone don't count, and picks of admins without a record are dropped and reported.
    - Inactive users become disabled logins and exited employees.
    - Grants follow each year's old policy without pro-rating, to match the old balances.
    - Attendance for the history (§8 step 7) is computed by the migration since Phase 3, from the first joining date to
      today, on a default shift seeded in auto mode. Payroll components are seeded in Phase 5.
33. **Job run keys may read settings**: `JobDefinition.runKey(now, timeZone, db)`, so `leave:year-end` keys on the leave
    year being closed.
34. **Shifts don't cross midnight.** The end must be after the start, and the automatic clock-out at or after the end.
35. **Shifts own the weekly offs and the attendance mode.**
    - `attendance.weeklyOffs` only seeds the first shift; Settings → Leave keeps just the leave-year month.
    - Until a shift is seeded, a virtual default (id 0, never stored) applies, so reads never write. The seed creates
      "General" 09:30–18:30; the legacy migration creates it in auto mode.
    - `employees.shift_id` has no `ON DELETE`: shifts are archived, never deleted. The default shift and shifts with
      current employees can't be archived.
36. **Shift changes apply from today.** Changing the default shift, editing a shift or assigning employees rebuilds
    today's row only. Shifts aren't versioned, so a later recompute of an earlier day (leave, a correction, an override)
    uses the employee's current shift.
37. **Corrections replace punches.** An approved regularization's punches supersede the day's other punches; a second
    approval for the same day replaces the first one's.
38. **Today is provisional.** Today's punch-based status (present, half day, absent) is shown as in progress and not
    counted until the day closes. Future days are never stored. Read models never write.
39. **A forgotten session** closes at its day's automatic clock-out time on the next clock-in, or in the nightly close.
40. **The nightly close heals gaps.** `attendance:close-day` also computes any of the 34 days before yesterday that have no
    row (a missed run, a back-dated joiner). Exited employees count only up to their last working day; migrated
    inactive accounts, which have none, get no attendance.
41. **`half_leave` keeps the worked minutes.** Phase 5 decides the loss of pay for an unworked other half.
42. **Comp-off balances come from lots, not the ledger.**
    - Leave checks and FIFO consumption use lots still valid on the leave's start date, earliest expiry first.
    - The credit is posted in the leave year of the approval date, so work approved after a year end is still usable.
    - Year end carries the active lots' remaining days into the next year and lapses the rest; expiry lapses a lot
      exactly once and warns 7 days ahead.
43. **Comp-off payout** claims are approved with `resolution = 'payout'` and no lot; Phase 5 pays them.
44. **Shared approval routing** (`src/server/modules/approvals/routing.ts`): leave, comp-off and regularization use
    the same rule (the right permission, plus org-wide viewing or a manager above), and self-approval is refused.
45. **No self-service for admins.** HR can't override their own attendance (`SELF_OVERRIDE`) or grant themselves
    comp-off (`SELF_ADJUST`). Grants refuse future days and days outside employment.
46. **Managers see their team's attendance.** `regularization.approve` holders get Today and the Muster roll for their
    reporting tree, read-only; overrides need `attendance.manage`.
47. **E2E sign-ins.** The login limiter allows 20 sign-ins per 15 minutes per client IP, and a password change signs in
    again. Each spec sends its own address (`test.use(clientIp(n))` from `tests/e2e/helpers.ts`). The Phase 3 spec is
    `time-attendance.spec.ts`: spec files run alphabetically, and `auth.spec.ts` must run first.
48. **Two timesheet reminder jobs** instead of one `timesheet:remind`: `timesheet:remind-employees` (Friday 16:00 IST)
    and `timesheet:remind-approvers` (Monday 10:00 IST), each keyed on the week's Monday.
49. **A timesheet week is saved whole.** Saving replaces the week's entries. A row is a (project, task category) pair;
    its billable flag and note are stored on each of its entries. Rows already in a stored week stay allowed when the
    project closes or the employee leaves it, and archived categories likewise.
50. **Who logs to what.** Internal projects (no client) are open to everyone; client projects to their active members.
    A project takes time only while active and inside its start and end dates. The seed adds an "Internal" (`INT`)
    project and default task categories.
51. **Timesheet decisions.** Rejecting needs a reason. Approval is final in this phase (no reopen). Employees can
    withdraw a submitted week until someone decides.
52. **Timesheet dates.** No time after today, before joining or after the last working day. An empty week can be
    submitted only when it offered no working hours. A timer started inside the week blocks submitting it.
53. **The timer** is one per employee, rounds to the nearest quarter hour (under 8 minutes adds nothing), and belongs to
    its start date, where it stops counting at local midnight. Stopping into a locked week is refused; the timer can then
    be discarded.
54. **Available hours** per working day are the shift length less the break (half on a half-day leave). Utilization =
    logged ÷ available; billable share = billable ÷ logged.
55. **Attendance reconciliation** shows worked time on punch-mode shifts only; a past day is flagged when logged and
    worked differ by more than an hour.
56. **Projects.** Budget burn counts submitted and approved hours, with drafts shown apart. `project.manage` edits
    projects, clients and categories; `timesheet.view.all` reads projects. The project manager field is informational.
    The profile Timesheets tab shows to the employee, managers above them and `timesheet.view.all`.

## Cross-phase integration map

Build each phase so these seams exist. Later phases consume them.

| Producer | Seam | Consumers |
|---|---|---|
| Phase 1 employees | `employees.user_id`, `reporting_manager_id`, `getReportingTree(db, managerEmployeeId)`, `isInScope(db, user, employeeId)`, `canViewEmployee`, `SessionUser.employeeId`/`hasReports` (`src/server/modules/employees/scope.ts`) | every approval flow, scopes, dashboards |
| Phase 1 employees | `employee_events` writer `recordEmployeeEvent()` | payroll salary revisions, exits |
| Phase 0/1 users | `activeUserIdsWithPermission(db, permission)` (approver fallback, HR notifications) | every approval flow, reminders |
| Phase 2 leave | approved `leave_requests` (status, days, halves, `is_lop` type) + `onLeaveChanged(tx, employeeId, from, to)` in `attendance/hooks.ts` | attendance (3), timesheets (4), payroll LOP (5) |
| Phase 2 leave | `postLedger`, `balanceOf`, `syncEntitlements`, `canDecideLeave`, the CO type (`compOffType`) | comp-off credits/FIFO (3), encashment (5) |
| Phase 2 holidays | `holidaysForEmployee(db, employeeId, from, to)`, `holidayDatesForEmployee`, `onHolidayChanged(tx, date)`; `weeklyOffsForEmployee` in `attendance/calendar.ts` | attendance, leave day count, timesheets, payroll working days |
| Phase 3 attendance | `attendance_days` rows (`isProvisional` for today) + `recomputeAttendance(db, employeeId, from, to, { now })`, `fillMissingAttendance(db, from, to)`; payroll should fill and recompute the unlocked days of a period before reading it | comp-off (3), timesheet reconciliation (4), payroll (5), reports (6) |
| Phase 3 attendance | `shiftForEmployee`, `shiftRules`, `weeklyOffsForEmployee` (shift-based) | timesheets available hours (4), payroll working days (5) |
| Phase 3 comp-off | CO leave type + `comp_off_lots` FIFO consume/restore on leave approve/cancel; `compOffAvailable(db, employeeId, onDate)` | leave (2 hooks), encashment (5) |
| Phase 3 comp-off | approved claims with `resolution = 'payout'` (no lot) | payroll payout (5) |
| Phase 4 timesheets | `workCalendar(db, employeeId, from, to)` / `availableMinutes` (`timesheets/availability.ts`), `utilization()` (`src/lib/timesheets.ts`), `timesheet_entries` joined with `timesheets.status` (approved = final), `projectDetail` budget burn | reports and dashboards (6) |
| Phase 5 payroll | approval sets `attendance_days.locked` for the period; recompute, regularization, overrides and leave hooks already skip locked days | attendance edits (3) |
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
