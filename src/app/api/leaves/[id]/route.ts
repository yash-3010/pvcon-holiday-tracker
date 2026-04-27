import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { leaves } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.number().positive().optional(),
  type: z.enum(["casual", "sick", "unpaid"]).optional(),
  reason: z.string().max(500).nullable().optional(),
  status: z.enum(["planned", "taken", "cancelled"]).optional(),
});

async function getLeave(id: number) {
  const r = await db.select().from(leaves).where(eq(leaves.id, id)).limit(1);
  return r[0];
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const leave = await getLeave(Number(id));
  if (!leave) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (session.user.role !== "admin" && leave.userId !== Number(session.user.id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  await db.update(leaves).set({ ...parsed.data, updatedAt: new Date().toISOString() }).where(eq(leaves.id, leave.id));
  const updated = await getLeave(leave.id);
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const leave = await getLeave(Number(id));
  if (!leave) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (session.user.role !== "admin" && leave.userId !== Number(session.user.id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  await db.delete(leaves).where(eq(leaves.id, leave.id));
  return NextResponse.json({ ok: true });
}
