"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Upload } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import type { RunInputItem } from "@/server/modules/payroll/queries";
import { addInputAction, deleteInputAction, importInputsAction } from "../actions";

const SOURCE_LABELS: Record<string, string> = { manual: "Entered", claim: "Claim", loan: "Loan", arrear: "Arrears", encashment: "Encashment" };

export function InputsCard({
  runId, inputs, editable, people, components,
}: {
  runId: number;
  inputs: RunInputItem[];
  editable: boolean;
  people: { id: number; name: string; code: string }[];
  components: { id: number; code: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(people[0]?.id ?? 0);
  const [componentId, setComponentId] = useState(components[0]?.id ?? 0);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const add = useServerAction(addInputAction, {
    successMessage: "Input added",
    onSuccess: () => {
      setOpen(false);
      setAmount("");
      setNote("");
      router.refresh();
    },
    onError: (r) => setErrors(r.fieldErrors ?? {}),
  });
  const remove = useServerAction(deleteInputAction, { successMessage: "Input deleted", onSuccess: () => router.refresh() });
  const importCsv = useServerAction(importInputsAction, {
    successMessage: (d) => (d.errors.length ? "" : `${d.added} input(s) imported`),
    onSuccess: (d) => {
      setImportErrors(d.errors);
      if (d.added) router.refresh();
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Inputs</CardTitle>
          <CardDescription>
            One-time amounts entered for this run, plus claims, loan EMIs and arrears the run adds itself. Changing them sends a computed run
            back to draft.
          </CardDescription>
        </div>
        {editable && (
          <div className="flex shrink-0 gap-2">
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setImportErrors([]);
                void importCsv.run({ runId, csv: await f.text() });
              }}
            />
            <Button variant="outline" size="sm" disabled={importCsv.pending} onClick={() => file.current?.click()}>
              {importCsv.pending ? <Spinner /> : <Upload />} Import CSV
            </Button>
            <Button size="sm" onClick={() => setOpen(true)} disabled={!people.length || !components.length}>
              <Plus /> Add input
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {importErrors.length > 0 && (
          <Alert variant="destructive" title="Nothing was imported">
            <ul className="list-disc pl-4">
              {importErrors.slice(0, 10).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            {importErrors.length > 10 && <p>…and {importErrors.length - 10} more.</p>}
          </Alert>
        )}
        {editable && (
          <p className="text-xs text-muted-foreground">
            CSV columns: <code>employee_code, component_code, amount, note</code> (amount in rupees). Every row must be valid.
          </p>
        )}
        {inputs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No inputs.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Line</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {inputs.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.employeeName}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {i.label}
                      <Badge variant={i.source === "manual" ? "secondary" : "info"}>{SOURCE_LABELS[i.source] ?? i.source}</Badge>
                    </div>
                    {i.note && <div className="text-xs text-muted-foreground">{i.note}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(i.amount)}</TableCell>
                  <TableCell className="text-right">
                    {editable && i.source === "manual" && (
                      <Button variant="ghost" size="icon" aria-label={`Delete ${i.label} for ${i.employeeName}`} disabled={remove.pending} onClick={() => remove.run({ id: i.id })}>
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an input</DialogTitle>
            <DialogDescription>A one-time amount for this run, e.g. a bonus or a deduction.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setErrors({});
              void add.run({ runId, employeeId, componentId, amount: Number(amount), note });
            }}
            className="space-y-4"
          >
            <Field label="Employee" htmlFor="input-employee" error={errors.employeeId?.[0]}>
              <NativeSelect id="input-employee" value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Component" htmlFor="input-component" error={errors.componentId?.[0]}>
                <NativeSelect id="input-component" value={componentId} onChange={(e) => setComponentId(Number(e.target.value))}>
                  {components.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Amount (₹)" htmlFor="input-amount" error={errors.amount?.[0]} required>
                <Input id="input-amount" type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </Field>
            </div>
            <Field label="Note" htmlFor="input-note" error={errors.note?.[0]}>
              <Input id="input-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={add.pending}>
                {add.pending && <Spinner />}
                Add input
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
