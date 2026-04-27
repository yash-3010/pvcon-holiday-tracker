import { auth } from "@/auth";
import { db } from "@/db";
import { holidays, holidaySelections } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { currentYear } from "@/lib/utils";
import { HolidaysClient } from "./HolidaysClient";

export default async function HolidaysPage() {
  const session = await auth();
  const userId = Number(session!.user.id);
  const year = currentYear();
  const all = await db.select().from(holidays).where(eq(holidays.year, year));
  const sel = await db
    .select({ holidayId: holidaySelections.holidayId })
    .from(holidaySelections)
    .where(eq(holidaySelections.userId, userId));
  const selectedIds = new Set(sel.map((s) => s.holidayId));
  const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date));
  return <HolidaysClient holidays={sorted} initiallySelected={Array.from(selectedIds)} year={year} />;
}
