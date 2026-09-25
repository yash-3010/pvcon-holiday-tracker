"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/dates";
import type { PendingProfileChange } from "@/server/modules/employees/profile-changes";
import { decideProfileChangeAction } from "./actions";

const FIELDS = [
  ["Bank name", "bankName"],
  ["Account number", "bankAccount"],
  ["IFSC", "bankIfsc"],
  ["PAN", "pan"],
  ["Aadhaar", "aadhaar"],
  ["Passport", "passport"],
] as const;

type Decision = { change: PendingProfileChange; decision: "approved" | "rejected" };

export function ProfileChangeList({
  changes,
  ownEmployeeId,
  timeZone,
}: {
  changes: PendingProfileChange[];
  ownEmployeeId: number | null;
  timeZone: string;
}) {
  const router = useRouter();
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const { run, pending } = useServerAction(decideProfileChangeAction, {
    successMessage: (d) => (d.status === "approved" ? "Change approved" : "Change rejected"),
    onSuccess: () => {
      setDeciding(null);
      setNote("");
      router.refresh();
    },
  });

  if (changes.length === 0) {
    return <EmptyState title="No pending requests" description="Bank and ID change requests from employees appear here." />;
  }

  return (
    <div className="space-y-4">
      {changes.map((change) => {
        const own = change.employeeId === ownEmployeeId;
        return (
          <Card key={change.id}>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div className="space-y-1">
                <CardTitle className="text-base">
                  <Link href={`/org/employees/${change.employeeId}?tab=bank`} className="hover:underline">
                    {change.employeeName}
                  </Link>{" "}
                  <span className="text-sm font-normal text-muted-foreground">{change.employeeCode}</span>
                </CardTitle>
                <CardDescription>
                  Bank details change · requested {formatDateTime(change.createdAt, timeZone)}
                  {change.reason ? ` · “${change.reason}”` : ""}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={own} onClick={() => setDeciding({ change, decision: "rejected" })}>
                  Reject
                </Button>
                <Button size="sm" disabled={own} onClick={() => setDeciding({ change, decision: "approved" })}>
                  Approve
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {own && <p className="mb-3 text-sm text-muted-foreground">This is your own request, so someone else has to decide it.</p>}
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Field</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead>Requested</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {FIELDS.map(([label, key]) => (
                    <TableRow key={key}>
                      <TableCell className="text-muted-foreground">{label}</TableCell>
                      <TableCell>{change.current[key] ?? "—"}</TableCell>
                      <TableCell className={change.requested[key] ? "font-medium" : "text-muted-foreground"}>
                        {change.requested[key] ?? "Unchanged"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
      <Dialog open={deciding !== null} onOpenChange={(open) => !open && setDeciding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deciding?.decision === "approved" ? "Approve this change?" : "Reject this change?"}</DialogTitle>
            <DialogDescription>
              {deciding?.decision === "approved"
                ? `The requested values replace ${deciding.change.employeeName}'s bank details.`
                : "The current bank details stay as they are."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Note (optional)" htmlFor="decision-note">
            <Textarea id="decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button
              variant={deciding?.decision === "rejected" ? "destructive" : "default"}
              disabled={pending}
              onClick={() => deciding && run({ requestId: deciding.change.id, decision: deciding.decision, note })}
            >
              {pending && <Spinner />}
              {deciding?.decision === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
