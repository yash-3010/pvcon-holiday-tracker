import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { clockSnapshot } from "@/server/modules/clock/queries";

/** The signed-in person's work clock, for tabs catching up after a change elsewhere (another tab, the phone). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "password change required" }, { status: 403 });
  if (user.employeeId === null) return NextResponse.json({ error: "no employee record" }, { status: 404 });
  return NextResponse.json(clockSnapshot(db, user.employeeId, new Date()), { headers: { "Cache-Control": "private, no-store" } });
}
