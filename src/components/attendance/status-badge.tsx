import { Badge } from "@/components/ui/badge";
import { ATTENDANCE_STATUS_BADGE, ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from "@/lib/attendance";

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  return <Badge variant={ATTENDANCE_STATUS_BADGE[status]}>{ATTENDANCE_STATUS_LABELS[status]}</Badge>;
}

/** Cell colours for calendars and the muster roll, matching the badge tones. */
export const ATTENDANCE_CELL_CLASSES: Record<AttendanceStatus, string> = {
  present: "bg-success/15 text-success",
  half_day: "bg-warning/15 text-warning",
  absent: "bg-destructive/15 text-destructive",
  on_leave: "bg-info/15 text-info",
  half_leave: "bg-info/10 text-info",
  holiday: "bg-primary-soft text-primary",
  weekly_off: "bg-muted text-muted-foreground",
  not_joined: "text-muted-foreground",
  exited: "text-muted-foreground",
};
