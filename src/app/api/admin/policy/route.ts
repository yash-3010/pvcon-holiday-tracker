import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { leavePolicy } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  year: z.number().int(),
  casualPerYear: z.number().int().min(0),
  sickPerYear: z.number().int().min(0),
  carryFwdMax: z.number().int().min(0),
  maxConsecutiveDays: z.number().int().min(1),
  optionalHolidaysAllowed: z.number().int().min(0),
});

export async function PUT(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const existing = await db.select().from(leavePolicy).where(eq(leavePolicy.year, parsed.data.year));
  if (existing.length === 0) {
    await db.insert(leavePolicy).values(parsed.data);
  } else {
    await db.update(leavePolicy).set(parsed.data).where(eq(leavePolicy.year, parsed.data.year));
  }
  return NextResponse.json({ ok: true });
}
