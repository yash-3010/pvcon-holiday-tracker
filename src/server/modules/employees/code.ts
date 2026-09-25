import { like } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { employees } from "@/server/db/schema";
import { getSetting } from "@/server/modules/settings/service";

/** Next code for the configured prefix: highest existing `<prefix><digits>` + 1, zero-padded (spec §5.1). */
export function nextEmployeeCode(db: DbLike): string {
  const { codePrefix, codeDigits } = getSetting(db, "employee");
  // codePrefix is validated as 1–5 uppercase letters, so it is safe inside a RegExp.
  const pattern = new RegExp(`^${codePrefix}(\\d+)$`);
  let max = 0;
  const rows = db
    .select({ code: employees.employeeCode })
    .from(employees)
    .where(like(employees.employeeCode, `${codePrefix}%`))
    .all();
  for (const { code } of rows) {
    const match = pattern.exec(code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${codePrefix}${String(max + 1).padStart(codeDigits, "0")}`;
}
