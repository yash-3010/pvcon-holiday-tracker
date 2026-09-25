import { z } from "zod";
import { CHECKLIST_KINDS, CHECKLIST_OWNERS } from "@/lib/hr";
import { optionalText } from "./employees";

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  code: optionalText(12)
    .refine((v) => v === null || /^[A-Za-z0-9-]+$/.test(v), "Letters, digits and dashes only")
    .transform((v) => v?.toUpperCase() ?? null),
  parentId: z.number().int().positive().nullable(),
  headEmployeeId: z.number().int().positive().nullable(),
});
export type DepartmentInput = z.output<typeof departmentSchema>;

export const designationSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  level: z.number().int().min(0).max(99).nullable(),
});
export type DesignationInput = z.output<typeof designationSchema>;

export const checklistTemplateSchema = z.object({
  kind: z.enum(CHECKLIST_KINDS),
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(2, "At least 2 characters").max(160),
        owner: z.enum(CHECKLIST_OWNERS),
      }),
    )
    .min(1, "Add at least one item")
    .max(50, "At most 50 items"),
  isDefault: z.boolean(),
});
export type ChecklistTemplateInput = z.output<typeof checklistTemplateSchema>;
