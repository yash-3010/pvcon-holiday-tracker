import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { leaves } from "@/db/schema";
import { z } from "zod";
import { eq, and, gte, lte } from "drizzle-orm";
import { workingDaysBetween, getYearHolidayDates, getPolicy } from "@/lib/leaves";

const createSchema = z.object({
  userId: z.number().int().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().positive().optional(),
  type: z.enum(["casual", "sick", "unpaid"]),
  reason: z.string().max(500).optional().nullable(),
  status: z.enum(["planned", "taken", "cancelled"]).default("planned"),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());
  const targetUserId = searchParams.get("userId");
  const isAdmin = session.user.role === "admin";
  const userId = targetUserId && isAdmin ? Number(targetUserId) : Number(session.user.id);

  const rows = await db
    .select()
    .from(leaves)
    .where(and(eq(leaves.userId, userId), gte(leaves.startDate, `${year}-01-01`), lte(leaves.startDate, `${year}-12-31`)));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", detail: parsed.error.flatten() }, { status: 400 });

  const isAdmin = session.user.role === "admin";
  const userId = parsed.data.userId && isAdmin ? parsed.data.userId : Number(session.user.id);
  const { startDate, endDate, type, reason, status } = parsed.data;
  if (endDate < startDate) return NextResponse.json({ error: "End before start" }, { status: 400 });

  const year = Number(startDate.slice(0, 4));
  const holidaySet = await getYearHolidayDates(year);
  const policy = await getPolicy(year);
  const computed = workingDaysBetween(startDate, endDate, holidaySet);
  const days = parsed.data.days ?? computed;

  if (computed > policy.maxConsecutiveDays && !isAdmin) {
    return NextResponse.json(
      { error: `Max ${policy.maxConsecutiveDays} consecutive working days allowed.` },
      { status: 400 }
    );
  }

  const inserted = await db.insert(leaves).values({
    userId, startDate, endDate, days, type, reason: reason ?? null, status,
  }).returning();
  return NextResponse.json(inserted[0]);
}
