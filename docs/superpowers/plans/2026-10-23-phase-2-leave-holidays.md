# Phase 2 — Leave, Holidays and Legacy Migration Implementation Plan

> **For agentic workers:** Execute task by task with TDD (failing test → implementation → passing test → commit).
> Steps use checkbox (`- [ ]`) syntax for tracking. Unlike the Phase 0/1 plans, this plan fixes **contracts**
> (files, signatures, rules, test cases) rather than pasting every line of code: the executor writes the code in
> the style of the existing modules. Where a rule here and the spec differ, this plan records the refinement in
> Task 20 and the roadmap.

**Goal:** Configurable leave types with ledger-based balances, leave requests with approvals, holidays with optional
picks, leave jobs, the team calendar, and the legacy Holiday Tracker migration with balance verification.

**Architecture:**
- New Drizzle tables in `src/server/db/schema/leave.ts` (leave types, ledger, requests, holidays, year config, picks).
- Pure, isomorphic leave math in `src/lib/leave.ts` (leave year, day counting, accrual, overlap). The apply sheet uses
  the same `countLeaveDays` for its live count as the server does for the stored count.
- Synchronous services in `src/server/modules/leave/*` and `src/server/modules/holidays/*`.
- `src/server/modules/attendance/{hooks,calendar}.ts` are Phase 3 seams: no-op recompute hooks and the weekly-off lookup.
- Legacy migration core in `src/server/modules/legacy/*` (testable), CLI in `scripts/migrate-legacy.ts`.

**Tech stack:** Phase 0/1 stack plus `papaparse` (holiday CSV import). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-hrms-overhaul-design.md`:
- §4.5 (leave tables, without the comp-off tables);
- §5.4 (leave & holidays behaviour);
- §5.7 (approvals inbox, Leave tab);
- §7 (`leave:accrue`, `leave:year-end`);
- §8 (legacy migration).

Roadmap Phase 2 (`docs/superpowers/plans/2026-09-24-hrms-roadmap.md`) lists the outline.

**Prerequisite:** Phase 1 is complete. Reuse these names exactly:
- actions: `defineAction`, `executeAction`, `DomainError`, `useServerAction`, `applyFieldErrors`;
- session: `requireUser`, `requirePermission`, `requireAnyPermission`;
- employees: `requireEmployee`, `getReportingTree`, `isManagerAbove`, `isInScope`, `getEmployeeByUserId`, `employeeOptions`;
- users and notifications: `activeUserIdsWithPermission`, `notify`, `notifyMany`;
- system: `writeAudit`/`audit`, `diffObjects`, `getSetting`/`patchSetting`, `saveUpload`, `canAccessFile` resolvers, `JOBS`, `runJobByName`;
- UI: `DataTable`, `Sheet*`, `Dialog*`, `ConfirmDialog`, `Tabs*`, `Field`, `NativeSelect`, `Badge`, `EmptyState`, `PageHeader`.

## Global Constraints

- Services are synchronous, take `db: DbLike` first, and use Drizzle's sync API. Never `await` inside a transaction.
- Every mutation goes through `defineAction` and calls `audit(...)`.
- Calendar dates are `YYYY-MM-DD`, using `src/lib/dates.ts`. "Today" is
  `todayInTimeZone(getSetting(db, "locale").timezone)`, passed **into** services as a parameter so tests control it.
- Leave amounts are days in steps of **0.5**. Every ledger delta the app computes (grants, accruals, request days,
  adjustments) is a multiple of 0.5, which binary floating point represents exactly. Only migrated legacy rows may carry
  other fractions, because migration preserves recorded days.
- Leave balance = `SUM(delta)` of `leave_ledger` per (employee, leave type, leave year). Nothing caches a balance.
- A leave request never spans two leave years (`CROSSES_LEAVE_YEAR`); its ledger rows use the leave year of its start date.
- Holiday `year` is the **calendar** year of its date. The optional-holiday quota is per calendar year. Leave years follow
  `leave.yearStartMonth` (default January).
- Approvals: a user decides a leave request when they hold `leave.approve` AND (they hold `leave.view.all` OR
  `isManagerAbove(db, user, employeeId)`) AND it is not their own request (`SELF_APPROVAL`). `isInScope` alone is not
  enough, because org-wide viewers are in scope for their own record.
- Schema files use relative imports only. Generate migrations with `npm run db:generate -- --name <change>`.
- Next 16: `params`/`searchParams` are Promises. lucide-react 1.x canonical icon names only.

## Review Focus

These are the five failure modes most likely to hurt a real user. Each one has a pinned test in the task that owns the code.

1. **Day counting.** Half days, weekly offs, holidays, selected optional holidays, `count_weekends`, a range that is
   entirely off days (0 days → refused), and IST dates (never `toISOString()` on local midnight).
   Tests: Task 2 (`countLeaveDays` matrix), Task 7 (stored `days` equals the quote).
2. **Balance integrity.** Approving twice, approving after the balance dropped, cancelling twice, or a pending request
   that silently overdraws must be impossible. A cancel must restore exactly what the approval took.
   Tests: Task 7 (`INSUFFICIENT_BALANCE` counts pending days; double approve is `NOT_PENDING`; approve → cancel nets to zero).
3. **Overlaps and half-day pairs.** A morning and an afternoon half day on the same date are allowed. Anything else that
   touches an already pending or approved day is refused.
   Tests: Task 2 (`portionsOverlap`), Task 7 (`OVERLAP`).
4. **Idempotent jobs and year boundaries.** `leave:accrue` and `leave:year-end` may run twice, or late. Pro-rating for
   joiners, carry-forward caps and lapses must still post exactly once.
   Tests: Task 5 (`syncEntitlements` twice = once), Task 6 (job run keys, a late year-end run).
5. **Legacy migration fidelity.** Every migrated employee/year balance must equal the old app's `getUserBalance` for
   CL, SL, unpaid used and optional used. The script exits non-zero on any mismatch, and never writes to the old file.
   Tests: Task 10 (fixture legacy DB, a tampered ledger is detected, the source file is unchanged).

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/leave.ts` | Leave enums/labels, leave-year math, half-day rounding, accrual and pro-rating, `countLeaveDays`, overlap portions (isomorphic) |
| `src/lib/validation/leave.ts` | zod: leave type, apply leave, decision, cancel, adjustment, holiday, holiday year config, leave settings form |
| `src/lib/validation/settings.ts` | + `attendance.weeklyOffs` (default `[0, 6]`) |
| `src/server/db/schema/leave.ts` | `leave_types`, `leave_ledger`, `leave_requests`, `holidays`, `holiday_year_config`, `holiday_selections` |
| `src/server/modules/attendance/hooks.ts` | `onLeaveChanged`, `onHolidayChanged`: no-ops until Phase 3 |
| `src/server/modules/attendance/calendar.ts` | `weeklyOffsForEmployee(db, employeeId)`: company setting now, the shift in Phase 3 |
| `src/server/modules/leave/types.ts` | Leave type CRUD, archive, system CO guard, `seedDefaultLeaveTypes` |
| `src/server/modules/holidays/service.ts` | Holiday CRUD, year config, CSV import, copy year, optional picks, `holidaysForEmployee` |
| `src/server/modules/leave/ledger.ts` | `postLedger`, `balanceOf`, `balancesFor`, `syncEntitlements`, `closeLeaveYear`, `adjustBalance` |
| `src/server/modules/leave/requests.ts` | Quote, apply, apply on behalf, approve, reject, withdraw, cancel, bulk approve, routing + notifications |
| `src/server/modules/leave/queries.ts` | My requests, approval queue, request register, balance sheet, ledger, team calendar, profile tab |
| `src/server/jobs/leave-accrue.ts`, `leave-year-end.ts` | Jobs, registered in `src/server/jobs/registry.ts` |
| `src/server/modules/legacy/{source,migrate,verify}.ts` | Read the old DB, write the new DB, verify balances |
| `scripts/migrate-legacy.ts` | CLI: `--from <old.db> --to <new.db>` |
| `tests/fixtures/legacy-holiday-tracker.sql` | Old schema (`git show 489c251:src/db/migrations/0000_init.sql`) |
| `src/components/leave/*` | Balance cards, status badge, day-count preview, request table, decision dialog |
| `src/app/(app)/me/leave/*` | Balances, apply sheet, history, holidays + optional picks |
| `src/app/(app)/approvals/*` | + Leave tab, bulk approve |
| `src/app/(app)/leave/{requests,balances,types,holidays}/*` | HR leave pages |
| `src/app/(app)/team/calendar/*` | Team leave calendar |
| `src/app/(app)/settings/leave/*` | Leave year start month, weekly offs |
| `tests/e2e/leave.spec.ts` | Apply → manager approves → balance drops → cancel restores |

---

### Task 1: Leave constants, validation schemas and settings

**Files:**
- Create: `src/lib/leave.ts` (constants part), `src/lib/validation/leave.ts`
- Modify: `src/lib/validation/settings.ts`
- Test: `tests/unit/lib/leave-validation.test.ts`

**Interfaces (`src/lib/leave.ts`):**
- `LEAVE_ACCRUALS = ["upfront", "monthly", "none"]`.
- `LEDGER_KINDS = ["grant", "accrual", "carry_forward", "lapse", "taken", "cancelled", "adjustment", "comp_off_credit", "comp_off_lapse", "encashment", "opening"]`.
- `LEAVE_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled", "withdrawn"]`.
- `LEAVE_HALVES = ["full", "first_half", "second_half"]`.
- `HOLIDAY_TYPES = ["fixed", "optional"]`.
- A label record for each, plus `LEAVE_STATUS_BADGE` (status → badge variant).
- `formatDays(n)`: `1` → "1 day", `0.5` → "½ day", `2.5` → "2½ days", `-1` → "-1 day".

**Schemas (`src/lib/validation/leave.ts`):**
- `leaveTypeSchema`:
  - `code` `^[A-Z][A-Z0-9_]{0,9}$`; `name` 1–60; `color` `#rrggbb`; `paid`, `isLop`;
  - `accrual` enum; `annualQuota` 0–365 in 0.5 steps; `carryForwardMax` 0–365 in 0.5 steps;
  - `encashable`, `allowHalfDay`, `allowNegative`; `maxConsecutiveDays` 1–365 or null;
  - `minNoticeDays` 0–365; `attachmentAfterDays` 0–365 (0.5 steps) or null; `countWeekends`;
  - `applicableEmploymentTypes` (non-empty subset of `EMPLOYMENT_TYPES`) or null = all.
  - Refine: `isLop` ⇒ `paid = false`.
- `applyLeaveSchema`:
  - `leaveTypeId`, `startDate`, `endDate`, `startHalf`, `endHalf`, `reason` (optional, ≤ 500).
  - Refine `endDate ≥ startDate` (field error on `endDate`).
  - Refine `halvesError(...) === null` (field error on `startHalf`).
- `applyOnBehalfSchema` = `applyLeaveSchema` + `employeeId`.
- `leaveDecisionSchema`: `requestId`, `decision` (`approved | rejected`), `note` optional ≤ 300.
- `cancelLeaveSchema`: `requestId`, `note` optional ≤ 300.
- `bulkApproveSchema`: `requestIds` 1–100 ids.
- `adjustmentSchema`: `employeeId`, `leaveTypeId`, `year` 2000–2100, `delta` (non-zero, multiple of 0.5, |delta| ≤ 365),
  `note` required 3–300.
- `holidaySchema`: `date` (ISO), `name` 1–80, `type`.
- `holidayYearConfigSchema`: `year`, `optionalAllowed` 0–50.
- `leaveSettingsFormSchema`: `yearStartMonth` 1–12, `weeklyOffs` (array of distinct 0–6, at most 6 entries).
- `isHalfStep(n)`: `Number.isInteger(n * 2)`.

**Settings:** `attendanceSettingsSchema` gains `weeklyOffs: z.array(z.number().int().min(0).max(6)).max(6)`, default `[0, 6]`.

**Tests:**
- `leaveTypeSchema` rejects a lowercase code, a 0.3 quota, and `isLop` with `paid`.
- `applyLeaveSchema` reports `endDate` when end < start, and `startHalf` for a multi-day `first_half` start.
- `adjustmentSchema` rejects a 0 delta, a 0.25 delta and an empty note.
- `getSetting(db, "attendance").weeklyOffs` defaults to `[0, 6]` for an existing stored row without the key.
  This one goes in `tests/integration/settings.test.ts`.

- [x] Write the failing tests → implement → pass → `npm run typecheck` → commit `feat(leave): add leave constants, validation schemas and weekly-off setting`

---

### Task 2: Pure leave math

**Files:**
- Modify: `src/lib/leave.ts`
- Test: `tests/unit/lib/leave.test.ts`

**Interfaces:**
- `leaveYearOf(date, startMonth): number`: the calendar year in which the containing leave year starts.
- `leaveYearRange(year, startMonth): { start, end }`. With `startMonth = 4`, year 2026 is 2026-04-01 … 2027-03-31.
- `leaveYearMonthIndex(date, startMonth): 1..12`.
- `roundHalf(n)` (nearest 0.5, ties up) and `floorHalf(n)`.
- `proRatedQuota(quota, joinMonthIndex)`: `roundHalf(quota × (13 − j) / 12)`. Joined before the leave year → j = 1 (full quota).
- `accrualCredit(quota, monthIndex)`: `floorHalf(q·k/12) − floorHalf(q·(k−1)/12)`. Over 12 months the credits always sum to `floorHalf(q)`.
- `halvesError(start, end, startHalf, endHalf): string | null`:
  - single day: `endHalf` must equal `startHalf`;
  - multi-day: `startHalf ∈ {full, second_half}` and `endHalf ∈ {full, first_half}`.
- `countLeaveDays({ start, end, startHalf, endHalf, weeklyOffs, holidays, countWeekends })`
  → `{ days, breakdown: { date, portion, counted, offReason: "weekly_off" | "holiday" | null }[] }`.
  - A date that is a weekly off or a holiday counts 0 unless `countWeekends`.
  - Otherwise `full` counts 1 and a half counts 0.5.
  - Throws `RangeError` on invalid halves or end < start.
- `requestPortions(start, end, startHalf, endHalf): Map<date, portion>`.
- `portionsOverlap(a, b)`: true if any shared date has `full` on either side, or the same half on both.

**Tests (table-driven):**
- Leave year: Jan start, Apr start, and dates on both sides of each boundary.
- Month index: April-start year, 2027-03-15 → 12.
- `accrualCredit(10, k)` for k = 1…12 gives `[0.5, 1, 1, 0.5, 1, 1, 0.5, 1, 1, 0.5, 1, 1]`, summing to 10.
  `accrualCredit(12, k)` = 1 for every k. `accrualCredit(18, k)` = 1.5 for every k.
- `proRatedQuota(12, 10)` = 3; `proRatedQuota(7, 7)` = 3.5; `proRatedQuota(12, 1)` = 12.
- `countLeaveDays`:
  - Mon–Fri = 5.
  - Fri–Mon = 2; with `countWeekends` = 4.
  - A holiday on Wednesday in Mon–Fri = 4.
  - Single day `first_half` = 0.5.
  - Multi-day `second_half` start + `first_half` end over Mon–Wed = 2.
  - A half-day start that falls on a Saturday counts 0, not −0.5.
  - Sat–Sun = 0.
  - An IST regression: `2026-01-01` counts as Thursday, whatever `process.env.TZ` is (run once with `TZ=Asia/Kolkata`
    via `vi.stubEnv`).
- `portionsOverlap`:
  - first_half vs second_half on one date → false;
  - full vs first_half → true;
  - disjoint ranges → false;
  - a multi-day range ending `first_half` vs a request starting `second_half` on that date → false.

- [x] Failing tests → implement → pass → commit `feat(leave): add leave year, accrual and day-counting math`

---

### Task 3: Leave schema and migration

**Files:**
- Create: `src/server/db/schema/leave.ts`; Modify: `src/server/db/schema/index.ts`
- Generate: `src/server/db/migrations/0002_leave.sql` (+ snapshot/journal) via `npm run db:generate -- --name leave`
- Test: `tests/integration/db/leave-schema.test.ts`

**Tables:**
- `leave_types`:
  - id, `code` unique, name, color, `paid`, `is_lop`, `accrual`, `annual_quota` real, `carry_forward_max` real,
    `encashable`, `allow_half_day`, `allow_negative`, `max_consecutive_days` int?, `min_notice_days` int,
    `attachment_after_days` real?, `count_weekends`, `applicable_employment_types` JSON?, `is_comp_off`,
    `sort_order`, `archived`, timestamps.
- `leave_ledger`:
  - id, `employee_id` → employees (cascade), `leave_type_id` → leave_types, `year` int, `date` text, `delta` real,
    `kind` enum, `ref_type` text?, `ref_id` int?, `note`, `created_by` → users (set null), `created_at`.
  - Indexes `(employee_id, leave_type_id, year)` and `(ref_type, ref_id)`.
- `leave_requests`:
  - id, `employee_id` (cascade), `leave_type_id`, `start_date`, `end_date`, `start_half`, `end_half`, `days` real,
    `reason`, `attachment_file_id` → files (set null), `status` (default pending).
  - `approver_id` → users, `decided_at`, `decision_note`, `applied_by` → users, `cancelled_by` → users,
    `cancelled_at`, `cancel_note`, timestamps.
  - Indexes `(employee_id, status)`, `(status, start_date)`.
- `holidays`: id, `year`, `date`, `name`, `type`, timestamps. Unique `(year, date)`.
- `holiday_year_config`: `year` PK, `optional_allowed` int, `updated_at`.
- `holiday_selections`: `employee_id` (cascade), `holiday_id` → holidays (cascade), `created_at`. PK (employee_id, holiday_id).

**Tests:** the migration applies on a fresh DB. Each FK cascade behaves as declared (delete an employee → their ledger,
requests and selections go; delete a holiday → its selections go). `(year, date)` is unique.

- [x] Failing test → schema → `npm run db:generate -- --name leave` → pass → commit `feat(db): add leave and holiday schema and migration`

---

### Task 4: Leave types and the attendance seams

**Files:**
- Create: `src/server/modules/leave/types.ts`, `src/server/modules/attendance/hooks.ts`, `src/server/modules/attendance/calendar.ts`
- Modify: `scripts/seed.ts` (call `seedDefaultLeaveTypes`)
- Test: `tests/integration/leave-types.test.ts`

**Interfaces:**
- `createLeaveType(db, input)`, `updateLeaveType(db, id, input) → { before, after }`, `setLeaveTypeArchived(db, id, archived)`.
- `listLeaveTypes(db, { includeArchived })`, `getLeaveType(db, id)`, `requireLeaveType(db, id)`.
- `compOffType(db)`: the single `is_comp_off` row, or undefined.
- `isApplicable(type, employmentType)`.
- `seedDefaultLeaveTypes(db): number`. Idempotent by code; returns the number inserted.
  - CL: Casual, upfront 12, carry 6, max consecutive 3, notice 1, half days.
  - SL: Sick, upfront 6, carry 0, notice 0, attachment after 2 days, half days.
  - LWP: Leave without pay, `is_lop`, unpaid, accrual none, quota 0, allow negative, half days.
  - CO: Comp-off, `is_comp_off`, accrual none, quota 0, half days.
- Attendance seams:
  - `onLeaveChanged(tx, employeeId, from, to): void` and `onHolidayChanged(tx, date): void`: no-ops.
  - `weeklyOffsForEmployee(db, employeeId): number[]` returns `getSetting(db, "attendance").weeklyOffs`.

**Rules:**
- `CODE_TAKEN` for a duplicate code.
- The CO type is system-managed:
  - its `code`, `is_comp_off`, `accrual` (none) and `annual_quota` (0) cannot change (`SYSTEM_TYPE`);
  - it cannot be archived (`SYSTEM_TYPE`);
  - no second `is_comp_off` type may exist (the input schema has no `isCompOff`; only the seed sets it).
- Changing `code` is refused once ledger rows exist for the type (`TYPE_IN_USE`), because the old code is historical.

**Tests:**
- The seed inserts 4 types once; a second run inserts 0.
- CO edit and archive are refused.
- A duplicate code is refused.
- `isApplicable` with null and with a list.
- `weeklyOffsForEmployee` follows the setting.

- [x] Commit `feat(leave): add leave types, defaults and attendance seams`

---

### Task 5: Leave ledger and entitlements

**Files:**
- Create: `src/server/modules/leave/ledger.ts`
- Modify: `src/server/modules/employees/service.ts` (`createEmployee` calls `syncEntitlements`)
- Test: `tests/integration/leave-ledger.test.ts`

**Interfaces:**
- `postLedger(db, { employeeId, leaveTypeId, year, date, delta, kind, refType?, refId?, note?, createdBy? }): LeaveLedgerRow`.
- `balanceOf(db, employeeId, leaveTypeId, year): number`.
- `pendingDays(db, employeeId, leaveTypeId, year, excludeRequestId?)`: the sum of `days` of pending requests whose start
  falls in that leave year.
- `balancesFor(db, employeeId, year)` → per non-archived type:
  - `{ type, opening, credited, used, adjusted, closed, balance, pending, available }`;
  - `opening` = carry_forward in (positive) + opening;
  - `credited` = grant + accrual + comp_off_credit;
  - `used` = −(taken + cancelled);
  - `closed` = −(carry_forward out + lapse + comp_off_lapse + encashment);
  - `available` = balance − pending.
- `syncEntitlements(db, employeeId, asOf: ISODate): { granted: number; accrued: number }`, for the leave year containing `asOf`:
  - skipped for exited employees, archived types, types not applicable to the employment type, and joiners after the year ends;
  - `upfront` with quota > 0: one `grant` of `proRatedQuota(quota, j)`, dated the later of year start and DOJ.
    Skipped when a `grant` exists for (employee, type, year);
  - `monthly`: for every month index k from max(1, j) to the month index of `asOf`, missing an `accrual` row dated that
    month's 1st, post `accrualCredit(quota, k)` (when non-zero).
- `closeLeaveYear(db, employeeId, year): { carried: number; lapsed: number }`:
  - skips `is_comp_off` types (Phase 3 expires lots), and types with no ledger rows that year;
  - balance > 0: carry c = min(balance, carryForwardMax) as a pair of `carry_forward` rows, −c in `year` (dated the
    year's end) and +c in `year + 1` (dated its start), so the closed year nets to zero and can't be spent twice;
    post `lapse` −rest into `year`, dated the year's end;
  - balance ≤ 0: nothing;
  - idempotent: skipped when a `ref_type = 'year_end'`, `ref_id = year` row exists for (employee, type);
  - encashment of encashable types belongs to Phase 5; Phase 2 lapses the excess.
- `adjustBalance(db, actorUserId, { employeeId, leaveTypeId, year, delta, note })`: posts an `adjustment`.
- `createEmployee` (Phase 1 service) calls `syncEntitlements(db, row.id, max(today, row.dateOfJoining))` after inserting.
  `today` = `todayInTimeZone(getSetting(db, "locale").timezone)`. The import goes through `createEmployee`, so imported
  employees get entitlements too.

**Tests:**
- A full-year employee gets CL 12 and SL 6 once, even when `syncEntitlements` is called twice.
- An October joiner gets CL 3 and SL 1.5.
- A monthly type with quota 10 accrues 0.5, 1.0, 1.0 by 1 March.
- A March joiner accrues nothing for January or February.
- `closeLeaveYear` carries 6 of 8 and lapses 2. It also caps at 0 carry for SL, and a second run posts nothing.
- `balancesFor` splits the columns correctly after a taken + cancelled pair.
- The employee create service grants CL for the current year.

- [x] Commit `feat(leave): add ledger, balances, entitlement sync and year close`

---

### Task 6: Leave jobs

**Files:**
- Create: `src/server/jobs/leave-accrue.ts`, `src/server/jobs/leave-year-end.ts`; Modify: `src/server/jobs/registry.ts`
- Test: `tests/integration/leave-jobs.test.ts`

**Jobs:**
- `leave:accrue`:
  - run key = local `YYYY-MM`;
  - run: `syncEntitlements(db, id, today)` for every `active`/`on_notice` employee;
  - summary "Granted X, accrued Y for N employee(s)".
- `leave:year-end`:
  - run key = the leave year being closed (`leaveYearOf(today) − 1`, as a string);
  - run: `closeLeaveYear(db, id, closingYear)` for every employee with ledger rows in that year (exited included,
    since their balance must still close);
  - then `syncEntitlements(db, id, today)` for current employees, so new-year grants exist even if `leave:accrue` has not run.

**Tests:**
- Running `leave:accrue` at `2026-02-28T19:15:00Z` (1 March 00:45 IST) uses run key `2026-03`; a second call is skipped.
- `leave:year-end` at `2026-12-31T19:20:00Z` closes 2026 (key "2026"). Running it late on 15 January closes 2026 too.
- With `yearStartMonth = 4`, a run on 1 April 2027 closes leave year 2026.

- [x] Commit `feat(leave): add accrual and year-end jobs`

---

### Task 7: Leave requests — apply, decide, cancel

**Files:**
- Create: `src/server/modules/leave/requests.ts`
- Test: `tests/integration/leave-requests.test.ts`

**Interfaces:**
- `quoteLeave(db, { employeeId, leaveTypeId, startDate, endDate, startHalf, endHalf })`
  → `{ days, breakdown, year, balance, pending, available }`. Uses `holidaysForEmployee` (Task 8) and
  `weeklyOffsForEmployee`. Throws `DomainError` for invalid halves or crossing leave years.
- `applyLeave(db, actor, input, { today, attachmentFileId? }): LeaveRequestRow`: self-service, for `actor.employeeId`.
- `applyLeaveOnBehalf(db, actor, input & { employeeId }, { today, attachmentFileId? })`: HR (`leave.adjust`).
  Creates the request **approved** (approver = actor) and posts the debit.
- `canDecideLeave(db, user, employeeId): boolean` (rule in Global Constraints).
- `leaveApproverUserIds(db, employeeId): number[]`:
  - the reporting manager's active login;
  - otherwise active users holding both `leave.approve` and `leave.view.all`;
  - never the applicant's own login.
- `approveLeave(db, actor, requestId, note)`, `rejectLeave(db, actor, requestId, note)`.
- `withdrawLeave(db, actor, requestId)`: own pending only.
- `cancelLeave(db, actor, requestId, note, { today })`:
  - own approved leave starting after today;
  - or any approved leave for `leave.adjust` holders.
- `bulkApproveLeave(db, actor, ids, note)` → `{ approved: number[]; failed: { id, error }[] }`. Each id runs in its own
  savepoint (`db.transaction`), so one failure doesn't undo the others.

**Apply validations, in order, with error codes:**
1. Employee status `active`/`on_notice` (`EMPLOYEE_INACTIVE`).
2. Type exists, is not archived (`TYPE_UNAVAILABLE`), and is applicable to the employment type (`TYPE_NOT_APPLICABLE`).
3. Halves allowed by the type (`HALF_DAY_NOT_ALLOWED`).
4. Within employment: start ≥ DOJ (`BEFORE_JOINING`); end ≤ LWD when set (`AFTER_LAST_DAY`).
5. Single leave year (`CROSSES_LEAVE_YEAR`).
6. `days > 0` (`NO_WORKING_DAYS`).
7. No overlap with the employee's pending/approved requests (`OVERLAP`).
8. Self-service only:
   - `days ≤ maxConsecutiveDays` (`TOO_MANY_DAYS`);
   - notice: a start in the future needs `diffDays(today, start) ≥ minNoticeDays` (`NOTICE_REQUIRED`);
   - a past start is allowed only when `minNoticeDays = 0` (`BACKDATED_NOT_ALLOWED`).
9. Attachment required when `attachmentAfterDays !== null && days > attachmentAfterDays` (`ATTACHMENT_REQUIRED`).
10. Balance unless `allowNegative`: `days ≤ balance − pendingDays` (`INSUFFICIENT_BALANCE`, message shows available days).

**Side effects:**
- On apply: notify the approvers (`leave.submitted`, link `/approvals?tab=leave`).
- On approve:
  - status approved, approver, decidedAt, note;
  - `postLedger(taken, −days, ref leave_request)`;
  - `onLeaveChanged(tx, employeeId, start, end)`;
  - notify the employee (`leave.approved`, link `/me/leave`).
- On reject: notify the employee (`leave.rejected`).
- On cancel:
  - status cancelled, cancelledBy/At/note;
  - `postLedger(cancelled, +days, ref leave_request)`;
  - `onLeaveChanged`;
  - notify the employee when HR cancelled, or the approver when the employee did.
- On behalf:
  - the same validations except step 8;
  - status approved, plus the approve side effects;
  - notification `leave.recorded`.

**Decision guards:**
- Not pending → `NOT_PENDING`.
- Own request → `SELF_APPROVAL`.
- Not allowed → `FORBIDDEN`.
- At approval, re-check the balance (`INSUFFICIENT_BALANCE`, excluding this request's own pending days).

**Tests:**
- One `it` per apply error code above.
- The happy path: the request stores `days` equal to `quoteLeave` and notifies the manager's login.
- A manager without a login → HR approvers are notified.
- The manager approves:
  - the ledger has one −days `taken` row and the balance drops;
  - the hook spy is called once with the range;
  - a second approve → `NOT_PENDING`.
- A peer manager (not above) → `FORBIDDEN`. HR approves their own request → `SELF_APPROVAL`.
- Pending days block over-booking: balance 2, a pending request of 2, a new request of 1 → `INSUFFICIENT_BALANCE`.
- Cancel:
  - restores the balance exactly;
  - the employee cannot cancel leave that started today or earlier (`CANCEL_NOT_ALLOWED`); HR can;
  - double cancel → `NOT_APPROVED`.
- Morning + afternoon half days on the same date both succeed; a full day on that date → `OVERLAP`.
- On-behalf skips notice and max-consecutive but not the balance check; it is approved immediately.
- Bulk approve with one insufficient request: the others are approved and the failure is reported.

- [x] Commit `feat(leave): add leave requests with approvals, cancellation and routing`

---

### Task 8: Holidays and optional picks

**Files:**
- Create: `src/server/modules/holidays/service.ts`
- Test: `tests/integration/holidays.test.ts`

> Implement Task 8 **before** Task 7. `quoteLeave` needs `holidaysForEmployee`. The numbering keeps the roadmap order.

**Interfaces:**
- `createHoliday(db, input)`, `updateHoliday(db, id, input) → { before, after }`, `deleteHoliday(db, id)`.
  Each calls `onHolidayChanged(tx, date)` for the old and new dates.
- `listHolidays(db, year)`.
- `getYearConfig(db, year) → { year, optionalAllowed }` (0 when unset); `setYearConfig(db, year, optionalAllowed)`.
- `importHolidaysCsv(db, csv) → { created, errors: { row, message }[] }`:
  - columns `date,name,type` (type optional, default fixed);
  - BOM, CRLF and header case tolerant;
  - all-or-nothing (`IMPORT_INVALID` when any row fails);
  - duplicate dates within the file or against the DB are errors.
- `copyHolidaysFromYear(db, fromYear, toYear) → { created, skipped }`:
  - same month-day, skipping 29 Feb into a non-leap year and dates that already exist;
  - also copies the year config when the target has none.
- `selectOptionalHoliday(db, employeeId, holidayId, selected, today)`:
  - optional type only (`NOT_OPTIONAL`);
  - date ≥ today, for both pick and unpick (`HOLIDAY_PASSED`);
  - picks for that calendar year < `optionalAllowed` (`OPTIONAL_LIMIT`);
  - idempotent.
- `holidaysForEmployee(db, employeeId, from, to) → { date, name, type }[]`: fixed holidays plus the selected optional ones.
- `holidayDatesForEmployee(db, employeeId, from, to): Set<ISODate>`.
- `optionalPicksFor(db, employeeId, year, today) → { holidayId, date, name, selected, locked }[]` and `optionalUsed(db, employeeId, year)`.

**Rules:**
- `year` is derived from `date` (calendar year).
- `DATE_TAKEN` for a duplicate date.
- Changing a holiday from optional to fixed deletes its selections (they become everyone's holiday).
- Existing leave requests keep their stored `days`. Holiday edits never re-price old requests.

**Tests:**
- CRUD, plus `DATE_TAKEN`.
- `holidaysForEmployee` includes a picked optional holiday and excludes an unpicked one.
- Pick limit, the past-date lock, and unpicking.
- CSV:
  - happy path with BOM/CRLF and mixed-case headers;
  - a bad date and a duplicate → nothing inserted.
- Copy skips 29 Feb and existing dates.
- `onHolidayChanged` is called (spy).

- [x] Commit `feat(holidays): add holiday calendar, CSV import, year copy and optional picks`

---

### Task 9: Leave read models and leave attachments

**Files:**
- Create: `src/server/modules/leave/queries.ts`
- Modify: `src/server/modules/files/access.ts` (leave attachment resolver)
- Test: `tests/integration/leave-queries.test.ts`

**Interfaces:**
- `myLeaveRequests(db, employeeId, year)`: rows with type code/name/color, approver name and `canCancel` (given today).
- `pendingLeaveForApprover(db, user)`: pending requests the user can decide (`canDecideLeave`), oldest first.
  Each has employee name/code, type, dates, days, reason, attachment id, and the balance after approval.
- `listLeaveRequests(db, user, { status?, leaveTypeId?, from?, to?, employeeId? })`:
  - all for `leave.view.all`;
  - the reporting tree for other `leave.approve` holders;
  - otherwise `[]`.
- `balanceSheet(db, year)`: active/on-notice employees × non-archived types (balance and used), for `/leave/balances`.
- `employeeLedger(db, employeeId, leaveTypeId, year)`: rows with creator names, oldest first.
- `teamCalendar(db, user, month, { departmentId? })`:
  - `{ days: { date, weekday, isWeeklyOff, holiday }[]; rows: { employee, cells: Record<date, { code, color, portion, status } | null> }[] }`;
  - scope:
    - `leave.view.all` → every current employee (department filter);
    - otherwise self + reporting tree + peers with the same reporting manager;
  - pending and approved requests only;
  - the type code/colour is masked to `"Leave"` unless the viewer is the employee, an org-wide viewer, or a manager above.
- `employeeLeaveSummary(db, employeeId, year)`: balances + the last 10 requests (the profile Leave tab).

**File access:** a resolver allows a leave request attachment to:
- the employee themself;
- `leave.view.all` holders;
- anyone who `canDecideLeave` for that employee.

**Tests:**
- Approval queue scoping: manager vs HR vs peer.
- The register filters work.
- Calendar masking for a peer vs the manager.
- A peer cannot download an attachment; the manager can.

- [x] Commit `feat(leave): add leave read models and attachment access`

---

### Task 10: Legacy migration

**Files:**
- Create:
  - `src/server/modules/legacy/source.ts` (typed readers for the old tables);
  - `src/server/modules/legacy/migrate.ts`, `src/server/modules/legacy/verify.ts`;
  - `scripts/migrate-legacy.ts`;
  - `tests/fixtures/legacy-holiday-tracker.sql`.
- Test: `tests/integration/legacy-migration.test.ts`

**Interfaces:**
- `readLegacy(sqlite)`:
  - returns `{ users, holidays, selections, leaves, policies, balances }`;
  - throws `NOT_LEGACY` unless `isLegacyDatabase(sqlite)`.
- `legacyPolicy(policies, year)`: the old `getPolicy` defaults (12 / 6 / 6 / 3 / 6) when the year has no row.
- `legacyBalance(source, userId, year)`: a re-implementation of the old `getUserBalance` over the loaded rows.
  - Leaves count by start-date year using string comparison, which removes the old timezone bug.
  - Cancelled leaves are excluded.
  - Returns `{ casualBalance, sickBalance, unpaidUsed, optionalUsed }`.
- `migrateLegacy(source, db, { today }) → MigrationReport`. Runs in one transaction on a freshly migrated and seeded target.
- `verifyMigration(source, db, map) → Mismatch[]`.
- CLI `npx tsx scripts/migrate-legacy.ts --from data/legacy/app.db --to data/people.db`:
  - refuses when `--to` exists, or when `--from` is missing or not legacy;
  - opens `--from` read-only (`{ readonly: true, fileMustExist: true }`);
  - migrates and seeds the target;
  - prints the report; exits 1 on mismatches (the target is kept for inspection, with a warning).

**Mapping (spec §8, as refined):**
1. Leave types:
   - seed defaults;
   - set CL quota/carry/max consecutive, and SL quota, from the **latest** policy year (defaults when none).
2. Year config:
   - each policy row's `optional_holidays_allowed`;
   - years with holidays but no policy row get the old default, 6.
3. Users:
   - email, name, password hash, `must_change_password`; `active` → status;
   - `role=admin` → `super_admin`.
4. Employee records:
   - `role=employee` → `employee` role + employee record:
     - code via `nextEmployeeCode`, in old id order;
     - name split on the first space;
     - DOJ = `joined_date`;
     - work email = email.
   - An admin who has leave history also gets an employee record, so no history is lost. Optional picks alone
     don't count (the system account may have clicked one).
   - Inactive old users become `exited` employees, exit reason "Migrated inactive account".
5. Holidays: copied as-is. Selections are mapped user → employee; selections of admins without a record are dropped and counted.
6. Ledger: per employee, per year in (policy years ∪ that employee's leave years ∪ their carry-forward years), excluding
   years before the joining year unless the employee has rows in them:
   - a `grant` of that year's CL and SL quotas (no pro-rating, matching the old app);
   - a `carry_forward` CL from `user_year_balance`.
   All rows carry `ref_type = 'legacy'`.
7. Leaves:
   - `planned`/`taken` → an `approved` request + a `taken` debit of the recorded `days`
     (casual → CL, sick → SL, unpaid → LWP);
   - `cancelled` → a `cancelled` request with no ledger;
   - a single day with 0.5 days → `first_half`;
   - created/decided timestamps converted from `YYYY-MM-DD HH:MM:SS` to ISO UTC.
8. Verify every (employee, year): CL balance, SL balance, unpaid used (−LWP taken/cancelled), optional used.

**Tests:**
- The fixture legacy DB is built in memory from the SQL file, with:
  - an admin, three employees (one inactive, one with `0.5` and `1.25`-day leaves);
  - policies for 2025 and 2026;
  - fixed and optional holidays; picks, including one by the admin;
  - all leave statuses and types; a carry-forward.
- After migration:
  - counts in the report;
  - codes `PV0001…` in id order;
  - the admin is a super admin with no employee;
  - the inactive user is disabled and exited;
  - the old password still signs in (`verifyCredentials`);
  - `verifyMigration` returns `[]`.
- Tampering one ledger row → exactly one mismatch.
- A non-legacy source → `NOT_LEGACY`.
- The script test: run `migrateLegacy` through the CLI entry against temp files. The source file's sha256 is unchanged,
  and a second run refuses the existing target.

- [x] Commit `feat(legacy): add holiday tracker migration with balance verification`

---

### Task 11: Navigation, Settings → Leave and the approvals shell

**Files:**
- Modify: `src/components/shell/nav.ts` (+ `tests/unit/shell/nav.test.ts`)
- Create: `src/app/(app)/settings/leave/{page,leave-settings-form,actions}.tsx`
- Test: `tests/integration/leave-settings-actions.test.ts`

**Nav:**
- Home: Approvals `anyOf` gains `leave.approve`.
- My Space: "My leave" `/me/leave` (`requiresEmployee`, icon `CalendarDays`).
- New group **Team**: "Team calendar" `/team/calendar` (everyone, icon `CalendarRange`).
- New group **Leave**:
  - Requests `/leave/requests` (`leave.view.all`, `leave.approve`);
  - Balances `/leave/balances` (`leave.view.all`);
  - Leave types `/leave/types` (`leave.config`);
  - Holidays `/leave/holidays` (`holiday.manage`).
- Settings: "Leave" `/settings/leave` (`leave.config`).

**Settings → Leave:**
- The page shows the leave year start month and the weekly-off days.
- Action `updateLeaveSettingsAction` (`leave.config`) patches `leave.yearStartMonth` and `attendance.weeklyOffs`, audited
  `settings.leave.update`.
- Changing the start month is refused once any ledger row exists (`LEAVE_YEAR_LOCKED`).

**Tests:**
- Nav visibility per role.
- The action saves, audits, and refuses the start month after a ledger row exists.

- [x] Commit `feat(leave): add leave navigation and leave settings`

---

### Task 12: Leave types page

**Files:** `src/app/(app)/leave/types/{page,types-client,actions}.tsx`; test `tests/integration/leave-type-actions.test.ts`

- `DataTable`: code (colour dot), name, accrual, quota, carry, half days, paid/LOP, status; row actions Edit, Archive/Restore.
- Sheet form with every `leaveTypeSchema` field. Employment types are checkboxes ("All" when none are ticked).
- The CO row shows a "System" badge and its locked fields are disabled.
- Actions `createLeaveTypeAction`, `updateLeaveTypeAction`, `archiveLeaveTypeAction`, all `leave.config`.
  Audited `leave_type.create|update|archive|restore` with a diff on update.
- Tests: permission, audit, and the CO guard surfacing as `SYSTEM_TYPE`.

- [x] Commit `feat(leave): add leave types page`

---

### Task 13: Holidays page

**Files:** `src/app/(app)/leave/holidays/{page,holidays-client,actions}.tsx`; test `tests/integration/holiday-actions.test.ts`

- Year switcher (`?year=`, default the current calendar year).
- Optional-allowed form (`setYearConfig`).
- Holiday table: date, weekday, name, type badge, how many employees picked it; edit and delete.
- "Add holiday" sheet; "Import CSV" dialog with a template download; "Copy from <year − 1>" confirm.
- Actions (`holiday.manage`): create, update, delete, setYearConfig, importCsv, copyYear. Each is audited
  (`holiday.create|update|delete|import|copy`, `holiday_year.update`).
- Tests: permission, audit, and an all-or-nothing import result.

- [x] Commit `feat(holidays): add holiday calendar page`

---

### Task 14: My leave

**Files:**
- `src/app/(app)/me/leave/{page,apply-sheet,requests-table,optional-holidays,actions}.tsx`
- `src/components/leave/{balance-cards,status-badge,day-count}.tsx`
- Test: `tests/integration/my-leave-actions.test.ts`

- Balance cards per type (balance, used, pending; "Used" only for `allowNegative` types with quota 0).
- "Apply leave" sheet:
  - type, start/end dates, halves (shown only when the type allows half days), reason, attachment (optional; required
    hint when over the threshold);
  - a **live day count** from `countLeaveDays`, fed by the page's holidays and weekly offs, with the breakdown.
- Requests table for the selected year: status badge; Withdraw (pending) and Cancel (approved, future) with a confirm.
- Holidays tab: the year's holidays; optional ones have a pick toggle (disabled when locked or at the limit).
  Shows "N of M picked".
- Actions:
  - `applyLeaveAction` takes `FormData`, like the document upload: zod in `prepare`, file read in `prepare`, then
    `saveUpload` (pdf/png/jpeg/webp) in the handler. Permission: `user.employeeId !== null`.
  - `withdrawLeaveAction`, `cancelLeaveAction`, `toggleOptionalHolidayAction` (own employee only).
  - All audited: `leave.apply|withdraw|cancel`, `holiday.pick|unpick`.
- Tests:
  - apply through the action saves the attachment, and the stored days equal the quote;
  - withdraw/cancel only for the owner;
  - the optional-pick limit surfaces.

- [x] Commit `feat(leave): add my leave page with apply, history and optional holidays`

---

### Task 15: Approvals — Leave tab

**Files:**
- Modify: `src/app/(app)/approvals/{page,actions}.tsx`
- Create: `src/app/(app)/approvals/leave-list.tsx`
- Test: extend `tests/integration/approvals-actions.test.ts`

- The page needs `employee.update` or `leave.approve` (`requireAnyPermission`).
- Tabs are shown per permission. The default tab is `?tab=` or the first visible one (Leave before Profile changes).
- Leave list:
  - rows with employee, type badge, dates + halves, days, balance after, reason, attachment link;
  - Approve / Reject with an optional note dialog;
  - row checkboxes + "Approve selected" (bulk).
- Actions:
  - `decideLeaveAction` (`leave.approve`; the service checks scope): audited `leave.approve|reject`;
  - `bulkApproveLeaveAction`: audits each approved id, and toasts "Approved N, M failed: …".
- Tests: a manager approves in scope; out of scope → `FORBIDDEN`; bulk partial failure.

- [x] Commit `feat(approvals): add the leave approvals tab with bulk approve`

---

### Task 16: Leave requests register and apply on behalf

**Files:** `src/app/(app)/leave/requests/{page,requests-client,on-behalf-sheet,actions}.tsx`; test `tests/integration/leave-request-actions.test.ts`

- Filters (status, type, date range, employee) via `searchParams`, and a `DataTable` of `listLeaveRequests`.
- For `leave.adjust`: a "Cancel" row action on approved leave (note required), and a "Record leave" sheet
  (employee picker + the apply fields + attachment) → `applyLeaveOnBehalfAction`.
- Audited `leave.cancel`, `leave.record`.
- Tests: on-behalf creates an approved request with a ledger debit; a manager without `leave.adjust` cannot record or cancel.

- [x] Commit `feat(leave): add leave register and on-behalf recording`

---

### Task 17: Balances and adjustments

**Files:** `src/app/(app)/leave/balances/{page,balances-client,adjust-sheet,ledger-dialog,actions}.tsx`; test `tests/integration/leave-balance-actions.test.ts`

- Year switcher, department filter, and a table of employees × types (balance; hover/expand shows used).
- Clicking a cell opens the ledger dialog (`employeeLedger`).
- "Adjust" sheet (`leave.adjust`): employee, type, year, ± days, mandatory note → `adjustBalanceAction`, audited
  `leave.adjust` with the delta in the summary.
- Tests: an adjustment changes the balance; the note is required; `leave.view.all` without `leave.adjust` cannot adjust.

- [x] Commit `feat(leave): add balance sheet, ledger drill-down and adjustments`

---

### Task 18: Team calendar

**Files:** `src/app/(app)/team/calendar/{page,calendar-grid}.tsx`

- `?month=YYYY-MM` with prev/next links, plus a department filter for `leave.view.all`.
- Grid: sticky name column; one column per day with the weekday initial; weekly-off and holiday columns shaded (holiday
  name in a tooltip). Cells show the type code in its colour: half-filled for half days, hatched/outlined for pending.
- Legend underneath. Empty state when the viewer has no team and is not org-wide.
- Covered by `leave-queries` tests (Task 9) and the e2e smoke check; no action tests (read only).

- [x] Commit `feat(team): add team leave calendar`

---

### Task 19: Employee profile Leave tab

**Files:** Modify `src/app/(app)/org/employees/[id]/page.tsx`; Create `src/components/leave/employee-leave-tab.tsx`

- Replace the "Leave arrives in Phase 2" empty state with the balance cards (current leave year) + the last 10 requests
  from `employeeLeaveSummary`.
- For `leave.view.all`, add links to the register (filtered to the employee) and to balances.
- Visible to anyone who can open the profile (Phase 1 rules).

- [x] Commit `feat(employees): show leave on the employee profile`

---

### Task 20: E2E, verification, documentation

**Files:** Create `tests/e2e/leave.spec.ts`; Modify the roadmap, `CLAUDE.md`, `DEPLOY.md` (legacy migration command only;
the full runbook comes in Phase 6).

**E2E (`test.describe.serial`)**, keeping sign-ins low because the login limiter allows 20 per 15 minutes per address:
1. Admin:
   - creates manager "Ravi Kumar" (login, role Manager) and employee "Meera Iyer" reporting to Ravi (login), both
     DOJ 2025-01-01;
   - captures both temporary passwords.
2. Meera:
   - signs in and changes her password;
   - `/me/leave` shows CL 12;
   - applies CL for one working day ≥ 7 days ahead (the test computes a Wednesday in UTC);
   - sees it pending.
3. Ravi: signs in, changes his password, approves on `/approvals` (Leave tab), and sees "No pending leave requests".
4. Meera:
   - sees the request approved and CL 11;
   - cancels it, and CL is 12 again.

Run `npm run test:e2e` (all specs) and `npm run verify`.

**Docs:**
- Roadmap:
  - the Phase 2 row → `☑ done (<last code commit>)`, plan `2026-10-23-phase-2-leave-holidays.md`;
  - "Spec refinements" 22+ from the list below;
  - the integration map row for Phase 2 names `holidaysForEmployee`, `holidayDatesForEmployee`, `onLeaveChanged`,
    `onHolidayChanged`, `weeklyOffsForEmployee`, `syncEntitlements`, `balanceOf`, `postLedger`, `canDecideLeave`.
- `CLAUDE.md`: a "Leave" bullet under Architecture rules: ledger-only balances, 0.5 steps, one leave year per request,
  `canDecideLeave` for approvals.

**Refinements to record:**
- LWP debits its own ledger (its balance goes negative = days used). It never touches CL/SL. Spec §8's "no balance
  debit" is honoured in that no paid balance is reduced.
- A request may not cross a leave-year boundary.
- Balance checks subtract pending days.
- Back-dated self-service requests are allowed only for types with `min_notice_days = 0`.
- HR "record leave" (on behalf) is approved immediately and skips notice/max-consecutive, but not balance or overlap.
- Monthly accrual credits `floorHalf(q·k/12) − floorHalf(q·(k−1)/12)`, so every ledger delta stays a 0.5 multiple.
  Upfront pro-rating counts the joining month.
- Weekly offs come from `attendance.weeklyOffs` (default Sat/Sun) until Phase 3 shifts. `weeklyOffsForEmployee` is the seam.
- Optional-holiday quota is per calendar year; a missing year config means 0 picks. Picks lock once the date passes.
- The leave year start month is locked once ledger rows exist.
- Year-end lapses the excess of encashable types until Phase 5 adds encashment. It skips CO (lots expire in Phase 3).
- Legacy migration:
  - admins with leave history also get an employee record;
  - inactive users become exited employees;
  - attendance backfill (§8 step 7) moves to Phase 3;
  - default shift/components are seeded in Phases 3 and 5.
- `isInScope` is true for org-wide viewers on their own record. Approval flows check `SELF_APPROVAL` explicitly.

- [x] Commit `test(e2e): cover leave apply, approval and cancellation`, then push `feat/hrms-overhaul`

---

## Self-review notes (planner)

- **Spec coverage:**
  - §4.5 tables except comp-off: Task 3.
  - §5.4:
    - types (Task 4); balances, grants, accrual, year end (Tasks 5–6);
    - day counting (Task 2); apply validations, approval, cancel, on behalf, adjustments (Tasks 5, 7, 16, 17);
    - holidays + optional picks (Tasks 8, 13, 14); team calendar (Task 18).
  - §5.7 Leave tab: Task 15.
  - §7 jobs: Task 6.
  - §8: Task 10, with step 7 deferred to Phase 3 (no attendance tables yet).
- **Roadmap items 1–11** map to Tasks 3, 2, 5, 4, 8, 7, 7, 6, 11–19, 10, 20.
- **Phase 3 seams:**
  - `onLeaveChanged`/`onHolidayChanged` (called by Tasks 7 and 8);
  - `weeklyOffsForEmployee` (Tasks 7, 9, 14, 18 use it, never the setting directly);
  - the CO type and its ledger (Phase 3 adds lots and FIFO inside `approveLeave`/`cancelLeave`).
- **Phase 5 seams:** `is_lop` and `days` on approved requests (LOP), `encashable` + `balanceOf` (exit encashment),
  and `leave_requests` for payroll locks (Phase 5 must refuse cancels inside a locked period).
