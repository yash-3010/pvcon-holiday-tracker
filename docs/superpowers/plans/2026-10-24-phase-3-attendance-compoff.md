# Phase 3 — Attendance and Comp-off Implementation Plan

> **For agentic workers:** Execute task by task with TDD (failing test → implementation → passing test → commit).
> Like the Phase 2 plan, this fixes **contracts** (files, signatures, rules, test cases); the executor writes the code
> in the style of the existing modules. Record any deviation from the spec in Task 21 and the roadmap.

**Goal:**
- Shifts.
- Web punch in/out with a daily attendance computation and its nightly close.
- Regularization, an admin today board and a muster roll, and payroll locks (respected, set in Phase 5).
- Comp-off end to end: off-day work → claim → approval → expiring lots → CO leave consumed FIFO → expiry.

**Architecture:**
- Tables in `src/server/db/schema/attendance.ts` (shifts, punches, days, regularizations) and the comp-off tables in
  `src/server/db/schema/leave.ts`.
- Pure attendance math in `src/lib/attendance.ts` (`computeAttendanceDay`, punch pairing, minutes helpers).
- Time-zone conversion helpers in `src/lib/dates.ts`.
- Services in `src/server/modules/attendance/*` and `src/server/modules/compoff/*`.
- Phase 2's seams become real:
  - `attendance/hooks.ts` recomputes;
  - `attendance/calendar.ts` reads the employee's shift;
  - leave approve/cancel consume and restore comp-off lots.

**Spec:** `docs/superpowers/specs/2026-09-24-hrms-overhaul-design.md`:
- §4.3 (attendance tables), §4.5 (comp-off tables);
- §5.2 (attendance), §5.5 (comp-off);
- §5.7 (Regularization and Comp-off approval tabs), §5.11 (attendance and comp-off settings);
- §7 (`attendance:close-day`, `compoff:expire`).

**Prerequisite:** Phase 2 is complete. Reuse these names exactly:
- leave: `onLeaveChanged`, `onHolidayChanged`, `weeklyOffsForEmployee`, `companyWeeklyOffs`, `holidaysForEmployee`,
  `holidayDatesForEmployee`, `postLedger`, `balanceOf`, `pendingDays`, `closeLeaveYear`, `compOffType`,
  `approveLeave`/`cancelLeave` (`src/server/modules/leave/requests.ts`), `leaveYearOf`/`leaveYearRange`;
- employees: `isManagerAbove`, `getReportingTree`, `requireEmployee`;
- users and notifications: `activeUserIdsWithPermission`, `notify`/`notifyMany`;
- jobs: `JOBS`/`runJobByName`.

## Global Constraints

- Punches are ISO-8601 UTC instants. The **attendance date** of a punch is its calendar date in the company time zone
  (`locale.timezone`).
- Shift times are local wall-clock `HH:MM` in the company time zone. Shifts never cross midnight in this phase
  (`end > start`, validated).
- Minutes are integers; worked time is the sum of closed in→out pairs.
- `attendance_days` is a cache that `recomputeAttendance` can always rebuild from punches, leave, holidays, shifts and
  overrides. A `locked` row is never rewritten.
- Services are synchronous, take `db` first and never `await` inside a transaction. "Now" and "today" are parameters.
- Every mutation goes through `defineAction` and calls `audit(...)`. Clock in/out is audited as `attendance.punch`.
- Approvals follow the leave rule: `regularization.approve` / `compoff.approve`, plus org-wide (`attendance.view.all` /
  `leave.view.all`) or a manager above. Never one's own.

## Review Focus

1. **Time zones and day boundaries.**
   - A punch at 23:50 IST belongs to that IST date, not the UTC date.
   - Auto clock-out uses the shift's local time converted to UTC.
   - Late, early and overtime use local minutes.
   - Tests: Task 1 (`zonedInstant`/`minutesInZone` round trip), Task 3 (pairing), Task 5 (a punch at 18:20Z lands on
     the next IST day).
2. **Status precedence** (spec §5.2): not joined / exited, override, full leave, holiday, weekly off, half leave, auto
   mode, then worked minutes.
   - Two half-day leaves on one date make a full day.
   - Work on an off day sets `off_day_worked`.
   - Test: Task 3 (one case per branch).
3. **Locks.** A payroll-locked day is never recomputed or regularized, and leave hooks skip it.
   - Test: Task 5, Task 7.
4. **Comp-off balance integrity.**
   - FIFO by earliest expiry; only lots still valid on the leave's start date count.
   - Approve consumes, cancel restores (and lapses at once if the lot has expired since).
   - Year-end carries the active lots' remaining days, never more.
   - Expiry lapses exactly once.
   - Tests: Tasks 10, 11, 12.
5. **One claim per worked date**, and claims only for real off-day work within the window, at the right
   half-day/full-day threshold.
   - Test: Task 10.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/dates.ts` | + `minutesInZone(instant, tz)`, `zonedInstant(date, minutes, tz)`, `parseHm`, `formatHm`, `formatMinutes` |
| `src/lib/attendance.ts` | Attendance enums/labels/codes, `pairPunches`, `computeAttendanceDay`, comp-off eligibility |
| `src/lib/validation/attendance.ts` | zod: shift, punch, regularization, override, comp-off claim/decision/grant, settings forms |
| `src/lib/validation/settings.ts` | `attendance.defaultShiftId` |
| `src/server/db/schema/attendance.ts` | `shifts`, `attendance_punches`, `attendance_days`, `regularization_requests` |
| `src/server/db/schema/leave.ts` | + `comp_off_claims`, `comp_off_lots`, `comp_off_consumptions` |
| `src/server/db/schema/core.ts` | + `employees.shift_id` |
| `src/server/modules/attendance/shifts.ts` | Shift CRUD, archive, default shift, `shiftForEmployee`, assignment, `seedDefaultShift` |
| `src/server/modules/attendance/calendar.ts` | `weeklyOffsForEmployee` reads the shift; `companyWeeklyOffs` reads the default shift |
| `src/server/modules/attendance/punches.ts` | Clock in/out, clock state, auto clock-out |
| `src/server/modules/attendance/compute.ts` | `recomputeAttendance(db, employeeId, from, to, now)`, `recomputeDateForAll` |
| `src/server/modules/attendance/hooks.ts` | `onLeaveChanged`/`onHolidayChanged` call the recompute |
| `src/server/modules/attendance/regularization.ts` | Request, approve, reject, withdraw |
| `src/server/modules/attendance/overrides.ts` | Admin override set/clear |
| `src/server/modules/attendance/queries.ts` | My month, today board, muster roll, regularization queue, profile tab |
| `src/server/modules/compoff/service.ts` | Eligibility, claims, decisions, lots, FIFO consume/restore, manual grant, expiry |
| `src/server/modules/compoff/queries.ts` | My comp-off, claim queue, admin lists |
| `src/server/jobs/attendance-close-day.ts`, `compoff-expire.ts` | Jobs |
| `src/components/attendance/*` | Clock card, status badge/codes, month calendar |
| `src/app/(app)/me/attendance/*`, `me/comp-off/*` | Self-service |
| `src/app/(app)/time/{attendance,muster,shifts}/*`, `leave/comp-off/*` | Admin |
| `src/app/(app)/settings/{attendance,comp-off}/*` | Settings |
| `src/app/(app)/approvals/*` | + Regularization and Comp-off tabs |
| `tests/e2e/attendance.spec.ts` | Clock in/out; Saturday work via regularization → claim → approve → CO leave |

---

### Task 1: Time-zone helpers

**Files:** Modify `src/lib/dates.ts`; Test `tests/unit/lib/dates.test.ts` (extend)

- `minutesInZone(instant: Date, timeZone): number`: minutes since local midnight.
- `zonedInstant(date: ISODate, minutes: number, timeZone): Date`: the UTC instant of a local date and time. Use
  offset iteration via `Intl` (no dependency); handle DST gaps by moving forward.
- `parseHm("09:30") → 570` (throws on invalid input); `formatHm(570) → "09:30"`.
- `formatMinutes(125) → "2h 05m"`; `formatMinutes(0) → "0m"`.
- **Tests:**
  - IST: 2026-11-02 09:30 → `2026-11-02T04:00:00.000Z`, and back.
  - `America/New_York` across the DST change (2026-03-08 02:30 does not exist → 03:30 local).
  - In IST, `2026-11-02T18:20:00Z` is 2026-11-02 at 23:50 (minute 1430), and `2026-11-02T18:40:00Z` is 2026-11-03 at
    00:10 (minute 10).

- [ ] Commit `feat(dates): add time-zone conversion and minute helpers`

### Task 2: Attendance constants, validation, settings

**Files:** Create `src/lib/attendance.ts` (constants), `src/lib/validation/attendance.ts`; Modify `src/lib/validation/settings.ts`; Test `tests/unit/lib/attendance-validation.test.ts`

- Enums:
  - `ATTENDANCE_STATUSES = [present, half_day, absent, on_leave, half_leave, holiday, weekly_off, not_joined, exited]`;
  - `PUNCH_DIRECTIONS = [in, out]`, `WORK_MODES = [office, remote]`, `PUNCH_SOURCES = [web, admin, regularization, auto]`;
  - `ATTENDANCE_MODES = [punch, auto]`;
  - `REGULARIZATION_STATUSES = [pending, approved, rejected, withdrawn]`;
  - `COMP_OFF_CLAIM_STATUSES = [pending, approved, rejected, withdrawn]`, `COMP_OFF_RESOLUTIONS = [leave, payout]`;
  - `COMP_OFF_LOT_STATUSES = [active, consumed, expired, paid_out]`.
- Labels, plus a short muster code per status: P, HD, A, L, HL, H, WO, NJ, EX.
- Schemas:
  - `shiftSchema`:
    - `name`; `startTime`/`endTime` `HH:MM` with end > start; `breakMinutes` 0–240; `graceMinutes` 0–240;
    - `halfDayMinutes` < `fullDayMinutes` ≤ the shift length;
    - `weeklyOffs` (distinct 0–6, ≤ 6); `attendanceMode`; `autoClockOutTime` `HH:MM` ≥ end, or null.
  - `punchSchema`: `workMode`.
  - `regularizationSchema`: `date`, `requestedIn`, `requestedOut` (out > in), `reason` 3–300.
  - `overrideSchema`: `employeeId`, `date`, `status` (a status, or null to clear), `note` required when setting.
  - `compOffClaimSchema`: `workedDate`, `reason` optional.
  - `compOffDecisionSchema`: `claimId`, `decision`, `resolution` (default leave), `note`.
  - `compOffGrantSchema`: `employeeId`, `days` (0.5 or 1–5 in half steps), `earnedOn`, `note` required.
  - `attendanceSettingsFormSchema`: `defaultMode`, `regularizationWindowDays`, `defaultShiftId`.
  - `compOffSettingsFormSchema`: mirrors `compOffSettingsSchema`.
- Settings: `attendance.defaultShiftId: number | null` (default null). `attendance.weeklyOffs` stays only as the seed for
  the default shift (refinement).
- **Tests:** a shift whose end is before its start, half ≥ full, a regularization whose out is before its in, an override
  without a note.

- [ ] Commit `feat(attendance): add attendance constants, validation and settings`

### Task 3: Pure attendance computation

**Files:** Modify `src/lib/attendance.ts`; Test `tests/unit/lib/attendance.test.ts`

- `pairPunches(punches: { minutes: number; direction }[]) → { inMinutes, outMinutes | null }[]`:
  - sorts by time;
  - ignores a second `in` while one is open, and an `out` with no open `in`.
- `computeAttendanceDay(input) → AttendanceDayResult`. The input:
  ```ts
  { date, weekday, dateOfJoining, lastWorkingDate,
    shift: { startMinutes, endMinutes, graceMinutes, halfDayMinutes, fullDayMinutes, weeklyOffs, mode },
    holiday: string | null,            // fixed or picked optional
    leave: { portion: LeaveHalf; requestId: number }[],   // approved leave touching the date
    sessions: { inMinutes; outMinutes | null }[],          // open sessions count up to `nowMinutes` when given
    nowMinutes: number | null,         // only for today
    override: AttendanceStatus | null }
  ```
  The result: `{ status, firstIn, lastOut, workedMinutes, lateMinutes, earlyMinutes, overtimeMinutes, offDayWorked, leaveRequestId }`.
- Precedence:
  1. Before DOJ → `not_joined`; after LWD → `exited`.
  2. Override.
  3. Full leave (a `full` portion, or both halves) → `on_leave`.
  4. Holiday.
  5. Weekly off.
  6. Half leave → `half_leave`.
  7. Auto mode → `present`.
  8. Worked ≥ full → `present`; ≥ half → `half_day`; else `absent`.
- Metrics:
  - worked always counts;
  - `offDayWorked` = (holiday or weekly off) and worked > 0;
  - late = max(0, firstIn − (start + grace)) on working days only;
  - early = max(0, end − lastOut) on working days when `lastOut` is set;
  - overtime = worked − full on working days (≥ 0), all worked minutes on off days.
- `compOffDaysFor(workedMinutes, thresholds) → 0 | 0.5 | 1`.
- **Tests:** one per precedence branch; auto mode; open session with `nowMinutes`; two half leaves; overtime on an off day;
  late within grace = 0; an override over leave.

- [ ] Commit `feat(attendance): add punch pairing and daily attendance computation`

### Task 4: Schema and migration

**Files:** Create `src/server/db/schema/attendance.ts`; Modify `schema/leave.ts`, `schema/core.ts`, `schema/index.ts`; Generate `0003_attendance`; Test `tests/integration/db/attendance-schema.test.ts`

- `shifts`: id, name unique, `start_time`, `end_time`, `break_minutes`, `grace_minutes`, `half_day_minutes`,
  `full_day_minutes`, `weekly_offs` JSON, `attendance_mode`, `auto_clock_out_time`?, `archived`, timestamps.
- `employees.shift_id` → shifts (set null).
- `attendance_punches`:
  - id, `employee_id` (cascade), `at` (UTC ISO), `date` (local, denormalised for queries), `direction`, `work_mode`,
    `source`, `ip`, `note`, `created_by` → users, `created_at`;
  - index (`employee_id`, `date`).
- `attendance_days`:
  - PK (`employee_id`, `date`); `status`, `first_in`/`last_out` (local minutes), `worked_minutes`, `late_minutes`,
    `early_minutes`, `overtime_minutes`, `off_day_worked`, `leave_request_id`, `locked`, `computed_at`;
  - `override_status`, `override_by`, `override_note`, `override_at`;
  - index (`date`, `status`).
- `regularization_requests`: id, `employee_id`, `date`, `requested_in`/`requested_out` (local minutes), `reason`,
  `status`, `approver_id`, `decided_at`, `decision_note`, timestamps.
- `comp_off_claims`:
  - id, `employee_id`, `worked_date`, `worked_minutes`, `days_requested`, `reason`, `status`, `approver_id`,
    `decided_at`, `decision_note`, `resolution`, `created_at`;
  - a partial unique index on (`employee_id`, `worked_date`) where status in (pending, approved).
- `comp_off_lots`:
  - id, `employee_id`, `claim_id` (null for HR grants), `days`, `remaining`, `earned_on`, `expires_on`, `status`,
    `note`, `created_by`, `created_at`;
  - index (`employee_id`, `status`, `expires_on`).
- `comp_off_consumptions`: id, `lot_id`, `leave_request_id`, `days`; index (`leave_request_id`).
- **Tests:** tables exist; cascades; the partial unique claim index allows a new claim after a rejected one.

- [ ] Commit `feat(db): add attendance and comp-off schema`

### Task 5: Shifts and the calendar seam

**Files:** Create `src/server/modules/attendance/shifts.ts`; Modify `attendance/calendar.ts`, `scripts/seed.ts`; Test `tests/integration/shifts.test.ts`

- CRUD:
  - `createShift`, `updateShift → { before, after }`, `setShiftArchived` (refused for the default shift and for shifts
    with current employees);
  - `listShifts` with employee counts.
- `seedDefaultShift(db)`:
  - when no shift exists, creates "General" 09:30–18:30 (60 break, 15 grace, half 240, full 480, auto clock-out 23:30)
    with `weeklyOffs` from `attendance.weeklyOffs` and mode from `attendance.defaultMode`;
  - sets `attendance.defaultShiftId`;
  - idempotent.
- `defaultShift(db)` (seeds lazily if missing) and `shiftForEmployee(db, employeeId)` (the employee's shift or the default).
- `assignShift(db, employeeIds, shiftId | null)` → recompute from today for those employees (Task 7).
- `weeklyOffsForEmployee` → `shiftForEmployee(...).weeklyOffs`; `companyWeeklyOffs` → `defaultShift(...).weeklyOffs`.
- Settings → Leave stops editing weekly offs (they live on shifts now); its form keeps only the year start month.
- **Tests:**
  - the seed copies the weekly offs once;
  - an employee without a shift gets the default;
  - archiving the default is refused;
  - leave day counting follows a Sunday-only shift.

- [ ] Commit `feat(attendance): add shifts and the default shift`

### Task 6: Punches

**Files:** Create `src/server/modules/attendance/punches.ts`; Test `tests/integration/punches.test.ts`

- `clockState(db, employeeId, now) → { state: "out" | "in"; since: string | null; workMode; todayWorkedMinutes; date }`.
- `clockIn(db, employeeId, { workMode, ip, now, source = "web", createdBy })`:
  - refused when already in (`ALREADY_IN`), or when the employee is exited or not yet joined (`NOT_WORKING`).
- `clockOut(db, employeeId, { ip, now })`: refused when not in (`NOT_IN`).
- Both store `date` = local date of `now` and call `recomputeAttendance` for that date.
- `autoClockOut(db, date, now)`: for every employee with an open session dated `date` (or earlier), insert an `out` at
  the shift's `autoClockOutTime` on the session's date (source `auto`). With no auto time, use the shift end. Returns
  the count.
- **Tests:**
  - in/out twice in a day sums both sessions;
  - double in → `ALREADY_IN`;
  - a punch at `2026-11-02T18:40:00Z` is dated 2026-11-03;
  - auto clock-out inserts at 23:30 IST (`18:00Z`).

- [ ] Commit `feat(attendance): add clock in and clock out`

### Task 7: Recompute, hooks and overrides

**Files:** Create `attendance/compute.ts`, `attendance/overrides.ts`; Modify `attendance/hooks.ts`; Test `tests/integration/attendance-compute.test.ts`

- `recomputeAttendance(db, employeeId, from, to, { now? })`:
  - gathers the shift, holidays (`holidayDatesForEmployee`), approved leave portions, punches (regularization punches
    supersede the day's others), and the existing row's override;
  - computes each day from `max(from, DOJ)` to `min(to, today)`; future days are not stored;
  - upserts unlocked rows and skips locked ones;
  - returns `{ written, skippedLocked }`.
- `recomputeDateForAll(db, date)`: every current employee.
- Hooks:
  - `onLeaveChanged` → recompute the range (clamped to today);
  - `onHolidayChanged(tx, date)` → `recomputeDateForAll` when `date ≤ today`.
- Overrides:
  - `setOverride(db, actorUserId, { employeeId, date, status, note })` sets or clears it, then recomputes;
  - refused on locked rows (`DAY_LOCKED`) and future dates (`FUTURE_DATE`).
- **Tests:**
  - approving leave turns past days `on_leave`, and cancelling restores them;
  - a new holiday flips a computed day to `holiday`;
  - a locked row survives a recompute;
  - an override wins and clearing it restores the computed status.

- [ ] Commit `feat(attendance): recompute attendance from punches, leave and holidays`

### Task 8: Close-day job

**Files:** Create `src/server/jobs/attendance-close-day.ts`; Modify registry; Test `tests/integration/attendance-jobs.test.ts`

- `attendance:close-day`, run key = yesterday's local date:
  - `autoClockOut` for yesterday and earlier;
  - `recomputeDateForAll(yesterday)`;
  - for each current employee whose yesterday is `offDayWorked` with eligible minutes and comp-off enabled, notify
    "You worked on <day> — claim comp-off" (`compoff.eligible`, link `/me/attendance?month=…`).
- **Tests:** run at `2026-11-07T19:00:00Z` (00:30 IST Sunday): it closes Saturday 11-07, auto clock-outs an open
  session, notifies a Saturday worker once, and a second run is skipped.

- [ ] Commit `feat(attendance): add the nightly close-day job`

### Task 9: Regularization

**Files:** Create `attendance/regularization.ts`; Test `tests/integration/regularization.test.ts`

- `requestRegularization(db, actor, input, { today })`:
  - past dates within `regularizationWindowDays` only (`OUTSIDE_WINDOW`, `FUTURE_DATE`);
  - not before joining;
  - one pending per date (`ALREADY_PENDING`);
  - not on a locked day (`DAY_LOCKED`);
  - notifies approvers (manager login, else org-wide `regularization.approve` + `attendance.view.all` holders).
- `canDecideRegularization(db, user, employeeId)`.
- `approveRegularization`:
  - inserts `in`/`out` punches (source `regularization`, at `zonedInstant(date, minutes)`);
  - recomputes; refused if the day got locked meanwhile;
  - notifies the employee.
- `rejectRegularization`, `withdrawRegularization` (own pending).
- **Tests:**
  - the window and the future;
  - approval makes an absent day present;
  - regularization punches supersede the day's web punches;
  - peer `FORBIDDEN`; `SELF_APPROVAL`.

- [ ] Commit `feat(attendance): add regularization requests`

### Task 10: Comp-off claims and lots

**Files:** Create `src/server/modules/compoff/service.ts`; Test `tests/integration/compoff.test.ts`

- `compOffThresholds(db, employeeId) → { half, full }` (settings or the shift).
- `eligibleOffDays(db, employeeId, { today })`:
  - computed days with `offDayWorked`, at least the half threshold, within the claim window, with no active claim;
  - each with `{ date, workedMinutes, days }`.
- `submitCompOffClaim(db, actor, { workedDate, reason }, { today })`:
  - comp-off enabled (`COMPOFF_DISABLED`);
  - within the window (`OUTSIDE_WINDOW`);
  - the day is off-day work (`NOT_OFF_DAY_WORK`);
  - enough minutes (`TOO_FEW_MINUTES`);
  - no active claim (`ALREADY_CLAIMED`);
  - snapshots the worked minutes and days; notifies approvers.
- `canDecideCompOff(db, user, employeeId)`.
- `approveCompOffClaim(db, actor, claimId, { resolution, note, today })`:
  - `leave`: create a lot (`expires_on = worked_date + expiryDays`) and a `comp_off_credit` ledger row on the CO type, in
    the leave year of the worked date;
  - `payout` (only when `payoutEnabled`, else `PAYOUT_DISABLED`): no lot; Phase 5 pays approved payout claims.
- `rejectCompOffClaim`, `withdrawCompOffClaim`.
- `grantCompOff(db, actorUserId, { employeeId, days, earnedOn, note })`: a manual lot (no claim) plus a credit;
  `SELF_ADJUST` guard in the action.
- `compOffAvailable(db, employeeId, onDate)`: Σ remaining of active lots with `expires_on ≥ onDate`.
- **Tests:**
  - a Saturday with 8.5 h → 1 day, with 5 h → 0.5, with 3 h → not eligible;
  - a second claim for the date → `ALREADY_CLAIMED`;
  - a claim after the window → `OUTSIDE_WINDOW`;
  - approve → lot + credit (the CO balance is 1);
  - payout refused while disabled.

- [ ] Commit `feat(compoff): add comp-off claims, approvals and lots`

### Task 11: Comp-off leave: FIFO consumption and restore

**Files:** Modify `src/server/modules/leave/requests.ts`, `compoff/service.ts`; Test `tests/integration/compoff-leave.test.ts`

- In `checkApplication` and `approveLeave`, for the CO type, availability = `compOffAvailable(employeeId, startDate)`,
  minus pending CO days (on apply only), instead of the ledger balance (`INSUFFICIENT_BALANCE`).
- `consumeCompOff(db, request)`: called by `approveLeave` (and on-behalf) for CO. Takes lots by `expires_on` ascending,
  then id; writes `comp_off_consumptions`; marks emptied lots `consumed`.
- `restoreCompOff(db, request, today)`: called by `cancelLeave` for CO. Gives the consumed days back to their lots
  (`active`). A lot already past expiry lapses those days at once (`comp_off_lapse` + `expired`).
- **Tests:**
  - two lots (expiring 11-20 and 12-01) and a 1.5-day CO leave → takes 1 from the first and 0.5 from the second;
  - a lot that expires before the leave date doesn't count;
  - cancel restores both;
  - cancel after expiry lapses the restored days.

- [ ] Commit `feat(compoff): consume comp-off lots first-expiring-first and restore them on cancel`

### Task 12: Comp-off expiry and year-end

**Files:** Create `src/server/jobs/compoff-expire.ts`; Modify `leave/ledger.ts` (`closeLeaveYear` for CO); Test `tests/integration/compoff-jobs.test.ts`

- `expireCompOff(db, today)`:
  - lots with `expires_on < today` and remaining > 0 → a `comp_off_lapse` −remaining in the leave year of today, status
    `expired`;
  - lots expiring in exactly 7 days → a notification (`compoff.expiring`);
  - returns counts.
- Job `compoff:expire`, keyed on the local date.
- `closeLeaveYear` for CO carries min(balance, Σ remaining of active lots) as a pair, and never lapses (lots expire on
  their own).
- **Tests:** expiry once (a second run is skipped); the warning goes out 7 days ahead only; year-end carries an active
  lot's remaining days into the next leave year.

- [ ] Commit `feat(compoff): expire lots and carry active comp-off across leave years`

### Task 13: Attendance read models

**Files:** Create `attendance/queries.ts`, `compoff/queries.ts`; Test `tests/integration/attendance-queries.test.ts`

- `myAttendanceMonth(db, employeeId, month, now)`:
  - per day: the status (today live), punches, worked/late/early/overtime;
  - holiday name, leave type code;
  - `canRegularize`, `compOff` eligibility and claim status;
  - summary counts.
- `todayBoard(db, user, now)`:
  - current employees in scope (`attendance.view.all` → all; managers → their tree);
  - state in/out/on leave/holiday/weekly off/not in yet; work mode; first in; late flag;
  - totals.
- `musterRoll(db, user, month, { departmentId })`: employees × days, with codes and an override flag, plus totals per
  employee (P, HD, A, L, …).
- `pendingRegularizationsFor(db, user)`, `pendingCompOffClaimsFor(db, user)`.
- `myCompOff(db, employeeId, today)`: lots with remaining and expiry, claims, eligible days, the next expiry.
- `employeeAttendanceSummary(db, employeeId, month)` (the profile tab).
- **Tests:** scope of the board/muster (manager vs HR vs employee); live status for today; muster totals.

- [ ] Commit `feat(attendance): add attendance and comp-off read models`

### Task 14: Settings and navigation

**Files:**
- Create `src/app/(app)/settings/{attendance,comp-off}/*`
- Modify `nav.ts`, `settings/leave/*` (drop the weekly offs)
- Test `tests/integration/attendance-settings-actions.test.ts`

- Settings → Attendance (`attendance.manage`): default mode, regularization window, default shift.
- Settings → Comp-off (`leave.config`): enabled, thresholds (blank = the shift's), claim window, expiry days, payout.
- Nav:
  - My Space: "My attendance" `/me/attendance`, "My comp-off" `/me/comp-off`;
  - a new **Time** group:
    - "Today" `/time/attendance` (`attendance.view.all`, `regularization.approve`);
    - "Muster roll" `/time/muster` (`attendance.view.all`, `regularization.approve`);
    - "Shifts" `/time/shifts` (`shift.manage`);
  - Leave group: "Comp-off" `/leave/comp-off` (`leave.view.all`);
  - Approvals `anyOf` adds `regularization.approve` and `compoff.approve`.

- [ ] Commit `feat(attendance): add attendance and comp-off settings and navigation`

### Task 15: Clock card and My attendance

**Files:**
- `src/components/attendance/{clock-card,status-badge,month-calendar}.tsx`
- `src/app/(app)/page.tsx` (dashboard widget)
- `src/app/(app)/me/attendance/{page,actions,attendance-client}.tsx`
- Test `tests/integration/my-attendance-actions.test.ts`

- Clock card (dashboard and `/me/attendance`):
  - state, since, today's worked time (ticking client-side from `since`);
  - a work mode select; a Clock in / Clock out button.
- Actions `clockInAction` / `clockOutAction` (employee only) read the IP from headers (`clientIp`).
- My attendance:
  - a month calendar (status colour + code, worked hours) with prev/next;
  - a day detail sheet: punches, late/early/overtime, the regularize form when allowed, the claim button when eligible;
  - month summary.
- Actions: `requestRegularizationAction`, `withdrawRegularizationAction`, `claimCompOffAction`, `withdrawCompOffClaimAction`.

- [ ] Commit `feat(attendance): add the clock card and my attendance page`

### Task 16: My comp-off

**Files:** `src/app/(app)/me/comp-off/{page,comp-off-client}.tsx`

- Available days with the next expiry; lots with earned/expiry/remaining/status; eligible days with Claim buttons;
  claims history.

- [ ] Commit `feat(compoff): add my comp-off page`

### Task 17: Approvals — Regularization and Comp-off tabs

**Files:** Modify `approvals/{page,actions}.tsx`; Create `approvals/{regularization-list,compoff-list}.tsx`; Test `tests/integration/approvals-attendance-actions.test.ts`

- Regularization rows: the day's actual punches vs the requested in/out, and the reason. Approve / Reject with a note.
- Comp-off rows:
  - worked date and minutes, days, and the employee's timesheet note (Phase 4);
  - Approve as leave, or as payout when enabled; Reject.
- Actions audited `regularization.approve|reject`, `compoff.approve|reject`.

- [ ] Commit `feat(approvals): add regularization and comp-off approval tabs`

### Task 18: Today board, muster roll, overrides

**Files:** `src/app/(app)/time/{attendance,muster}/*`; Test `tests/integration/attendance-admin-actions.test.ts`

- Today board: stat tiles (in, remote, late, on leave, not in yet) and a table.
- Muster roll:
  - month grid with codes and colours, a department filter, and per-employee totals;
  - a cell opens a day dialog with punches and an override form (`attendance.manage`);
  - `setOverrideAction` audited `attendance.override`.

- [ ] Commit `feat(attendance): add the today board, muster roll and overrides`

### Task 19: Shifts page and assignment

**Files:** `src/app/(app)/time/shifts/*`; Modify the employee profile Attendance tab; Test `tests/integration/shift-actions.test.ts`

- Shifts table (times, grace, thresholds, weekly offs, mode, employee count, default badge) with a create/edit sheet
  and archive.
- "Assign employees" dialog per shift (multi-select of current employees).
- Profile Attendance tab:
  - the shift (with a change select for `shift.manage`);
  - this month's summary and recent days.
- Actions audited `shift.create|update|archive|assign`.

- [ ] Commit `feat(attendance): add shifts page and shift assignment`

### Task 20: Comp-off admin

**Files:** `src/app/(app)/leave/comp-off/*`; Test `tests/integration/compoff-admin-actions.test.ts`

- Tabs: claims (all statuses, filters), lots (active/expiring/expired), and a "Grant comp-off" sheet (`leave.adjust`).
- `grantCompOffAction` audited `compoff.grant`.

- [ ] Commit `feat(compoff): add comp-off administration`

### Task 21: E2E, verification, documentation

**Files:** `tests/e2e/attendance.spec.ts`; the roadmap; `CLAUDE.md`

**E2E** (serial, few sign-ins):
1. Admin creates a manager and an employee (logins, DOJ 2025-01-01). Note: if a Phase 2 spec already created people,
   use new names.
2. The employee:
   - clocks in from the dashboard, then out; `/me/attendance` shows today with worked time;
   - regularizes last Saturday 10:00–18:30 (the window allows it).
3. The manager approves the regularization (Approvals → Regularization).
4. The employee claims comp-off for that Saturday (1 day).
5. The manager approves the claim (as leave).
6. The employee:
   - sees CO 1 on My comp-off;
   - applies CO leave for a weekday ≥ 2 days ahead (inside the lot's validity);
   - the manager approves it, and CO shows 0 used up.

   Keep sign-ins under the limiter: about 6 in this spec, about 21 overall. If the suite as a whole exceeds 20 per
   15 minutes, add `storageState` reuse in `tests/e2e/helpers.ts`.

Run `npm run test:e2e` and `npm run verify`.

**Docs:**
- Roadmap:
  - Phase 3 row done;
  - refinements 34+ (the list below);
  - the integration map names `recomputeAttendance`, `attendance_days.locked`, `compOffAvailable`, approved payout claims.
- `CLAUDE.md`: an "Attendance" bullet (UTC punches, local dates, recompute is the only writer of `attendance_days`, locks).

**Refinements to record:**
- Shifts don't cross midnight.
- Regularization punches supersede the day's other punches.
- Today's row is computed live on punch; future days are never stored.
- `half_leave` keeps worked minutes, and Phase 5 decides the LOP for an unworked other half.
- The CO balance check uses valid lots, not the ledger.
- CO year-end carries active lots' remaining days.
- Payout claims wait for Phase 5.
- Settings → Leave no longer edits weekly offs (shifts do).
- Shift assignment lives on the profile Attendance tab and the Shifts page, not the Phase 1 job form.

- [ ] Commit `test(e2e): cover clock-in, regularization and the comp-off flow`, then push
