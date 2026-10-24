import { z } from "zod";
import { isISODate } from "@/lib/dates";

const date = z.string().trim().refine(isISODate, "Enter a valid date");

export const announcementSchema = z.object({
  title: z.string().trim().min(1, "Required").max(120),
  body: z.string().trim().min(1, "Required").max(5000),
  pinned: z.boolean(),
  /** Shown from the start of this day (company time zone). */
  publishOn: date,
  /** Shown through the end of this day; null keeps it up. */
  showUntil: date.nullable(),
});
export type AnnouncementInput = z.output<typeof announcementSchema>;
