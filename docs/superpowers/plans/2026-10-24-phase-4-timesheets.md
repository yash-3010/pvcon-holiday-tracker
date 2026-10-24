# Phase 4 — Timesheets Implementation Plan

> **For agentic workers:** Execute task by task with TDD (failing test → implementation → passing test → commit).
> Like the Phase 2 and 3 plans, this fixes **contracts** (files, signatures, rules, test cases); the executor writes the
> code in the style of the existing modules. Record any deviation from the spec in Task 16 and the roadmap.

**Goal:**
- Clients, projects (with members and budgets) and task categories.
- A weekly timesheet per employee: a Monday–Sunday grid of project × category rows in quarter hours, with holidays,
  weekly offs, leave and the attendance worked time beside it.
- A running timer, submit → manager approval → locked week, and reminders.
- Pure utilization math (available hours from the attendance calendar, logged, billable %) for Phase 6 reports.

**Architecture:**
- Tables in `src/server/db/schema/timesheets.ts`.
- Pure constants and math in `src/lib/timesheets.ts`; zod schemas in `src/lib/validation/timesheets.ts`.
- Services:
  - `src/server/modules/projects/*`: clients, projects, members, categories;
  - `src/server/modules/timesheets/*`: availability, weeks, approvals, timer, read models.
- Approvals reuse `approvals/routing.ts` with a new `TIMESHEET_APPROVAL` right.

**Spec:** `docs/superpowers/specs/2026-09-24-hrms-overhaul-design.md`:
- §4.4 (tables), §5.3 (behaviour), §5.7 (Timesheets approval tab), §5.8 (timesheet notifications), §5.9 (dashboard
  "this week's timesheet progress");
- §7 (`timesheet:remind`).

**Prerequisite:** Phase 3 is complete. Reuse these names exactly:
- dates: `startOfWeek`, `addDays`, `eachDay`, `dayOfWeek`, `dateInTimeZone`, `todayInTimeZone`, `formatMinutes`;
- attendance: `shiftForEmployee`, `shiftRules`, `attendance_days` (+ `isProvisional`), `holidaysForEmployee`,
  `requestPortions` (`src/lib/leave.ts`);
- approvals: `canDecideFor`, `approverUserIdsFor` (`src/server/modules/approvals/routing.ts`);
- employees: `requireEmployee`, `getReportingTree`, `isManagerAbove`, `canViewEmployee`;
- notifications: `notify`, `notifyMany`; jobs: `JOBS`, `runJobByName`.

## Global Constraints

- Weeks run Monday to Sunday; a week is named by its Monday (`week_start`, `YYYY-MM-DD`).
- Durations are integer minutes in multiples of 15 (the grid shows hours in 0.25 steps). A day's total is at most 24 h.
- A timesheet row is a (project, task category) pair. Its billable flag and note are stored on each of its entries.
- Reads never write: a week without a stored timesheet reads as an empty draft.
- Services are synchronous, take `db` first, never `await` inside a transaction; "now" and "today" are parameters.
- Every mutation goes through `defineAction` and calls `audit(...)`. Timer start/stop are audited as `timesheet.timer`.
- Approval follows the shared rule: `timesheet.approve`, plus org-wide (`timesheet.view.all`) or a manager above.
  Never one's own.

## Review Focus

1. **Which projects an employee may log to** (spec §5.3): active projects where they are an active member, plus
   internal projects (no client), inside the project's dates. Rows already in the week stay valid if the project
   closes later. Test: Task 6.
2. **Locking.** Only `draft` and `rejected` weeks change. Submit locks, withdraw/reject unlock, approve is final.
   Test: Tasks 6–8.
3. **Time and dates.** No entries after today, before joining or after the last working day. The timer belongs to
   its start date in the company time zone and never runs past that day's midnight. Test: Tasks 6, 8.
4. **Availability math** (shift length − break per working day; half for a half-day leave; 0 for leave, holidays,
   weekly offs and days outside employment). It feeds utilization, submit rules and reminders. Tests: Tasks 1, 5.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/timesheets.ts` | Statuses/labels, quarter-hour helpers, `weekDates`, `dayAvailableMinutes`, `utilization` |
| `src/lib/validation/timesheets.ts` | zod: client, project, member, category, week save, timer, decision, bulk approve |
| `src/server/db/schema/timesheets.ts` | `clients`, `projects`, `project_members`, `task_categories`, `timesheets`, `timesheet_entries`, `running_timers` |
| `src/server/modules/projects/service.ts` | Clients, projects, members, categories CRUD; `seedTimesheetDefaults` |
| `src/server/modules/projects/queries.ts` | Lists, options, project detail with budget burn |
| `src/server/modules/timesheets/availability.ts` | Per-day calendar (kind, available minutes) for an employee and range |
| `src/server/modules/timesheets/service.ts` | Allowed projects, week save, submit, withdraw, approve, reject, bulk approve |
| `src/server/modules/timesheets/timer.ts` | Start, stop, discard the running timer |
| `src/server/modules/timesheets/queries.ts` | My weeks, week detail (grid + calendar + attendance), approvals queue, profile tab, dashboard card |
| `src/server/jobs/timesheet-remind-employees.ts`, `timesheet-remind-approvers.ts` | Reminder jobs |
| `src/app/(app)/me/timesheets/*`, `me/timesheets/[week]/*` | Self-service |
| `src/app/(app)/time/{projects,projects/[id],clients,categories}/*` | Admin |
| `src/app/(app)/approvals/*` | + Timesheets tab |
| `tests/e2e/timesheets.spec.ts` | Log → submit → approve → locked |

---

### Task 1: Constants and pure math

**Files:** Create `src/lib/timesheets.ts`; Test `tests/unit/lib/timesheets.test.ts`

- `TIMESHEET_STATUSES = [draft, submitted, approved, rejected]` with labels and badge tones; `EDITABLE_STATUSES = [draft, rejected]`.
- `PROJECT_STATUSES = [active, on_hold, closed]` with labels.
- `QUARTER = 15`; `isQuarterHour(minutes)`; `hoursToMinutes(1.25) → 75` (rounds to the nearest quarter);
  `minutesToHours(75) → 1.25`; `formatHours(75) → "1.25"` (no trailing zeros: `"8"`, `"7.5"`).
- `weekDates(weekStart) → ISODate[7]`; `isWeekStart(date)` (a Monday).
- `DayKind = "working" | "half_leave" | "leave" | "holiday" | "weekly_off" | "not_employed"`;
  `dayAvailableMinutes(kind, shiftMinutes)`: working → shift, half_leave → half (rounded down to a quarter),
  others → 0.
- `utilization({ availableMinutes, loggedMinutes, billableMinutes }) → { utilizationPct: number | null; billablePct: number | null }`
  with one decimal; null when the denominator is 0.
- `roundTimerMinutes(elapsedMinutes)`: nearest quarter; under 8 minutes → 0.
- **Tests:** quarter rounding both ways, `formatHours`, a Monday check, each day kind, utilization with zero
  available/logged, timer rounding at 7, 8, 22, 23 minutes.

- [x] Commit `feat(timesheets): add timesheet constants and utilization math`

### Task 2: Validation schemas

**Files:** Create `src/lib/validation/timesheets.ts`; Test `tests/unit/lib/timesheet-validation.test.ts`

- `clientSchema`: `name` 1–100, `code` optional (2–10 uppercase letters/digits).
- `projectSchema`: `name` 1–120, `code` 2–12 uppercase letters/digits/dashes, `clientId` id|null (null = internal),
  `billableDefault`, `status`, `startDate`/`endDate` optional with end ≥ start, `budgetHours` int 1–100000 or null,
  `managerEmployeeId` id|null.
- `memberSchema`: `projectId`, `employeeIds` (1–200), `role` optional ≤ 60.
- `categorySchema`: `name` 1–60, `billableDefault`.
- `weekSaveSchema`: `weekStart` (a Monday), `rows` ≤ 60 of `{ projectId, taskCategoryId, billable, notes ≤ 300,
  minutes: Record<ISODate, number> }`; each minute value a quarter in 0–1440; no duplicate (project, category) rows.
- `timerStartSchema`: `projectId`, `taskCategoryId`, `notes` optional.
- `timesheetDecisionSchema`: `timesheetId`, `decision`, `note`; a note of 3+ characters is required to reject.
- `bulkApproveTimesheetsSchema`: `timesheetIds` (1–100), `note` optional.
- **Tests:** a Sunday `weekStart`, a 20-minute cell, duplicate rows, a reject without a note, end before start.

- [x] Commit `feat(timesheets): add timesheet validation schemas`

### Task 3: Schema and migration

**Files:** Create `src/server/db/schema/timesheets.ts`; Modify `schema/index.ts`; Generate `0004_timesheets`; Test `tests/integration/db/timesheets-schema.test.ts`

- `clients`: id, `name` (unique, case-insensitive), `code` (unique, nullable), `archived`, timestamps.
- `projects`: id, `client_id` → clients (no action: clients are archived, not deleted), `code` unique, `name`,
  `billable_default`, `status`, `start_date`?, `end_date`?, `budget_hours`?, `manager_employee_id` → employees
  (set null), timestamps.
- `project_members`: PK (`project_id`, `employee_id`), both cascade; `role`?, `active`, `created_at`.
- `task_categories`: id, `name` unique, `billable_default`, `archived`, `sort_order`, timestamps.
- `timesheets`: id, `employee_id` (cascade), `week_start`, `status`, `submitted_at`, `approver_id` → users (set null),
  `decided_at`, `decision_note`, timestamps; unique (`employee_id`, `week_start`); index (`status`, `week_start`).
- `timesheet_entries`: id, `timesheet_id` (cascade), `project_id` → projects, `task_category_id` → task_categories,
  `date`, `minutes`, `billable`, `notes`, timestamps; unique (`timesheet_id`, `project_id`, `task_category_id`, `date`);
  index (`project_id`, `date`).
- `running_timers`: `employee_id` PK (cascade), `project_id`, `task_category_id`, `notes`, `started_at` (UTC ISO).
- **Tests:** tables exist; the unique week and entry keys; deleting a timesheet cascades its entries.

- [x] Commit `feat(db): add timesheet schema`

### Task 4: Clients, projects, members, categories

**Files:** Create `src/server/modules/projects/{service,queries}.ts`; Modify `scripts/seed.ts`, `legacy/migrate.ts`; Test `tests/integration/projects.test.ts`

- Clients: `createClient`, `updateClient → { before, after }`, `setClientArchived` (refused while the client has
  active or on-hold projects: `CLIENT_IN_USE`); `DUPLICATE_NAME` / `DUPLICATE_CODE` with field errors.
- Categories: `createCategory`, `updateCategory`, `setCategoryArchived`; names unique.
- Projects: `createProject`, `updateProject → { before, after }` (an archived client refused); codes unique.
- Members: `addMembers(db, projectId, employeeIds, role)` (current employees only: `NOT_CURRENT`; re-adding
  reactivates), `setMemberActive(db, projectId, employeeId, active)`.
- `seedTimesheetDefaults(db)` (idempotent): categories Development, Design, Testing, Meetings, Documentation, Support
  (billable) and Training, Internal admin (not billable); an internal project "Internal" (code `INT`, no client, not
  billable, active). Called by `scripts/seed.ts` and the legacy migration.
- Queries: `listClients`, `listCategories({ includeArchived })`, `listProjects({ status?, clientId? })` with client
  name, member count and logged hours; `projectOptions`, `clientOptions`, `categoryOptions`.
- **Tests:** duplicates refused case-insensitively; archiving a client with an active project refused; re-adding a
  removed member reactivates them; the seed runs twice without duplicates.

- [x] Commit `feat(projects): add clients, projects, members and task categories`

### Task 5: Availability calendar

**Files:** Create `src/server/modules/timesheets/availability.ts`; Test `tests/integration/timesheet-availability.test.ts`

- `workCalendar(db, employeeId, from, to) → { date, kind: DayKind, holiday: string | null, leave: { code, portion } | null, availableMinutes }[]`:
  - employment from `dateOfJoining`/`lastWorkingDate`; shift from `shiftForEmployee`; shift minutes = end − start − break;
  - holidays from `holidaysForEmployee`; approved leave portions from `requestPortions` (two halves = leave).
- `availableMinutes(db, employeeId, from, to)`: the sum.
- **Tests:** a Mon–Fri week on the General shift is 5 × 480; a holiday and a half-day leave take 480 and 240 off; a
  Sunday-only shift makes Saturday a working day; a joiner on Wednesday has 3 working days.

- [x] Commit `feat(timesheets): add the work calendar for available hours`

### Task 6: Saving a week

**Files:** Create `src/server/modules/timesheets/service.ts`; Test `tests/integration/timesheets.test.ts`

- `allowedProjects(db, employeeId, onDate) → ProjectRow[]`: active, (internal or active member), and
  `start_date ≤ onDate ≤ end_date` when set.
- `saveWeek(db, actor, { weekStart, rows }, { today }) → { timesheet, warnings: string[] }`:
  - the actor's own week only (`NO_EMPLOYEE` otherwise);
  - refused unless the week is draft or rejected (`TIMESHEET_LOCKED`); a rejected week stays rejected until submitted;
  - get-or-create the `timesheets` row; replace all entries; zero-minute cells are dropped;
  - every date inside the week, not after today (`FUTURE_DATE`), inside employment (`NOT_EMPLOYED`);
  - every project allowed on each of its dates, unless the stored week already had that project (`PROJECT_NOT_ALLOWED`);
    categories not archived (unless already in the week);
  - each day's total ≤ 1440 (`DAY_OVER_24H`, field error on the row/date);
  - warnings (not errors): "<date> is a full day of leave" for minutes on such a day.
- `getOrCreateTimesheet(db, employeeId, weekStart)` (internal helper).
- **Tests:** saving twice replaces entries; a non-member project refused, an internal project allowed; a closed
  project already in the week can still be saved; a future date refused; 25 h on a day refused; a submitted week
  refused; a leave-day warning is returned.

- [x] Commit `feat(timesheets): save weekly timesheet entries`

### Task 7: Submit, withdraw, approve, reject

**Files:** Modify `timesheets/service.ts`, `approvals/routing.ts`; Test `tests/integration/timesheet-approvals.test.ts`

- `TIMESHEET_APPROVAL = { approve: "timesheet.approve", orgWide: "timesheet.view.all" }`; `canDecideTimesheet`.
- `submitTimesheet(db, actor, weekStart, { today, now })`:
  - draft/rejected only; not a future week (`weekStart > startOfWeek(today)` → `FUTURE_WEEK`);
  - an empty week only when it had no available minutes (`EMPTY_WEEK`);
  - refused while the actor's running timer started inside the week (`TIMER_RUNNING`);
  - sets `submitted`, `submitted_at`, clears the previous decision; notifies `approverUserIdsFor` (link
    `/approvals?tab=timesheets`).
- `withdrawTimesheet(db, actor, timesheetId)`: own and submitted only → draft.
- `approveTimesheet(db, actor, id, note)` / `rejectTimesheet(db, actor, id, note)`: submitted only (`NOT_PENDING`),
  `canDecideTimesheet` (`FORBIDDEN`, `SELF_APPROVAL`); reject → `rejected`; notifies the employee (link
  `/me/timesheets/<week>`).
- `bulkApproveTimesheets(db, actor, ids, note) → { approved: number[]; failed: { id, error }[] }`.
- **Tests:** submit/withdraw/resubmit; a future week and an empty working week refused; an all-leave week can be submitted
  empty; the manager approves, a peer cannot, nobody approves their own; a rejected week is editable again; approved
  is locked; bulk approve reports failures.

- [x] Commit `feat(timesheets): submit, approve and reject timesheets`

### Task 8: Running timer

**Files:** Create `src/server/modules/timesheets/timer.ts`; Test `tests/integration/timesheet-timer.test.ts`

- `runningTimer(db, employeeId)`.
- `startTimer(db, actor, { projectId, taskCategoryId, notes }, { now })`: one per employee (`TIMER_RUNNING`); the
  project allowed today; the current week editable.
- `stopTimer(db, actor, { now }) → { minutes, date }`:
  - `date` = the start's local date; elapsed is capped at that date's local midnight; minutes via `roundTimerMinutes`;
  - adds to the (project, category, date) entry of that week (creating the week and row; the row's billable default
    and the timer notes when new) and deletes the timer;
  - 0 minutes → deletes the timer and reports nothing added;
  - refused if the week is no longer editable (`TIMESHEET_LOCKED`; the timer stays so it can be discarded).
- `discardTimer(db, actor)`.
- **Tests:** 1 h 07 m adds 60; a timer started at 23:30 and stopped next morning adds 30 to the start date; a second
  start is refused; stopping into a submitted week is refused.

- [x] Commit `feat(timesheets): add the running timer`

### Task 9: Read models

**Files:** Create `src/server/modules/timesheets/queries.ts`; Test `tests/integration/timesheet-queries.test.ts`

- `myWeeks(db, employeeId, { today, count = 12 })`: the last `count` weeks (newest first), each with status (a missing
  week is a virtual draft), logged and billable minutes, available minutes.
- `weekDetail(db, employeeId, weekStart, { today, now })`:
  - `days`: the work calendar plus attendance worked minutes (null for auto-mode shifts, future days and days without
    a row), logged per day, variance (logged − worked) and `flag` when |variance| > 60;
  - `rows`: grouped entries `{ projectId, projectCode, projectName, clientName, taskCategoryId, categoryName,
    billable, notes, minutes: Record<date, number> }`;
  - `status`, `editable`, `decision` (approver name, note, date), `timer` (running timer if any);
  - `options`: allowed projects on the week's dates (+ projects already in it) and active categories, each with its
    billable default.
- `pendingTimesheetsFor(db, user)`: submitted timesheets `user` can decide, oldest first, with employee, week, logged,
  billable, available, the count of flagged days and leave days.
- `timesheetDetailForApprover(db, user, timesheetId)` (scope: can decide, org-wide view, or own) → the week detail.
- `employeeTimesheetSummary(db, employeeId, { today })`: the last 8 weeks for the profile tab.
- `weekCard(db, employeeId, { today })`: this week's status, logged, available and utilization for the dashboard.
- **Tests:** a virtual draft for an unsaved week; variance flags a day 2 h short; auto-mode days have no attendance
  reference; the manager's queue holds only their team.

- [x] Commit `feat(timesheets): add timesheet read models`

### Task 10: Reminder jobs

**Files:** Create `src/server/jobs/timesheet-remind-employees.ts`, `timesheet-remind-approvers.ts`; Modify `registry.ts`; Test `tests/integration/timesheet-jobs.test.ts`

- `timesheet:remind-employees` (Friday 16:00 IST; run key = the week's Monday):
  - current employees with an active login whose current week is neither submitted nor approved and had available
    minutes → a `timesheet.reminder` notification (link `/me/timesheets/<week>`).
- `timesheet:remind-approvers` (Monday 10:00 IST; run key = the week's Monday):
  - every approver with submitted timesheets waiting (per `approverUserIdsFor`) → one `timesheet.pending` notification
    with the count (link `/approvals?tab=timesheets`).
- **Tests:** submitted and all-leave weeks get no reminder; one notification per approver; both run once per week.

- [x] Commit `feat(timesheets): add timesheet reminder jobs`

### Task 11: Navigation, clients and categories pages

**Files:** Modify `nav.ts`; Create `src/app/(app)/time/{clients,categories}/*`; Test `tests/integration/project-admin-actions.test.ts` (clients, categories), `tests/unit/shell/nav.test.ts`

- Nav:
  - My Space: "My timesheets" `/me/timesheets` (requires an employee record);
  - Time: "Projects" `/time/projects` (`project.manage`, `timesheet.view.all`), "Clients" `/time/clients` and
    "Task categories" `/time/categories` (`project.manage`);
  - Approvals `anyOf` adds `timesheet.approve`.
- Clients and categories: DataTable + create/edit sheet + archive/restore; actions audited `client.*`, `category.*`.

- [x] Commit `feat(projects): add clients and task categories pages`

### Task 12: Projects pages

**Files:** Create `src/app/(app)/time/projects/*`, `time/projects/[id]/*`; Test `tests/integration/project-admin-actions.test.ts` (projects, members)

- `/time/projects`: table (code, name, client or "Internal", status, members, logged hours, budget) with a status
  filter and a create/edit sheet (`project.manage`).
- `/time/projects/[id]`: header with status; budget burn (approved + submitted hours vs budget, drafts shown apart, a
  bar); hours by employee and by category; members table with add (multi-select of current employees + role) and
  remove (deactivate). Read-only for `timesheet.view.all` without `project.manage`.
- Actions audited `project.create|update`, `project.members`.

- [x] Commit `feat(projects): add projects and project detail pages`

### Task 13: My timesheets and the week grid

**Files:** Create `src/app/(app)/me/timesheets/{page,actions}.tsx`, `me/timesheets/[week]/{page,week-client}.tsx`, `src/components/timesheets/*`; Test `tests/integration/my-timesheet-actions.test.ts`

- `/me/timesheets`: this week first ("Open" button), then the last 12 weeks with status, logged/available hours.
- `/me/timesheets/[week]` (a non-Monday redirects to its Monday; more than 52 weeks away → 404):
  - week navigation; status badge and decision note;
  - the grid: rows of project × category with billable toggle, a note, and 7 hour inputs (step 0.25); "Add row"
    (project + category selects); totals per row, per day and for the week;
  - column headers mark holidays, weekly offs and leave; an attendance row shows worked hours with variance flags;
  - a timer bar: project/category/notes + Start, or the running timer (ticking) with Stop and Discard;
  - Save (shows warnings), Submit (saves first), Withdraw when submitted. Read-only unless editable.
- Actions: `saveWeekAction`, `submitWeekAction`, `withdrawWeekAction`, `startTimerAction`, `stopTimerAction`,
  `discardTimerAction` (audited `timesheet.save|submit|withdraw|timer`).

- [x] Commit `feat(timesheets): add my timesheets and the weekly grid`

### Task 14: Approvals — Timesheets tab

**Files:** Modify `approvals/{page,actions}.tsx`; Create `approvals/timesheet-list.tsx`; Test `tests/integration/approvals-timesheet-actions.test.ts`

- Rows: employee, week, logged/available, billable, flagged days, leave days; View (a sheet with the read-only week),
  Approve / Reject (note required), bulk approve.
- Actions `decideTimesheetAction`, `bulkApproveTimesheetsAction`, `timesheetDetailAction` (read-only, not audited);
  decisions audited `timesheet.approve|reject`.

- [x] Commit `feat(approvals): add the timesheets approval tab`

### Task 15: Profile tab and dashboard card

**Files:** Modify the employee profile page, `src/app/(app)/page.tsx`; Create `src/components/timesheets/employee-timesheets-tab.tsx`, `week-card.tsx`

- Profile Timesheets tab (self, managers above, `timesheet.view.all`): the last 8 weeks.
- Dashboard: "This week" card for employees: status, logged vs available, a link to the week.

- [x] Commit `feat(timesheets): add the profile timesheets tab and dashboard card`

### Task 16: E2E, verification, documentation

**Files:** `tests/e2e/timesheets.spec.ts`; the roadmap; `CLAUDE.md`

**E2E** (serial, `test.use(clientIp(5))`, one context per person):
1. Admin creates a client and a project with a manager and an employee as members (new names).
2. The employee opens last week (always fully in the past), logs 8 h on its Monday on the project, saves and submits.
3. The manager approves it in Approvals → Timesheets.
4. The employee sees the week approved and read-only.

Run `npm run test:e2e` and `npm run verify`.

**Docs:**
- Roadmap: Phase 4 row done; refinements 48+; integration map (`workCalendar`/`availableMinutes`, approved
  `timesheet_entries` for reports, `utilization`).
- `CLAUDE.md`: a "Timesheets" bullet (quarter hours, row = project × category, editable statuses, allowed projects).

**Refinements to record:**
- Two reminder jobs instead of one `timesheet:remind`.
- A week is saved whole; a row's billable flag and note are stored on its entries.
- Internal projects (no client) are open to everyone.
- Rejecting needs a note; approval is final in this phase (no reopen).
- No entries after today; the timer rounds to the nearest quarter and stays on its start date.
- Budget burn counts submitted and approved hours.
