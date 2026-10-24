"use server";

import { z } from "zod";
import { todayInTimeZone } from "@/lib/dates";
import { formatDays } from "@/lib/leave";
import { adjustmentSchema } from "@/lib/validation/leave";
import { defineAction } from "@/server/actions/define";
import { DomainError } from "@/server/errors";
import { adjustBalance, balanceOf } from "@/server/modules/leave/ledger";
import { employeeLedger } from "@/server/modules/leave/queries";
import { requireLeaveType } from "@/server/modules/leave/types";
import { getSetting } from "@/server/modules/settings/service";

export const adjustBalanceAction = defineAction({
  name: "leave.adjust",
  schema: adjustmentSchema,
  permission: "leave.adjust",
  handler: ({ tx, user, audit }, input) => {
    if (input.employeeId === user.employeeId) {
      throw new DomainError("SELF_ADJUST", "Someone else has to adjust your own leave balance.");
    }
    const type = requireLeaveType(tx, input.leaveTypeId);
    adjustBalance(tx, user.id, input, todayInTimeZone(getSetting(tx, "locale").timezone));
    audit({
      action: "leave.adjust", entityType: "employee", entityId: input.employeeId,
      summary: `Adjusted ${type.code} ${input.year} by ${input.delta > 0 ? "+" : ""}${formatDays(input.delta)}: ${input.note}`,
    });
    return { balance: balanceOf(tx, input.employeeId, input.leaveTypeId, input.year) };
  },
  revalidate: ["/leave/balances", "/me/leave"],
});

/** Read-only drill-down behind a balance cell. Nothing changes, so nothing is audited. */
export const employeeLedgerAction = defineAction({
  name: "leave.ledger",
  schema: z.object({
    employeeId: z.number().int().positive(),
    leaveTypeId: z.number().int().positive(),
    year: z.number().int().min(2000).max(2100),
  }),
  permission: "leave.view.all",
  handler: ({ tx }, { employeeId, leaveTypeId, year }) => employeeLedger(tx, employeeId, leaveTypeId, year),
});
