import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  categorySchema, clientSchema, projectSchema, timesheetDecisionSchema, weekSaveSchema,
} from "@/lib/validation/timesheets";

const fieldErrors = (result: { success: boolean; error?: z.ZodError }) =>
  result.success ? {} : (z.flattenError(result.error!).fieldErrors as Record<string, string[]>);

const row = { projectId: 1, taskCategoryId: 2, billable: true, notes: "", minutes: { "2026-10-19": 480, "2026-10-20": 450 } };

describe("weekSaveSchema", () => {
  it("accepts a week of quarter hours and trims notes", () => {
    const parsed = weekSaveSchema.parse({ weekStart: "2026-10-19", rows: [{ ...row, notes: "  API work  " }] });
    expect(parsed.rows[0]).toMatchObject({ notes: "API work", minutes: { "2026-10-19": 480, "2026-10-20": 450 } });
  });

  it("wants a Monday, quarter hours inside the week and one row per project and category", () => {
    expect(fieldErrors(weekSaveSchema.safeParse({ weekStart: "2026-10-18", rows: [] }))).toHaveProperty("weekStart");
    expect(fieldErrors(weekSaveSchema.safeParse({ weekStart: "2026-10-19", rows: [{ ...row, minutes: { "2026-10-19": 20 } }] }))).toHaveProperty("rows");
    expect(fieldErrors(weekSaveSchema.safeParse({ weekStart: "2026-10-19", rows: [{ ...row, minutes: { "2026-10-26": 60 } }] }))).toHaveProperty("rows");
    expect(fieldErrors(weekSaveSchema.safeParse({ weekStart: "2026-10-19", rows: [{ ...row, minutes: { "2026-10-19": 1455 } }] }))).toHaveProperty("rows");
    expect(fieldErrors(weekSaveSchema.safeParse({ weekStart: "2026-10-19", rows: [row, { ...row, billable: false }] }))).toEqual({
      rows: ["Each project and category once"],
    });
  });
});

describe("timesheetDecisionSchema", () => {
  it("needs a reason to reject but not to approve", () => {
    expect(timesheetDecisionSchema.safeParse({ timesheetId: 1, decision: "approved", note: "" }).success).toBe(true);
    expect(fieldErrors(timesheetDecisionSchema.safeParse({ timesheetId: 1, decision: "rejected", note: " " }))).toEqual({
      note: ["Say what needs fixing"],
    });
  });
});

describe("projects, clients and categories", () => {
  const project = {
    name: "Website revamp", code: "web-01", clientId: 3, billableDefault: true, status: "active", startDate: "2026-10-01",
    endDate: "", budgetHours: 400, managerEmployeeId: null,
  };

  it("normalises codes and blank dates", () => {
    expect(projectSchema.parse(project)).toMatchObject({ code: "WEB-01", endDate: null });
    expect(clientSchema.parse({ name: "Acme", code: "acme" })).toEqual({ name: "Acme", code: "ACME" });
    expect(clientSchema.parse({ name: "Acme", code: "" }).code).toBeNull();
    expect(categorySchema.parse({ name: " Meetings ", billableDefault: false })).toEqual({ name: "Meetings", billableDefault: false });
  });

  it("refuses an end before the start and odd codes", () => {
    expect(fieldErrors(projectSchema.safeParse({ ...project, endDate: "2026-09-01" }))).toHaveProperty("endDate");
    expect(fieldErrors(projectSchema.safeParse({ ...project, code: "web 01" }))).toHaveProperty("code");
    expect(fieldErrors(clientSchema.safeParse({ name: "Acme", code: "A" }))).toHaveProperty("code");
  });
});
