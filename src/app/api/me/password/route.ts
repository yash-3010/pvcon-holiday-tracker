import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";

const schema = z.object({
  current: z.string().min(1),
  next: z.string().min(8),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const userId = Number(session.user.id);
  const found = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = found[0];
  if (!u) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ok = await bcrypt.compare(parsed.data.current, u.passwordHash);
  if (!ok) return NextResponse.json({ error: "Current password incorrect" }, { status: 400 });

  const hash = await bcrypt.hash(parsed.data.next, 10);
  await db.update(users).set({ passwordHash: hash, mustChangePassword: false }).where(eq(users.id, userId));

  return NextResponse.json({ ok: true });
}
