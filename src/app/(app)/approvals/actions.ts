"use server";

import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { optionalText } from "@/lib/validation/employees";
import { bulkApproveSchema, leaveDecisionSchema } from "@/lib/validation/leave";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { decideProfileChange } from "@/server/modules/employees/profile-changes";
import { approveLeave, bulkApproveLeave, rejectLeave } from "@/server/modules/leave/requests";

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

export const decideLeaveAction = defineAction({
  name: "approvals.leave",
  schema: leaveDecisionSchema,
  // Scope (manager above or org-wide approver, never one's own) is checked by the service.
  permission: "leave.approve",
  handler: ({ tx, user, audit }, { requestId, decision, note }) => {
    const request = decision === "approved" ? approveLeave(tx, user, requestId, note) : rejectLeave(tx, user, requestId, note);
    audit({
      action: decision === "approved" ? "leave.approve" : "leave.reject",
      entityType: "leave_request",
      entityId: requestId,
      summary: `${decision === "approved" ? "Approved" : "Rejected"} ${request.days} day(s) of leave from ${request.startDate}`,
    });
    return { status: request.status };
  },
  revalidate: ["/approvals", "/leave/requests", "/team/calendar"],
});

export const bulkApproveLeaveAction = defineAction({
  name: "approvals.leave_bulk",
  schema: bulkApproveSchema,
  permission: "leave.approve",
  handler: ({ tx, user, audit }, { requestIds, note }) => {
    const result = bulkApproveLeave(tx, user, requestIds, note);
    for (const id of result.approved) {
      audit({ action: "leave.approve", entityType: "leave_request", entityId: id, summary: "Approved leave (bulk)" });
    }
    return { approved: result.approved.length, failed: result.failed };
  },
  revalidate: ["/approvals", "/leave/requests", "/team/calendar"],
});
