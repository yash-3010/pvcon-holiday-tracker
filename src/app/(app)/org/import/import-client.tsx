"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, FileUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { useServerAction } from "@/components/forms/use-server-action";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IMPORT_COLUMNS, IMPORT_TEMPLATE_CSV } from "@/lib/validation/employee-import";
import type { ImportPreview } from "@/server/modules/employees/import";
import { commitImportAction, previewImportAction } from "./actions";

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([IMPORT_TEMPLATE_CSV], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "pvcon-employee-import-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportClient() {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<{ created: number; codes: string[] } | null>(null);
  const check = useServerAction(previewImportAction, { onSuccess: (result) => setPreview(result) });
  const commit = useServerAction(commitImportAction, {
    onSuccess: (result) => {
      setDone(result);
      setPreview(null);
      setCsv(null);
      toast.success(`Imported ${result.created} employee(s)`);
    },
  });
  const ready = preview !== null && preview.fileErrors.length === 0 && preview.invalid === 0 && preview.valid > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Prepare the file</CardTitle>
          <CardDescription>
            Only first_name and date_of_joining are required. Departments and designations must already exist; managers are matched by
            work email (a new manager must be on an earlier row).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download /> Download template
          </Button>
          <p className="text-xs text-muted-foreground">
            Columns: <span className="font-mono">{IMPORT_COLUMNS.join(", ")}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Check it</CardTitle>
          <CardDescription>Nothing is saved until you import. Imported employees get no login and no onboarding checklist.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field label="CSV file" htmlFor="import-file">
            <Input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                setPreview(null);
                setDone(null);
                setFileName(file?.name ?? "");
                setCsv(file ? await file.text() : null);
              }}
            />
          </Field>
          <Button disabled={!csv || check.pending} onClick={() => csv && check.run({ csv })}>
            {check.pending ? <Spinner /> : <FileUp />} Check file
          </Button>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-base">3. Import</CardTitle>
              <CardDescription>
                {fileName}: {preview.valid} ready, {preview.invalid} with errors.
              </CardDescription>
            </div>
            <Button disabled={!ready || commit.pending} onClick={() => csv && commit.run({ csv })}>
              {commit.pending ? <Spinner /> : <Upload />} Import {preview.valid} employee(s)
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.fileErrors.map((error) => (
              <Alert key={error} variant="destructive" title={error} />
            ))}
            {preview.rows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Row</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Work email</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Check</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={row.row}>
                      <TableCell>{row.row}</TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.workEmail ?? "—"}</TableCell>
                      <TableCell>{row.employeeCode ?? "auto"}</TableCell>
                      <TableCell>
                        {row.errors.length === 0 ? (
                          <Badge variant="success">Ready</Badge>
                        ) : (
                          <ul className="space-y-0.5 text-xs text-destructive">
                            {row.errors.map((error) => (
                              <li key={error}>{error}</li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {done && (
        <Alert variant="success" title={`Imported ${done.created} employee(s)`}>
          {done.codes.join(", ")} ·{" "}
          <Link href="/org/employees" className="text-primary hover:underline">
            View employees
          </Link>
        </Alert>
      )}
    </div>
  );
}
