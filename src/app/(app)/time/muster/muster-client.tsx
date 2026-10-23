"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AttendanceStatusBadge, ATTENDANCE_CELL_CLASSES } from "@/components/attendance/status-badge";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUSES, WORK_MODE_LABELS, type AttendanceStatus } from "@/lib/attendance";
import { formatDate, formatMinutes } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AttendanceDayDetail, MusterRoll } from "@/server/modules/attendance/queries";
import { attendanceDayAction, setOverrideAction } from "./actions";

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
const TOTALS: { label: string; title: string; of: (t: Record<AttendanceStatus, number>) => number }[] = [
  { label: "P", title: "Present", of: (t) => t.present },
  { label: "HD", title: "Half days", of: (t) => t.half_day },
  { label: "A", title: "Absent", of: (t) => t.absent },
  { label: "L", title: "Leave days (half-day leave counts ½)", of: (t) => t.on_leave + t.half_leave / 2 },
];

function OverrideForm({ detail, onSaved }: { detail: AttendanceDayDetail; onSaved: () => void }) {
  const [status, setStatus] = useState<string>(detail.row?.overrideStatus ?? "");
  const [note, setNote] = useState(detail.row?.overrideNote ?? "");
  const save = useServerAction(setOverrideAction, { successMessage: "Attendance updated", onSuccess: onSaved });
  return (
    <div className="space-y-3">
      <Field label="Override" htmlFor="override-status" hint="Wins over punches, leave and holidays until cleared.">
        <NativeSelect id="override-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">No override (computed)</option>
          {ATTENDANCE_STATUSES.filter((s) => s !== "not_joined" && s !== "exited").map((s) => (
            <option key={s} value={s}>
              {ATTENDANCE_STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {status && (
        <Field label="Reason" htmlFor="override-note">
          <Textarea id="override-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
      {(status !== "" || detail.row?.overrideStatus) && (
        <Button
          disabled={save.pending}
          onClick={() =>
            save.run({ employeeId: detail.employee.id, date: detail.date, status: status ? (status as AttendanceStatus) : null, note: status ? note : "" })
          }
        >
          {save.pending && <Spinner />}
          {status ? "Save override" : "Clear override"}
        </Button>
      )}
    </div>
  );
}

function DayDialog({
  open, detail, loading, canManage, ownEmployeeId, onClose, onSaved,
}: {
  open: boolean;
  detail: AttendanceDayDetail | null;
  loading: boolean;
  canManage: boolean;
  ownEmployeeId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const row = detail?.row ?? null;
  const facts = row
    ? [
        ["Worked", formatMinutes(row.workedMinutes)],
        row.lateMinutes > 0 && ["Late by", formatMinutes(row.lateMinutes)],
        row.earlyMinutes > 0 && ["Left early by", formatMinutes(row.earlyMinutes)],
        row.overtimeMinutes > 0 && ["Overtime", formatMinutes(row.overtimeMinutes)],
      ].filter((f): f is [string, string] => !!f)
    : [];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{detail ? detail.employee.name : "Loading…"}</DialogTitle>
          <DialogDescription>{detail && formatDate(detail.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</DialogDescription>
        </DialogHeader>
        {loading && !detail ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {row ? <AttendanceStatusBadge status={row.status} /> : <Badge variant="outline">Not recorded yet</Badge>}
              {detail.holiday && <Badge>{detail.holiday}</Badge>}
              {row?.offDayWorked && <Badge variant="info">Worked an off day</Badge>}
              {row?.locked && <Badge variant="outline">Payroll locked</Badge>}
            </div>
            {row?.overrideStatus && (
              <p className="text-sm text-muted-foreground">
                Set by {detail.overrideBy ?? "HR"}: “{row.overrideNote}”
              </p>
            )}
            {facts.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {facts.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <section className="space-y-1">
              <h3 className="text-sm font-medium">Punches</h3>
              {detail.punches.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {detail.punches.map((p, i) => (
                    <li key={i} className="flex items-center gap-2 tabular-nums">
                      <span className="w-12">{p.time}</span>
                      <span className="w-8 text-muted-foreground">{p.direction === "in" ? "In" : "Out"}</span>
                      <span className="text-xs text-muted-foreground">
                        {WORK_MODE_LABELS[p.workMode]}
                        {p.source !== "web" && ` · ${p.source === "auto" ? "automatic" : p.source === "regularization" ? "corrected" : "by HR"}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {canManage && !row?.locked && detail.employee.id !== ownEmployeeId && (
              <>
                <Separator />
                <OverrideForm key={`${detail.employee.id}-${detail.date}-${row?.overrideStatus ?? ""}`} detail={detail} onSaved={onSaved} />
              </>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MusterGrid({
  muster, today, canManage, ownEmployeeId,
}: {
  muster: MusterRoll;
  today: string;
  canManage: boolean;
  ownEmployeeId: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AttendanceDayDetail | null>(null);
  const load = useServerAction(attendanceDayAction, { onSuccess: setDetail });
  const show = (employeeId: number, date: string) => {
    setDetail(null);
    setOpen(true);
    void load.run({ employeeId, date });
  };

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-40 border-b bg-card px-3 py-2 text-left font-medium text-muted-foreground">Employee</th>
              {muster.days.map((d) => (
                <th
                  key={d.date}
                  title={formatDate(d.date)}
                  className={cn("min-w-7 border-b px-0 py-1 text-center font-normal text-muted-foreground", d.date === today && "font-semibold text-primary")}
                >
                  <div>{WEEKDAY_INITIALS[d.weekday]}</div>
                  <div className="tabular-nums">{Number(d.date.slice(8))}</div>
                </th>
              ))}
              {TOTALS.map((t) => (
                <th key={t.label} title={t.title} className="min-w-8 border-b border-l px-1 py-1 text-center font-medium text-muted-foreground">
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {muster.rows.map((row) => (
              <tr key={row.employee.id} className="hover:bg-muted/40">
                <th scope="row" className="sticky left-0 z-10 border-b bg-card px-3 py-1.5 text-left font-normal">
                  <span className="block text-sm font-medium">{row.employee.name}</span>
                  <span className="text-muted-foreground">
                    {row.employee.code}
                    {row.employee.department && ` · ${row.employee.department}`}
                  </span>
                </th>
                {muster.days.map((d) => {
                  const cell = row.cells[d.date];
                  const future = d.date > today;
                  return (
                    <td key={d.date} className="border-b p-0.5 text-center">
                      {future ? null : (
                        <button
                          type="button"
                          onClick={() => show(row.employee.id, d.date)}
                          aria-label={`${row.employee.name}, ${formatDate(d.date)}: ${cell ? ATTENDANCE_STATUS_LABELS[cell.status] : "not recorded"}`}
                          className={cn(
                            "relative flex h-7 w-full min-w-6 items-center justify-center rounded font-semibold hover:ring-1 hover:ring-border",
                            cell && !cell.provisional ? ATTENDANCE_CELL_CLASSES[cell.status] : "text-muted-foreground",
                            cell?.provisional && "border border-dashed",
                          )}
                        >
                          {cell ? cell.code : "·"}
                          {cell?.overridden && <span className="absolute right-0.5 top-0.5 size-1 rounded-full bg-current" aria-hidden />}
                        </button>
                      )}
                    </td>
                  );
                })}
                {TOTALS.map((t) => (
                  <td key={t.label} className="border-b border-l px-1 text-center tabular-nums">
                    {t.of(row.totals)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DayDialog
        open={open}
        detail={detail}
        loading={load.pending}
        canManage={canManage}
        ownEmployeeId={ownEmployeeId}
        onClose={() => setOpen(false)}
        onSaved={() => {
          router.refresh();
          if (detail) void load.run({ employeeId: detail.employee.id, date: detail.date });
        }}
      />
    </>
  );
}
