import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { employees } from "@/server/db/schema";
import { listEmployeeChecklists, seedDefaultChecklistTemplates } from "@/server/modules/employees/checklists";
import { commitEmployeeImport, previewEmployeeImport } from "@/server/modules/employees/import";
import { createTestDb } from "../helpers/db";
import { insertDepartment, insertDesignation, insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const HEADER = " First_Name ,LAST_NAME,work_email,department,designation,manager_email,date_of_joining,employee_code";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n") + "\n";

let db: DB;
let hr: SessionUser;
beforeEach(() => {
  db = createTestDb();
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
  insertDepartment(db, "Engineering");
  insertDesignation(db, "Consultant");
});

describe("previewEmployeeImport", () => {
  it("reads a BOM, Windows line endings, messy headers and trailing blank lines", () => {
    const file = "﻿" + [
      HEADER,
      "Asha,Rao,Asha@PVCON.in,engineering,consultant,,2026-10-01,",
      "Ravi,Menon,ravi@pvcon.in,Engineering,,asha@pvcon.in,2026-10-05,",
      ",,,,,,,",
      "",
    ].join("\r\n");
    expect(previewEmployeeImport(db, file)).toEqual({
      rows: [
        { row: 1, employeeCode: null, name: "Asha Rao", workEmail: "asha@pvcon.in", errors: [] },
        { row: 2, employeeCode: null, name: "Ravi Menon", workEmail: "ravi@pvcon.in", errors: [] },
      ],
      valid: 2,
      invalid: 0,
      fileErrors: [],
    });
  });

  it("reports every problem, row by row", () => {
    insertEmployee(db, { workEmail: "taken@pvcon.in", employeeCode: "PV0009" });
    const preview = previewEmployeeImport(db, csv(
      "Asha,Rao,asha@pvcon.in,Sales,,,2026-10-01,",
      "Ravi,Menon,asha@pvcon.in,,,,2026-10-05,",
      "Kiran,Das,kiran@pvcon.in,,,meera@pvcon.in,2026-10-05,",
      "Meera,Iyer,meera@pvcon.in,,,,2026-10-05,PV0009",
      ",Nobody,,,,,2026-02-30,",
      "Taken,Person,taken@pvcon.in,,,,2026-10-05,",
    ));
    expect(preview.rows.map((r) => r.errors)).toEqual([
      ['department: no active department called "Sales"'],
      ["work_email: repeats row 1"],
      ["manager_email: no current employee with this work email (a new manager must be on an earlier row)"],
      ["employee_code: PV0009 already exists"],
      ["first_name: is required", "date_of_joining: Enter a valid date"],
      ["work_email: taken@pvcon.in already belongs to an employee"],
    ]);
    expect([preview.valid, preview.invalid]).toEqual([0, 6]);
  });

  it("rejects files with missing or unknown columns, no data, or too many rows", () => {
    expect(previewEmployeeImport(db, "last_name,work_email\nRao,a@pvcon.in\n").fileErrors).toEqual([
      "Missing required column(s): first_name, date_of_joining.",
    ]);
    expect(previewEmployeeImport(db, "first_name,date_of_joining,salary\nAsha,2026-10-01,100\n").fileErrors).toEqual([
      "Unknown column(s): salary. Use the template's column names.",
    ]);
    expect(previewEmployeeImport(db, "first_name,date_of_joining\n").fileErrors).toEqual(["The file has no data rows."]);
    const many = ["first_name,date_of_joining", ...Array.from({ length: 501 }, (_, i) => `E${i},2026-10-01`)].join("\n");
    expect(previewEmployeeImport(db, many).fileErrors).toEqual(["Import at most 500 rows at a time."]);
  });
});

describe("commitEmployeeImport", () => {
  it("creates every row in order, linking managers from earlier rows and generating codes", () => {
    seedDefaultChecklistTemplates(db);
    const result = commitEmployeeImport(db, hr, csv(
      "Asha,Rao,asha@pvcon.in,Engineering,Consultant,,2026-10-01,",
      "Ravi,Menon,ravi@pvcon.in,Engineering,,asha@pvcon.in,2026-10-05,",
      "Meera,Iyer,meera@pvcon.in,,,,2026-10-05,PV0050",
    ));
    expect(result).toEqual({ created: 3, codes: ["PV0001", "PV0002", "PV0050"] });
    const rows = db.select().from(employees).all();
    const asha = rows.find((e) => e.workEmail === "asha@pvcon.in")!;
    expect(rows.find((e) => e.workEmail === "ravi@pvcon.in")!.reportingManagerId).toBe(asha.id);
    expect(listEmployeeChecklists(db, asha.id)).toEqual([]);
  });

  it("creates nothing when any row is invalid", () => {
    expectDomainError(() => commitEmployeeImport(db, hr, csv("Asha,Rao,asha@pvcon.in,Sales,,,2026-10-01,")), "IMPORT_INVALID");
    expect(db.select().from(employees).all()).toEqual([]);
  });
});
