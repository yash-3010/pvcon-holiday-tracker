import { desc, eq } from "drizzle-orm";
import type { DocumentCategory } from "@/lib/hr";
import type { DbLike } from "@/server/db/client";
import { employeeDocuments, files, users, type EmployeeDocumentRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { requireEmployee } from "./service";

export interface NewEmployeeDocument {
  employeeId: number;
  category: DocumentCategory;
  title: string;
  fileId: number;
  uploadedBy: number | null;
}

export interface EmployeeDocumentView {
  id: number;
  employeeId: number;
  fileId: number;
  category: DocumentCategory;
  title: string;
  originalName: string;
  size: number;
  mime: string;
  uploadedByName: string | null;
  createdAt: string;
}

export function addEmployeeDocument(db: DbLike, input: NewEmployeeDocument): EmployeeDocumentRow {
  requireEmployee(db, input.employeeId);
  return db.insert(employeeDocuments).values(input).returning().get();
}

export function getEmployeeDocument(db: DbLike, id: number): EmployeeDocumentRow | undefined {
  return db.select().from(employeeDocuments).where(eq(employeeDocuments.id, id)).get();
}

/** Removes the document record; the stored file stays (readable only by its uploader and super admins). */
export function deleteEmployeeDocument(db: DbLike, id: number): EmployeeDocumentRow {
  const doc = getEmployeeDocument(db, id);
  if (!doc) throw new DomainError("NOT_FOUND", "Document not found.");
  db.delete(employeeDocuments).where(eq(employeeDocuments.id, id)).run();
  return doc;
}

export function listEmployeeDocuments(db: DbLike, employeeId: number): EmployeeDocumentView[] {
  return db
    .select({
      id: employeeDocuments.id,
      employeeId: employeeDocuments.employeeId,
      fileId: employeeDocuments.fileId,
      category: employeeDocuments.category,
      title: employeeDocuments.title,
      originalName: files.originalName,
      size: files.size,
      mime: files.mime,
      uploadedByName: users.name,
      createdAt: employeeDocuments.createdAt,
    })
    .from(employeeDocuments)
    .innerJoin(files, eq(files.id, employeeDocuments.fileId))
    .leftJoin(users, eq(users.id, employeeDocuments.uploadedBy))
    .where(eq(employeeDocuments.employeeId, employeeId))
    .orderBy(desc(employeeDocuments.createdAt), desc(employeeDocuments.id))
    .all();
}
