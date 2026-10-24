import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/dates";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { pendingRegularizationsFor } from "@/server/modules/attendance/queries";
import { pendingCompOffClaimsFor } from "@/server/modules/compoff/queries";
import { listPendingProfileChanges } from "@/server/modules/employees/profile-changes";
import { pendingLeaveForApprover } from "@/server/modules/leave/queries";
import { pendingClaimsFor } from "@/server/modules/payroll/queries";
import { getSetting } from "@/server/modules/settings/service";
import { pendingTimesheetsFor } from "@/server/modules/timesheets/queries";
import { ClaimApprovalList } from "./claim-list";
import { CompOffApprovalList } from "./compoff-list";
import { LeaveApprovalList } from "./leave-list";
import { ProfileChangeList } from "./profile-change-list";
import { RegularizationApprovalList } from "./regularization-list";
import { TimesheetApprovalList } from "./timesheet-list";

export const metadata: Metadata = { title: "Approvals" };

const count = (n: number) => (n ? ` (${n})` : "");

/** Tabs per permission (spec §5.7): Leave in Phase 2, Comp-off and Regularization in Phase 3, and so on. */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireAnyPermission([
    "employee.update", "leave.approve", "regularization.approve", "compoff.approve", "timesheet.approve", "claim.approve",
  ]);
  const timeZone = getSetting(db, "locale").timezone;
  const now = new Date();
  const today = todayInTimeZone(timeZone, now);
  const leave = can(user, "leave.approve") ? pendingLeaveForApprover(db, user) : null;
  const compOff = can(user, "compoff.approve") ? pendingCompOffClaimsFor(db, user) : null;
  const regularizations = can(user, "regularization.approve") ? pendingRegularizationsFor(db, user) : null;
  const timesheetsWaiting = can(user, "timesheet.approve") ? pendingTimesheetsFor(db, user, { today, now }) : null;
  const claims = can(user, "claim.approve") ? pendingClaimsFor(db, user) : null;
  const changes = can(user, "employee.update") ? listPendingProfileChanges(db, can(user, "employee.sensitive.view")) : null;
  const tabs = [
    leave && { value: "leave", waiting: leave.length },
    compOff && { value: "compoff", waiting: compOff.length },
    regularizations && { value: "regularization", waiting: regularizations.length },
    timesheetsWaiting && { value: "timesheets", waiting: timesheetsWaiting.length },
    claims && { value: "claims", waiting: claims.length },
    changes && { value: "profile", waiting: changes.length },
  ].filter((t) => !!t);
  const requested = (await searchParams).tab;
  // A link names its tab; otherwise open the first tab with something waiting.
  const active = tabs.find((t) => t.value === requested)?.value ?? (tabs.find((t) => t.waiting > 0) ?? tabs[0])!.value;

  return (
    <>
      <PageHeader title="Approvals" description="Requests waiting for a decision." />
      <Tabs defaultValue={active}>
        <TabsList>
          {leave && <TabsTrigger value="leave">Leave{count(leave.length)}</TabsTrigger>}
          {compOff && <TabsTrigger value="compoff">Comp-off{count(compOff.length)}</TabsTrigger>}
          {regularizations && <TabsTrigger value="regularization">Regularization{count(regularizations.length)}</TabsTrigger>}
          {timesheetsWaiting && <TabsTrigger value="timesheets">Timesheets{count(timesheetsWaiting.length)}</TabsTrigger>}
          {claims && <TabsTrigger value="claims">Claims{count(claims.length)}</TabsTrigger>}
          {changes && <TabsTrigger value="profile">Profile changes{count(changes.length)}</TabsTrigger>}
        </TabsList>
        {leave && (
          <TabsContent value="leave">
            <LeaveApprovalList requests={leave} timeZone={timeZone} />
          </TabsContent>
        )}
        {compOff && (
          <TabsContent value="compoff">
            <CompOffApprovalList claims={compOff} payoutEnabled={getSetting(db, "compOff").payoutEnabled} timeZone={timeZone} />
          </TabsContent>
        )}
        {regularizations && (
          <TabsContent value="regularization">
            <RegularizationApprovalList requests={regularizations} timeZone={timeZone} />
          </TabsContent>
        )}
        {timesheetsWaiting && (
          <TabsContent value="timesheets">
            <TimesheetApprovalList timesheets={timesheetsWaiting} timeZone={timeZone} today={today} />
          </TabsContent>
        )}
        {claims && (
          <TabsContent value="claims">
            <ClaimApprovalList claims={claims} timeZone={timeZone} />
          </TabsContent>
        )}
        {changes && (
          <TabsContent value="profile">
            <ProfileChangeList changes={changes} ownEmployeeId={user.employeeId} timeZone={timeZone} />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
