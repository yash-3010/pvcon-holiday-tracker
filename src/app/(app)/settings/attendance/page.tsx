import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { defaultShift, listShifts } from "@/server/modules/attendance/shifts";
import { getSetting } from "@/server/modules/settings/service";
import { AttendanceSettingsForm } from "./attendance-settings-form";

export const metadata: Metadata = { title: "Attendance settings" };

export default async function AttendanceSettingsPage() {
  await requirePermission("attendance.manage");
  const { defaultMode, regularizationWindowDays } = getSetting(db, "attendance");
  const shifts = listShifts(db).map((s) => ({ id: s.id, name: s.name, times: `${s.startTime}–${s.endTime}` }));
  return (
    <>
      <PageHeader title="Attendance settings" description="The default shift and how far back days can be corrected." />
      <AttendanceSettingsForm initial={{ defaultMode, regularizationWindowDays, defaultShiftId: defaultShift(db).id }} shifts={shifts} />
    </>
  );
}
