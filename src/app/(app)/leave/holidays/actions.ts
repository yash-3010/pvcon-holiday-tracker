"use server";

import { z } from "zod";
import { holidaySchema, holidayYearConfigSchema } from "@/lib/validation/leave";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import {
  copyHolidaysFromYear, createHoliday, deleteHoliday, getYearConfig, importHolidaysCsv, setYearConfig, updateHoliday,
} from "@/server/modules/holidays/service";

const id = z.number().int().positive();
const year = z.number().int().min(2000).max(2100);
const PATHS = ["/leave/holidays", "/me/leave", "/team/calendar"];

export const createHolidayAction = defineAction({
  name: "holidays.create",
  schema: holidaySchema,
  permission: "holiday.manage",
  handler: ({ tx, audit }, input) => {
    const row = createHoliday(tx, input);
    audit({ action: "holiday.create", entityType: "holiday", entityId: row.id, summary: `Added ${row.type} holiday ${row.name} on ${row.date}` });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateHolidayAction = defineAction({
  name: "holidays.update",
  schema: holidaySchema.extend({ id }),
  permission: "holiday.manage",
  handler: ({ tx, audit }, { id, ...input }) => {
    const { before, after } = updateHoliday(tx, id, input);
    audit({
      action: "holiday.update", entityType: "holiday", entityId: id, summary: `Updated holiday ${after.name}`,
      diff: diffObjects(before, after),
    });
    return { id };
  },
  revalidate: PATHS,
});

export const deleteHolidayAction = defineAction({
  name: "holidays.delete",
  schema: z.object({ id }),
  permission: "holiday.manage",
  handler: ({ tx, audit }, { id }) => {
    const row = deleteHoliday(tx, id);
    audit({ action: "holiday.delete", entityType: "holiday", entityId: id, summary: `Removed holiday ${row.name} on ${row.date}` });
    return { id };
  },
  revalidate: PATHS,
});

export const setYearConfigAction = defineAction({
  name: "holidays.year_config",
  schema: holidayYearConfigSchema,
  permission: "holiday.manage",
  handler: ({ tx, audit }, { year, optionalAllowed }) => {
    const before = getYearConfig(tx, year);
    setYearConfig(tx, year, optionalAllowed);
    audit({
      action: "holiday_year.update", entityType: "holiday_year", entityId: year,
      summary: `Set ${optionalAllowed} optional holiday(s) for ${year}`,
      diff: diffObjects({ optionalAllowed: before.optionalAllowed }, { optionalAllowed }),
    });
    return { year, optionalAllowed };
  },
  revalidate: PATHS,
});

export const importHolidaysAction = defineAction({
  name: "holidays.import",
  schema: z.object({ csv: z.string().min(1, "Choose a CSV file").max(200_000, "Files over 200 KB are too large") }),
  permission: "holiday.manage",
  handler: ({ tx, audit }, { csv }) => {
    const result = importHolidaysCsv(tx, csv);
    if (result.created > 0) audit({ action: "holiday.import", entityType: "holiday", summary: `Imported ${result.created} holiday(s)` });
    return result;
  },
  revalidate: PATHS,
});

export const copyHolidaysAction = defineAction({
  name: "holidays.copy",
  schema: z.object({ fromYear: year, toYear: year }),
  permission: "holiday.manage",
  handler: ({ tx, audit }, { fromYear, toYear }) => {
    const result = copyHolidaysFromYear(tx, fromYear, toYear);
    audit({
      action: "holiday.copy", entityType: "holiday", entityId: toYear,
      summary: `Copied ${result.created} holiday(s) from ${fromYear} to ${toYear} (${result.skipped} skipped)`,
    });
    return result;
  },
  revalidate: PATHS,
});
