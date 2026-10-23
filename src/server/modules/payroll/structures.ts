import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { calculatePayslip, type CalcComponent, type PayslipCalcResult } from "@/lib/payroll/calculate";
import type { Minor } from "@/lib/money";
import type { ComponentInput, StructureInput } from "@/lib/validation/payroll";
import type { DbLike } from "@/server/db/client";
import {
  employees, employeeSalaries, salaryComponents, salaryStructureComponents, salaryStructures, type SalaryStructureRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { componentByCode, createComponent, updateComponentRow } from "./components";

export function requireStructure(db: DbLike, id: number): SalaryStructureRow {
  const row = db.select().from(salaryStructures).where(eq(salaryStructures.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Salary structure not found.");
  return row;
}

type Line = StructureInput["lines"][number];

/** A structure's components in order, with the structure's overrides applied. */
function componentsForLines(db: DbLike, lines: readonly Line[]): CalcComponent[] {
  const ids = lines.map((l) => l.componentId);
  const rows = ids.length ? db.select().from(salaryComponents).where(inArray(salaryComponents.id, ids)).all() : [];
  return lines.map((line) => {
    const c = rows.find((r) => r.id === line.componentId);
    if (!c) throw new DomainError("NOT_FOUND", "Salary component not found.");
    return {
      code: c.code, name: c.name, kind: c.kind, calc: c.calc, value: line.value ?? c.defaultValue, percentOf: c.percentOf,
      percent: line.percent ?? c.percent, formula: line.formula ?? c.formula, prorate: c.prorate, round: c.round,
      showOnPayslip: c.showOnPayslip, inCtc: c.inCtc,
    };
  });
}

export function structureLines(db: DbLike, structureId: number): Line[] {
  return db
    .select({
      componentId: salaryStructureComponents.componentId, value: salaryStructureComponents.value, percent: salaryStructureComponents.percent,
      formula: salaryStructureComponents.formula,
    })
    .from(salaryStructureComponents)
    .where(eq(salaryStructureComponents.structureId, structureId))
    .orderBy(asc(salaryStructureComponents.sortOrder))
    .all();
}

export function structureComponents(db: DbLike, structureId: number): CalcComponent[] {
  return componentsForLines(db, structureLines(db, structureId));
}

/** Employee overrides: an amount makes the component fixed at it, text makes it a formula. */
export function applyOverrides(components: readonly CalcComponent[], overrides: Readonly<Record<string, number | string>>): CalcComponent[] {
  return components.map((c) => {
    const o = overrides[c.code];
    if (o === undefined) return c;
    return typeof o === "number" ? { ...c, calc: "fixed", value: o, formula: null } : { ...c, calc: "formula", formula: o, value: null };
  });
}

/** A full month of 30 paid days, for previews and validation. */
export function structurePreview(
  _db: DbLike,
  components: readonly CalcComponent[],
  annualCtc: Minor,
  overrides: Readonly<Record<string, number | string>>,
): PayslipCalcResult {
  return calculatePayslip({
    annualCtc, components: applyOverrides(components, overrides), inputs: [],
    variables: { TOTAL_DAYS: 30, PAID_DAYS: 30, WORKING_DAYS: 22, PRESENT_DAYS: 22 },
  });
}

/** A structure must compute: one balance at most, known names, no cycles, bases present. */
function assertComputes(name: string, components: readonly CalcComponent[]): void {
  const result = structurePreview(null as unknown as DbLike, components, 120_000_000, {});
  if (result.errors.length) throw new DomainError("STRUCTURE_INVALID", `${name}: ${result.errors[0]}`, { lines: result.errors });
}

export function validateStructure(db: DbLike, structureId: number): void {
  assertComputes(requireStructure(db, structureId).name, structureComponents(db, structureId));
}

function assertNameFree(db: DbLike, name: string, exceptId: number | null): void {
  const clash = db
    .select({ id: salaryStructures.id })
    .from(salaryStructures)
    .where(and(sql`lower(${salaryStructures.name}) = ${name.toLowerCase()}`, exceptId === null ? undefined : ne(salaryStructures.id, exceptId)))
    .get();
  if (clash) throw new DomainError("DUPLICATE_NAME", "A structure with this name already exists.", { name: ["Already exists"] });
}

function writeLines(db: DbLike, structureId: number, lines: readonly Line[]): void {
  db.delete(salaryStructureComponents).where(eq(salaryStructureComponents.structureId, structureId)).run();
  lines.forEach((line, i) => db.insert(salaryStructureComponents).values({ structureId, ...line, sortOrder: i }).run());
}

export function createStructure(db: DbLike, input: StructureInput): SalaryStructureRow {
  assertNameFree(db, input.name, null);
  assertComputes(input.name, componentsForLines(db, input.lines));
  const row = db.insert(salaryStructures).values({ name: input.name, description: input.description }).returning().get();
  writeLines(db, row.id, input.lines);
  return row;
}

export function updateStructure(db: DbLike, id: number, input: StructureInput): { before: SalaryStructureRow; after: SalaryStructureRow } {
  const before = requireStructure(db, id);
  assertNameFree(db, input.name, id);
  assertComputes(input.name, componentsForLines(db, input.lines));
  const after = db.update(salaryStructures).set({ name: input.name, description: input.description }).where(eq(salaryStructures.id, id)).returning().get()!;
  writeLines(db, id, input.lines);
  return { before, after };
}

/** Updates a component; every structure using it must still compute. */
export function updateComponent(db: DbLike, id: number, input: ComponentInput) {
  const { before, after, structureIds } = updateComponentRow(db, id, input);
  for (const structureId of structureIds) validateStructure(db, structureId);
  return { before, after };
}

/** Employees whose latest salary uses the structure. */
function employeesOn(db: DbLike, structureId: number): number {
  const latest = db
    .select({ employeeId: employeeSalaries.employeeId, effectiveFrom: sql<string>`max(${employeeSalaries.effectiveFrom})` })
    .from(employeeSalaries)
    .innerJoin(employees, eq(employees.id, employeeSalaries.employeeId))
    .where(inArray(employees.status, ["active", "on_notice"]))
    .groupBy(employeeSalaries.employeeId)
    .all();
  let n = 0;
  for (const l of latest) {
    const row = db
      .select({ structureId: employeeSalaries.structureId })
      .from(employeeSalaries)
      .where(and(eq(employeeSalaries.employeeId, l.employeeId), eq(employeeSalaries.effectiveFrom, l.effectiveFrom)))
      .get();
    if (row?.structureId === structureId) n += 1;
  }
  return n;
}

export function setStructureArchived(db: DbLike, id: number, archived: boolean): SalaryStructureRow {
  requireStructure(db, id);
  if (archived) {
    const n = employeesOn(db, id);
    if (n) throw new DomainError("IN_USE", `${n} current employee(s) are paid on this structure.`);
  }
  return db.update(salaryStructures).set({ archived }).where(eq(salaryStructures.id, id)).returning().get()!;
}

export function listStructures(db: DbLike): (SalaryStructureRow & { components: number; employees: number })[] {
  const counts = new Map(
    db
      .select({ structureId: salaryStructureComponents.structureId, n: count() })
      .from(salaryStructureComponents)
      .groupBy(salaryStructureComponents.structureId)
      .all()
      .map((r) => [r.structureId, r.n]),
  );
  return db
    .select()
    .from(salaryStructures)
    .orderBy(asc(salaryStructures.name))
    .all()
    .map((s) => ({ ...s, components: counts.get(s.id) ?? 0, employees: employeesOn(db, s.id) }));
}

const DEFAULT_COMPONENTS: (ComponentInput & { system?: boolean })[] = [
  { code: "BASIC", name: "Basic", kind: "earning", calc: "formula", defaultValue: null, percentOf: null, percent: null, formula: "MONTHLY_CTC * 0.5", prorate: true, inCtc: true, round: "nearest", showOnPayslip: true, taxableLabel: null },
  { code: "HRA", name: "House rent allowance", kind: "earning", calc: "percent", defaultValue: null, percentOf: "BASIC", percent: 4000, formula: null, prorate: true, inCtc: true, round: "nearest", showOnPayslip: true, taxableLabel: null },
  { code: "SPECIAL", name: "Special allowance", kind: "earning", calc: "balance", defaultValue: null, percentOf: null, percent: null, formula: null, prorate: true, inCtc: true, round: "nearest", showOnPayslip: true, taxableLabel: null },
  { code: "BONUS", name: "Bonus", kind: "earning", calc: "input", defaultValue: null, percentOf: null, percent: null, formula: null, prorate: false, inCtc: false, round: "none", showOnPayslip: true, taxableLabel: null },
  { code: "COMP_OFF_PAY", name: "Comp-off payout", kind: "earning", calc: "formula", defaultValue: null, percentOf: null, percent: null, formula: "COMP_OFF_DAYS * MONTHLY_CTC / 30", prorate: false, inCtc: false, round: "nearest", showOnPayslip: true, taxableLabel: null },
  { code: "LEAVE_ENCASH", name: "Leave encashment", kind: "earning", calc: "formula", defaultValue: null, percentOf: null, percent: null, formula: "ENCASH_DAYS * BASIC_RATE / 30", prorate: false, inCtc: false, round: "nearest", showOnPayslip: true, taxableLabel: null },
  { code: "OTHER_DEDUCTION", name: "Other deduction", kind: "deduction", calc: "input", defaultValue: null, percentOf: null, percent: null, formula: null, prorate: false, inCtc: false, round: "none", showOnPayslip: true, taxableLabel: null },
  { code: "LOAN_EMI", name: "Loan repayment", kind: "deduction", calc: "input", defaultValue: null, percentOf: null, percent: null, formula: null, prorate: false, inCtc: false, round: "none", showOnPayslip: true, taxableLabel: null, system: true },
  { code: "REIMB", name: "Reimbursements", kind: "reimbursement", calc: "input", defaultValue: null, percentOf: null, percent: null, formula: null, prorate: false, inCtc: false, round: "none", showOnPayslip: true, taxableLabel: null, system: true },
];

/**
 * The standard components and the "Standard" structure: basic 50% of the monthly CTC, HRA 40% of basic, special
 * allowance for the balance, plus payouts, inputs and the system components. Idempotent.
 */
export function seedPayrollDefaults(db: DbLike): void {
  if (!db.select({ id: salaryComponents.id }).from(salaryComponents).get()) {
    for (const { system, ...c } of DEFAULT_COMPONENTS) {
      const row = createComponent(db, c);
      if (system) db.update(salaryComponents).set({ system: true }).where(eq(salaryComponents.id, row.id)).run();
    }
  }
  if (!db.select({ id: salaryStructures.id }).from(salaryStructures).get()) {
    createStructure(db, {
      name: "Standard",
      description: "Basic 50% of the monthly CTC, HRA 40% of basic, special allowance for the rest.",
      lines: DEFAULT_COMPONENTS.map((c) => ({ componentId: componentByCode(db, c.code)!.id, value: null, percent: null, formula: null })),
    });
  }
}
