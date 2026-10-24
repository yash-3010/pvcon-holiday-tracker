"use server";

import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { formatPeriod, isISODate, todayInTimeZone } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PAYSLIP_STATUSES } from "@/lib/payroll/constants";
import { inputSchema, runCreateSchema } from "@/lib/validation/payroll";
import { optionalText } from "@/lib/validation/employees";
import { defineAction } from "@/server/actions/define";
import { config } from "@/server/config";
import { db } from "@/server/db";
import type { DbLike } from "@/server/db/client";
import { payslipEnv } from "@/server/modules/payroll/env";
import { addManualInput, deleteInput, importInputs, requireRun } from "@/server/modules/payroll/inputs";
import { emailPayslips, preparePayslip, prepareRelease, releasePayslip, releaseRun, requirePayslip } from "@/server/modules/payroll/payslips";
import { payslipDetail } from "@/server/modules/payroll/queries";
import { approveRun, cancelRun, computeRun, createRun, markPaid, revertRun, setPayslipStatus } from "@/server/modules/payroll/runs";
import { getSetting } from "@/server/modules/settings/service";

const id = z.number().int().positive();
const PATHS = ["/payroll/runs", "/me/payslips"];
const clock = (tx: DbLike) => {
  const now = new Date();
  return { now, today: todayInTimeZone(getSetting(tx, "locale").timezone, now) };
};
const runLabel = (tx: DbLike, runId: number) => {
  const run = requireRun(tx, runId);
  return `${formatPeriod(run.period)}${run.type === "off_cycle" ? " off-cycle" : ""} run`;
};
const canSeeRuns = (user: SessionUser) => can(user, "payroll.run") || can(user, "payroll.approve") || can(user, "payroll.release");

export const createRunAction = defineAction({
  name: "payroll.run.create",
  schema: runCreateSchema,
  permission: "payroll.run",
  handler: ({ tx, user, audit }, input) => {
    const run = createRun(tx, user.id, input, clock(tx));
    audit({ action: "payroll.run.create", entityType: "payroll_run", entityId: run.id, summary: `Created the ${runLabel(tx, run.id)}` });
    return { id: run.id };
  },
  revalidate: PATHS,
});

export const computeRunAction = defineAction({
  name: "payroll.run.compute",
  schema: z.object({ id }),
  permission: "payroll.run",
  handler: ({ tx, user, audit }, { id: runId }) => {
    const { run, payslips } = computeRun(tx, user.id, runId, clock(tx));
    audit({
      action: "payroll.run.compute", entityType: "payroll_run", entityId: runId,
      summary: `Computed the ${runLabel(tx, runId)}: ${payslips} payslip(s)`, diff: { warnings: run.warnings },
    });
    return { payslips, warnings: run.warnings.length };
  },
  revalidate: PATHS,
});

export const setPayslipStatusAction = defineAction({
  name: "payroll.payslip.status",
  schema: z.object({ runId: id, employeeId: id, status: z.enum(PAYSLIP_STATUSES) }),
  permission: "payroll.run",
  handler: ({ tx, audit }, { runId, employeeId, status }) => {
    const payslip = setPayslipStatus(tx, runId, employeeId, status);
    audit({
      action: "payroll.payslip.status", entityType: "payslip", entityId: payslip.id,
      summary: `Set ${payslip.snapshot.name}'s payslip in the ${runLabel(tx, runId)} to ${status}`,
    });
    return { status: payslip.status };
  },
  revalidate: PATHS,
});

export const approveRunAction = defineAction({
  name: "payroll.run.approve",
  schema: z.object({ id }),
  permission: "payroll.approve",
  handler: ({ tx, user, audit }, { id: runId }) => {
    approveRun(tx, user.id, runId, clock(tx));
    audit({ action: "payroll.run.approve", entityType: "payroll_run", entityId: runId, summary: `Approved the ${runLabel(tx, runId)}` });
    return { ok: true };
  },
  revalidate: PATHS,
});

export const revertRunAction = defineAction({
  name: "payroll.run.revert",
  schema: z.object({ id, note: z.string().trim().min(3, "Say why").max(300) }),
  permission: (user) => user.roles.includes("super_admin"),
  handler: ({ tx, audit }, { id: runId, note }) => {
    revertRun(tx, runId);
    audit({ action: "payroll.run.revert", entityType: "payroll_run", entityId: runId, summary: `Reverted the ${runLabel(tx, runId)}: ${note}`, diff: { note } });
    return { ok: true };
  },
  revalidate: PATHS,
});

export const releaseRunAction = defineAction({
  name: "payroll.run.release",
  schema: z.object({ id }),
  permission: "payroll.release",
  // Rendering and signing are async, so they happen before the transaction.
  prepare: async ({ id: runId }) => {
    const now = new Date();
    return { now, prepared: await prepareRelease(db, runId, payslipEnv(), { now }) };
  },
  handler: ({ tx, audit }, { id: runId }, { now, prepared }) => {
    const { payslipIds } = releaseRun(tx, runId, prepared, { now, uploadDir: config.uploadDir });
    audit({ action: "payroll.run.release", entityType: "payroll_run", entityId: runId, summary: `Released the ${runLabel(tx, runId)}: ${payslipIds.length} payslip(s)` });
    return { payslipIds, released: payslipIds.length };
  },
  revalidate: PATHS,
  after: async ({ payslipIds }) => {
    await emailPayslips(db, payslipIds, payslipEnv(), { now: new Date() });
  },
});

export const releasePayslipAction = defineAction({
  name: "payroll.payslip.release",
  schema: z.object({ payslipId: id }),
  permission: "payroll.release",
  prepare: async ({ payslipId }) => {
    const now = new Date();
    return { now, prepared: await preparePayslip(db, payslipId, payslipEnv(), { now }) };
  },
  handler: ({ tx, audit }, { payslipId }, { now, prepared }) => {
    const payslip = releasePayslip(tx, payslipId, prepared, { now, uploadDir: config.uploadDir });
    audit({ action: "payroll.payslip.release", entityType: "payslip", entityId: payslipId, summary: `Released ${payslip.snapshot.name}'s held payslip` });
    return { payslipIds: [payslipId] };
  },
  revalidate: PATHS,
  after: async ({ payslipIds }) => {
    await emailPayslips(db, payslipIds, payslipEnv(), { now: new Date() });
  },
});

export const markPaidAction = defineAction({
  name: "payroll.run.paid",
  schema: z.object({ id, paidOn: z.string().trim().refine(isISODate, "Enter a valid date"), reference: optionalText(100) }),
  permission: "payroll.run",
  handler: ({ tx, audit }, { id: runId, paidOn, reference }) => {
    markPaid(tx, runId, { paidOn, reference }, { now: new Date() });
    audit({ action: "payroll.run.paid", entityType: "payroll_run", entityId: runId, summary: `Marked the ${runLabel(tx, runId)} paid on ${paidOn}`, diff: { paidOn, reference } });
    return { ok: true };
  },
  revalidate: PATHS,
});

export const cancelRunAction = defineAction({
  name: "payroll.run.cancel",
  schema: z.object({ id }),
  permission: "payroll.run",
  handler: ({ tx, audit }, { id: runId }) => {
    cancelRun(tx, runId);
    audit({ action: "payroll.run.cancel", entityType: "payroll_run", entityId: runId, summary: `Cancelled the ${runLabel(tx, runId)}` });
    return { ok: true };
  },
  revalidate: PATHS,
});

export const addInputAction = defineAction({
  name: "payroll.input.add",
  schema: inputSchema,
  permission: "payroll.run",
  handler: ({ tx, user, audit }, input) => {
    const row = addManualInput(tx, user.id, input);
    audit({ action: "payroll.input.add", entityType: "payroll_run", entityId: input.runId, summary: `Added ${row.label} ${formatMoney(row.amount)} to the ${runLabel(tx, input.runId)}`, diff: { employeeId: row.employeeId, amount: row.amount, note: row.note } });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const deleteInputAction = defineAction({
  name: "payroll.input.delete",
  schema: z.object({ id }),
  permission: "payroll.run",
  handler: ({ tx, audit }, { id: inputId }) => {
    const row = deleteInput(tx, inputId);
    audit({ action: "payroll.input.delete", entityType: "payroll_run", entityId: row.runId, summary: `Deleted ${row.label} from the ${runLabel(tx, row.runId)}`, diff: { employeeId: row.employeeId, amount: row.amount } });
    return { ok: true };
  },
  revalidate: PATHS,
});

export const importInputsAction = defineAction({
  name: "payroll.input.import",
  schema: z.object({ runId: id, csv: z.string().min(1, "The file is empty").max(1_000_000, "The file is too large") }),
  permission: "payroll.run",
  handler: ({ tx, user, audit }, { runId, csv }) => {
    const result = importInputs(tx, user.id, runId, csv);
    if (result.added) audit({ action: "payroll.input.import", entityType: "payroll_run", entityId: runId, summary: `Imported ${result.added} input(s) into the ${runLabel(tx, runId)}` });
    return result;
  },
  revalidate: PATHS,
});

/** Read-only drill-down for the run review; not audited. */
export const payslipDetailAction = defineAction({
  name: "payroll.payslip.detail",
  schema: z.object({ payslipId: id }),
  permission: (user) => canSeeRuns(user) || can(user, "salary.view"),
  handler: ({ tx }, { payslipId }) => {
    requirePayslip(tx, payslipId);
    return payslipDetail(tx, payslipId)!;
  },
});
