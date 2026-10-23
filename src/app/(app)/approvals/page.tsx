import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listPendingProfileChanges } from "@/server/modules/employees/profile-changes";
import { pendingLeaveForApprover } from "@/server/modules/leave/queries";
import { getSetting } from "@/server/modules/settings/service";
import { LeaveApprovalList } from "./leave-list";
import { ProfileChangeList } from "./profile-change-list";

export const metadata: Metadata = { title: "Approvals" };

const count = (n: number) => (n ? ` (${n})` : "");

/** Tabs per permission (spec §5.7): Leave in Phase 2, Comp-off and Regularization in Phase 3, and so on. */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireAnyPermission(["employee.update", "leave.approve"]);
  const timeZone = getSetting(db, "locale").timezone;
  const leave = can(user, "leave.approve") ? pendingLeaveForApprover(db, user) : null;
  const changes = can(user, "employee.update") ? listPendingProfileChanges(db, can(user, "employee.sensitive.view")) : null;
  const tabs = [
    leave && { value: "leave", waiting: leave.length },
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
          {changes && <TabsTrigger value="profile">Profile changes{count(changes.length)}</TabsTrigger>}
        </TabsList>
        {leave && (
          <TabsContent value="leave">
            <LeaveApprovalList requests={leave} timeZone={timeZone} />
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
