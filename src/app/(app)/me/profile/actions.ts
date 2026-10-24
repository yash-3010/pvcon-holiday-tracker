"use server";

import { z } from "zod";
import type { SessionUser } from "@/lib/auth/types";
import { bankChangeRequestSchema, contactSchema } from "@/lib/validation/employees";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { submitProfileChange, withdrawProfileChange } from "@/server/modules/employees/profile-changes";
import { updateOwnContact } from "@/server/modules/employees/service";

/** Self-service acts only on the caller's own employee record. */
const hasEmployee = (user: SessionUser) => user.employeeId !== null;

export const updateOwnContactAction = defineAction({
  name: "me.update_contact",
  schema: contactSchema,
  permission: hasEmployee,
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = updateOwnContact(tx, user.employeeId!, input);
    audit({
      action: "employee.update_contact", entityType: "employee", entityId: after.id,
      summary: "Updated own contact details", diff: diffObjects(before, after),
    });
    return { id: after.id };
  },
  revalidate: ["/me/profile"],
});

export const submitBankChangeAction = defineAction({
  name: "me.bank_change",
  schema: bankChangeRequestSchema,
  permission: hasEmployee,
  handler: ({ tx, user, audit }, { reason, ...bank }) => {
    const request = submitProfileChange(tx, user.employeeId!, user.id, bank, reason);
    audit({ action: "profile_change.submit", entityType: "employee", entityId: user.employeeId, summary: "Requested a bank details change" });
    return { id: request.id };
  },
  revalidate: ["/me/profile", "/approvals"],
});

export const withdrawBankChangeAction = defineAction({
  name: "me.bank_change_withdraw",
  schema: z.object({ requestId: z.number().int().positive() }),
  permission: hasEmployee,
  handler: ({ tx, user, audit }, { requestId }) => {
    withdrawProfileChange(tx, user.employeeId!, requestId);
    audit({ action: "profile_change.withdraw", entityType: "employee", entityId: user.employeeId, summary: "Withdrew a bank details change request" });
    return { id: requestId };
  },
  revalidate: ["/me/profile", "/approvals"],
});
