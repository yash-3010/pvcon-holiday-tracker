"use server";

import { z } from "zod";
import { formatMoney } from "@/lib/money";
import { LOAN_STATUSES } from "@/lib/payroll/constants";
import { loanSchema } from "@/lib/validation/payroll";
import { defineAction } from "@/server/actions/define";
import { createLoan, setLoanStatus } from "@/server/modules/payroll/loans";

const PATHS = ["/payroll/loans", "/payroll/runs"];

export const createLoanAction = defineAction({
  name: "payroll.loan.create",
  schema: loanSchema,
  permission: "loan.manage",
  handler: ({ tx, user, audit }, input) => {
    const loan = createLoan(tx, user.id, input);
    audit({
      action: "loan.create", entityType: "loan", entityId: loan.id,
      summary: `Gave a ${loan.type} of ${formatMoney(loan.principal)} (EMI ${formatMoney(loan.emi)} from ${loan.startPeriod})`,
    });
    return { id: loan.id };
  },
  revalidate: PATHS,
});

export const setLoanStatusAction = defineAction({
  name: "payroll.loan.status",
  schema: z.object({ id: z.number().int().positive(), status: z.enum(LOAN_STATUSES) }),
  permission: "loan.manage",
  handler: ({ tx, audit }, { id, status }) => {
    const { before, after } = setLoanStatus(tx, id, status);
    audit({ action: "loan.status", entityType: "loan", entityId: id, summary: `Set a ${after.type} to ${status}`, diff: { status: [before.status, after.status] } });
    return { status: after.status };
  },
  revalidate: PATHS,
});
