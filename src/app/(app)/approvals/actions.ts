"use server";

import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { optionalText } from "@/lib/validation/employees";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { decideProfileChange } from "@/server/modules/employees/profile-changes";

export const decideProfileChangeAction = defineAction({
  name: "approvals.profile_change",
  schema: z.object({
    requestId: z.number().int().positive(),
    decision: z.enum(["approved", "rejected"]),
    note: optionalText(300),
  }),
  // Approvers check the real numbers against proof, so they need sensitive access too.
  permission: (user) => can(user, "employee.update") && can(user, "employee.sensitive.view"),
  handler: ({ tx, user, audit }, { requestId, decision, note }) => {
    const { request, before, after } = decideProfileChange(tx, user.id, requestId, decision, note);
    audit({
      action: decision === "approved" ? "profile_change.approve" : "profile_change.reject",
      entityType: "employee",
      entityId: request.employeeId,
      summary: `${decision === "approved" ? "Approved" : "Rejected"} a bank details change request`,
      diff: decision === "approved" ? diffObjects({ ...before }, { ...after }) : null,
    });
    return { status: request.status };
  },
  revalidate: ["/approvals"],
});
