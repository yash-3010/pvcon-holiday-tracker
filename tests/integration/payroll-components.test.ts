import { beforeEach, describe, expect, it } from "vitest";
import type { ComponentInput } from "@/lib/validation/payroll";
import type { DB } from "@/server/db/client";
import { employeeSalaries, salaryComponents, salaryStructures } from "@/server/db/schema";
import { componentByCode, createComponent, listComponents, setComponentArchived } from "@/server/modules/payroll/components";
import {
  createStructure, listStructures, seedPayrollDefaults, setStructureArchived, structureComponents, structurePreview, updateComponent,
  updateStructure,
} from "@/server/modules/payroll/structures";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError } from "../helpers/fixtures";

let db: DB;
beforeEach(() => {
  db = createTestDb();
  seedPayrollDefaults(db);
});

const component = (overrides: Partial<ComponentInput>): ComponentInput => ({
  code: "X", name: "X", kind: "earning", calc: "formula", defaultValue: null, percentOf: null, percent: null, formula: "1", prorate: true,
  inCtc: true, round: "nearest", showOnPayslip: true, taxableLabel: null, ...overrides,
});
const standard = () => db.select().from(salaryStructures).get()!;
const lineFor = (code: string) => ({ componentId: componentByCode(db, code)!.id, value: null, percent: null, formula: null });

describe("seeded defaults", () => {
  it("adds the standard components and structure once", () => {
    seedPayrollDefaults(db);
    expect(listComponents(db, {}).map((c) => c.code)).toEqual([
      "BASIC", "HRA", "SPECIAL", "BONUS", "COMP_OFF_PAY", "LEAVE_ENCASH", "OTHER_DEDUCTION", "LOAN_EMI", "REIMB",
    ]);
    expect(db.select().from(salaryComponents).all().filter((c) => c.system).map((c) => c.code)).toEqual(["LOAN_EMI", "REIMB"]);
    expect(listStructures(db).map((s) => [s.name, s.components])).toEqual([["Standard", 9]]);
  });

  it("previews 12 L a year as 50,000 basic, 20,000 HRA and 30,000 special", () => {
    const preview = structurePreview(db, structureComponents(db, standard().id), 120_000_000, {});
    expect(preview.errors).toEqual([]);
    expect(preview.lines.map((l) => [l.code, l.amount])).toEqual([["BASIC", 5_000_000], ["HRA", 2_000_000], ["SPECIAL", 3_000_000]]);
    const overridden = structurePreview(db, structureComponents(db, standard().id), 120_000_000, { HRA: 1_500_000, BASIC: "MONTHLY_CTC * 0.4" });
    expect(overridden.lines.map((l) => [l.code, l.amount])).toEqual([["BASIC", 4_000_000], ["HRA", 1_500_000], ["SPECIAL", 4_500_000]]);
  });
});

describe("components", () => {
  it("keeps codes unique and formulas valid", () => {
    expectDomainError(() => createComponent(db, component({ code: "BASIC" })), "DUPLICATE_CODE");
    expectDomainError(() => createComponent(db, component({ code: "PF", formula: "BASIC * PF_PERCENT" })), "INVALID_FORMULA");
    expectDomainError(() => createComponent(db, component({ code: "PF", calc: "percent", formula: null, percentOf: "NOPE", percent: 1200 })), "NOT_FOUND");
    expect(createComponent(db, component({ code: "PF", kind: "deduction", formula: "min(BASIC, 15000) * 0.12" })).code).toBe("PF");
  });

  it("refuses a formula change that would break a structure", () => {
    const pf = createComponent(db, component({ code: "PF", kind: "deduction", formula: "BASIC * 0.12" }));
    updateStructure(db, standard().id, { name: "Standard", description: null, lines: [...structureComponents(db, standard().id).map((c) => lineFor(c.code)), lineFor("PF")] });
    expectDomainError(() => updateComponent(db, componentByCode(db, "BASIC")!.id, component({ code: "BASIC", formula: "PF_RATE * 8" })), "STRUCTURE_INVALID");
    expectDomainError(() => updateComponent(db, pf.id, component({ code: "PF2", kind: "deduction" })), "CODE_LOCKED");
  });

  it("archives only unused, non-system components", () => {
    expectDomainError(() => setComponentArchived(db, componentByCode(db, "HRA")!.id, true), "IN_USE");
    expectDomainError(() => setComponentArchived(db, componentByCode(db, "REIMB")!.id, true), "SYSTEM_COMPONENT");
    const spare = createComponent(db, component({ code: "SPARE" }));
    expect(setComponentArchived(db, spare.id, true).archived).toBe(true);
  });
});

describe("structures", () => {
  it("refuses cycles, two balances and unknown names", () => {
    // A cycle can only appear by editing a formula of a component no structure uses yet.
    const a = createComponent(db, component({ code: "A", formula: "1" }));
    createComponent(db, component({ code: "B", formula: "A" }));
    updateComponent(db, a.id, component({ code: "A", formula: "B_RATE" }));
    expectDomainError(() => createStructure(db, { name: "Loop", description: null, lines: [lineFor("A"), lineFor("B")] }), "STRUCTURE_INVALID");
    createComponent(db, component({ code: "OTHER_BAL", calc: "balance", formula: null }));
    expectDomainError(
      () => createStructure(db, { name: "Two", description: null, lines: [lineFor("BASIC"), lineFor("SPECIAL"), lineFor("OTHER_BAL")] }),
      "STRUCTURE_INVALID",
    );
    expectDomainError(() => createStructure(db, { name: "Half", description: null, lines: [lineFor("HRA")] }), "STRUCTURE_INVALID");
  });

  it("applies line overrides and archives only unused structures", () => {
    const lean = createStructure(db, {
      name: "Lean", description: null,
      lines: [{ ...lineFor("BASIC"), formula: "MONTHLY_CTC * 0.6" }, lineFor("SPECIAL")],
    });
    expect(structurePreview(db, structureComponents(db, lean.id), 120_000_000, {}).lines.map((l) => l.amount)).toEqual([6_000_000, 4_000_000]);
    const e = insertEmployee(db);
    db.insert(employeeSalaries).values({ employeeId: e.id, effectiveFrom: "2026-01-01", annualCtc: 1, structureId: lean.id, overrides: {} }).run();
    expectDomainError(() => setStructureArchived(db, lean.id, true), "IN_USE");
    expect(setStructureArchived(db, standard().id, true).archived).toBe(true);
  });
});
