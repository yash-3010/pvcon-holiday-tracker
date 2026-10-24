import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { todayInTimeZone } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { employeeOptions } from "@/server/modules/employees/queries";
import { loanStatement } from "@/server/modules/payroll/loans";
import { listLoans } from "@/server/modules/payroll/queries";
import { getSetting } from "@/server/modules/settings/service";
import { LoansClient } from "./loans-client";

export const metadata: Metadata = { title: "Loans and advances" };

export default async function LoansPage() {
  await requirePermission("loan.manage");
  const loans = listLoans(db, {}).map((l) => ({ ...l, repayments: loanStatement(db, l.id).repayments }));
  return (
    <>
      <PageHeader title="Loans and advances" description="Each regular run deducts the EMI, never more than what is outstanding, until the loan is repaid." />
      <LoansClient loans={loans} employees={employeeOptions(db)} thisMonth={todayInTimeZone(getSetting(db, "locale").timezone).slice(0, 7)} />
    </>
  );
}
