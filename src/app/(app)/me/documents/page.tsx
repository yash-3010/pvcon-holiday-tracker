import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { DocumentsCard } from "@/components/employees/documents-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SELF_DOCUMENT_CATEGORIES } from "@/lib/hr";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listEmployeeDocuments } from "@/server/modules/employees/documents";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = { title: "My documents" };

export default async function MyDocumentsPage() {
  const user = await requireUser();
  if (user.employeeId === null) {
    return (
      <>
        <PageHeader title="My documents" />
        <EmptyState icon={FileText} title="No employee record yet" description="Your login isn't linked to an employee record. Ask HR to link it." />
      </>
    );
  }
  return (
    <>
      <PageHeader title="My documents" description="Offer letters and contracts from HR, plus the ID and education documents you add." />
      <DocumentsCard
        employeeId={user.employeeId}
        documents={listEmployeeDocuments(db, user.employeeId)}
        categories={SELF_DOCUMENT_CATEGORIES}
        canUpload
        canDelete={false}
        timeZone={getSetting(db, "locale").timezone}
      />
    </>
  );
}
