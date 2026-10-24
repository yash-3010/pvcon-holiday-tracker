"use server";

import { salarySchema } from "@/lib/validation/payroll";
import { defineAction } from "@/server/actions/define";
import { reviseSalary } from "@/server/modules/payroll/salaries";

export const reviseSalaryAction = defineAction({
  name: "payroll.salary.revise",
  schema: salarySchema,
  permission: "salary.manage",
  handler: ({ tx, user, audit }, input) => {
    const row = reviseSalary(tx, user.id, input);
    audit({
      action: "salary.revise", entityType: "employee", entityId: input.employeeId,
      summary: `Revised the salary from ${input.effectiveFrom.slice(0, 7)}`,
      diff: { effectiveFrom: input.effectiveFrom, annualCtc: input.annualCtc, structureId: input.structureId, overrides: input.overrides, reason: input.reason },
    });
    return { id: row.id };
  },
  revalidate: ["/payroll/salaries", "/org/employees"],
});
