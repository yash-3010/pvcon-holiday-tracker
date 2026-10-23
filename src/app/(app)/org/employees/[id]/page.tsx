import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Landmark, Timer } from "lucide-react";
import { EmployeeAttendanceTab } from "@/components/attendance/employee-attendance-tab";
import { ChecklistCard } from "@/components/employees/checklist-card";
import { bankDetailItems, DetailList } from "@/components/employees/detail-list";
import { DocumentsCard } from "@/components/employees/documents-card";
import { EventsTimeline } from "@/components/employees/events-timeline";
import { bankDefaults, jobDefaults, personalDefaults } from "@/components/employees/form-defaults";
import { EmployeeStatusBadge } from "@/components/employees/status-badge";
import { EmployeeLeaveTab } from "@/components/leave/employee-leave-tab";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can, canAny } from "@/lib/auth/permissions";
import { formatDate, todayInTimeZone } from "@/lib/dates";
import { leaveYearLabel, leaveYearOf } from "@/lib/leave";
import {
  DOCUMENT_CATEGORIES, EMPLOYMENT_TYPE_LABELS, formatAddress, GENDER_LABELS, MARITAL_STATUS_LABELS, type SelectOption,
} from "@/lib/hr";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { employeeAttendanceSummary } from "@/server/modules/attendance/queries";
import { defaultShift, listShifts } from "@/server/modules/attendance/shifts";
import { listEmployeeChecklists } from "@/server/modules/employees/checklists";
import { listEmployeeDocuments } from "@/server/modules/employees/documents";
import { employeeOptions, getEmployeeDetail, listEmployeeEvents, unlinkedUserOptions } from "@/server/modules/employees/queries";
import { canViewEmployee, getReportingTree, isManagerAbove } from "@/server/modules/employees/scope";
import { leaveYearStartMonth } from "@/server/modules/leave/ledger";
import { employeeLeaveSummary } from "@/server/modules/leave/queries";
import { departmentOptions, designationOptions } from "@/server/modules/org/queries";
import { getSetting } from "@/server/modules/settings/service";
import { BankForm } from "./bank-form";
import { ExitCard } from "./exit-card";
import { JobForm } from "./job-form";
import { LoginCard } from "./login-card";
import { PersonalForm } from "./personal-form";

export const metadata: Metadata = { title: "Employee" };

/** Keeps the employee's current value selectable even when it is archived or has left. */
function withCurrent(options: SelectOption[], id: number | null, label: string | null): SelectOption[] {
  if (id === null || options.some((o) => o.id === id)) return options;
  return [...options, { id, label: `${label ?? "Unknown"} (inactive)` }];
}

export default async function EmployeeProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const id = Number((await params).id);
  // Out-of-scope ids look exactly like missing ones.
  if (!Number.isInteger(id) || id <= 0 || !canViewEmployee(db, user, id)) notFound();
  const reveal = can(user, "employee.sensitive.view");
  const employee = getEmployeeDetail(db, id, { revealSensitive: reveal });
  if (!employee) notFound();

  const isSelf = user.employeeId === id;
  const showPrivate = isSelf || can(user, "employee.view");
  const canEdit = can(user, "employee.update") && employee.status !== "exited";
  const canManageLogins = can(user, "user.manage") || can(user, "role.assign");
  const canTick = can(user, "employee.update") || isSelf || isManagerAbove(db, user, id);
  const timeZone = getSetting(db, "locale").timezone;
  const today = todayInTimeZone(timeZone);
  const excluded = new Set([id, ...getReportingTree(db, id)]);
  const checklists = listEmployeeChecklists(db, id);
  const startMonth = leaveYearStartMonth(db);
  const leaveYear = leaveYearOf(today, startMonth);
  const leave = employeeLeaveSummary(db, id, leaveYear);
  const attendance = employeeAttendanceSummary(db, id, today.slice(0, 7));

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "job", label: "Job" },
    ...(showPrivate
      ? [{ value: "personal", label: "Personal" }, { value: "bank", label: "Bank & IDs" }, { value: "documents", label: "Documents" }]
      : []),
    ...(can(user, "salary.view") ? [{ value: "salary", label: "Salary" }] : []),
    { value: "attendance", label: "Attendance" },
    { value: "leave", label: "Leave" },
    { value: "timesheets", label: "Timesheets" },
    { value: "history", label: "History" },
    { value: "checklists", label: "Checklists" },
  ];
  const { tab } = await searchParams;
  const active = tab && tabs.some((t) => t.value === tab) ? tab : "overview";

  const jobItems = [
    { label: "Department", value: employee.departmentName },
    { label: "Designation", value: employee.designationName },
    { label: "Reporting manager", value: employee.managerName },
    { label: "Employment type", value: EMPLOYMENT_TYPE_LABELS[employee.employmentType] },
    { label: "Work location", value: employee.workLocation },
    { label: "Joined", value: formatDate(employee.dateOfJoining) },
    { label: "Probation ends", value: employee.probationEndDate && formatDate(employee.probationEndDate) },
    { label: "Confirmed on", value: employee.confirmationDate && formatDate(employee.confirmationDate) },
    { label: "Notice period", value: `${employee.noticePeriodDays} days` },
  ];
  const contact = employee.emergencyContact;

  return (
    <>
      <PageHeader
        title={employee.displayName}
        description={[employee.employeeCode, employee.designationName, employee.departmentName].filter(Boolean).join(" · ")}
        actions={<EmployeeStatusBadge status={employee.status} />}
      />
      <Tabs defaultValue={active}>
        <TabsList className="h-auto flex-wrap justify-start">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: "Employee code", value: employee.employeeCode },
                  { label: "Work email", value: employee.workEmail },
                  { label: "Phone", value: employee.phone },
                  { label: "Department", value: employee.departmentName },
                  { label: "Designation", value: employee.designationName },
                  {
                    label: "Reporting manager",
                    value: employee.reportingManagerId ? (
                      <Link className="text-primary hover:underline" href={`/org/employees/${employee.reportingManagerId}`}>
                        {employee.managerName}
                      </Link>
                    ) : null,
                  },
                  { label: "Employment type", value: EMPLOYMENT_TYPE_LABELS[employee.employmentType] },
                  { label: "Joined", value: formatDate(employee.dateOfJoining) },
                ]}
              />
              {employee.directReports.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 text-sm font-medium">Direct reports</p>
                  <ul className="flex flex-wrap gap-2">
                    {employee.directReports.map((report) => (
                      <li key={report.id}>
                        <Link href={`/org/employees/${report.id}`} className="rounded-full border px-3 py-1 text-sm hover:bg-muted">
                          {report.displayName}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
          <div className="space-y-6">
            <LoginCard
              employeeId={id}
              hasWorkEmail={employee.workEmail !== null}
              user={employee.user}
              canManage={canManageLogins && employee.status !== "exited"}
              canAssignPrivileged={can(user, "role.assign")}
              linkableUsers={canManageLogins ? unlinkedUserOptions(db) : []}
            />
            <ExitCard
              employeeId={id}
              status={employee.status}
              resignationDate={employee.resignationDate}
              lastWorkingDate={employee.lastWorkingDate}
              exitReason={employee.exitReason}
              noticePeriodDays={employee.noticePeriodDays}
              today={today}
              canExit={can(user, "employee.exit")}
            />
          </div>
        </TabsContent>

        <TabsContent value="job">
          {canEdit ? (
            <JobForm
              employeeId={id}
              initial={jobDefaults(employee)}
              today={today}
              departments={withCurrent(departmentOptions(db), employee.departmentId, employee.departmentName)}
              designations={withCurrent(designationOptions(db), employee.designationId, employee.designationName)}
              managers={withCurrent(
                employeeOptions(db).filter((o) => !excluded.has(o.id)),
                employee.reportingManagerId,
                employee.managerName,
              )}
            />
          ) : (
            <Card>
              <CardContent className="pt-5">
                <DetailList items={jobItems} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {showPrivate && (
          <TabsContent value="personal">
            {canEdit ? (
              <PersonalForm employeeId={id} initial={personalDefaults(employee)} />
            ) : (
              <Card>
                <CardContent className="pt-5">
                  <DetailList
                    items={[
                      { label: "Date of birth", value: employee.dateOfBirth && formatDate(employee.dateOfBirth) },
                      { label: "Gender", value: employee.gender && GENDER_LABELS[employee.gender] },
                      { label: "Marital status", value: employee.maritalStatus && MARITAL_STATUS_LABELS[employee.maritalStatus] },
                      { label: "Personal email", value: employee.personalEmail },
                      { label: "Phone", value: employee.phone },
                      { label: "Address", value: formatAddress(employee.address) },
                      { label: "Emergency contact", value: contact && [contact.name, contact.relation, contact.phone].filter(Boolean).join(" · ") },
                    ]}
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {showPrivate && (
          <TabsContent value="bank">
            {canEdit && reveal ? (
              <BankForm employeeId={id} initial={bankDefaults(employee.bank)} />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Bank &amp; IDs</CardTitle>
                  <CardDescription>
                    {employee.bank.masked ? "Numbers are masked. Employees request changes from My profile." : "Shown in full."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DetailList items={bankDetailItems(employee.bank)} />
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {showPrivate && (
          <TabsContent value="documents">
            <DocumentsCard
              employeeId={id}
              documents={listEmployeeDocuments(db, id)}
              categories={DOCUMENT_CATEGORIES}
              canUpload={can(user, "document.manage")}
              canDelete={can(user, "document.manage")}
              timeZone={timeZone}
            />
          </TabsContent>
        )}

        {can(user, "salary.view") && (
          <TabsContent value="salary">
            <EmptyState icon={Landmark} title="Salary arrives with payroll" description="Salary history and revisions are available after Phase 5." />
          </TabsContent>
        )}
        <TabsContent value="attendance">
          <EmployeeAttendanceTab
            employeeId={id}
            month={today.slice(0, 7)}
            shift={attendance.shift}
            assignedShiftId={attendance.assignedShiftId}
            counts={attendance.counts}
            recent={attendance.recent}
            shiftChoice={
              can(user, "shift.manage") && employee.status !== "exited"
                ? { defaultName: defaultShift(db).name, shifts: listShifts(db).map((s) => ({ id: s.id, name: s.name, times: `${s.startTime}–${s.endTime}` })) }
                : null
            }
            links={{ muster: canAny(user, ["attendance.view.all", "regularization.approve"]), mine: isSelf }}
          />
        </TabsContent>
        <TabsContent value="leave">
          <EmployeeLeaveTab
            employeeId={id}
            yearLabel={leaveYearLabel(leaveYear, startMonth)}
            balances={leave.balances}
            recent={leave.recent}
            showRegisterLinks={can(user, "leave.view.all")}
          />
        </TabsContent>
        <TabsContent value="timesheets">
          <EmptyState icon={Timer} title="Timesheets arrive in Phase 4" description="Weekly timesheets will show here." />
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="pt-5">
              <EventsTimeline events={listEmployeeEvents(db, id)} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checklists" className="space-y-4">
          {checklists.length === 0 ? (
            <EmptyState title="No checklists" description="Onboarding starts when an employee is added; offboarding when a resignation is recorded." />
          ) : (
            checklists.map((c) => (
              <ChecklistCard key={c.id} checklist={{ id: c.id, name: c.name, kind: c.kind, status: c.status, items: c.items }} canTick={canTick} />
            ))
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
