import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Cake, Inbox, PartyPopper, Pin } from "lucide-react";
import { ClockCard } from "@/components/attendance/clock-card";
import { AttendanceDonut, HeadcountChart, UtilizationBars } from "@/components/dashboard/charts";
import { RunStatusBadge } from "@/components/payroll/run-status-badge";
import { WeekCard } from "@/components/timesheets/week-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { can, canAny } from "@/lib/auth/permissions";
import { formatDate, formatPeriod, todayInTimeZone } from "@/lib/dates";
import { formatDays } from "@/lib/leave";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { currentAnnouncements } from "@/server/modules/announcements/queries";
import { clockCardFor } from "@/server/modules/attendance/clock-card";
import {
  compOffPrompts, headcountTrend, joinersLeavers, latestPayslip, leaveSnapshot, leavesToday, myPendingRequests, openExitsAndChecklists,
  payrollStatus, pendingApprovalCount, teamLeaveAhead, teamOutToday, teamToday, teamUtilization, upcomingCelebrations, upcomingHolidays,
} from "@/server/modules/dashboard/queries";
import { getSetting } from "@/server/modules/settings/service";
import { weekCard } from "@/server/modules/timesheets/queries";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(new Date()),
  );
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

const shortMonth = (period: string) => new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

export default async function DashboardPage() {
  const user = await requireUser();
  const { timezone } = getSetting(db, "locale");
  const now = new Date();
  const today = todayInTimeZone(timezone, now);
  const employeeId = user.employeeId;
  const company = can(user, "employee.view");
  const payroll = canAny(user, ["payroll.run", "payroll.approve", "payroll.release"]);
  const approver = canAny(user, ["leave.approve", "compoff.approve", "regularization.approve", "timesheet.approve", "claim.approve"]);
  const waiting = approver ? pendingApprovalCount(db, user, { today, now }) : 0;
  const announcements = currentAnnouncements(db, now, { limit: 3 });

  const me =
    employeeId !== null
      ? {
          clock: clockCardFor(db, employeeId, now),
          week: weekCard(db, employeeId, { today }),
          leave: leaveSnapshot(db, employeeId, today),
          payslip: latestPayslip(db, employeeId),
          holidays: upcomingHolidays(db, employeeId, today),
          requests: myPendingRequests(db, employeeId),
          prompts: compOffPrompts(db, employeeId, today),
          away: teamOutToday(db, employeeId, today),
        }
      : null;
  const team =
    employeeId !== null && user.hasReports
      ? {
          today: teamToday(db, user, now),
          utilization: teamUtilization(db, employeeId, `${today.slice(0, 7)}-01`, today),
          ahead: teamLeaveAhead(db, employeeId, today, 7),
        }
      : null;
  const org = company
    ? {
        trend: headcountTrend(db, today, 12),
        moves: joinersLeavers(db, today.slice(0, 7)),
        attendance: teamToday(db, user, now),
        onLeave: leavesToday(db, today),
        exits: openExitsAndChecklists(db),
        celebrations: upcomingCelebrations(db, today, 14),
      }
    : null;
  const runs = payroll ? payrollStatus(db, today) : null;
  const requestCount = me ? Object.values(me.requests).reduce((s, n) => s + n, 0) : 0;

  return (
    <>
      <PageHeader
        title={`${greeting(timezone)}, ${user.name.split(" ")[0]}`}
        description={formatDate(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      />
      <div className="space-y-8">
        {waiting > 0 && (
          <Card className="border-primary/30 bg-primary-soft">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="flex items-center gap-2 font-medium">
                <Inbox className="size-5 text-primary" aria-hidden /> {waiting} request{waiting === 1 ? "" : "s"} waiting for your decision
              </p>
              <Button asChild size="sm">
                <Link href="/approvals">
                  Open approvals <ArrowRight />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {me && (
          <Section title="My day">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <ClockCard key={me.clock.renderedAt} {...me.clock} />
              {me.week && <WeekCard week={me.week} />}
              <Card>
                <CardHeader>
                  <CardDescription>Leave available</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  {me.leave.balances.map((b) => (
                    <div key={b.code} className="flex justify-between">
                      <span className="text-muted-foreground">{b.name}</span>
                      <span className="font-medium tabular-nums">{formatDays(b.available)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Comp-off</span>
                    <span className="font-medium tabular-nums">{formatDays(me.leave.compOff.available)}</span>
                  </div>
                  {me.leave.compOff.nextExpiry && (
                    <p className="text-xs text-warning">
                      {formatDays(me.leave.compOff.nextExpiry.days)} expire{me.leave.compOff.nextExpiry.days === 1 ? "s" : ""} on {formatDate(me.leave.compOff.nextExpiry.date)}
                    </p>
                  )}
                  <Button asChild variant="link" size="sm" className="h-auto px-0">
                    <Link href="/me/leave">Apply for leave</Link>
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Latest payslip</CardDescription>
                  {me.payslip ? (
                    <CardTitle className="text-2xl tabular-nums">{formatMoney(me.payslip.netPay)}</CardTitle>
                  ) : (
                    <CardTitle className="text-base font-normal text-muted-foreground">None yet</CardTitle>
                  )}
                </CardHeader>
                {me.payslip && (
                  <CardContent className="text-sm">
                    <p className="text-muted-foreground">Net pay for {formatPeriod(me.payslip.period)}</p>
                    <Button asChild variant="link" size="sm" className="h-auto px-0">
                      <Link href={`/me/payslips/${me.payslip.id}`}>View payslip</Link>
                    </Button>
                  </CardContent>
                )}
              </Card>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardHeader>
                  <CardDescription>Upcoming holidays</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  {me.holidays.length === 0 && <Empty>None scheduled.</Empty>}
                  {me.holidays.map((h) => (
                    <div key={h.date} className="flex justify-between gap-2">
                      <span>{h.name}</span>
                      <span className="whitespace-nowrap text-muted-foreground">{formatDate(h.date, { weekday: "short", day: "numeric", month: "short" })}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>My requests</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{requestCount}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {requestCount === 0 && <Empty>Nothing waiting.</Empty>}
                  {(
                    [
                      ["leave", "Leave", "/me/leave"], ["regularization", "Attendance corrections", "/me/attendance"], ["compOff", "Comp-off claims", "/me/comp-off"],
                      ["claims", "Expense claims", "/me/claims"], ["timesheets", "Timesheets", "/me/timesheets"],
                    ] as const
                  )
                    .filter(([key]) => me.requests[key] > 0)
                    .map(([key, label, href]) => (
                      <Link key={key} href={href} className="flex justify-between hover:underline">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium tabular-nums">{me.requests[key]}</span>
                      </Link>
                    ))}
                  {me.prompts > 0 && (
                    <Link href="/me/comp-off" className="block pt-1 text-primary hover:underline">
                      Claim comp-off for {me.prompts} day{me.prompts === 1 ? "" : "s"} you worked off
                    </Link>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Team away today</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  {me.away.length === 0 && <Empty>Everyone&apos;s in.</Empty>}
                  {me.away.map((a) => (
                    <div key={a.employeeId} className="flex justify-between gap-2">
                      <span>{a.name}</span>
                      <span className="text-muted-foreground">
                        {a.leaveType}
                        {a.half ? " (half)" : ""}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Announcements</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {announcements.length === 0 && <Empty>No news.</Empty>}
                  {announcements.map((a) => (
                    <Link key={a.id} href="/announcements" className="block hover:underline">
                      <span className="flex items-center gap-1 font-medium">
                        {a.pinned && <Pin className="size-3.5 text-primary" aria-label="Pinned" />}
                        {a.title}
                      </span>
                      <span className="line-clamp-2 text-muted-foreground">{a.body}</span>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </div>
          </Section>
        )}

        {team && (
          <Section title="My team">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardDescription>Today</CardDescription>
                </CardHeader>
                <CardContent>
                  <AttendanceDonut
                    slices={[
                      { name: "In", value: team.today.in }, { name: "Remote", value: team.today.remote }, { name: "On leave", value: team.today.onLeave },
                      { name: "Not in", value: team.today.notIn }, { name: "Off", value: team.today.off },
                    ]}
                  />
                  {team.today.late > 0 && <p className="mt-2 text-xs text-warning">{team.today.late} came in late</p>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Utilization this month</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{team.utilization.utilizationPct === null ? "—" : `${team.utilization.utilizationPct}%`}</CardTitle>
                </CardHeader>
                <CardContent>
                  {team.utilization.people.length ? <UtilizationBars people={team.utilization.people} /> : <Empty>No one to show.</Empty>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Leave in the next 7 days</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  {team.ahead.length === 0 && <Empty>No leave booked.</Empty>}
                  {team.ahead.map((l, i) => (
                    <div key={i} className="flex justify-between gap-2">
                      <span>{l.name}</span>
                      <span className="whitespace-nowrap text-muted-foreground">
                        {formatDate(l.startDate, { day: "numeric", month: "short" })}
                        {l.endDate !== l.startDate && `–${formatDate(l.endDate, { day: "numeric", month: "short" })}`}
                      </span>
                    </div>
                  ))}
                  <Button asChild variant="link" size="sm" className="h-auto px-0">
                    <Link href="/team/calendar">Team calendar</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </Section>
        )}

        {(org || runs) && (
          <Section title="Company">
            {org && (
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardDescription>Headcount</CardDescription>
                    <CardTitle className="text-2xl tabular-nums">{org.trend.at(-1)?.headcount ?? 0}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <HeadcountChart data={org.trend.map((t) => ({ label: shortMonth(t.period), headcount: t.headcount }))} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>Attendance today</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <AttendanceDonut
                      slices={[
                        { name: "In", value: org.attendance.in }, { name: "Remote", value: org.attendance.remote },
                        { name: "On leave", value: org.attendance.onLeave }, { name: "Not in", value: org.attendance.notIn },
                        { name: "Off", value: org.attendance.off },
                      ]}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>This month</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div>
                      <p className="font-medium">{org.moves.joiners.length} joined</p>
                      <p className="text-muted-foreground">{org.moves.joiners.map((j) => j.name).join(", ") || "—"}</p>
                    </div>
                    <div>
                      <p className="font-medium">{org.moves.leavers.length} leaving</p>
                      <p className="text-muted-foreground">{org.moves.leavers.map((j) => j.name).join(", ") || "—"}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>On leave today</CardDescription>
                    <CardTitle className="text-2xl tabular-nums">{org.onLeave.length}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    {org.onLeave.slice(0, 6).map((a) => (
                      <div key={a.employeeId} className="flex justify-between gap-2">
                        <span>{a.name}</span>
                        <span className="text-muted-foreground">{a.leaveType}</span>
                      </div>
                    ))}
                    {org.onLeave.length > 6 && <p className="text-muted-foreground">and {org.onLeave.length - 6} more</p>}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>Notice and checklists</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-sm">
                    {org.exits.exits.length === 0 && <Empty>No one is serving notice.</Empty>}
                    {org.exits.exits.map((e) => (
                      <Link key={e.id} href={`/org/employees/${e.id}`} className="flex justify-between gap-2 hover:underline">
                        <span>{e.name}</span>
                        <span className="text-muted-foreground">{e.lastWorkingDate ? `leaves ${formatDate(e.lastWorkingDate, { day: "numeric", month: "short" })}` : ""}</span>
                      </Link>
                    ))}
                    <Link href="/org/checklists" className="block pt-1 text-primary hover:underline">
                      {org.exits.openChecklists} open checklist{org.exits.openChecklists === 1 ? "" : "s"}
                    </Link>
                  </CardContent>
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardDescription>Birthdays and work anniversaries, next 14 days</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-1.5 text-sm sm:grid-cols-2">
                    {org.celebrations.length === 0 && <Empty>None coming up.</Empty>}
                    {org.celebrations.map((c) => (
                      <div key={`${c.employeeId}-${c.kind}`} className="flex items-center gap-2">
                        {c.kind === "birthday" ? <Cake className="size-4 text-secondary" aria-label="Birthday" /> : <PartyPopper className="size-4 text-primary" aria-label="Work anniversary" />}
                        <span>{c.name}</span>
                        <span className="text-muted-foreground">
                          {formatDate(c.date, { day: "numeric", month: "short" })}
                          {c.years ? ` · ${c.years} year${c.years === 1 ? "" : "s"}` : ""}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}
            {runs && (
              <Card>
                <CardHeader>
                  <CardDescription>Payroll</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-6 text-sm">
                  {runs.map(({ period, run }) => (
                    <div key={period} className="flex items-center gap-2">
                      <span className="font-medium">{formatPeriod(period)}</span>
                      {run ? (
                        <Link href={`/payroll/runs/${run.id}`}>
                          <RunStatusBadge status={run.status} />
                        </Link>
                      ) : (
                        <Badge variant="outline">No run yet</Badge>
                      )}
                    </div>
                  ))}
                  <Button asChild variant="link" size="sm" className="h-auto px-0">
                    <Link href="/payroll/runs">Payroll runs</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </Section>
        )}

        {!me && !org && !runs && (
          <Card>
            <CardContent className="space-y-2 p-6 text-sm">
              <p className="font-medium">Your login isn&apos;t linked to an employee record yet.</p>
              <p className="text-muted-foreground">Ask HR to link it to see your attendance, leave and payslips here.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
