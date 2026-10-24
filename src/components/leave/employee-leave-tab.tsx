import Link from "next/link";
import { BalanceCards } from "@/components/leave/balance-cards";
import { formatLeaveRange } from "@/components/leave/format";
import { LeaveStatusBadge } from "@/components/leave/leave-status-badge";
import { LeaveTypeTag } from "@/components/leave/leave-type-tag";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LeaveBalance } from "@/server/modules/leave/ledger";
import type { LeaveRequestView } from "@/server/modules/leave/queries";

/** The profile Leave tab: this leave year's balances and the latest requests. */
export function EmployeeLeaveTab({
  employeeId,
  yearLabel,
  balances,
  recent,
  showRegisterLinks,
}: {
  employeeId: number;
  yearLabel: string;
  balances: LeaveBalance[];
  recent: LeaveRequestView[];
  showRegisterLinks: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Balances for leave year {yearLabel}</h2>
        {showRegisterLinks && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/leave/requests?employee=${employeeId}`}>All requests</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/leave/balances">Balances</Link>
            </Button>
          </div>
        )}
      </div>
      <BalanceCards balances={balances} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Latest requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <EmptyState title="No leave requests yet" className="border-0" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Decided by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <LeaveTypeTag code={r.leaveType.code} name={r.leaveType.name} color={r.leaveType.color} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatLeaveRange(r)}</TableCell>
                    <TableCell className="tabular-nums">{r.days}</TableCell>
                    <TableCell>
                      <LeaveStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.approverName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
