"use server";

import { z } from "zod";
import { defineAction } from "@/server/actions/define";
import { commitEmployeeImport, previewEmployeeImport } from "@/server/modules/employees/import";

const csvSchema = z.object({
  csv: z.string().min(1, "Choose a CSV file").max(1_000_000, "Files over 1 MB are too large"),
});

/** Read-only dry run (spec §5.1): nothing is written, so there is nothing to audit. */
export const previewImportAction = defineAction({
  name: "employees.import_preview",
  schema: csvSchema,
  permission: "employee.import",
  handler: ({ tx }, { csv }) => previewEmployeeImport(tx, csv),
});

export const commitImportAction = defineAction({
  name: "employees.import",
  schema: csvSchema,
  permission: "employee.import",
  handler: ({ tx, user, audit }, { csv }) => {
    const result = commitEmployeeImport(tx, user, csv);
    audit({ action: "employee.import", entityType: "employee", summary: `Imported ${result.created} employee(s): ${result.codes.join(", ")}` });
    return result;
  },
  revalidate: ["/org/employees"],
});
