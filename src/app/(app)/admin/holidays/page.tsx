import { db } from "@/db";
import { holidays } from "@/db/schema";
import { eq } from "drizzle-orm";
import { currentYear } from "@/lib/utils";
import { AdminHolidaysClient } from "./AdminHolidaysClient";

export default async function AdminHolidaysPage() {
  const year = currentYear();
  const list = await db.select().from(holidays).where(eq(holidays.year, year));
  return <AdminHolidaysClient initial={[...list].sort((a, b) => a.date.localeCompare(b.date))} year={year} />;
}
