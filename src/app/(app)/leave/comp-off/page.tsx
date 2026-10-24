import type { Metadata } from "next";
import Link from "next/link";
import { RequestStatusBadge } from "@/components/attendance/request-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COMP_OFF_CLAIM_STATUSES, COMP_OFF_LOT_STATUS_LABELS, type CompOffClaimStatus } from "@/lib/attendance";
import { can } from "@/lib/auth/permissions";
import { diffDays, formatDate, formatMinutes, todayInTimeZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listCompOffClaims, listCompOffLots } from "@/server/modules/compoff/queries";
import { employeeOptions } from "@/server/modules/employees/queries";
import { getSetting } from "@/server/modules/settings/service";
import { GrantCompOffButton } from "./grant-sheet";

export const metadata: Metadata = { title: "Comp-off" };

const LOT_BADGE = { active: "success", consumed: "secondary", expired: "destructive", paid_out: "info" } as const;
const STATUS_LABEL: Record<CompOffClaimStatus, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" };

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn("rounded-full border px-3 py-1 text-xs", active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted")}
    >
      {children}
    </Link>
  );
}

export default async function CompOffAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; lots?: string }> }) {
  const user = await requirePermission("leave.view.all");
  const params = await searchParams;
  const today = todayInTimeZone(getSetting(db, "locale").timezone);
  const settings = getSetting(db, "compOff");
  const status = COMP_OFF_CLAIM_STATUSES.find((s) => s === params.status);
  const allLots = params.lots === "all";
  const lots = listCompOffLots(db, { includeClosed: allLots });
  const claims = listCompOffClaims(db, { status });

  return (
    <>
      <PageHeader
        title="Comp-off"
        description="Compensatory off earned for work on weekly offs and holidays: what is still usable, and every claim."
        actions={can(user, "leave.adjust") && <GrantCompOffButton employees={employeeOptions(db)} today={today} expiryDays={settings.expiryDays} />}
      />
      <Tabs defaultValue={params.tab === "claims" ? "claims" : "lots"}>
        <TabsList>
          <TabsTrigger value="lots">Earned days</TabsTrigger>
          <TabsTrigger value="claims">Claims</TabsTrigger>
        </TabsList>
        <TabsContent value="lots" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <FilterLink href="/leave/comp-off" active={!allLots}>
              Usable
            </FilterLink>
            <FilterLink href="/leave/comp-off?lots=all" active={allLots}>
              All, including used and expired
            </FilterLink>
          </div>
          {lots.length === 0 ? (
            <EmptyState title="No comp-off to show" description="Approved claims and grants appear here until they are used or expire." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Employee</TableHead>
                      <TableHead>Day worked</TableHead>
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
                          <TableCell>
                            <Link href={`/org/employees/${l.employeeId}?tab=leave`} className="font-medium hover:underline">
                              {l.employeeName}
                            </Link>
                            <p className="text-xs text-muted-foreground">{l.employeeCode}</p>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(l.earnedOn)}</TableCell>
                          <TableCell className="tabular-nums">{l.days}</TableCell>
                          <TableCell className="tabular-nums">{l.remaining}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(l.expiresOn)}</TableCell>
                          <TableCell>
                            <span className="flex flex-wrap gap-1">
                              <Badge variant={LOT_BADGE[l.status]}>{COMP_OFF_LOT_STATUS_LABELS[l.status]}</Badge>
                              {soon && <Badge variant="warning">Expires soon</Badge>}
                              {l.claimId === null && <Badge variant="outline">Granted</Badge>}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-64 text-xs text-muted-foreground">{l.note}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="claims" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <FilterLink href="/leave/comp-off?tab=claims" active={!status}>
              All
            </FilterLink>
            {COMP_OFF_CLAIM_STATUSES.map((s) => (
              <FilterLink key={s} href={`/leave/comp-off?tab=claims&status=${s}`} active={status === s}>
                {STATUS_LABEL[s]}
              </FilterLink>
            ))}
          </div>
          {claims.length === 0 ? (
            <EmptyState title="No claims to show" description="Claims employees make for off-day work appear here." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Employee</TableHead>
                      <TableHead>Day worked</TableHead>
                      <TableHead>Worked</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link href={`/org/employees/${c.employeeId}?tab=attendance`} className="font-medium hover:underline">
                            {c.employeeName}
                          </Link>
                          <p className="text-xs text-muted-foreground">{c.employeeCode}</p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(c.workedDate)}</TableCell>
                        <TableCell className="tabular-nums">{formatMinutes(c.workedMinutes)}</TableCell>
                        <TableCell className="tabular-nums">{c.daysRequested}</TableCell>
                        <TableCell>
                          <span className="flex flex-wrap gap-1">
                            <RequestStatusBadge status={c.status} />
                            {c.resolution === "payout" && <Badge variant="info">Payout</Badge>}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-72 text-xs text-muted-foreground">
                          {[c.reason, c.decisionNote ? `“${c.decisionNote}”` : null].filter(Boolean).join(" · ") || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
