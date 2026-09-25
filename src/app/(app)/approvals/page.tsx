import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listPendingProfileChanges } from "@/server/modules/employees/profile-changes";
import { getSetting } from "@/server/modules/settings/service";
import { ProfileChangeList } from "./profile-change-list";

export const metadata: Metadata = { title: "Approvals" };

/** Phase 1 has one tab; Phase 2 adds Leave, Phase 3 Comp-off and Regularization, and so on (spec §5.7). */
export default async function ApprovalsPage() {
  const user = await requirePermission("employee.update");
  const changes = listPendingProfileChanges(db, can(user, "employee.sensitive.view"));
  return (
    <>
      <PageHeader title="Approvals" description="Requests waiting for a decision." />
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile changes{changes.length ? ` (${changes.length})` : ""}</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileChangeList changes={changes} ownEmployeeId={user.employeeId} timeZone={getSetting(db, "locale").timezone} />
        </TabsContent>
      </Tabs>
    </>
  );
}
