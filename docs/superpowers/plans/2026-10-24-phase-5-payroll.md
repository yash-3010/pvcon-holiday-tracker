# Phase 5 — Payroll and Payslips Implementation Plan

> **For agentic workers:** Execute task by task with TDD (failing test → implementation → passing test → commit).
> Like the earlier plans, this fixes **contracts** (files, signatures, rules, test cases); the executor writes the code
> in the style of the existing modules. Record any deviation from the spec in Task 24 and the roadmap.

**Goal:** Generic monthly payroll:
- salary components with a safe formula language, structures, and salary revisions;
- payroll runs (draft → computed → approved → released → paid) with maker-checker approval, attendance-based
  proration and loss of pay, inputs, loans, expense claims, comp-off payouts, arrears and exit encashment;
- frozen, verifiable payslip PDFs (QR + public verify page, optional signing and password-protected email copies);
- bank advice and register exports.

**Architecture:**
- Pure, isomorphic code in `src/lib/payroll/*`:
  - the formula engine `formula/{lexer,parser,evaluate,graph}.ts`;
  - the calculator `calculate.ts`;
  - LOP day rules `days.ts`;
  - amount in words in `src/lib/money.ts`.
- Tables in `src/server/db/schema/payroll.ts`.
- Services in `src/server/modules/payroll/*`:
  - `components`, `structures`, `salaries`, `period` (attendance summary), `runs`, `inputs`, `arrears`, `loans`, `claims`,
    `payslips` (PDF, verification), `exports`.
- PDF rendering (`@react-pdf/renderer`), QR (`qrcode`), signing (`@signpdf/*` 3.3.0) and encryption (`@cantoo/pdf-lib`)
  are async. They run in `prepare` / `after`, never inside a transaction.

**Spec:** `docs/superpowers/specs/2026-09-24-hrms-overhaul-design.md` §4.6, §5.6 (all), §5.7 (Claims tab), §5.8 (payslip
and claim notifications), §5.11 (payroll settings).

**Prerequisite:** Phase 4 is complete. Reuse:
- money: `toMinor`, `toMajor`, `roundMinor`, `formatMoney` (`src/lib/money.ts`);
- dates: `monthRange`, `eachDay`, `daysInMonth`, `addMonths`, `dayOfWeek`;
- attendance: `fillMissingAttendance`, `recomputeAttendance`, `attendance_days.locked`, `shiftForEmployee`;
- leave: `balancesFor`, leave types `isLop`/`encashable`;
- comp-off claims with `resolution = 'payout'`;
- `approvals/routing.ts`, `recordEmployeeEvent`, `saveUpload`, `canAccessFile` resolvers, `sendEmail`/`renderEmail`,
  `notify`, `createRateLimiter`.

## Global Constraints

- Money is integer paise everywhere. Formulas compute in rupees; the engine converts to paise and rounds per component.
- No `eval` / `new Function`. The formula parser is hand-written, the expression length ≤ 500, and only whitelisted
  identifiers and functions are allowed.
- A salary revision is effective from the 1st of a month. The salary for a month is the latest revision effective on or
  before the month's first day.
- Released payslips are immutable. Their PDF is stored once with a SHA-256 and served byte-for-byte. Corrections go
  through the next period.
- Maker-checker: the approver of a run must differ from the person who last computed it.
- Services are synchronous and take `db` first. Async rendering happens outside transactions. Every mutation is audited.

## Review Focus

1. **Formula safety and determinism**: malicious inputs, cycles, unknown identifiers, divide by zero. Tests: Task 1.
2. **Calculator correctness**:
   - rate vs earned and proration;
   - `balance` last and never negative;
   - rounding;
   - net never below zero (deductions capped, with a warning);
   - explanations.
   Tests: Task 4.
3. **Loss-of-pay days**: calendar vs working basis, half days, LOP leave, not joined/exited, overrides, projection of
   future days. Tests: Task 5.
4. **Run integrity**:
   - one regular run per period, in order;
   - approval locks attendance, pays claims, writes loan repayments, marks comp-off payouts;
   - revert undoes exactly that;
   - released runs never change.
   Tests: Tasks 9–11.
5. **Payslip trust**: the stored PDF hash matches downloads; the verify page shows no net pay, compares a typed one
   and logs lookups. Tests: Tasks 14–15.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/payroll/formula/{lexer,parser,evaluate,graph}.ts` | Formula language: tokens, Pratt parser → AST, evaluator, dependency graph |
| `src/lib/payroll/constants.ts` | Component kinds/calcs, run/payslip/loan/claim statuses, labels, `VARIABLES` |
| `src/lib/payroll/calculate.ts` | `calculatePayslip(input)` |
| `src/lib/payroll/days.ts` | Pure LOP/paid-day rules over a day list |
| `src/lib/money.ts` | + `amountInWords(minor)` (Indian grouping) |
| `src/lib/validation/payroll.ts` | zod: component, structure, salary, run, input, loan, claim, settings |
| `src/server/db/schema/payroll.ts` | All payroll tables; + `comp_off_claims.paid_run_id` |
| `src/server/modules/payroll/components.ts`, `structures.ts` | CRUD, validation through the graph, seeds |
| `src/server/modules/payroll/salaries.ts` | Revisions, effective salary, preview |
| `src/server/modules/payroll/period.ts` | Attendance summary for a period (with projection) and formula variables |
| `src/server/modules/payroll/runs.ts`, `inputs.ts`, `arrears.ts` | Run lifecycle, system inputs, arrears |
| `src/server/modules/payroll/loans.ts`, `claims.ts` | Loans and expense claims |
| `src/server/modules/payroll/payslip-pdf.tsx`, `payslips.ts`, `verify.ts` | PDF, release, verification |
| `src/server/modules/payroll/exports.ts` | Bank advice and register (exceljs) |
| `src/server/modules/payroll/queries.ts` | Read models |
| `src/app/(app)/payroll/*`, `me/payslips/*`, `me/claims/*`, `settings/payroll/*`, `src/app/verify/[code]/*` | UI |
| `src/app/api/payslips/[id]/pdf`, `api/payroll/runs/[id]/export` | Downloads |
| `tests/e2e/payroll.spec.ts` | Run lifecycle → release → download → verify |

---

### Task 1: Formula engine

**Files:** Create `src/lib/payroll/formula/{lexer,parser,evaluate,graph}.ts`, `src/lib/payroll/constants.ts` (variables); Test `tests/unit/lib/payroll-formula.test.ts`

- Lexer:
  - numbers (`12`, `0.5`, `.5`); identifiers `[A-Za-z_][A-Za-z0-9_]*`;
  - operators `+ - * / % ( ) , < <= > >= == !=`; keywords `and`, `or`, `not`;
  - a position on every token; `FormulaError` with position and message for anything else.
- Pratt parser → AST `Num | Ident | Unary(-, not) | Binary | Call(name, args)`:
  - precedence: `or` < `and` < comparisons < `+ -` < `* / %` < unary;
  - functions `min`, `max` (≥ 1 arg), `round(x, digits?)`, `floor`, `ceil`, `abs`, `if(c, a, b)` with arity checks;
  - the input is limited to 500 characters and the nesting depth to 50.
- `evaluate(ast, vars)`:
  - numbers only; booleans are 1/0;
  - `if` evaluates lazily;
  - division or modulo by 0 throws `FormulaError("Division by zero")`;
  - a missing identifier throws;
  - the result must be finite.
- `identifiers(ast)`; `validateFormula(text, known: Set<string>) → { ok } | { ok: false, error, position }`.
- `dependencyOrder(nodes: { code, deps: string[] }[]) → string[]`: topological order (stable by input order), throwing
  on a cycle with the cycle's path.
- **Tests:**
  - precedence and associativity; `if` short-circuit (`if(0, 1/0, 2)` → 2); `round(1.235, 2)`;
  - `not`/`and`/`or`; unknown function/identifier;
  - malicious inputs: `constructor`, `__proto__`, `process.exit()`, `a.b`, `[1]`, string quotes, 501 characters,
    10 000 nested parentheses → each a `FormulaError`, none throws anything else;
  - cycle detection.

- [ ] Commit `feat(payroll): add the formula engine`

### Task 2: Constants, money in words, validation

**Files:** Modify `src/lib/payroll/constants.ts`, `src/lib/money.ts`; Create `src/lib/validation/payroll.ts`; Test `tests/unit/lib/payroll-validation.test.ts`, extend `tests/unit/lib/money.test.ts`

- `COMPONENT_KINDS = [earning, deduction, employer_contribution, reimbursement]`;
  `COMPONENT_CALCS = [fixed, percent, formula, balance, input]`; `ROUND_MODES`.
- `RUN_TYPES = [regular, off_cycle]`; `RUN_STATUSES = [draft, computed, approved, released, paid, cancelled]`;
  `PAYSLIP_STATUSES = [ok, hold, excluded]`; `INPUT_SOURCES = [manual, claim, loan, arrear, encashment]`.
- `LOAN_TYPES = [loan, advance]`, `LOAN_STATUSES = [active, paused, closed]`;
  `CLAIM_STATUSES = [draft, submitted, approved, rejected, paid]`; `CLAIM_CATEGORIES` (travel, meals, internet,
  equipment, training, other).
- `VARIABLES`:
  - `CTC`, `MONTHLY_CTC`;
  - `TOTAL_DAYS`, `WORKING_DAYS`, `PAID_DAYS`, `LOP_DAYS`, `PRESENT_DAYS`;
  - `OT_HOURS`, `OFF_DAY_WORKED_DAYS`, `COMP_OFF_DAYS`, `ENCASH_DAYS`;
  - `YEARS_OF_SERVICE`, `MONTHS_OF_SERVICE`.
- `amountInWords(minor, currency = "INR")`: "Rupees Forty-Two Thousand Five Hundred and Fifty Paise Only", with lakh and
  crore grouping.
- Schemas:
  - `componentSchema`:
    - `code` `^[A-Z][A-Z0-9_]*$` ≤ 30, not a variable name and not ending in `_RATE`; `name`; `kind`; `calc`;
    - calc-specific fields: `defaultValue` (rupees → paise) for fixed, `percentOf` + `percent` (0–100 with two
      decimals → basis points) for percent, `formula` for formula;
    - `prorate`, `round`, `showOnPayslip`, `taxableLabel`.
  - `structureSchema`: `name`, `description`, `components: { componentId, overrides }[]`.
  - `salarySchema`: `employeeId`, `effectiveFrom` (a 1st), `annualCtc` (rupees → paise, > 0), `structureId`,
    `overrides: Record<code, number | string>`, `reason`.
  - `runCreateSchema`: `period`, `type`, `notes`.
  - `inputSchema`: `runId`, `employeeId`, `componentId`, `amount`, `note`.
  - `loanSchema`; `claimSchema`; `payrollSettingsFormSchema`.
- **Tests:** a code that clashes with `PAID_DAYS` or ends in `_RATE`; percent without a base; a salary on the 15th;
  amounts in words for 0, 1 paisa, 1,00,000 and 12,34,56,789.50.

- [ ] Commit `feat(payroll): add payroll constants, validation and amounts in words`

### Task 3: Schema and migration

**Files:** Create `src/server/db/schema/payroll.ts`; Modify `schema/leave.ts` (`comp_off_claims.paid_run_id`), `schema/index.ts`; Generate `0005_payroll`; Test `tests/integration/db/payroll-schema.test.ts`

- Tables per spec §4.6, plus:
  - `employee_salaries.created_at`;
  - `payroll_runs.warnings` JSON;
  - `payslips.salary_id`, `payslips.paid_basis_salary_id` (for arrears), `payslips.warnings` JSON,
    `payslips.variables` JSON (the day summary used);
  - `payslip_lines.source` (component or an input source);
  - `payroll_inputs.label`;
  - `comp_off_claims.paid_run_id`.
- Indexes and constraints:
  - a partial unique index: one regular run per period where status ≠ cancelled;
  - unique (`run_id`, `employee_id`) on payslips; unique `verification_code`;
  - indexes on `payroll_inputs(run_id)`, `loan_repayments(loan_id)`, `expense_claims(employee_id, status)`.
- **Tests:** tables exist; one regular run per period (a cancelled one doesn't count); cascades from runs to payslips,
  lines and inputs.

- [ ] Commit `feat(db): add payroll schema`

### Task 4: The payslip calculator

**Files:** Create `src/lib/payroll/calculate.ts`; Test `tests/unit/lib/payroll-calculate.test.ts`

- Input:
  ```ts
  { annualCtc: Minor;
    components: { code, name, kind, calc, value: Minor | null, percentOf: string | null, percent: number | null /* bp */,
                  formula: string | null, prorate: boolean, round: RoundMode, showOnPayslip: boolean }[];  // structure order, overrides applied
    variables: Record<Variable, number>;            // day summary etc.; PAID_DAYS/TOTAL_DAYS drive proration
    inputs: { code: string; amount: Minor; label: string; source: InputSource }[] }
  ```
- Order: the dependency graph over formula identifiers (`X` and `X_RATE` → X), `percentOf`, and `balance` after every
  earning and employer contribution; unknown identifiers and cycles → `{ errors }`.
- Per component:
  - `rate`:
    - fixed → value; percent → base rate × bp / 10 000; formula → evaluate (rupees) → paise;
    - input → the sum of its manual inputs;
    - balance → MONTHLY_CTC − Σ other earning rates − Σ employer contribution rates. Below 0 is clamped to 0 with a
      warning.
  - `amount` = prorate ? rate × PAID_DAYS / TOTAL_DAYS : rate (TOTAL_DAYS 0 → 0); both are rounded with the
    component's mode.
  - `explanation`:
    - fixed `"50,000.00"`; percent `"40% of BASIC 50,000.00"`; formula `"=<formula>"`;
    - proration appended as `" × 28/30"`.
- Other input lines (sources claim, loan, arrear, encashment, and manual inputs to non-input components) become extra
  lines with their label.
- Totals:
  - gross = earnings + reimbursements; employer = employer contributions;
  - deductions are capped so net ≥ 0: the latest deductions are reduced first, with the warning "Deductions capped at
    gross pay";
  - net = gross − deductions.
- An evaluation error → `{ errors: ["<code>: <message>"] }` with no lines.
- **Tests:**
  - the default structure (BASIC = 50% of MONTHLY_CTC, HRA = 40% of BASIC, SPECIAL balance) for 12 L CTC → 50 000 /
    20 000 / 30 000;
  - 28 of 30 paid days prorates all three;
  - `round` modes;
  - a deduction formula on `BASIC` (earned) vs `BASIC_RATE`;
  - balance clamped at 0;
  - net capping;
  - input components and extra input lines;
  - divide by zero → an error;
  - a cycle → an error.

- [ ] Commit `feat(payroll): add the payslip calculator`

### Task 5: Loss-of-pay days

**Files:** Create `src/lib/payroll/days.ts`; Test `tests/unit/lib/payroll-days.test.ts`

- `summarizeDays(days: PayrollDay[], basis) → { TOTAL_DAYS, WORKING_DAYS, PAID_DAYS, LOP_DAYS, PRESENT_DAYS }`, where
  `PayrollDay = { date, status: AttendanceStatus | "projected", working: boolean, lopLeave: 0 | 0.5 | 1, workedHalf: boolean | null }`.
- Rules (spec §5.6):
  - calendar basis counts every day; working basis counts working days only;
  - LOP: absent 1, half_day 0.5, on_leave with a LOP type 1 (0.5 for a half-day LOP leave), not_joined/exited 1;
  - half_leave: its LOP half plus 0.5 when the other half wasn't worked on a punch shift (refinement 41);
  - projected days are present; holidays and weekly offs 0.
- `PAID_DAYS = max(0, TOTAL_DAYS − LOP_DAYS)`; `PRESENT_DAYS` = present 1, half_day/half_leave 0.5.
- **Tests:** one per rule, both bases, a joiner on the 10th, an exit on the 20th.

- [ ] Commit `feat(payroll): add loss-of-pay day rules`

### Task 6: Components and structures

**Files:** Create `src/server/modules/payroll/{components,structures}.ts`; Test `tests/integration/payroll-components.test.ts`

- Components:
  - `createComponent`, `updateComponent → { before, after }`, `setComponentArchived` (refused while a non-archived
    structure uses it);
  - formulas validated against the known codes and variables;
  - `percentOf` must exist; system codes (`REIMB`, `LOAN_EMI`) can't be archived or retyped.
- Structures:
  - `createStructure`, `updateStructure` (an ordered component list with overrides);
  - at most one `balance`; validated through `dependencyOrder` (cycles, unknown references);
  - `setStructureArchived` (refused while a current salary uses it).
- `seedPayrollDefaults(db)` (idempotent):
  - components:
    - BASIC formula `MONTHLY_CTC * 0.5`; HRA percent 40 of BASIC; SPECIAL balance;
    - COMP_OFF_PAY formula `COMP_OFF_DAYS * MONTHLY_CTC / 30` (not prorated);
    - LEAVE_ENCASH formula `ENCASH_DAYS * BASIC_RATE / 30` (not prorated);
    - BONUS earning input; OTHER_DEDUCTION deduction input; LOAN_EMI deduction input (system); REIMB reimbursement
      input (system);
  - the "Standard" structure with all of them.
  - Called from `scripts/seed.ts` and the legacy migration.
- `structurePreview(db, structureId, annualCtc, overrides)` → the calculator at 30/30 days.
- **Tests:** a cycle across two formulas refused; two balances refused; an unknown identifier refused; the seed runs
  twice; the preview for 12 L.

- [ ] Commit `feat(payroll): add salary components and structures`

### Task 7: Employee salaries

**Files:** Create `src/server/modules/payroll/salaries.ts`; Test `tests/integration/payroll-salaries.test.ts`

- `reviseSalary(db, actorUserId, input) → EmployeeSalaryRow`:
  - a 1st-of-month effective date, not before the employee's joining month;
  - an active structure; overrides only for codes in the structure, validated by a preview;
  - records `employee_events` `salary_revised` (old → new CTC);
  - a revision for the same employee and date replaces the earlier one (history keeps both via the audit);
  - sets `approved_by` = actor.
- `effectiveSalary(db, employeeId, period)`; `salaryHistory(db, employeeId)`; `salaryPreview(db, input)` (monthly
  and annual breakdown).
- **Tests:** the effective salary switches on the effective month; a mid-month date refused; the event is recorded;
  an override on a code not in the structure refused.

- [ ] Commit `feat(payroll): add salary revisions`

### Task 8: Period summary and variables

**Files:** Create `src/server/modules/payroll/period.ts`; Test `tests/integration/payroll-period.test.ts`

- `periodDays(db, employeeId, period, { today, now, recompute = true })`:
  - with `recompute`, `fillMissingAttendance` + `recomputeAttendance` over the period up to today (locked days are
    skipped);
  - stored rows up to today (status, leave LOP flag via `leave_request_id`, worked vs the shift half threshold);
  - days after today are projected from the work calendar (leave, holidays and weekly offs apply, else `projected`);
  - working-ness from the work calendar.
- `periodVariables(db, employee, salary, period, opts) → Record<Variable, number>`:
  - days per `payroll.prorationBasis`;
  - `OT_HOURS`, `OFF_DAY_WORKED_DAYS`;
  - `COMP_OFF_DAYS`: approved payout claims decided by the period end and not yet paid;
  - `ENCASH_DAYS`: encashable leave available on the last working day when the employee leaves within the period;
  - service years and months at the period end; `CTC`, `MONTHLY_CTC`.
- **Tests:** a month with 2 absences and an LOP leave; the working basis; a future-dated computation projects the rest
  of the month as present; an unpaid comp-off payout counts once.

- [ ] Commit `feat(payroll): summarise attendance for a pay period`

### Task 9: Payroll runs — create, inputs, compute

**Files:** Create `src/server/modules/payroll/{runs,inputs}.ts`; Test `tests/integration/payroll-runs.test.ts`

- `createRun(db, actor, { period, type, notes }, { today })`:
  - one regular run per period (`DUPLICATE_RUN`);
  - the previous regular period must be approved, released or paid unless no regular run exists (`PREVIOUS_OPEN`);
  - no period more than a month ahead.
- Inputs:
  - `addManualInput` (to `input` components only; draft or computed runs);
  - `deleteInput` (manual only);
  - `importInputs(csv)` (code, component, amount, note).
- `refreshSystemInputs(db, run)`: replaces the run's non-manual inputs:
  - approved, unpaid claims with claim date ≤ the period end → REIMB;
  - active loans started by the period → LOAN_EMI = min(emi, outstanding);
  - arrears (Task 11);
  - exit encashment comes through `ENCASH_DAYS`.
- `computeRun(db, actor, runId, { today, now })` (draft or computed):
  - refreshes the system inputs;
  - for each employee employed any day of the period (regular runs): the effective salary (none → a run warning
    "No salary for <name>"), the period variables, the structure with overrides, the calculator;
  - upserts the payslip (keeping `hold`/`excluded`) with snapshot, days, totals, warnings and `salary_id`; replaces
    its lines;
  - warnings: missing bank details, zero paid days, capped deductions, calculator errors (an error payslip is excluded
    with the error as its warning);
  - off-cycle runs: payslips only for employees with inputs, lines from inputs only;
  - sets `computed`, `computed_by`, `computed_at`.
- `setPayslipStatus(db, runId, employeeId, status)` (ok | hold | excluded; computed runs only).
- **Tests:** the order rule; inputs; a compute for three employees (a joiner, an LOP, a missing salary); recompute
  keeps hold; an off-cycle bonus run.

- [ ] Commit `feat(payroll): create and compute payroll runs`

### Task 10: Approve, revert, release, paid, cancel

**Files:** Modify `runs.ts`; Test `tests/integration/payroll-run-lifecycle.test.ts`

- `approveRun(db, actor, runId)`:
  - `payroll.approve`; actor ≠ `computed_by` (`SAME_PERSON`); computed only; no payslip with an error;
  - locks `attendance_days` of the period for employees with an `ok`/`hold` payslip (`fillMissingAttendance` first);
  - claims → `paid` with `paid_run_id`, `finance_by`; loan repayments per LOAN_EMI input (a repaid loan closes);
  - comp-off payout claims → `paid_run_id`; arrears → updates the source payslips' `paid_basis_salary_id`.
- `revertRun(db, actor, runId, note)` (super admin, approved only): undoes each of the above; back to `computed`.
- `releaseRun` (Task 14 adds PDFs): `approved` → `released`; `ok` payslips get `released_at` and codes; notifications.
- `releasePayslip(db, payslipId)` for held payslips of a released run; `markPaid(db, runId, { paidOn, reference })`;
  `cancelRun` (draft or computed).
- **Tests:**
  - maker ≠ checker; approval locks attendance (a recompute leaves those days alone);
  - claims paid; a loan of 10 000 with 4 000 EMI closes after three runs (4 000, 4 000, 2 000);
  - revert restores everything; a released run refuses revert and recompute.

- [ ] Commit `feat(payroll): approve, release and revert payroll runs`

### Task 11: Arrears

**Files:** Create `src/server/modules/payroll/arrears.ts`; Test `tests/integration/payroll-arrears.test.ts`

- `arrearsInputs(db, run)`: for each payslip of an approved+ regular run before this run's period whose
  `salary_id` (or `paid_basis_salary_id`) differs from the employee's current effective salary for that period:
  - re-run the calculator with the stored `variables` (no recompute of attendance) under both salaries;
  - each earning/deduction difference ≠ 0 becomes an input (source `arrear`, `source_id` = the old payslip,
    label `Arrears – <name> (<Mon YYYY>)`).
- **Tests:** a revision back-dated two months yields two months of differences; after approval a later run adds no
  more; a second revision pays only the new difference.

- [ ] Commit `feat(payroll): pay arrears for back-dated revisions`

### Task 12: Loans

**Files:** Create `src/server/modules/payroll/loans.ts`; Test `tests/integration/payroll-loans.test.ts`

- `createLoan` (`principal`, `emi` ≤ principal, `startPeriod`, type, note); `setLoanStatus` (active/paused/closed);
  `loanStatement(db, loanId)` (repayments, outstanding).
- **Tests:** EMI capped at the outstanding; paused loans skipped; statement totals.

- [ ] Commit `feat(payroll): add loans and advances`

### Task 13: Expense claims

**Files:** Create `src/server/modules/payroll/claims.ts`; Modify `approvals/routing.ts`, `permissions.ts` (`claim.view.all`); Test `tests/integration/payroll-claims.test.ts`

- `CLAIM_APPROVAL = { approve: "claim.approve", orgWide: "claim.view.all" }` (refinement: `claim.view.all` for HR and
  payroll admins).
- `saveClaim` (draft, own), `submitClaim` (needs a receipt file; notifies approvers), `withdrawClaim`, `approveClaim`,
  `rejectClaim` (note required), via shared routing.
- The receipt file is readable by the claimant, approvers and `claim.view.all` (file access resolver).
- **Tests:** the flow; self-approval refused; a peer refused; a receipt visible to the manager, not to a peer.

- [ ] Commit `feat(payroll): add expense claims`

### Task 14: Payslip PDF and release

**Files:** Create `src/server/modules/payroll/{payslip-pdf.tsx,payslips.ts}`; Modify `runs.ts`, `next.config.ts` (`serverExternalPackages`); Test `tests/integration/payslip-release.test.ts`

- Install `@react-pdf/renderer@4.9.0`, `qrcode@1.5.4` (+ `@types/qrcode`), `@cantoo/pdf-lib@2.11.1`,
  `@signpdf/signpdf@3.3.0`, `@signpdf/signer-p12@3.3.0`, `@signpdf/placeholder-pdf-lib@3.3.0`.
- `renderPayslipPdf(data, { draft }) → Promise<Buffer>` (A4) laid out per spec §5.6:
  - logo, company, period, employee snapshot (bank masked), days, earnings | deductions, reimbursements;
  - net with words; YTD column (fiscal year from `locale.fiscalYearStartMonth`); footer note;
  - QR + code + verify URL; the signatory image or the computer-generated line;
  - a DRAFT watermark when `draft`.
- `payslipDocument(db, payslipId)` → render data (YTD from released payslips of the fiscal year).
- Release: `prepareRelease(db, runId)` (async, outside the transaction) assigns codes, renders and signs each PDF
  (when `PAYSLIP_SIGN_P12_PATH` is set) and hashes it. `commitRelease(tx, …)` stores files (`saveUpload`, pdf), sets
  `pdf_file_id`, `pdf_sha256`, `verification_code`, `signed`, `released_at`, the run status, and notifies.
- An `after` hook emails each employee: a login link, or a protected copy when `emailAttachment = protected` (password
  from DOB `DDMMYYYY`, else the employee code). It sets `emailed_at`.
- `GET /api/payslips/[id]/pdf`: released + (own, or `payroll.run`/`salary.view`) → the stored file. A draft preview
  (`?preview=1`) for payroll admins renders with the watermark and stores nothing.
- **Tests:** the released hash equals the SHA-256 of the served bytes; a second download is identical; a held
  payslip is not released; the protected copy needs the password (pdf-lib can't open it without).

- [ ] Commit `feat(payroll): render, freeze and release payslips`

### Task 15: Public verification

**Files:** Create `src/server/modules/payroll/verify.ts`, `src/app/verify/[code]/{page,actions}.tsx`; Modify `src/proxy.ts`/public paths; Test `tests/integration/payslip-verify.test.ts`

- `lookupPayslip(db, code, { ip, userAgent, netPay? })`:
  - logs a `payslip_verifications` row;
  - returns `{ company, maskedName ("Y*** S***"), period, issuedOn, matched: boolean | null }` or null;
  - rate-limited 30 per 15 minutes per IP.
- The page: no login, `robots: noindex`, "Genuine payslip"; a form to check the net pay.
- **Tests:** an unknown code; a match and a mismatch; each lookup logged; the masked name.

- [ ] Commit `feat(payroll): add public payslip verification`

### Task 16: Exports

**Files:** Create `src/server/modules/payroll/exports.ts`, `src/app/api/payroll/runs/[id]/export/route.ts`; Test `tests/integration/payroll-exports.test.ts`

- Install `exceljs@4.4.0`.
- The bank advice (code, name, bank, account, IFSC, net) for `ok` payslips, as XLSX or CSV.
- The register (one row per payslip with every component column and totals), as XLSX.
- `payroll.run` only; audited `payroll.export`.

- [ ] Commit `feat(payroll): export bank advice and the payroll register`

### Task 17: Read models

**Files:** Create `src/server/modules/payroll/queries.ts`; Test `tests/integration/payroll-queries.test.ts`

- `listRuns`, `runDetail` (register rows with variance vs the previous regular run, flagged above
  `varianceThresholdPct`; warnings; inputs), `payslipDetail` (lines, days, explanations), `myPayslips`,
  `myYearStatement`, `listSalaries` (current salary per employee), `listLoans`, `listClaims`, `myClaims`,
  `pendingClaimsFor`, `verificationLog`.

- [ ] Commit `feat(payroll): add payroll read models`

### Task 18: Settings → Payroll and navigation

- Settings page for the `payroll` settings (proration basis, pay day, footer, variance threshold, signatory, email
  attachment, password format).
- Nav:
  - a **Payroll** group: Runs, Salaries, Components, Structures, Loans, Claims;
  - My Space: "My payslips", "My claims";
  - Settings: Payroll;
  - Approvals `anyOf` + `claim.approve`.

- [ ] Commit `feat(payroll): add payroll settings and navigation`

### Task 19: Components and structures pages

- `/payroll/components`: table plus a sheet with calc-specific fields and a formula editor (live validation and a
  preview against a sample CTC).
- `/payroll/structures`: an ordered component picker with overrides and a preview.

- [ ] Commit `feat(payroll): add components and structures pages`

### Task 20: Salaries pages

- `/payroll/salaries`: current salary per employee and a revise sheet (CTC, structure, overrides, effective month,
  reason) with a live breakdown.
- Profile Salary tab (`salary.view`): history and the current breakdown.

- [ ] Commit `feat(payroll): add salaries pages`

### Task 21: Runs pages

- `/payroll/runs`: a list and a create dialog.
- `/payroll/runs/[id]`:
  - status steps; actions per status (compute, approve, revert, release, release held, mark paid, cancel);
  - the register with variance flags and hold/exclude;
  - warnings; manual inputs (add, delete, CSV import); a payslip drill-down sheet with explanations and a draft PDF
    preview;
  - exports.

- [ ] Commit `feat(payroll): add payroll run pages`

### Task 22: Loans and claims pages, approvals tab

- `/payroll/loans` (create, pause/close, statement); `/payroll/claims` (all claims, filters).
- `/me/claims` (create with receipt upload, submit, withdraw).
- Approvals → Claims tab.

- [ ] Commit `feat(payroll): add loans and claims pages`

### Task 23: My payslips

- `/me/payslips` (list by period, net, download), `/me/payslips/[id]` (lines and a download), and the year statement
  (on demand, marked as a statement).

- [ ] Commit `feat(payroll): add my payslips`

### Task 24: E2E, verification, documentation

**E2E** (`tests/e2e/payroll.spec.ts`, `test.use(clientIp(6))`):
1. The admin assigns a salary to a new employee and creates last month's run, which an HR admin computes.
2. The super admin approves it, then releases it.
3. The employee opens My payslips and downloads the PDF; its hash matches.
4. The verify page for its code says genuine and matches the net pay.

Run `npm run test:e2e` and `npm run verify`.

**Docs:**
- Roadmap: Phase 5 done; refinements; integration map.
- `CLAUDE.md`: a "Payroll" bullet (paise, formulas in rupees, maker-checker, immutable releases, async rendering
  outside transactions).

**Refinements to record:**
- `claim.view.all` permission.
- System components REIMB and LOAN_EMI.
- COMP_OFF_PAY and LEAVE_ENCASH as formula components with `COMP_OFF_DAYS` / `ENCASH_DAYS`. Year-end encashment of
  excess still lapses.
- Half-leave LOP for the unworked half on punch shifts.
- `paid_run_id` on comp-off claims.
- Arrears tracked through `paid_basis_salary_id`.
- Signing library pinned to 3.3.0.
