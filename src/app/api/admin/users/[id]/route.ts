import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  joinedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  active: z.boolean().optional(),
  role: z.enum(["admin", "employee"]).optional(),
  resetPassword: z.boolean().optional(),
});

function tempPassword() {
  const rand = Math.random().toString(36).slice(2, 6);
  return `Pvcon@${rand}`;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.joinedDate !== undefined) updates.joinedDate = parsed.data.joinedDate;
  if (parsed.data.active !== undefined) updates.active = parsed.data.active;
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;

  let tempPw: string | undefined;
  if (parsed.data.resetPassword) {
    tempPw = tempPassword();
    updates.passwordHash = await bcrypt.hash(tempPw, 10);
    updates.mustChangePassword = true;
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true });
  await db.update(users).set(updates).where(eq(users.id, Number(id)));
  return NextResponse.json({ ok: true, tempPassword: tempPw });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  if (Number(id) === Number(session.user.id)) return NextResponse.json({ error: "Cannot delete self" }, { status: 400 });
  await db.delete(users).where(eq(users.id, Number(id)));
  return NextResponse.json({ ok: true });
}
