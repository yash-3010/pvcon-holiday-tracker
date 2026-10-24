import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { PayslipRow } from "@/server/db/schema";

/** Payroll admins and salary viewers see every payslip; an employee sees their own once released. */
export function canViewPayslip(user: SessionUser, payslip: Pick<PayslipRow, "employeeId" | "releasedAt">): boolean {
  if (can(user, "payroll.run") || can(user, "salary.view")) return true;
  return payslip.releasedAt !== null && user.employeeId === payslip.employeeId;
}
