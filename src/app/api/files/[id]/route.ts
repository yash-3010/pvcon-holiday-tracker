import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { canAccessFile } from "@/server/modules/files/access";
import { getFile, resolveStoredPath } from "@/server/modules/files/service";

const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "password change required" }, { status: 403 });
  const id = Number((await ctx.params).id);
  const file = Number.isInteger(id) ? getFile(db, id) : undefined;
  if (!file || !canAccessFile(db, user, file)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data = await readFile(resolveStoredPath(config.uploadDir, file.storageName));
  const inline = new URL(request.url).searchParams.get("inline") === "1" && INLINE_TYPES.has(file.mime);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
