import { Badge } from "@/components/ui/badge";
import { PAYSLIP_STATUS_LABELS, RUN_STATUS_BADGE, RUN_STATUS_LABELS, type PayslipStatus, type RunStatus } from "@/lib/payroll/constants";

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge variant={RUN_STATUS_BADGE[status]}>{RUN_STATUS_LABELS[status]}</Badge>;
}

const PAYSLIP_BADGE: Record<PayslipStatus, "success" | "warning" | "secondary"> = { ok: "success", hold: "warning", excluded: "secondary" };

export function PayslipStatusBadge({ status }: { status: PayslipStatus }) {
  return <Badge variant={PAYSLIP_BADGE[status]}>{PAYSLIP_STATUS_LABELS[status]}</Badge>;
}
