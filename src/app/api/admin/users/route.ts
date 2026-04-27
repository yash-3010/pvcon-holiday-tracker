import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import bcrypt from "bcryptjs";
import { z } from "zod";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "pvcon.in";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().transform((s) => s.toLowerCase()),
  joinedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role: z.enum(["admin", "employee"]).default("employee"),
});

function tempPassword() {
  const rand = Math.random().toString(36).slice(2, 6);
  return `Pvcon@${rand}`;
}

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const all = await db.select().from(users);
  return NextResponse.json(all);
}

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  if (!parsed.data.email.endsWith("@" + ALLOWED_DOMAIN)) {
    return NextResponse.json({ error: `Email must end with @${ALLOWED_DOMAIN}` }, { status: 400 });
  }
  const pw = tempPassword();
  const hash = await bcrypt.hash(pw, 10);
  const inserted = await db.insert(users).values({
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash: hash,
    role: parsed.data.role,
    joinedDate: parsed.data.joinedDate,
    mustChangePassword: true,
  }).returning();
  return NextResponse.json({ user: inserted[0], tempPassword: pw });
}
