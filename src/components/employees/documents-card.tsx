"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, Trash2, Upload } from "lucide-react";
import { deleteEmployeeDocumentAction, uploadEmployeeDocumentAction } from "@/app/(app)/org/employees/actions";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/dates";
import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from "@/lib/hr";
import type { EmployeeDocumentView } from "@/server/modules/employees/documents";

const VIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function DocumentsCard({
  employeeId,
  documents,
  categories,
  canUpload,
  canDelete,
  timeZone,
}: {
  employeeId: number;
  documents: EmployeeDocumentView[];
  categories: readonly DocumentCategory[];
  canUpload: boolean;
  canDelete: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const upload = useServerAction(uploadEmployeeDocumentAction, {
    successMessage: "Document uploaded",
    onSuccess: () => {
      formRef.current?.reset();
      router.refresh();
    },
  });
  const remove = useServerAction(deleteEmployeeDocumentAction, { successMessage: "Document deleted", onSuccess: () => router.refresh() });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Documents</CardTitle>
        <CardDescription>PDF, PNG, JPG or WebP, up to 10 MB each.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {canUpload && (
          <form
            ref={formRef}
            className="grid items-end gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              data.set("employeeId", String(employeeId));
              void upload.run(data);
            }}
          >
            <Field label="Category" htmlFor="doc-category">
              <NativeSelect id="doc-category" name="category" defaultValue={categories[0]}>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {DOCUMENT_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Title" htmlFor="doc-title">
              <Input id="doc-title" name="title" required minLength={2} maxLength={120} />
            </Field>
            <Field label="File" htmlFor="doc-file">
              <Input id="doc-file" name="file" type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" />
            </Field>
            <Button type="submit" disabled={upload.pending}>
              {upload.pending ? <Spinner /> : <Upload />} Upload
            </Button>
          </form>
        )}
        {documents.length === 0 ? (
          <EmptyState title="No documents yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">{doc.title}</TableCell>
                  <TableCell>{DOCUMENT_CATEGORY_LABELS[doc.category]}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {doc.originalName} · {formatSize(doc.size)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(doc.createdAt, timeZone)}
                    {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {VIEWABLE.has(doc.mime) && (
                        <Button asChild variant="ghost" size="icon">
                          <a href={`/api/files/${doc.fileId}?inline=1`} target="_blank" rel="noreferrer" aria-label={`View ${doc.title}`}>
                            <Eye />
                          </a>
                        </Button>
                      )}
                      <Button asChild variant="ghost" size="icon">
                        <a href={`/api/files/${doc.fileId}`} aria-label={`Download ${doc.title}`}>
                          <Download />
                        </a>
                      </Button>
                      {canDelete && (
                        <ConfirmDialog
                          trigger={
                            <Button variant="ghost" size="icon" aria-label={`Delete ${doc.title}`}>
                              <Trash2 />
                            </Button>
                          }
                          title="Delete document?"
                          description={`"${doc.title}" is removed from this employee's documents.`}
                          confirmLabel="Delete"
                          destructive
                          onConfirm={() => remove.run({ documentId: doc.id })}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
