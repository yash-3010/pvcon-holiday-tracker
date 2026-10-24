import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { nextEmployeeCode } from "@/server/modules/employees/code";
import { employeeOptions, unlinkedUserOptions } from "@/server/modules/employees/queries";
import { departmentOptions, designationOptions } from "@/server/modules/org/queries";
import { getSetting } from "@/server/modules/settings/service";
import { EmployeeWizard } from "./employee-wizard";

export const metadata: Metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const user = await requirePermission("employee.create");
  const canManageLogins = can(user, "user.manage") || can(user, "role.assign");
  return (
    <>
      <PageHeader title="Add employee" description="Basics, job, personal and bank details, then an optional login." />
      <EmployeeWizard
        today={todayInTimeZone(getSetting(db, "locale").timezone)}
        nextCode={nextEmployeeCode(db)}
        departments={departmentOptions(db)}
        designations={designationOptions(db)}
        managers={employeeOptions(db)}
        linkableUsers={canManageLogins ? unlinkedUserOptions(db) : []}
        canManageLogins={canManageLogins}
        canAssignPrivileged={can(user, "role.assign")}
        allowedDomain={config.allowedEmailDomain}
      />
    </>
  );
}
