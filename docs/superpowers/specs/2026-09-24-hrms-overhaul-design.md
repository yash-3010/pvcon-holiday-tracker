# PVCON People — HRMS Overhaul Design

**Date:** 2026-09-24
**Status:** Approved in chat, pending written-spec review
**Replaces:** PVCON Holiday Tracker (leave + holiday only)

## 1. Goal

Turn the single-purpose holiday tracker into an integrated internal HR platform for PVCON Consulting that covers the full employee lifecycle:

- **Core HR** — employee master, org structure, documents, lifecycle history
- **Time & Attendance** — shifts, web punch in/out, daily attendance, regularization
- **Timesheets** — clients, projects, weekly timesheets, billable hours, utilization
- **Leave & Holidays** — configurable leave types, ledger-based balances, approvals, holidays, optional holidays, **comp-off**
- **Payroll** — generic configurable salary components, formula engine, payroll runs with maker-checker, LOP from attendance, payslip PDFs, bank export
- **Cross-cutting** — RBAC, approvals inbox, notifications (in-app + email), audit log, reports, dashboards, settings

Everything is one ecosystem: attendance feeds leave (comp-off) and payroll (LOP, overtime); leave feeds attendance, timesheets and payroll; timesheets reconcile against attendance; exits drive leave encashment and final settlement.

### Decisions already made

| Topic | Decision |
|---|---|
| Payroll compliance | **Generic** — configurable components + formulas, no country statutory rules baked in |
| Time tracking | **Both** attendance (punch) and project timesheets |
| Tenancy / DB | **Single company**, keep **SQLite** (better-sqlite3, WAL) |
| Existing data | **Migrate** users, leaves, holidays, optional picks, carry-forward |
| Architecture | **Modular monolith** in the existing Next.js app |
| Comp-off | Working on weekly off / holiday → eligible → claim → approve → expiring leave credit |

### Non-goals

- Multi-tenant SaaS, billing, public signup
- Country statutory payroll (PF/ESI/PT/TDS). Firms can model these as formula components if needed.
- Native mobile apps (responsive web + PWA instead)
- Biometric device integration
- Recruitment / ATS, performance appraisal, LMS

## 2. Architecture

### 2.1 Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript strict |
| Styling | Tailwind v4, CSS variable tokens, light + dark themes |
| UI primitives | Radix UI (`radix-ui`), `class-variance-authority`, `tailwind-merge`, `lucide-react` |
| Tables | `@tanstack/react-table` wrapped in a shared `DataTable` |
| Forms | `react-hook-form` + `@hookform/resolvers` + `zod` |
| Feedback | `sonner` toasts, `cmdk` command palette |
| Charts | `recharts` |
| DB | SQLite via `better-sqlite3`, Drizzle ORM, drizzle-kit migrations |
| Auth | Auth.js v5 Credentials, JWT sessions, bcrypt (cost 12) |
| PDF | `@react-pdf/renderer` (server side), `qrcode` (verification QR), `@signpdf/signpdf` (optional signing), `@cantoo/pdf-lib` (password-encrypted email copies) |
| Spreadsheet export | `exceljs` (replaces vulnerable `xlsx`) |
| CSV import | `papaparse` |
| Email | `nodemailer` over SMTP (optional) |
| Logging | `pino` |
| Tests | `vitest` (unit + integration on in-memory SQLite), `@playwright/test` (e2e) |

### 2.2 Source layout

```
src/
  app/
    (auth)/login, forgot-password, reset-password/[token], change-password
    (app)/                      # authenticated shell (sidebar layout)
      page.tsx                  # role-aware dashboard
      me/...                    # self-service
      approvals/  team/  org/  time/  leave/  payroll/  reports/  settings/
      notifications/  announcements/
    api/
      auth/[...nextauth]/       # Auth.js
      files/[id]/               # permission-checked downloads
      payslips/[id]/pdf/        # payslip PDF stream
      exports/[report]/         # XLSX/CSV exports
      cron/[job]/               # jobs, CRON_SECRET bearer
      health/
  server/                       # server-only code (import "server-only")
    db/
      client.ts                 # better-sqlite3 + drizzle, pragmas
      schema/{core,attendance,timesheet,leave,payroll,system}.ts
      migrations/
    auth/
      permissions.ts            # permission constants + role→permission map
      rbac.ts                   # can(), requirePermission(), scope helpers
      session.ts                # getCurrentUser() with session-version check
    actions/
      safe-action.ts            # wrapper: auth → zod → permission → tx → audit → result
    modules/
      employees/ org/ attendance/ timesheets/ leave/ compoff/ holidays/
      payroll/ claims/ loans/ notifications/ audit/ settings/ reports/ files/ announcements/
        service.ts              # business logic (mutations, rules)
        queries.ts              # reads for server components
        schemas.ts              # zod input schemas (shared with client forms)
    payroll/engine/
      lexer.ts parser.ts evaluate.ts   # safe formula language
      graph.ts                  # dependency ordering + cycle detection
      calculate.ts              # pure: (inputs) → payslip lines
    jobs/                       # idempotent job implementations
    lib/ crypto.ts dates.ts money.ts email.ts logger.ts pdf/ excel.ts
  components/
    ui/                         # design system primitives
    shell/                      # sidebar, topbar, command palette, notification bell
    <feature>/                  # feature components
  lib/                          # isomorphic utilities (formatting, date math)
tests/
  unit/  integration/  e2e/
scripts/
  migrate-legacy.ts             # old DB → new DB
  seed-demo.ts                  # demo data for dev
```

`src/server/**` never ships to the client. Client components receive plain data and call server actions.

### 2.3 Request / mutation flow

- **Reads:** Server Components call `modules/*/queries.ts`, which take the current user and apply scope filters (self / team / all).
- **Mutations:** Server Actions built with `safeAction({ schema, permission, handler })`:
  1. Resolve session user; reject if session version stale or user inactive.
  2. Parse input with zod → typed field errors returned to form.
  3. Check permission and data scope (e.g. manager can only approve reports in their tree).
  4. Run handler inside a SQLite transaction.
  5. Write audit log entry (actor, action, entity, before/after diff).
  6. Return `{ ok: true, data } | { ok: false, error, fieldErrors }`; `revalidatePath` as needed.
- **Route handlers** only for binary/streamed responses (files, PDFs, exports), cron, health and auth.

### 2.4 Core conventions

- **Money:** integer minor units (paise). `money.ts` handles formatting, rounding, amount-in-words (Indian numbering for INR, international otherwise). Currency code from settings (default `INR`).
- **Dates:** `YYYY-MM-DD` strings for calendar dates, ISO-8601 UTC for timestamps. All calendar math uses pure string/UTC arithmetic (fixes the existing IST off-by-one bug where `toISOString()` on a local-midnight date shifts the day). Company timezone setting (default `Asia/Kolkata`) converts punches to local dates.
- **IDs:** integer autoincrement primary keys. Human codes where useful (`PV0001`, `PRJ-001`).
- **Soft lifecycle:** employees are never hard-deleted (status → exited). Master data uses `archived` flags. Hard delete only for drafts.
- **Validation:** zod schemas live in `schemas.ts` and are shared by server actions and client forms.

## 3. Identity, roles and security

### 3.1 Users vs employees

- `users` = login identity (email, password hash, status, security fields).
- `employees` = HR record, optionally linked 1:1 to a user.
- A user may have no employee record (e.g. the `admin@pvcon.in` system account). An employee may have no login (not yet onboarded).

### 3.2 Roles

Users can hold multiple roles. Permissions are the unit of authorization; roles are fixed bundles defined in code.

| Role | Summary |
|---|---|
| `employee` | Self-service: own profile, attendance, timesheets, leave, comp-off, payslips, claims, directory |
| `manager` | Employee + team scope: approvals for reporting tree, team attendance/leave/timesheets, team reports |
| `hr_admin` | Employees, org masters, documents, attendance & shift config, leave config, holidays, all non-payroll approvals, HR reports. **Cannot see salaries.** |
| `payroll_admin` | Salary components/structures, employee salaries, payroll runs, loans, claim payment, payroll reports |
| `super_admin` | Everything, plus company settings, role assignment, audit log |

Manager scope = transitive reporting tree via `employees.reporting_manager_id`. Anyone who has at least one direct report automatically gets manager scope for approvals even without the explicit role.

### 3.3 Permission list

```
self.*                          (implicit for every employee)
directory.view
employee.view | employee.create | employee.update | employee.exit | employee.import
employee.sensitive.view         (bank, ID numbers — unmasked)
document.manage
org.manage                      (departments, designations)
attendance.view.all | attendance.manage | shift.manage
regularization.approve
timesheet.view.all | timesheet.approve | project.manage
leave.view.all | leave.approve | leave.config | leave.adjust
holiday.manage
compoff.approve
salary.view | salary.manage
payroll.configure | payroll.run | payroll.approve | payroll.release
loan.manage | claim.approve | claim.pay
report.hr | report.attendance | report.timesheet | report.leave | report.payroll
announcement.manage
settings.manage | role.assign | audit.view
```

`approve` permissions without `.all` scope are limited to the reporting tree; HR/payroll admins get org-wide scope.

### 3.4 Security controls

- Email domain allow-list (`ALLOWED_EMAIL_DOMAIN`, current behaviour kept).
- Password policy: min 10 chars, upper + lower + digit; bcrypt cost 12. Existing cost-10 hashes are verified then transparently rehashed on login.
- Lockout: 5 failed attempts → locked 15 minutes. Failed attempts and lock stored on user row. Plus in-memory per-IP throttle.
- `session_version` on user; embedded in JWT; `getCurrentUser()` compares on every request → password change, role change, deactivation and exit revoke all sessions.
- Forgot password: single-use hashed token, 30-minute expiry, emailed when SMTP configured; otherwise admin reset generates a temporary password with forced change.
- Sensitive fields (bank account number, ID numbers) encrypted with AES-256-GCM (`DATA_ENCRYPTION_KEY`), stored as `v1:<iv>:<tag>:<ciphertext>`. UI shows masked values (`XXXX1234`) unless `employee.sensitive.view`.
- Uploads: allow-list (pdf, png, jpg, webp, csv), max 10 MB, random UUID storage names under `UPLOAD_DIR`, served only via `/api/files/[id]` with permission check and `Content-Disposition: attachment`.
- Security headers in `next.config.ts`: CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS (via Caddy).
- Server Actions provide origin checks (CSRF). Cron endpoints require `Authorization: Bearer ${CRON_SECRET}`.
- The only unauthenticated app routes are the auth pages, `/api/health` and `/verify/[code]`; the proxy allow-list names them explicitly, and `/verify` is rate-limited per IP and returns no personal data beyond a masked name.
- Maker-checker: a payroll run cannot be approved by the user who computed it; salary changes by payroll admin are audited.
- Every mutation writes to `audit_logs`.

## 4. Data model

Column lists show the important fields; every table also has `created_at` / `updated_at` where relevant.

### 4.1 System & core

- **users**: id, email (unique), password_hash, status (`active|disabled`), must_change_password, session_version, failed_login_count, locked_until, last_login_at
- **user_roles**: user_id, role — PK(user_id, role)
- **password_reset_tokens**: id, user_id, token_hash, expires_at, used_at
- **company_settings**: key (PK), value JSON — typed accessor in `settings/service.ts` with defaults (see §10)
- **audit_logs**: id, actor_user_id, action, entity_type, entity_id, summary, diff JSON, ip, user_agent, at
- **notifications**: id, user_id, type, title, body, link, read_at, created_at
- **job_runs**: id, job, run_key (e.g. `accrual:2026-10`), status, started_at, finished_at, detail — unique(job, run_key) for idempotency
- **files**: id, storage_name, original_name, mime, size, sha256, uploaded_by, created_at
- **announcements**: id, title, body, pinned, publish_at, expires_at, created_by

### 4.2 Core HR

- **departments**: id, name, code, head_employee_id, parent_id, archived
- **designations**: id, name, level, archived
- **employees**: id, user_id (unique, nullable), employee_code (unique), first_name, last_name, display_name, work_email, personal_email, phone, date_of_birth, gender, marital_status, address JSON, emergency_contact JSON, department_id, designation_id, reporting_manager_id, employment_type (`full_time|part_time|contract|intern`), work_location, date_of_joining, probation_end_date, confirmation_date, notice_period_days, status (`active|on_notice|exited`), resignation_date, last_working_date, exit_reason, shift_id, bank_name, bank_account_enc, bank_ifsc, id_numbers_enc JSON, photo_file_id
- **employee_documents**: id, employee_id, file_id, category (`offer_letter|id_proof|address_proof|education|experience|contract|other`), title, uploaded_by
- **employee_events**: id, employee_id, type (`joined|confirmed|promoted|transferred|manager_changed|salary_revised|resigned|exited|rehired`), effective_date, from JSON, to JSON, note, created_by — job history timeline
- **checklist_templates**: id, kind (`onboarding|offboarding`), name, items JSON
- **employee_checklists**: id, employee_id, template_id, kind, items JSON (label, owner role, done_by, done_at), status

### 4.3 Attendance

- **shifts**: id, name, start_time, end_time, break_minutes, grace_minutes, half_day_minutes, full_day_minutes, weekly_offs JSON (e.g. `[0,6]`), attendance_mode (`punch|auto`), auto_clock_out_time, archived
- **attendance_punches**: id, employee_id, at (UTC), direction (`in|out`), work_mode (`office|remote`), source (`web|admin|regularization|auto`), ip, note
- **attendance_days**: employee_id, date — PK; status (`present|half_day|absent|on_leave|half_leave|holiday|weekly_off|not_joined|exited`), first_in, last_out, worked_minutes, late_minutes, early_minutes, overtime_minutes, off_day_worked (bool), leave_request_id, locked (bool, set by payroll approval), computed_at, override_status, override_by, override_note
- **regularization_requests**: id, employee_id, date, requested_in, requested_out, reason, status (`pending|approved|rejected|withdrawn`), approver_id, decided_at, decision_note

### 4.4 Timesheets

- **clients**: id, name, code, archived
- **projects**: id, client_id (nullable = internal), code, name, billable_default, status (`active|on_hold|closed`), start_date, end_date, budget_hours, manager_employee_id
- **project_members**: project_id, employee_id, role, active — PK(project_id, employee_id)
- **task_categories**: id, name, billable_default, archived
- **timesheets**: id, employee_id, week_start (Monday), status (`draft|submitted|approved|rejected`), submitted_at, approver_id, decided_at, decision_note — unique(employee_id, week_start)
- **timesheet_entries**: id, timesheet_id, project_id, task_category_id, date, minutes, billable, notes
- **running_timers**: employee_id (PK), project_id, task_category_id, notes, started_at

### 4.5 Leave, holidays, comp-off

- **leave_types**: id, code (unique), name, color, paid (bool), is_lop (bool — unpaid counts as loss of pay), accrual (`upfront|monthly|none`), annual_quota, carry_forward_max, encashable, allow_half_day, allow_negative, max_consecutive_days, min_notice_days, attachment_after_days, count_weekends (sandwich), applicable_employment_types JSON, is_comp_off (bool, system type), archived
- **leave_ledger**: id, employee_id, leave_type_id, year, date, delta (days, ±0.5 granularity), kind (`grant|accrual|carry_forward|lapse|taken|cancelled|adjustment|comp_off_credit|comp_off_lapse|encashment|opening`), ref_type, ref_id, note, created_by. Balance = SUM(delta) per employee/type/year.
- **leave_requests**: id, employee_id, leave_type_id, start_date, end_date, start_half (`full|first_half|second_half`), end_half, days, reason, attachment_file_id, status (`pending|approved|rejected|cancelled|withdrawn`), approver_id, decided_at, decision_note, applied_by (self or admin on behalf)
- **holidays**: id, year, date, name, type (`fixed|optional`) — unique(year, date)
- **holiday_year_config**: year (PK), optional_allowed
- **holiday_selections**: employee_id, holiday_id — PK
- **comp_off_claims**: id, employee_id, worked_date, worked_minutes (snapshot from attendance), days_requested (0.5 | 1), reason, status (`pending|approved|rejected|withdrawn`), approver_id, decided_at, decision_note, resolution (`leave|payout`)
- **comp_off_lots**: id, employee_id, claim_id, days, remaining, earned_on, expires_on, status (`active|consumed|expired|paid_out`)
- **comp_off_consumptions**: lot_id, leave_request_id, days

### 4.6 Payroll

- **salary_components**: id, code (unique, `^[A-Z][A-Z0-9_]*$`), name, kind (`earning|deduction|employer_contribution|reimbursement`), calc (`fixed|percent|formula|balance|input`), default_value (paise for fixed), percent_of (component code), percent (basis points), formula, prorate (bool), round (`none|nearest|up|down`), show_on_payslip, taxable_label (free-text flag for reporting), sort_order, archived
- **salary_structures**: id, name, description, archived
- **salary_structure_components**: structure_id, component_id, calc override fields (nullable = use component defaults), sort_order
- **employee_salaries**: id, employee_id, effective_from (must be 1st of a month), annual_ctc (paise), structure_id, overrides JSON (component_code → value/formula), reason, created_by, approved_by — history; the effective row for a month = latest effective_from ≤ month start
- **payroll_runs**: id, period (`YYYY-MM`, unique for regular runs), type (`regular|off_cycle`), status (`draft|computed|approved|released|paid|cancelled`), computed_by, computed_at, approved_by, approved_at, released_at, paid_at, payment_ref, notes
- **payroll_inputs**: id, run_id, employee_id, component_id, amount (paise), note, source (`manual|claim|loan|comp_off|arrear|encashment`), source_id
- **payslips**: id, run_id, employee_id, status (`ok|hold|excluded`), snapshot JSON (name, code, designation, department, DOJ, bank masked, pay basis), total_days, working_days, paid_days, lop_days, gross_earnings, total_deductions, employer_contributions, reimbursements, net_pay, released_at, emailed_at, pdf_file_id, pdf_sha256, verification_code (unique, nullable until release), signed (bool) — unique(run_id, employee_id)
- **payslip_verifications**: id, payslip_id, ip, user_agent, amount_checked (bool), matched (bool, nullable), at
- **payslip_lines**: id, payslip_id, component_code, component_name, kind, amount, rate_amount, explanation (e.g. `50000 × 28/30`), sort_order
- **loans**: id, employee_id, type (`loan|advance`), principal, emi, start_period, status (`active|closed|paused`), note
- **loan_repayments**: id, loan_id, payslip_id, period, amount
- **expense_claims**: id, employee_id, category, claim_date, amount, description, receipt_file_id, status (`draft|submitted|approved|rejected|paid`), approver_id, approved_at, finance_by, paid_run_id, decision_note

## 5. Module behaviour

### 5.1 Core HR

- Employee create wizard: basic → job → personal → bank → login (optionally create user + roles, sends invite / temp password). Employee code auto-increments (`PV` + 4 digits, prefix configurable).
- Employee profile page with tabs: Overview, Job, Personal, Bank & IDs, Documents, Salary (payroll perms), Attendance, Leave, Timesheets, History, Checklists.
- Every job-affecting change (department, designation, manager, salary) creates an `employee_events` row.
- Directory (all employees): search, filter by department, contact card. Org chart built from reporting lines.
- Bulk import from CSV with dry-run preview, per-row validation errors, then commit.
- Exit flow: record resignation → status `on_notice` → last working date → offboarding checklist → nightly job on LWD+1 sets `exited`, disables user, bumps session version; F&F prompts in next payroll run (leave encashment for encashable types, pending claims, loan balance recovery).
- Onboarding checklist instantiated on employee creation from default template.
- Self-service profile: employee can edit personal contact fields; bank/ID changes create a change request requiring HR approval (audited).

### 5.2 Attendance

- **Punch**: dashboard widget + `/me/attendance` — Clock in / Clock out with work mode (office/remote). Multiple punches per day allowed; worked time = sum of in→out pairs. Clock state derived from last punch.
- **Daily computation** (`computeAttendanceDay(employee, date)`, pure + tested), status precedence:
  1. Before joining / after last working date → `not_joined` / `exited`.
  2. Approved full-day leave → `on_leave` (half-day leave → `half_leave` combined with worked half).
  3. Fixed holiday, or optional holiday the employee selected → `holiday`.
  4. Weekly off per shift → `weekly_off`.
  5. Otherwise by worked minutes: ≥ `full_day_minutes` → `present`; ≥ `half_day_minutes` → `half_day`; else `absent`.
  - For `attendance_mode = auto`: a working day with no leave counts `present` regardless of punches (punches still recorded for hours).
  - On `holiday`/`weekly_off` with worked minutes > 0 → `off_day_worked = true` (comp-off eligibility).
  - Late minutes = first_in − (shift start + grace); early = shift end − last_out; overtime = worked − full_day_minutes (on working days) or all worked (on off days).
  - Admin override sets `override_status` with note; override wins.
- Recomputed on: punch, regularization approval, leave approve/cancel, holiday change, shift change, and nightly for yesterday.
- **Nightly job** (`attendance:close-day`): auto clock-out open sessions at shift `auto_clock_out_time` (source `auto`, flagged), compute previous day for all active employees.
- **Regularization**: employee requests corrected in/out for a past date (within `regularization_window_days`, default 30); approver approval inserts `regularization` punches and recomputes.
- **Locking**: when a payroll run is approved, all `attendance_days` in that period are locked; further changes require the run to be reverted.
- Admin views: today board (who's in, remote, late, absent, on leave), muster roll grid (employees × days with status codes P/HD/A/L/H/WO/CO), exceptions list (missing out punch, late).

### 5.3 Timesheets

- Weekly grid (Mon–Sun): rows = project × task category, columns = days, cells = hours (0.25 h steps). Holidays, weekly offs and approved leave shown in column headers. Attendance worked hours shown per day as a reference row; variance > 1 h highlighted.
- Running timer: start/stop on a project; stop adds minutes to that day's entry.
- Only projects where the employee is an active member (plus internal projects open to all).
- Submit locks the week; reporting manager approves or rejects with note (rejected → editable draft).
- Validation: max 24 h/day; entries on a full-day approved leave day warn (not block); cannot submit future weeks.
- Weekly reminder job (Friday) notifies employees with unsubmitted current week; Monday job notifies managers of pending approvals.
- Reports: utilization % (logged hours ÷ available hours from attendance calendar), billable % (billable ÷ logged), hours by project/client/employee/category, budget burn per project, missing timesheets.

### 5.4 Leave & holidays

- **Leave types** fully configurable (see §4.5). Seeded: CL (Casual), SL (Sick), LWP (Leave Without Pay, `is_lop`), CO (Comp-off, `is_comp_off`, system-managed, quota 0).
- **Balances** from `leave_ledger`. Leave year = calendar year by default (`leave_year_start_month` setting).
  - `upfront`: `grant` of annual_quota on year start (pro-rated by months remaining for mid-year joiners, rounded to 0.5).
  - `monthly`: `accrual` of annual_quota/12 on 1st of each month (job `leave:accrue`).
  - Year-end job (`leave:year-end`): carry forward min(balance, carry_forward_max) as `carry_forward` into next year; remainder `lapse`.
- **Day counting** (`countLeaveDays`, pure + tested): inclusive dates, excludes weekly offs and holidays applicable to the employee unless `count_weekends` (sandwich); half-day start/end subtract 0.5.
- **Apply** validations: balance sufficient unless `allow_negative`; max consecutive days; min notice days (sick exempt by config); overlapping requests rejected; attachment required when days > `attachment_after_days`; half-day allowed only if type allows; not before joining / after LWD.
- **Approval**: pending → approved/rejected by reporting manager (or HR). Approve writes `taken` ledger debit and recomputes attendance for the range. Cancel of approved leave (future dates by employee; any by HR) writes `cancelled` credit reversal and recomputes attendance.
- HR can apply on behalf, and post `adjustment` ledger entries with a mandatory note.
- **Holidays**: yearly calendar editor (fixed/optional), CSV import, copy from previous year. Employees pick optional holidays up to `optional_allowed` per year; picks are locked once the date has passed. Selected optional holidays behave like fixed holidays for that employee everywhere (attendance, leave counting, timesheets, payroll).
- **Team leave calendar**: month view of team/department leaves + holidays.

### 5.5 Comp-off (integrated)

Flow:
1. Employee works on a weekly off or a holiday that applies to them → nightly/instant attendance computation sets `off_day_worked = true` with `worked_minutes`.
2. System notifies the employee: "You worked on Sat 12 Sep — claim comp-off". The attendance page and dashboard show a **Claim comp-off** action for eligible days.
3. Employee submits a claim within `compoff_claim_window_days` (default 30). Days requested: `1` if worked ≥ `compoff_full_day_minutes` (default = shift full-day), `0.5` if ≥ `compoff_half_day_minutes` (default = shift half-day); below that → not eligible. Timesheet entries for that date are shown as supporting evidence.
4. Reporting manager (or HR with `compoff.approve`) approves or rejects.
5. Approval creates a `comp_off_lots` row (`expires_on = worked_date + compoff_expiry_days`, default 90) and a `comp_off_credit` ledger entry for the CO leave type.
6. Employee applies leave of type CO like any other leave; approval consumes lots **FIFO by earliest expiry** (`comp_off_consumptions`) and writes the `taken` ledger debit. Cancellation restores lot `remaining`.
7. Nightly job `compoff:expire` lapses remaining days of expired lots (`comp_off_lapse` ledger entry, lot `expired`) and warns employees 7 days before expiry.
8. Optional payout (`compoff_payout_enabled`, default off): approver may resolve a claim as **payout** instead of leave → creates a `payroll_inputs` row (source `comp_off`) for the next draft run using component `COMP_OFF_PAY` (default formula `BASIC_RATE / TOTAL_DAYS * COMP_OFF_DAYS`).

Guards: one claim per employee per worked date; cannot claim a date where attendance is not `off_day_worked`; claims on a locked (payroll-approved) period still allowed because credit is leave, not pay; HR can grant manual comp-off (adjustment with note).

### 5.6 Payroll

#### Components & formula engine

- Calc types:
  - `fixed` — amount from structure/override (monthly).
  - `percent` — `percent` of another component's rate (e.g. HRA = 40% of BASIC).
  - `formula` — expression in the formula language.
  - `balance` — `MONTHLY_CTC − Σ(other earning rates) − Σ(employer_contribution rates)`; at most one per structure; evaluated last.
  - `input` — value supplied per run via `payroll_inputs` (bonus, incentive, one-time deductions).
- **Formula language** (hand-written lexer + Pratt parser, no `eval`/`Function`):
  - Numbers, identifiers, `+ - * / %`, parentheses, comparisons `< <= > >= == !=`, `and`, `or`, `not`.
  - Functions: `min`, `max`, `round(x, digits?)`, `floor`, `ceil`, `abs`, `if(cond, a, b)`.
  - Variables:
    - `CTC` (annual), `MONTHLY_CTC`
    - `TOTAL_DAYS` (per proration basis), `WORKING_DAYS`, `PAID_DAYS`, `LOP_DAYS`, `PRESENT_DAYS`
    - `OT_HOURS`, `OFF_DAY_WORKED_DAYS`, `COMP_OFF_DAYS`
    - `YEARS_OF_SERVICE`, `MONTHS_OF_SERVICE`
    - `<CODE>` = prorated (earned) amount of a component; `<CODE>_RATE` = full-month rate
  - Values in formulas are in **currency major units** (rupees); engine converts to paise and rounds per component.
  - Dependency graph from identifiers → topological order; cycles and unknown identifiers are validation errors at component save time and at run time.
  - Max expression length 500 chars; evaluation errors (divide by zero) produce a run error for that employee, not a crash.
- Formula editor in UI shows live preview against a sample employee.

#### Salary assignment

- Structure = ordered component list with default values/formulas. Employee salary row = annual CTC + structure + per-component overrides, effective from the 1st of a month.
- Salary preview (monthly and annual breakdown) shown before save.
- Revision history; each revision creates an `employee_events` `salary_revised` entry.

#### Payroll run

1. **Create** draft run for period `YYYY-MM` (only one regular run per period; previous period must be approved first, except the very first run).
2. Draft collects inputs: manual one-time inputs (with CSV import), approved-but-unpaid expense claims (claim date ≤ period end), active loan EMIs (capped at outstanding balance), comp-off payouts, arrears (below), exit settlement lines (leave encashment for exited employees' encashable balances).
3. **Compute** (can repeat while draft/computed): for each employee active any day in the period with an effective salary:
   - Attendance for the whole period is recomputed first. A run may be computed before month end: days after today are **projected** — leave/holiday/weekly-off rules apply, otherwise the day counts as `present`. Recompute after month end picks up actuals.
   - `TOTAL_DAYS` = calendar days in the period (`payroll_proration_basis = calendar`, default) or the employee's working days (`working`: excludes weekly offs and applicable holidays).
   - `LOP_DAYS` = Σ over days inside the `TOTAL_DAYS` basis: `absent` → 1; `half_day` (worked half, no leave) → 0.5; `on_leave` with an `is_lop` type → 1 (0.5 for a half-day LOP leave); `not_joined` / `exited` → 1. Admin overrides win.
   - `PAID_DAYS = TOTAL_DAYS − LOP_DAYS` (never below 0).
   - Evaluate components in dependency order; prorate those with `prorate = true`: `amount = rate × PAID_DAYS / TOTAL_DAYS`.
   - Gross = Σ earnings + reimbursements; deductions = Σ deductions (net cannot go below zero — deductions are capped and the excess flagged as a warning); net = gross − deductions; employer cost = gross + employer contributions.
   - Write `payslips` + `payslip_lines` with explanations; collect warnings (missing bank details, negative net capped, zero paid days, salary missing).
4. **Review** screen: register table, per-employee drill-down, variance vs previous month (flag > 10% change), warnings list, per-employee **hold** / exclude.
5. **Approve** (`payroll.approve`, must differ from `computed_by`): freezes run, locks attendance for the period, marks claims `paid` (linked to run), writes loan repayments, consumes comp-off payout inputs.
6. **Release** (`payroll.release`): payslips (except held) become visible to employees; PDFs frozen (and signed if configured), verification codes issued, notification + email per `payslip_email_attachment` setting. Held payslips can be released individually later.
7. **Mark paid**: payment date + reference; bank transfer file export (XLSX/CSV: employee code, name, bank, account, IFSC, amount).
- **Revert**: an approved (not released) run can be reverted to computed by `super_admin` with a note (unlocks attendance, reverses loan repayments/claim status). Released runs are immutable; corrections flow through next period's inputs.
- **Arrears**: when a salary revision is saved with `effective_from` earlier than the latest approved period, the next draft run recomputes each affected approved period using its stored attendance summary with the new salary, and adds per-component difference lines labelled `Arrears – <component> (<period>)` as payroll inputs (source `arrear`).
- **Off-cycle run** type for bonuses/settlements outside the monthly cycle (inputs only, no salary components).

#### Payslips

- **Layout** (`@react-pdf/renderer`, A4): logo, company legal name/address, "Payslip for <Month YYYY>", employee snapshot (code, name, designation, department, DOJ, bank masked), days summary (total/paid/LOP), earnings and deductions tables side by side, reimbursements, net pay with amount in words, YTD column (fiscal-year to date per component), footer note from settings, verification block (QR + code), and the line *"This is a computer-generated payslip and does not require a signature."*
- **Frozen at release**: when a payslip is released, its PDF is rendered once, stored as a file (`payslips.pdf_file_id`) and its SHA-256 recorded (`payslips.pdf_sha256`). All later downloads serve the stored file byte-for-byte; it is never regenerated. Corrections go through the next period, never by editing a released payslip. Before release (review stage) admins see an unstored "DRAFT"-watermarked preview.
- **Verification (default on)**: each released payslip gets a random 12-character `verification_code` (unique). The PDF carries a QR code to `${APP_URL}/verify/<code>`. The public verify page (no login, rate-limited, `noindex`) shows company name, masked employee name (`Y*** S***`), period and issue date, and "Genuine payslip". Net pay is **not** displayed; the verifier may type the net pay printed on the document and the page answers match / no match. Every verification lookup is logged (IP, time) and visible to payroll admins.
- **Signatory image (optional, off)**: setting to upload an authorised-signatory signature image + name/designation, rendered in place of the "does not require a signature" line.
- **Digital signature (optional, auto-on when configured)**: if `PAYSLIP_SIGN_P12_PATH` + `PAYSLIP_SIGN_P12_PASSWORD` are set, the stored PDF is signed at release with a PAdES/PKCS#7 detached signature (`@signpdf/signpdf`) using the organisation's document-signing certificate, so PDF readers show a valid-signature, tamper-evident status. The hash is taken after signing. Without a certificate this step is skipped.
- **Email delivery**: default = notification email with a login link (no attachment). Optional setting `payslip_email_attachment = protected`: attaches a copy encrypted with a password (format setting, default date of birth `DDMMYYYY`; falls back to employee code if DOB missing), and the email states the password format. The encrypted copy is derived from the stored PDF and is not signed (encryption would invalidate a signature); the stored original stays the canonical record.
- Employee: `/me/payslips` list + view + download; annual YTD statement (generated on demand, marked as a statement, not a payslip).

#### Loans & claims

- Loans/advances: payroll admin creates; EMI auto-deducted each run until repaid; pause/close; statement.
- Expense claims: employee submits with receipt → manager approves → payroll (`claim.pay`) includes in next run as `reimbursement` → marked paid on run approval.

### 5.7 Approvals inbox

Single `/approvals` page with tabs: Leave, Comp-off, Regularization, Timesheets, Claims, Profile changes. Each row: requester, summary, dates, balance/context, approve/reject with note, bulk approve. Counts shown in sidebar badge.

### 5.8 Notifications

In-app bell (unread count, mark all read) + email when SMTP configured (per-user preference to opt out of non-critical email). Events:

- Leave: submitted (→ approver), approved/rejected (→ employee), cancelled
- Comp-off: eligible day detected, claim submitted/approved/rejected, lot expiring in 7 days, expired
- Regularization submitted/decided
- Timesheet reminder, submitted, approved/rejected
- Claim submitted/decided/paid
- Payslip released (email = login link, or password-protected PDF when enabled)
- Account: password reset, new account invite
- Announcements published
- Birthdays/work anniversaries (dashboard widget only)

### 5.9 Dashboards

- **Employee**: clock-in widget + today's worked time, leave balances (incl. comp-off with nearest expiry), this week's timesheet progress, latest payslip, upcoming holidays, pending requests, comp-off claim prompts, announcements, team out today.
- **Manager**: + pending approvals, team today (in/remote/leave/absent), team utilization this month, team leave calendar preview.
- **HR / Admin**: headcount + trend, joiners/leavers this month, attendance today donut, leaves today, open exits/checklists, payroll status for current month, upcoming birthdays/anniversaries.

### 5.10 Reports & exports

All reports: filters (period, department, employee, project), on-screen table + chart where useful, export XLSX/CSV (`/api/exports/[report]`, permission-checked, audited).

| Area | Reports |
|---|---|
| HR | Headcount, joiners & leavers, attrition, employee master export, birthdays/anniversaries |
| Attendance | Muster roll, daily status, late/early, overtime, remote vs office, off-day work |
| Leave | Balances, leave register, utilization by type, comp-off lots & expiries |
| Timesheets | Utilization, billable %, project hours, client hours, budget burn, missing timesheets |
| Payroll | Payroll register, component summary, bank advice, employer cost by department, YTD statement, loan register, claims register, salary revision history |

### 5.11 Settings

Company profile (legal name, display name, address, logo), locale (timezone, currency, date format, fiscal year start month — default April), employee code prefix, default shift, leave year start month, attendance (default mode, regularization window), comp-off (enabled, half/full-day minutes, claim window, expiry days, payout enabled), payroll (proration basis `calendar|working`, pay day, payslip footer, variance threshold, payslip signatory image/name/designation, payslip email attachment `none|protected`, PDF password format), security (lockout attempts, lockout minutes), roles (assign roles to users), audit log viewer (filter by actor/entity/date), SMTP status (read-only, from env; send test email).

## 6. UI / UX

- **Shell**: collapsible left sidebar grouped by area (Home · My Space · Team · Organization · Time · Leave · Payroll · Reports · Settings), items filtered by permission, approval count badges. Top bar: breadcrumb, command palette (Ctrl/Cmd+K: navigate, find employee, quick actions), notification bell, theme toggle, user menu. Mobile: sidebar becomes a drawer, bottom-friendly clock-in button.
- **Brand**: primary `#202f63` navy, secondary `#92b353` green, Plus Jakarta Sans; neutral palette with semantic status colours (success, warning, danger, info) tuned for both themes. Dark mode via `next-themes` + CSS variables.
- **Patterns**: page header (title, description, primary action), filter bar, `DataTable` (sort, search, column visibility, pagination, row actions, empty states), side sheet for quick create/edit, dialog confirmations for destructive/irreversible actions, skeleton loaders, toasts for results, inline field errors, status badges with consistent colours per state.
- **Accessibility**: Radix primitives (focus management, keyboard), visible focus rings, colour contrast AA, labels on all inputs.
- **PWA**: web manifest + icons from `/public/brand`, installable; no offline data.

### Information architecture (routes)

```
/                                   dashboard (role-aware)
/me/attendance  /me/timesheets  /me/timesheets/[week]  /me/leave  /me/comp-off
/me/payslips  /me/payslips/[id]  /me/claims  /me/profile  /me/documents
/approvals  /team  /team/calendar  /notifications  /announcements
/org/employees  /org/employees/new  /org/employees/[id]  /org/directory  /org/chart
/org/departments  /org/designations  /org/import  /org/checklists
/time/attendance  /time/muster  /time/shifts  /time/projects  /time/projects/[id]  /time/clients  /time/categories
/leave/requests  /leave/balances  /leave/types  /leave/holidays  /leave/comp-off
/payroll/runs  /payroll/runs/[id]  /payroll/components  /payroll/structures  /payroll/salaries  /payroll/loans  /payroll/claims
/reports  /reports/[slug]
/settings/company  /settings/attendance  /settings/leave  /settings/payroll  /settings/security  /settings/roles  /settings/audit
/login  /forgot-password  /reset-password/[token]  /change-password
/verify/[code]                      public payslip verification (no auth)
```

## 7. Background jobs

Triggered by OS cron calling `POST /api/cron/<job>` with `CRON_SECRET`; each job is idempotent via `job_runs(job, run_key)`; also runnable from Settings → Jobs by super admin.

| Job | Schedule (IST) | Run key |
|---|---|---|
| `attendance:close-day` | daily 00:30 | date |
| `compoff:expire` | daily 01:00 | date |
| `employee:lifecycle` (exits, probation reminders) | daily 01:15 | date |
| `leave:accrue` | 1st of month 00:45 | YYYY-MM |
| `leave:year-end` | 1st of leave year 00:50 | year |
| `timesheet:remind` | Fri 16:00, Mon 10:00 | week+kind |
| `notifications:digest` (optional email digest) | daily 09:00 | date |

## 8. Legacy data migration

`scripts/migrate-legacy.ts --from <old.db> --to <new.db>` (never mutates the old file):

1. Create new DB, run all migrations, seed defaults (settings, roles, default shift `General 09:30–18:30`, weekly offs Sat/Sun, leave types CL/SL/LWP/CO, components & a default structure).
2. Leave type params from old `leave_policy` (CL quota = `casual_per_year`, carry = `carry_fwd_max`, max consecutive = `max_consecutive_days`; SL quota = `sick_per_year`, no carry; LWP `is_lop`). `holiday_year_config.optional_allowed` from `optional_holidays_allowed`.
3. Users: copy email, password hash, must_change_password, active→status. `role=admin` → `super_admin` with no employee record. `role=employee` → `employee` role + employee record (code `PV0001…` ordered by id, name split into first/last, DOJ = `joined_date`, default shift).
4. Holidays and optional selections copied (user id → employee id).
5. Ledger per employee per policy year: `grant` of CL/SL quotas; `carry_forward` from `user_year_balance.carry_forward_cl`.
6. Leaves: `planned|taken` → `approved` request + `taken` ledger debit (LWP gets no balance debit but is recorded); `cancelled` → `cancelled` request, no ledger. `days` preserved as recorded.
7. Attendance for past leave dates computed so muster roll is consistent (attendance mode of migrated employees = `auto` to avoid mass-absent history; admin can switch to `punch` from a go-live date).
8. **Verification**: for every employee/year compare old computed balance (old `getUserBalance` logic re-implemented in the script) to new ledger balances for CL, SL, unpaid used, optional used; any mismatch → non-zero exit with report.
9. Print summary counts.

Cutover runbook in `DEPLOY.md`: stop app → `sqlite3 .backup` old DB → run migration to new file → verify → point `DB_FILE` to new file → start → smoke test.

## 9. Error handling & observability

- Server actions return typed results; forms show field errors; unexpected errors are logged with a request id and shown as a generic toast with that id.
- `error.tsx` / `not-found.tsx` boundaries per route group; `global-error.tsx`.
- Domain errors (`DomainError` with code + message) for rule violations (insufficient balance, overlapping leave, locked period, maker-checker violation).
- `pino` JSON logs to stdout (pm2 captures), with user id and action name.
- `/api/health`: DB reachable, migrations current, disk writable → 200/503.
- Payroll compute collects per-employee errors instead of failing the whole run.

## 10. Configuration

New environment variables (documented in `.env.example`):

```
AUTH_SECRET, AUTH_TRUST_HOST, DB_FILE, ALLOWED_EMAIL_DOMAIN   (existing)
APP_URL                     https://holidays.pvcon.in (links in emails)
DATA_ENCRYPTION_KEY         base64 32 bytes
CRON_SECRET                 random string
UPLOAD_DIR                  ./data/uploads
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM          (optional)
PAYSLIP_SIGN_P12_PATH, PAYSLIP_SIGN_P12_PASSWORD                (optional, enables PDF signing)
LOG_LEVEL                   info
```

Company-level settings live in `company_settings` (§5.11), with code defaults.

## 11. Testing strategy

- **Unit (Vitest)** — pure logic, high coverage:
  - date utilities (IST-safe), leave day counting (half days, sandwich, holidays, optional picks)
  - attendance day computation (every precedence branch, auto mode, overtime, off-day work)
  - comp-off eligibility, FIFO consumption, expiry
  - formula lexer/parser/evaluator (precedence, functions, errors, injection attempts), dependency graph/cycles
  - payroll calculator (proration, balance component, rounding, capping, arrears), money & amount-in-words
  - RBAC `can()` matrix and scope resolution
- **Integration (Vitest + in-memory SQLite with real migrations)** — services end to end: apply → approve leave → ledger + attendance; punch → compute → comp-off claim → approve → CO leave; payroll draft → compute → approve (maker-checker) → release; legacy migration against a fixture old DB with balance verification.
- **E2E (Playwright)** against a seeded dev server: login + forced password change; employee clock-in/out; leave apply → manager approve; timesheet submit → approve; comp-off claim flow; payroll run full lifecycle → employee downloads payslip PDF; RBAC negative checks (employee cannot open `/payroll`).
- CI script `npm run verify` = typecheck + lint + unit + integration + build.

## 12. Delivery phases

Each phase ends with passing tests, a working app and a commit on `feat/hrms-overhaul`.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Foundation** | Dependencies, `src/server` layout, new schema skeleton (system + core users/roles), settings, RBAC, `safeAction`, audit log, notifications table + bell, files, crypto, logger, sidebar shell, design system, dark mode, command palette, auth hardening (lockout, session version, reset), test infra | Login works on new shell; RBAC unit tests; `npm run verify` green |
| **1. Core HR** | Departments, designations, employees CRUD + wizard, profile tabs, documents, events timeline, directory, org chart, CSV import, onboarding/offboarding checklists, exit flow, profile change requests | HR can onboard an employee with login; employee sees profile |
| **2. Leave, holidays, migration** | Leave types, ledger, accrual/year-end jobs, apply/approve/cancel, balances, adjustments, holidays + optional picks, team calendar, approvals inbox (leave), legacy migration script + verification | Migrated data balances verified; leave flow e2e |
| **3. Attendance + comp-off** | Shifts, punches, day computation, nightly close-day job, regularization, admin today board, muster roll, locks, comp-off claims/lots/FIFO/expiry | Punch → attendance → comp-off → CO leave works e2e |
| **4. Timesheets** | Clients, projects, members, categories, weekly grid, timer, submit/approve, reminders, attendance reconciliation, utilization reports | Timesheet flow e2e |
| **5. Payroll** | Components, formula engine + editor, structures, employee salaries + revisions, runs (inputs, compute, review, maker-checker approve, release, paid, revert), arrears, loans, claims, comp-off payout, exit settlement, payslip PDF, bank export, email | Full run lifecycle e2e, payslip PDF downloads |
| **6. Insight & polish** | Dashboards per role, reports centre + exports, announcements, email notifications & digest, PWA, accessibility pass, performance pass, DEPLOY.md/README rewrite, cron setup, backups incl. uploads | All reports export; docs updated; full e2e suite green |

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| SQLite write contention | Single pm2 instance, WAL, short transactions; payroll compute batched per employee within one transaction; fine for < 200 staff |
| Payroll correctness | Pure calculator with exhaustive unit tests, explanations on every line, variance checks, maker-checker, immutable released payslips |
| Migration data loss | Old DB never mutated; balance verification gate; backup-first runbook |
| Formula injection | Own parser, whitelist of functions/identifiers, no `eval`, length limits, tests with malicious inputs |
| Scope size | Phased delivery with working software after each phase |
| Next.js 16 API changes | Consult `node_modules/next/dist/docs` for conventions (e.g. `proxy.ts` replacing `middleware.ts`, async request APIs) during implementation |
