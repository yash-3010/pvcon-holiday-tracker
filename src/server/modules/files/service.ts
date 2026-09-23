import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DbLike } from "@/server/db/client";
import { files, type FileRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { sha256Hex } from "@/server/lib/crypto";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export type FileKind = "pdf" | "png" | "jpeg" | "webp" | "csv";

export const MIME_BY_KIND: Record<FileKind, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
};

/** Detects the real type from magic bytes; CSV is accepted only by extension and absence of NUL bytes. */
export function sniffKind(data: Buffer, originalName: string): FileKind | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  if (/\.csv$/i.test(originalName) && !data.includes(0)) return "csv";
  return null;
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "file";
}

export function resolveStoredPath(uploadDir: string, storageName: string): string {
  const root = path.resolve(uploadDir);
  const full = path.resolve(root, storageName);
  if (!full.startsWith(root + path.sep)) throw new DomainError("BAD_PATH", "Invalid file path.");
  return full;
}

export interface SaveUploadInput {
  data: Buffer;
  originalName: string;
  allowed: FileKind[];
  uploadedBy: number | null;
  uploadDir: string;
  maxBytes?: number;
  now?: Date;
}

export function saveUpload(db: DbLike, input: SaveUploadInput): FileRow {
  const maxBytes = input.maxBytes ?? MAX_UPLOAD_BYTES;
  if (input.data.length === 0) throw new DomainError("EMPTY_FILE", "The file is empty.");
  if (input.data.length > maxBytes) {
    throw new DomainError("FILE_TOO_LARGE", `Files must be ${Math.floor(maxBytes / 1024 / 1024) || 1} MB or smaller.`);
  }
  const kind = sniffKind(input.data, input.originalName);
  if (!kind || !input.allowed.includes(kind)) {
    throw new DomainError("FILE_TYPE", `Allowed file types: ${input.allowed.join(", ")}.`);
  }
  const now = input.now ?? new Date();
  const storageName = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  const fullPath = resolveStoredPath(input.uploadDir, storageName);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, input.data, { flag: "wx" });
  return db
    .insert(files)
    .values({
      storageName,
      originalName: sanitizeFileName(input.originalName),
      mime: MIME_BY_KIND[kind],
      size: input.data.length,
      sha256: sha256Hex(input.data),
      uploadedBy: input.uploadedBy,
    })
    .returning()
    .get();
}

export function getFile(db: DbLike, id: number): FileRow | undefined {
  return db.select().from(files).where(eq(files.id, id)).get();
}
