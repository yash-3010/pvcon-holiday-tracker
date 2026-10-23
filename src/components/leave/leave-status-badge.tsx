import { Badge } from "@/components/ui/badge";
import { LEAVE_STATUS_BADGE, LEAVE_STATUS_LABELS, type LeaveRequestStatus } from "@/lib/leave";

export function LeaveStatusBadge({ status }: { status: LeaveRequestStatus }) {
  return <Badge variant={LEAVE_STATUS_BADGE[status]}>{LEAVE_STATUS_LABELS[status]}</Badge>;
}
