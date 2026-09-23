import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import type { FileRow } from "@/server/db/schema";
import { getSetting } from "@/server/modules/settings/service";

export type FileAccessResolver = (db: DbLike, user: SessionUser, file: FileRow) => boolean;

/**
 * A file is readable when any resolver allows it.
 * Later phases append resolvers here (employee documents, payslips, receipts, …).
 */
const RESOLVERS: FileAccessResolver[] = [
  (_db, user, file) => file.uploadedBy === user.id,
  (_db, user) => user.roles.includes("super_admin"),
  (db, _user, file) => getSetting(db, "company").logoFileId === file.id,
];

export function canAccessFile(db: DbLike, user: SessionUser, file: FileRow): boolean {
  return RESOLVERS.some((resolve) => resolve(db, user, file));
}
