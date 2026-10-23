"use server";

import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { dateInTimeZone, formatHm } from "@/lib/dates";
import { compOffDecisionSchema, decisionSchema } from "@/lib/validation/attendance";
import { optionalText } from "@/lib/validation/employees";
import { bulkApproveSchema, leaveDecisionSchema } from "@/lib/validation/leave";
import { defineAction } from "@/server/actions/define";
import { approveRegularization, rejectRegularization } from "@/server/modules/attendance/regularization";
import { diffObjects } from "@/server/modules/audit/service";
import { approveCompOffClaim, rejectCompOffClaim } from "@/server/modules/compoff/service";
import { decideProfileChange } from "@/server/modules/employees/profile-changes";
import { approveLeave, bulkApproveLeave, rejectLeave } from "@/server/modules/leave/requests";
import { getSetting } from "@/server/modules/settings/service";

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

export const decideRegularizationAction = defineAction({
  name: "approvals.regularization",
  schema: decisionSchema,
  // Scope (manager above or org-wide viewer, never one's own) is checked by the service.
  permission: "regularization.approve",
  handler: ({ tx, user, audit }, { id, decision, note }) => {
    const request = decision === "approved" ? approveRegularization(tx, user, id, note) : rejectRegularization(tx, user, id, note);
    audit({
      action: decision === "approved" ? "regularization.approve" : "regularization.reject",
      entityType: "regularization_request",
      entityId: id,
      summary: `${decision === "approved" ? "Approved" : "Rejected"} the correction of ${request.date} to ${formatHm(request.requestedIn)}–${formatHm(request.requestedOut)}`,
    });
    return { status: request.status };
  },
  revalidate: ["/approvals", "/time/muster", "/time/attendance", "/me/attendance"],
});

export const decideCompOffAction = defineAction({
  name: "approvals.compoff",
  schema: compOffDecisionSchema,
  permission: "compoff.approve",
  handler: ({ tx, user, audit }, { claimId, decision, resolution, note }) => {
    const today = dateInTimeZone(new Date(), getSetting(tx, "locale").timezone);
    const claim =
      decision === "approved" ? approveCompOffClaim(tx, user, claimId, { resolution, note, today }) : rejectCompOffClaim(tx, user, claimId, note);
    audit({
      action: decision === "approved" ? "compoff.approve" : "compoff.reject",
      entityType: "comp_off_claim",
      entityId: claimId,
      summary:
        decision === "approved"
          ? `Approved ${claim.daysRequested} comp-off day(s) for ${claim.workedDate} as ${resolution === "payout" ? "a payout" : "leave"}`
          : `Rejected the comp-off claim for ${claim.workedDate}`,
    });
    return { status: claim.status };
  },
  revalidate: ["/approvals", "/me/comp-off", "/leave/comp-off"],
});
