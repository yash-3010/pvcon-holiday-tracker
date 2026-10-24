import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { employeeOptions } from "@/server/modules/employees/queries";
import { clientOptions, listProjects } from "@/server/modules/projects/queries";
import { ProjectsClient } from "./projects-client";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await requireAnyPermission(["project.manage", "timesheet.view.all"]);
  const canManage = can(user, "project.manage");
  return (
    <>
      <PageHeader title="Projects" description="What people log time to. Booked hours count submitted and approved weeks." />
      <ProjectsClient
        projects={listProjects(db, {})}
        options={canManage ? { clients: clientOptions(db), employees: employeeOptions(db) } : { clients: [], employees: [] }}
        canManage={canManage}
      />
    </>
  );
}
