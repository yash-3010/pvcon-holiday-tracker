"use server";

import { z } from "zod";
import { todayInTimeZone } from "@/lib/dates";
import { claimSchema } from "@/lib/validation/payroll";
import { defineAction } from "@/server/actions/define";
import { config } from "@/server/config";
import type { DbLike } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { saveUpload } from "@/server/modules/files/service";
import { deleteClaim, saveClaim, submitClaim, withdrawClaim } from "@/server/modules/payroll/claims";
import { getSetting } from "@/server/modules/settings/service";

const id = z.number().int().positive();
const PATHS = ["/me/claims", "/approvals", "/payroll/claims"];
const clock = (tx: DbLike) => {
  const now = new Date();
  return { now, today: todayInTimeZone(getSetting(tx, "locale").timezone, now) };
};

/** A claim form: the fields, an optional receipt, the claim being edited and whether to submit it too. */
async function readClaimForm(form: FormData) {
  const parsed = claimSchema.safeParse({
    category: form.get("category"), claimDate: form.get("claimDate"), amount: Number(form.get("amount")), description: form.get("description"),
  });
  if (!parsed.success) {
    throw new DomainError("VALIDATION", "Please correct the highlighted fields.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  }
  const file = form.get("receipt");
  const receipt = file instanceof File && file.size > 0 ? { name: file.name, data: Buffer.from(await file.arrayBuffer()) } : null;
  const claimId = Number(form.get("id")) || null;
  return { input: parsed.data, receipt, claimId, submit: form.get("submit") === "1" };
}

export const saveClaimAction = defineAction({
  name: "claim.save",
  schema: z.instanceof(FormData),
  permission: (user) => user.employeeId !== null,
  prepare: (form) => readClaimForm(form),
  handler: ({ tx, user, audit }, _form, { input, receipt, claimId, submit }) => {
    const receiptFileId = receipt
      ? saveUpload(tx, { data: receipt.data, originalName: receipt.name, allowed: ["pdf", "png", "jpeg", "webp"], uploadedBy: user.id, uploadDir: config.uploadDir, maxBytes: 5 * 1024 * 1024 }).id
      : undefined;
    const at = clock(tx);
    let claim = saveClaim(tx, user, claimId, { ...input, receiptFileId }, at);
    audit({ action: claimId ? "claim.update" : "claim.create", entityType: "expense_claim", entityId: claim.id, summary: `${claimId ? "Edited" : "Drafted"} a ${claim.category} claim of ${claim.claimDate}` });
    if (submit) {
      claim = submitClaim(tx, user, claim.id, at);
      audit({ action: "claim.submit", entityType: "expense_claim", entityId: claim.id, summary: `Submitted a ${claim.category} claim of ${claim.claimDate}` });
    }
    return { id: claim.id, status: claim.status };
  },
  revalidate: PATHS,
});

export const submitClaimAction = defineAction({
  name: "claim.submit",
  schema: z.object({ id }),
  permission: (user) => user.employeeId !== null,
  handler: ({ tx, user, audit }, { id: claimId }) => {
    const claim = submitClaim(tx, user, claimId, clock(tx));
    audit({ action: "claim.submit", entityType: "expense_claim", entityId: claimId, summary: `Submitted a ${claim.category} claim of ${claim.claimDate}` });
    return { status: claim.status };
  },
  revalidate: PATHS,
});

export const withdrawClaimAction = defineAction({
  name: "claim.withdraw",
  schema: z.object({ id }),
  permission: (user) => user.employeeId !== null,
  handler: ({ tx, user, audit }, { id: claimId }) => {
    const claim = withdrawClaim(tx, user, claimId);
    audit({ action: "claim.withdraw", entityType: "expense_claim", entityId: claimId, summary: `Withdrew a ${claim.category} claim of ${claim.claimDate}` });
    return { status: claim.status };
  },
  revalidate: PATHS,
});

export const deleteClaimAction = defineAction({
  name: "claim.delete",
  schema: z.object({ id }),
  permission: (user) => user.employeeId !== null,
  handler: ({ tx, user, audit }, { id: claimId }) => {
    const claim = deleteClaim(tx, user, claimId);
    audit({ action: "claim.delete", entityType: "expense_claim", entityId: claimId, summary: `Deleted a draft ${claim.category} claim of ${claim.claimDate}` });
    return { ok: true };
  },
  revalidate: PATHS,
});
