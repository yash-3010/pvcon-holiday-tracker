import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/dates";
import { formatHours, PROJECT_STATUS_BADGE, PROJECT_STATUS_LABELS } from "@/lib/timesheets";
import { cn } from "@/lib/utils";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { employeeOptions } from "@/server/modules/employees/queries";
import { clientOptions, projectDetail } from "@/server/modules/projects/queries";
import { EditProjectButton, MembersCard } from "./project-client";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyPermission(["project.manage", "timesheet.view.all"]);
  const id = Number((await params).id);
  const detail = Number.isInteger(id) && id > 0 ? projectDetail(db, id) : null;
  if (!detail) notFound();
  const { project, burn } = detail;
  const canManage = can(user, "project.manage");
  const employees = canManage ? employeeOptions(db) : [];
  const usedPct = burn.budgetMinutes ? Math.round((burn.bookedMinutes / burn.budgetMinutes) * 100) : null;
  const dates = [project.startDate && `from ${formatDate(project.startDate)}`, project.endDate && `until ${formatDate(project.endDate)}`].filter(Boolean).join(" ");

  return (
    <>
      <PageHeader
        title={`${project.code} · ${project.name}`}
        description={[project.clientName ?? "Internal project", project.managerName && `managed by ${project.managerName}`, dates].filter(Boolean).join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={PROJECT_STATUS_BADGE[project.status]}>{PROJECT_STATUS_LABELS[project.status]}</Badge>
            {canManage && <EditProjectButton project={project} options={{ clients: clientOptions(db), employees }} />}
          </div>
        }
      />
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardDescription>Budget burn</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatHours(burn.bookedMinutes)} h
                {burn.budgetMinutes !== null && <span className="text-base font-normal text-muted-foreground"> of {formatHours(burn.budgetMinutes)} h</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {usedPct !== null && (
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={usedPct} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
                  <div className={cn("h-full rounded-full", usedPct > 100 ? "bg-destructive" : usedPct > 85 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(usedPct, 100)}%` }} />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {formatHours(burn.approvedMinutes)} h approved · {formatHours(burn.bookedMinutes - burn.approvedMinutes)} h waiting for approval
                {burn.draftMinutes > 0 && ` · ${formatHours(burn.draftMinutes)} h more in unsubmitted weeks`}
                {usedPct !== null && ` · ${usedPct}% of the budget`}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Billable by default</CardDescription>
              <CardTitle className="text-base">{project.billableDefault ? "Yes" : "No"}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Each row&apos;s billable flag can be changed on the timesheet.</CardContent>
          </Card>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hours by person</CardTitle>
            </CardHeader>
            <CardContent className={detail.byEmployee.length ? "p-0" : undefined}>
              {detail.byEmployee.length === 0 ? (
                <p className="text-sm text-muted-foreground">No submitted time yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Billable</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.byEmployee.map((e) => (
                      <TableRow key={e.employeeId}>
                        <TableCell>{e.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatHours(e.minutes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatHours(e.billableMinutes)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hours by category</CardTitle>
            </CardHeader>
            <CardContent className={detail.byCategory.length ? "p-0" : undefined}>
              {detail.byCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No submitted time yet.</p>
              ) : (
                <Table>
                  <TableBody>
                    {detail.byCategory.map((c) => (
                      <TableRow key={c.categoryId}>
                        <TableCell>{c.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatHours(c.minutes)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
        <MembersCard projectId={project.id} members={detail.members} candidates={employees} canManage={canManage} internal={project.clientId === null} />
      </div>
    </>
  );
}
