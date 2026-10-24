import { and, asc, eq, ne } from "drizzle-orm";
import { VARIABLES } from "@/lib/payroll/constants";
import { validateFormula } from "@/lib/payroll/formula/parser";
import type { ComponentInput } from "@/lib/validation/payroll";
import type { DbLike } from "@/server/db/client";
import { salaryComponents, salaryStructureComponents, salaryStructures, type SalaryComponentRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";

export function listComponents(db: DbLike, { includeArchived = false }: { includeArchived?: boolean }): SalaryComponentRow[] {
  return db
    .select()
    .from(salaryComponents)
    .where(includeArchived ? undefined : eq(salaryComponents.archived, false))
    .orderBy(asc(salaryComponents.sortOrder), asc(salaryComponents.id))
    .all();
}

export function requireComponent(db: DbLike, id: number): SalaryComponentRow {
  const row = db.select().from(salaryComponents).where(eq(salaryComponents.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Salary component not found.");
  return row;
}

export function componentByCode(db: DbLike, code: string): SalaryComponentRow | undefined {
  return db.select().from(salaryComponents).where(eq(salaryComponents.code, code)).get();
}

/** Names a formula may use: the variables, and every other component's earned amount and full-month rate. */
function knownNames(db: DbLike): Set<string> {
  const codes = db.select({ code: salaryComponents.code }).from(salaryComponents).all().map((r) => r.code);
  return new Set<string>([...VARIABLES, ...codes.flatMap((c) => [c, `${c}_RATE`])]);
}

function assertComponent(db: DbLike, input: ComponentInput, exceptId: number | null): void {
  const others = exceptId === null ? undefined : ne(salaryComponents.id, exceptId);
  if (db.select({ id: salaryComponents.id }).from(salaryComponents).where(and(eq(salaryComponents.code, input.code), others)).get()) {
    throw new DomainError("DUPLICATE_CODE", "A component with this code already exists.", { code: ["Already used"] });
  }
  if (input.calc === "formula") {
    const result = validateFormula(input.formula ?? "", new Set([...knownNames(db), input.code, `${input.code}_RATE`]));
    if (!result.ok) throw new DomainError("INVALID_FORMULA", result.error, { formula: [result.error] });
    if (result.identifiers.some((n) => n === input.code || n === `${input.code}_RATE`)) {
      throw new DomainError("INVALID_FORMULA", "A component can't refer to itself.", { formula: ["Refers to itself"] });
    }
  }
  if (input.calc === "percent" && !componentByCode(db, input.percentOf!)) {
    throw new DomainError("NOT_FOUND", `There is no ${input.percentOf} component.`, { percentOf: ["Not found"] });
  }
  if (input.calc === "balance" && input.kind !== "earning") {
    throw new DomainError("INVALID_BALANCE", "The balance component must be an earning.", { kind: ["Must be an earning"] });
  }
}

export function createComponent(db: DbLike, input: ComponentInput): SalaryComponentRow {
  assertComponent(db, input, null);
  const last = db.select({ n: salaryComponents.sortOrder }).from(salaryComponents).orderBy(asc(salaryComponents.sortOrder)).all().at(-1)?.n ?? 0;
  return db.insert(salaryComponents).values({ ...input, sortOrder: last + 1 }).returning().get();
}

/**
 * Codes are fixed once created: formulas and released payslips refer to them. System components keep their kind and
 * calc. Callers re-check the structures using the component (`updateComponent` in `structures.ts`).
 */
export function updateComponentRow(
  db: DbLike,
  id: number,
  input: ComponentInput,
): { before: SalaryComponentRow; after: SalaryComponentRow; structureIds: number[] } {
  const before = requireComponent(db, id);
  if (input.code !== before.code) throw new DomainError("CODE_LOCKED", "A component's code can't change.", { code: ["Can't change"] });
  if (before.system && (input.kind !== before.kind || input.calc !== before.calc)) {
    throw new DomainError("SYSTEM_COMPONENT", "This component is used by the system; its kind and calculation are fixed.");
  }
  assertComponent(db, input, id);
  const after = db.update(salaryComponents).set(input).where(eq(salaryComponents.id, id)).returning().get()!;
  return { before, after, structureIds: structuresUsing(db, id).map((s) => s.structureId) };
}

function structuresUsing(db: DbLike, componentId: number) {
  return db
    .select({ structureId: salaryStructureComponents.structureId, name: salaryStructures.name })
    .from(salaryStructureComponents)
    .innerJoin(salaryStructures, eq(salaryStructures.id, salaryStructureComponents.structureId))
    .where(and(eq(salaryStructureComponents.componentId, componentId), eq(salaryStructures.archived, false)))
    .all();
}

export function setComponentArchived(db: DbLike, id: number, archived: boolean): SalaryComponentRow {
  const row = requireComponent(db, id);
  if (archived) {
    if (row.system) throw new DomainError("SYSTEM_COMPONENT", "This component is used by the system and can't be archived.");
    const using = structuresUsing(db, id);
    if (using.length) throw new DomainError("IN_USE", `Remove it from ${using.map((s) => s.name).join(", ")} first.`);
  }
  return db.update(salaryComponents).set({ archived }).where(eq(salaryComponents.id, id)).returning().get()!;
}
