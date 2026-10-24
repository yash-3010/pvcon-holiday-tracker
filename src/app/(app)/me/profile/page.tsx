import type { Metadata } from "next";
import { UserRound } from "lucide-react";
import { DetailList } from "@/components/employees/detail-list";
import { EMPTY_ADDRESS, EMPTY_EMERGENCY_CONTACT } from "@/components/employees/form-defaults";
import { PhotoEditor } from "@/components/employees/photo-editor";
import { EmployeeStatusBadge } from "@/components/employees/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate } from "@/lib/dates";
import { EMPLOYMENT_TYPE_LABELS, GENDER_LABELS, MARITAL_STATUS_LABELS } from "@/lib/hr";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { pendingProfileChangeFor } from "@/server/modules/employees/profile-changes";
import { getEmployeeDetail } from "@/server/modules/employees/queries";
import { bankView } from "@/server/modules/employees/sensitive";
import { getSetting } from "@/server/modules/settings/service";
import { BankChangeCard } from "./bank-change-card";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = { title: "My profile" };

export default async function MyProfilePage() {
  const user = await requireUser();
  const employee = user.employeeId === null ? null : getEmployeeDetail(db, user.employeeId, { revealSensitive: false });
  if (!employee) {
    return (
      <>
        <PageHeader title="My profile" />
        <EmptyState icon={UserRound} title="No employee record yet" description="Your login isn't linked to an employee record. Ask HR to link it." />
      </>
    );
  }
  const pending = pendingProfileChangeFor(db, employee.id);
  const timeZone = getSetting(db, "locale").timezone;

  return (
    <>
      <PageHeader
        title="My profile"
        description={`${employee.displayName} · ${employee.employeeCode}`}
        actions={<EmployeeStatusBadge status={employee.status} />}
      />
      <div className="mb-6">
        <PhotoEditor employeeId={employee.id} name={employee.displayName} photoFileId={employee.photoFileId} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Job</CardTitle>
              <CardDescription>Maintained by HR.</CardDescription>
            </CardHeader>
            <CardContent>
              <DetailList
                columns={1}
                items={[
                  { label: "Employee code", value: employee.employeeCode },
                  { label: "Designation", value: employee.designationName },
                  { label: "Department", value: employee.departmentName },
                  { label: "Reporting manager", value: employee.managerName },
                  { label: "Employment type", value: EMPLOYMENT_TYPE_LABELS[employee.employmentType] },
                  { label: "Work email", value: employee.workEmail },
                  { label: "Joined", value: formatDate(employee.dateOfJoining) },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personal</CardTitle>
              <CardDescription>Ask HR to correct these.</CardDescription>
            </CardHeader>
            <CardContent>
              <DetailList
                columns={1}
                items={[
                  { label: "Date of birth", value: employee.dateOfBirth && formatDate(employee.dateOfBirth) },
                  { label: "Gender", value: employee.gender && GENDER_LABELS[employee.gender] },
                  { label: "Marital status", value: employee.maritalStatus && MARITAL_STATUS_LABELS[employee.maritalStatus] },
                ]}
              />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <ContactForm
            initial={{
              personalEmail: employee.personalEmail ?? "",
              phone: employee.phone ?? "",
              address: employee.address ?? EMPTY_ADDRESS,
              emergencyContact: employee.emergencyContact ?? EMPTY_EMERGENCY_CONTACT,
            }}
          />
          <BankChangeCard
            current={employee.bank}
            timeZone={timeZone}
            pending={
              pending
                ? { id: pending.id, createdAt: pending.createdAt, reason: pending.reason, requested: bankView(pending.fields, false) }
                : null
            }
          />
        </div>
      </div>
    </>
  );
}
