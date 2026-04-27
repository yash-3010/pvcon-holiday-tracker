import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { holidaySelections, holidays, leavePolicy } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  holidayId: z.number().int(),
  selected: z.boolean(),
  userId: z.number().int().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const isAdmin = session.user.role === "admin";
  const userId = parsed.data.userId && isAdmin ? parsed.data.userId : Number(session.user.id);
  const { holidayId, selected } = parsed.data;

  const h = await db.select().from(holidays).where(eq(holidays.id, holidayId)).limit(1);
  if (!h[0] || h[0].type !== "optional") {
    return NextResponse.json({ error: "Only optional holidays selectable" }, { status: 400 });
  }

  if (selected) {
    const policyRow = await db.select().from(leavePolicy).where(eq(leavePolicy.year, h[0].year)).limit(1);
    const max = policyRow[0]?.optionalHolidaysAllowed ?? 6;
    const existing = await db
      .select({ id: holidaySelections.holidayId })
      .from(holidaySelections)
      .innerJoin(holidays, eq(holidays.id, holidaySelections.holidayId))
      .where(and(eq(holidaySelections.userId, userId), eq(holidays.year, h[0].year), eq(holidays.type, "optional")));
    const alreadyHas = existing.some((e) => e.id === holidayId);
    if (!alreadyHas && existing.length >= max) {
      return NextResponse.json({ error: `Limit ${max} optional holidays reached.` }, { status: 400 });
    }
    await db.insert(holidaySelections).values({ userId, holidayId }).onConflictDoNothing();
  } else {
    await db.delete(holidaySelections).where(and(eq(holidaySelections.userId, userId), eq(holidaySelections.holidayId, holidayId)));
  }
  return NextResponse.json({ ok: true });
}
