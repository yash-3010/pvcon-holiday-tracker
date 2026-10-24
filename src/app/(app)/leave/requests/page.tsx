import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { isISODate, todayInTimeZone } from "@/lib/dates";
import { LEAVE_REQUEST_STATUSES, LEAVE_STATUS_LABELS, type LeaveRequestStatus } from "@/lib/leave";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { employeeOptions } from "@/server/modules/employees/queries";
import { applyLeaveContext } from "@/server/modules/leave/apply-context";
import { listLeaveRequests } from "@/server/modules/leave/queries";
import { listLeaveTypes } from "@/server/modules/leave/types";
import { getSetting } from "@/server/modules/settings/service";
import { LeaveRequestsTable, RecordLeaveButton } from "./requests-client";

export const metadata: Metadata = { title: "Leave requests" };

type Params = { status?: string; type?: string; from?: string; to?: string; employee?: string };

export default async function LeaveRequestsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireAnyPermission(["leave.view.all", "leave.approve"]);
  const params = await searchParams;
  const orgWide = can(user, "leave.view.all");
  const status = (LEAVE_REQUEST_STATUSES as readonly string[]).includes(params.status ?? "") ? (params.status as LeaveRequestStatus) : undefined;
  const types = listLeaveTypes(db, { includeArchived: true });
  const leaveTypeId = types.find((t) => String(t.id) === params.type)?.id;
  const from = params.from && isISODate(params.from) ? params.from : undefined;
  const to = params.to && isISODate(params.to) ? params.to : undefined;
  const employees = orgWide ? employeeOptions(db) : [];
  const employeeId = employees.find((e) => String(e.id) === params.employee)?.id;
  const requests = listLeaveRequests(db, user, { status, leaveTypeId, from, to, employeeId });
  const canAdjust = can(user, "leave.adjust");
  const today = todayInTimeZone(getSetting(db, "locale").timezone);

  return (
    <>
      <PageHeader
        title="Leave requests"
        description={orgWide ? "Every leave request in the company." : "Leave requests from the people who report to you."}
        actions={
          canAdjust ? (
            // Nobody records their own leave: that would approve it without a second person.
            <RecordLeaveButton context={applyLeaveContext(db, null, today)} employees={employees.filter((e) => e.id !== user.employeeId)} />
          ) : undefined
        }
      />
      <Card className="mb-4">
        <CardContent className="p-4">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end" method="get">
            <Field label="Status" htmlFor="f-status">
              <NativeSelect id="f-status" name="status" defaultValue={status ?? ""}>
                <option value="">Any status</option>
                {LEAVE_REQUEST_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {LEAVE_STATUS_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Type" htmlFor="f-type">
              <NativeSelect id="f-type" name="type" defaultValue={leaveTypeId ? String(leaveTypeId) : ""}>
                <option value="">Any type</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {orgWide && (
              <Field label="Employee" htmlFor="f-employee">
                <NativeSelect id="f-employee" name="employee" defaultValue={employeeId ? String(employeeId) : ""}>
                  <option value="">Everyone</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field label="From" htmlFor="f-from">
              <Input id="f-from" name="from" type="date" defaultValue={from} />
            </Field>
            <Field label="To" htmlFor="f-to">
              <Input id="f-to" name="to" type="date" defaultValue={to} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit">Filter</Button>
              <Button variant="ghost" asChild>
                <Link href="/leave/requests">Clear</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <LeaveRequestsTable requests={requests} canCancel={canAdjust} />
    </>
  );
}
