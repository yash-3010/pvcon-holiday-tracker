"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useServerAction } from "@/components/forms/use-server-action";
import { RequestStatusBadge } from "@/components/attendance/request-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { COMP_OFF_LOT_STATUS_LABELS } from "@/lib/attendance";
import { diffDays, formatDate, formatMinutes } from "@/lib/dates";
import { formatDays } from "@/lib/leave";
import type { CompOffClaimRow, CompOffLotRow } from "@/server/db/schema";
import type { EligibleOffDay } from "@/server/modules/compoff/service";
import { claimCompOffAction, withdrawCompOffClaimAction } from "./actions";

const LOT_BADGE = { active: "success", consumed: "secondary", expired: "destructive", paid_out: "info" } as const;

function ClaimDialog({ day, onClose }: { day: EligibleOffDay | null; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const { run, pending } = useServerAction(claimCompOffAction, {
    successMessage: "Comp-off claimed; your manager will review it",
    onSuccess: () => {
      setReason("");
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open={day !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Claim comp-off</DialogTitle>
          <DialogDescription>
            {day && `${formatDays(day.days)} for ${formatMinutes(day.workedMinutes)} worked on ${formatDate(day.date, { weekday: "long", day: "numeric", month: "long" })}.`}
          </DialogDescription>
        </DialogHeader>
        <Field label="Note for your manager (optional)" htmlFor="claim-note">
          <Textarea id="claim-note" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What the work was" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => day && run({ workedDate: day.date, reason: reason || null })}>
            {pending && <Spinner />}
            Claim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EligibleDays({ days, windowDays }: { days: EligibleOffDay[]; windowDays: number }) {
  const [claiming, setClaiming] = useState<EligibleOffDay | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Days you can claim</CardTitle>
        <CardDescription>Work on a weekly off or holiday in the last {windowDays} days that hasn&apos;t been claimed yet.</CardDescription>
      </CardHeader>
      <CardContent className={days.length ? "p-0" : undefined}>
        {days.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to claim right now.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Day worked</TableHead>
                <TableHead>Worked</TableHead>
                <TableHead>Earns</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((d) => (
                <TableRow key={d.date}>
                  <TableCell className="whitespace-nowrap">{formatDate(d.date, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                  <TableCell className="tabular-nums">{formatMinutes(d.workedMinutes)}</TableCell>
                  <TableCell>{formatDays(d.days)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" onClick={() => setClaiming(d)}>
                      Claim
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ClaimDialog day={claiming} onClose={() => setClaiming(null)} />
    </Card>
  );
}

export function Lots({ lots, today }: { lots: CompOffLotRow[]; today: string }) {
  if (lots.length === 0) {
    return <EmptyState title="No comp-off earned yet" description="Approved claims and grants from HR appear here with their expiry dates." />;
  }
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Earned for</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Left</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lots.map((l) => {
              const soon = l.status === "active" && l.remaining > 0 && diffDays(today, l.expiresOn) <= 7;
              return (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(l.earnedOn)}</TableCell>
                  <TableCell className="tabular-nums">{l.days}</TableCell>
                  <TableCell className="tabular-nums">{l.remaining}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(l.expiresOn)}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      <Badge variant={LOT_BADGE[l.status]}>{COMP_OFF_LOT_STATUS_LABELS[l.status]}</Badge>
                      {soon && <Badge variant="warning">Expires soon</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-60 text-xs text-muted-foreground">{l.note}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function Claims({ claims }: { claims: CompOffClaimRow[] }) {
  const router = useRouter();
  const withdraw = useServerAction(withdrawCompOffClaimAction, { successMessage: "Claim withdrawn", onSuccess: () => router.refresh() });
  if (claims.length === 0) return <EmptyState title="No claims yet" description="Claims you make appear here with your manager's decision." />;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Day worked</TableHead>
              <TableHead>Worked</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {claims.map((c) => (
              <TableRow key={c.id} data-testid={`compoff-claim-${c.id}`}>
                <TableCell className="whitespace-nowrap">{formatDate(c.workedDate)}</TableCell>
                <TableCell className="tabular-nums">{formatMinutes(c.workedMinutes)}</TableCell>
                <TableCell className="tabular-nums">{c.daysRequested}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    <RequestStatusBadge status={c.status} />
                    {c.resolution === "payout" && <Badge variant="info">Paid out</Badge>}
                  </span>
                </TableCell>
                <TableCell className="max-w-72 text-xs text-muted-foreground">
                  {[c.reason, c.decisionNote ? `“${c.decisionNote}”` : null].filter(Boolean).join(" · ")}
                </TableCell>
                <TableCell className="text-right">
                  {c.status === "pending" && (
                    <Button size="sm" variant="outline" disabled={withdraw.pending} onClick={() => withdraw.run({ claimId: c.id })}>
                      Withdraw
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
