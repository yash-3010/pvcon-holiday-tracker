import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHours } from "@/lib/timesheets";
import { cn } from "@/lib/utils";
import type { WeekSummary } from "@/server/modules/timesheets/queries";
import { TimesheetStatusBadge } from "./status-badge";

/** Dashboard: this week's timesheet so far (spec §5.9). */
export function WeekCard({ week }: { week: WeekSummary & { utilizationPct: number | null } }) {
  const pct = week.utilizationPct ?? 0;
  return (
    <Card data-testid="week-card">
      <CardHeader>
        <CardDescription className="flex items-center justify-between gap-2">
          This week&apos;s timesheet <TimesheetStatusBadge status={week.status} />
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {formatHours(week.loggedMinutes)} h <span className="text-base font-normal text-muted-foreground">of {formatHours(week.availableMinutes)} h</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Hours logged">
          <div className={cn("h-full rounded-full", pct > 100 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/me/timesheets/${week.weekStart}`}>Open timesheet</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
