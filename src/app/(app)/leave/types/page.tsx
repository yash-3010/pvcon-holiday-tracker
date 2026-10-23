import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listLeaveTypes } from "@/server/modules/leave/types";
import { LeaveTypesClient } from "./types-client";

export const metadata: Metadata = { title: "Leave types" };

export default async function LeaveTypesPage() {
  await requirePermission("leave.config");
  return (
    <>
      <PageHeader
        title="Leave types"
        description="What employees can take, how it is credited and the rules for applying. Archive a type to stop offering it."
      />
      <LeaveTypesClient types={listLeaveTypes(db, { includeArchived: true })} />
    </>
  );
}
