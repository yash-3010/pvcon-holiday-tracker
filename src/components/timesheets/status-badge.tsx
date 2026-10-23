import { Badge } from "@/components/ui/badge";
import { TIMESHEET_STATUS_BADGE, TIMESHEET_STATUS_LABELS, type TimesheetStatus } from "@/lib/timesheets";

export function TimesheetStatusBadge({ status }: { status: TimesheetStatus }) {
  return <Badge variant={TIMESHEET_STATUS_BADGE[status]}>{TIMESHEET_STATUS_LABELS[status]}</Badge>;
}
