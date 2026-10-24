import { Badge } from "@/components/ui/badge";
import { EMPLOYEE_STATUS_LABELS, type EmployeeStatus } from "@/lib/hr";

const VARIANT = { active: "success", on_notice: "warning", exited: "secondary" } as const;

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <Badge variant={VARIANT[status]}>{EMPLOYEE_STATUS_LABELS[status]}</Badge>;
}
