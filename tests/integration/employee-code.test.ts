import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { nextEmployeeCode } from "@/server/modules/employees/code";
import { patchSetting } from "@/server/modules/settings/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";

describe("nextEmployeeCode", () => {
  let db: DB;
  beforeEach(() => {
    db = createTestDb();
  });

  it("starts at 1 with the default prefix and width", () => {
    expect(nextEmployeeCode(db)).toBe("PV0001");
  });

  it("continues after the highest code with the same prefix, ignoring look-alikes", () => {
    for (const code of ["PV0007", "PV0012", "PVX0099", "EMP0500", "PV12A"]) insertEmployee(db, { employeeCode: code });
    expect(nextEmployeeCode(db)).toBe("PV0013");
  });

  it("follows the configured prefix and width", () => {
    patchSetting(db, "employee", { codePrefix: "EMP", codeDigits: 3 }, null);
    insertEmployee(db, { employeeCode: "PV0042" });
    expect(nextEmployeeCode(db)).toBe("EMP001");
  });

  it("grows past the configured width instead of wrapping", () => {
    insertEmployee(db, { employeeCode: "PV9999" });
    expect(nextEmployeeCode(db)).toBe("PV10000");
  });
});
