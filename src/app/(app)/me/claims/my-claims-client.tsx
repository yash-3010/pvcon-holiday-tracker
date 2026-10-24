"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Ellipsis, Paperclip, Pencil, Plus, Send, Trash2, Undo2 } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/dates";
import { formatMoney, toMajor } from "@/lib/money";
import { CLAIM_CATEGORIES, CLAIM_CATEGORY_LABELS, CLAIM_STATUS_BADGE, CLAIM_STATUS_LABELS } from "@/lib/payroll/constants";
import type { ClaimListItem } from "@/server/modules/payroll/queries";
import { deleteClaimAction, saveClaimAction, submitClaimAction, withdrawClaimAction } from "./actions";

function ClaimSheet({ open, onOpenChange, editing, today }: { open: boolean; onOpenChange: (open: boolean) => void; editing: ClaimListItem | null; today: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const { run, pending } = useServerAction(saveClaimAction, {
    successMessage: (d) => (d.status === "submitted" ? "Claim submitted for approval" : "Claim saved as a draft"),
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
    onError: (r) => setErrors(r.fieldErrors ?? {}),
  });
  const send = (form: HTMLFormElement, submit: boolean) => {
    const data = new FormData(form);
    if (editing) data.set("id", String(editing.id));
    if (submit) data.set("submit", "1");
    setErrors({});
    void run(data);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Edit claim" : "New claim"}</SheetTitle>
          <SheetDescription>Attach the receipt or invoice (PDF or image, up to 5 MB) before submitting.</SheetDescription>
        </SheetHeader>
        <form
          key={editing?.id ?? "new"}
          onSubmit={(e) => {
            e.preventDefault();
            send(e.currentTarget, true);
          }}
          className="flex flex-1 flex-col gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="claim-category" error={errors.category?.[0]}>
              <NativeSelect id="claim-category" name="category" defaultValue={editing?.category ?? "travel"}>
                {CLAIM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CLAIM_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Date" htmlFor="claim-date" error={errors.claimDate?.[0]} required>
              <Input id="claim-date" name="claimDate" type="date" max={today} defaultValue={editing?.claimDate ?? today} required />
            </Field>
          </div>
          <Field label="Amount (₹)" htmlFor="claim-amount" error={errors.amount?.[0]} required>
            <Input id="claim-amount" name="amount" type="number" step="0.01" min={0.01} defaultValue={editing ? toMajor(editing.amount) : ""} required />
          </Field>
          <Field label="What it was for" htmlFor="claim-description" error={errors.description?.[0]} required>
            <Textarea id="claim-description" name="description" rows={3} maxLength={300} defaultValue={editing?.description ?? ""} required />
          </Field>
          <Field
            label="Receipt"
            htmlFor="claim-receipt"
            error={errors.receipt?.[0]}
            hint={editing?.receiptFileId ? "A receipt is attached; choose a file to replace it." : undefined}
          >
            <Input id="claim-receipt" name="receipt" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" />
          </Field>
          <SheetFooter className="gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={(e) => send(e.currentTarget.form!, false)}>
              Save draft
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Submit
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function MyClaimsClient({ claims, today }: { claims: ClaimListItem[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClaimListItem | null>(null);
  const submit = useServerAction(submitClaimAction, { successMessage: "Claim submitted for approval", onSuccess: () => router.refresh() });
  const withdraw = useServerAction(withdrawClaimAction, { successMessage: "Claim withdrawn to draft", onSuccess: () => router.refresh() });
  const remove = useServerAction(deleteClaimAction, { successMessage: "Draft deleted", onSuccess: () => router.refresh() });
  const openSheet = (claim: ClaimListItem | null) => {
    setEditing(claim);
    setOpen(true);
  };
  const columns: ColumnDef<ClaimListItem>[] = [
    { id: "date", header: "Date", accessorFn: (c) => c.claimDate, cell: ({ row }) => formatDate(row.original.claimDate) },
    {
      id: "expense",
      header: "Expense",
      accessorFn: (c) => `${CLAIM_CATEGORY_LABELS[c.category]} ${c.description}`,
      cell: ({ row }) => (
        <div>
          <p>{CLAIM_CATEGORY_LABELS[row.original.category]}</p>
          <p className="text-xs text-muted-foreground">{row.original.description}</p>
          {row.original.status === "rejected" && row.original.decisionNote && (
            <p className="text-xs text-destructive">Rejected: {row.original.decisionNote}</p>
          )}
        </div>
      ),
    },
    { id: "amount", header: "Amount", accessorFn: (c) => c.amount, cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.amount)}</span> },
    {
      id: "receipt",
      header: "Receipt",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.receiptFileId ? (
          <a href={`/api/files/${row.original.receiptFileId}?inline=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            <Paperclip className="size-3.5" /> View
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">None</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (c) => c.status,
      cell: ({ row }) => <Badge variant={CLAIM_STATUS_BADGE[row.original.status]}>{CLAIM_STATUS_LABELS[row.original.status]}</Badge>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const c = row.original;
        if (c.status !== "draft" && c.status !== "submitted") return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for the claim of ${formatDate(c.claimDate)}`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {c.status === "draft" && (
                <>
                  <DropdownMenuItem onSelect={() => openSheet(c)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!c.receiptFileId} onSelect={() => submit.run({ id: c.id })}>
                    <Send /> Submit
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => remove.run({ id: c.id })}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </>
              )}
              {c.status === "submitted" && (
                <DropdownMenuItem onSelect={() => withdraw.run({ id: c.id })}>
                  <Undo2 /> Withdraw
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        data={claims}
        searchPlaceholder="Search claims…"
        toolbar={
          <Button onClick={() => openSheet(null)}>
            <Plus /> New claim
          </Button>
        }
      />
      <ClaimSheet open={open} onOpenChange={setOpen} editing={editing} today={today} />
    </>
  );
}
