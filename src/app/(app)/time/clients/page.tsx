import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listClients } from "@/server/modules/projects/queries";
import { ClientsClient } from "./clients-client";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  await requirePermission("project.manage");
  return (
    <>
      <PageHeader title="Clients" description="Who the projects are for. Archive a client once its projects are closed." />
      <ClientsClient clients={listClients(db)} />
    </>
  );
}
