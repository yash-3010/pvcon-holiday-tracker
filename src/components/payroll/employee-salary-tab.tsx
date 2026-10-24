import { Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dateInTimeZone, formatDate, formatPeriod } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { EmployeeSalaryView, StructureOption } from "@/server/modules/payroll/queries";
import { ReviseSalaryButton } from "./revise-salary-button";

/** The profile Salary tab (`salary.view`): this month's breakdown and every revision. */
export function EmployeeSalaryTab({
  employee, view, structures, canManage, period, timeZone,
}: {
  employee: { id: number; name: string; dateOfJoining: string; exited: boolean };
  view: EmployeeSalaryView;
  structures: StructureOption[];
  canManage: boolean;
  period: string;
  timeZone: string;
}) {
  const revise =
    canManage && !employee.exited ? (
      <ReviseSalaryButton
        target={{
          employeeId: employee.id, name: employee.name, joinedMonth: employee.dateOfJoining.slice(0, 7),
          current: view.current ? { annualCtc: view.current.annualCtc, structureId: view.current.structureId, overrides: view.current.overrides } : null,
        }}
        structures={structures}
        defaultMonth={period}
      />
    ) : null;
  if (!view.current && view.history.length === 0) {
    return <EmptyState icon={Landmark} title="No salary yet" description="Assign a salary before the employee's first payroll run." action={revise} />;
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>{formatPeriod(period)}</CardTitle>
            <CardDescription>
              {view.current
                ? `${formatMoney(view.current.annualCtc)} a year on ${view.current.structure}, since ${formatPeriod(view.current.effectiveFrom.slice(0, 7))}. A full month:`
                : "No salary applies this month yet."}
            </CardDescription>
          </div>
          {revise}
        </CardHeader>
        {view.current && (
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                  <TableHead className="text-right">Annual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.current.lines.map((l) => (
                  <TableRow key={l.code}>
                    <TableCell>
                      {l.name}
                      {view.current!.overrides[l.code] !== undefined && (
                        <Badge variant="outline" className="ml-2">
                          Override
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.kind === "deduction" ? "−" : ""}
                      {formatMoney(l.monthly)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(l.annual)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Net pay</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(view.current.netMonthly)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(view.current.netMonthly * 12)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Revisions</CardTitle>
          <CardDescription>Latest first. A corrected revision was replaced after payroll had used it; arrears settle the difference.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead className="text-right">Annual CTC</TableHead>
                <TableHead>Structure</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.history.map((h) => (
                <TableRow key={h.id} className={h.corrected ? "text-muted-foreground" : undefined}>
                  <TableCell className="whitespace-nowrap">
                    {formatPeriod(h.effectiveFrom.slice(0, 7))}
                    {h.corrected && (
                      <Badge variant="secondary" className="ml-2">
                        Corrected
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(h.annualCtc)}</TableCell>
                  <TableCell>{h.structure}</TableCell>
                  <TableCell className="text-xs">
                    {h.reason ?? "—"}
                    <div className="text-muted-foreground">
                      {h.createdByName ?? "Someone"}, {formatDate(dateInTimeZone(new Date(h.createdAt), timeZone))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
