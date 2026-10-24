"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { dayOfWeek, formatDate, type ISODate } from "@/lib/dates";
import { WEEKDAY_LABELS } from "@/lib/leave";
import { DAY_MINUTES, formatHours, hoursToMinutes } from "@/lib/timesheets";
import { cn } from "@/lib/utils";
import type { WeekDay } from "@/server/modules/timesheets/queries";

export interface GridRow {
  key: string;
  projectCode: string;
  projectName: string;
  clientName: string | null;
  categoryName: string;
  billable: boolean;
  notes: string;
  /** Hours as typed, per date ("" = nothing). */
  hours: Record<ISODate, string>;
}

/** Minutes for a typed value, or null when it isn't a valid number of hours. */
export function parseHours(value: string): number | null {
  if (value.trim() === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  const minutes = hoursToMinutes(n);
  return minutes > DAY_MINUTES ? null : minutes;
}

/** Attendance is to the minute, so it reads as `h:mm` rather than quarter hours. */
const workedLabel = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

function dayNote(day: WeekDay): { text: string; title?: string } | null {
  switch (day.kind) {
    case "holiday":
      return { text: "Holiday", title: day.holiday ?? undefined };
    case "leave":
      return { text: day.leave?.code ?? "Leave", title: "Full day of leave" };
    case "half_leave":
      return { text: `½ ${day.leave?.code ?? "leave"}`, title: "Half day of leave" };
    case "weekly_off":
      return { text: "Off" };
    case "not_employed":
      return { text: "—" };
    default:
      return null;
  }
}

/** The weekly timesheet table (spec §5.3): project × category rows, a column per day, totals and the attendance reference. */
export function WeekGrid({
  days, rows, today, editable, onHours, onBillable, onNotes, onRemove,
}: {
  days: WeekDay[];
  rows: GridRow[];
  today: ISODate;
  editable: boolean;
  onHours?: (rowKey: string, date: ISODate, value: string) => void;
  onBillable?: (rowKey: string, billable: boolean) => void;
  onNotes?: (rowKey: string, notes: string) => void;
  onRemove?: (rowKey: string) => void;
}) {
  const logged = (date: ISODate) => rows.reduce((s, r) => s + (parseHours(r.hours[date] ?? "") ?? 0), 0);
  const rowTotal = (r: GridRow) => days.reduce((s, d) => s + (parseHours(r.hours[d.date] ?? "") ?? 0), 0);
  const weekLogged = days.reduce((s, d) => s + logged(d.date), 0);
  const weekAvailable = days.reduce((s, d) => s + d.availableMinutes, 0);
  const showAttendance = days.some((d) => d.workedMinutes !== null);

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Project and task</th>
            {days.map((d) => {
              const note = dayNote(d);
              return (
                <th
                  key={d.date}
                  className={cn("w-20 px-1 py-2 text-center font-normal", d.date === today && "text-primary", note && d.kind !== "half_leave" && "bg-muted/50")}
                  title={note?.title}
                >
                  <div className="font-medium">{WEEKDAY_LABELS[dayOfWeek(d.date)]!.slice(0, 3)}</div>
                  <div className="text-xs text-muted-foreground">{formatDate(d.date, { day: "numeric", month: "short" })}</div>
                  <div className="h-4 text-[11px] text-muted-foreground">{note?.text}</div>
                </th>
              );
            })}
            <th className="w-16 px-2 py-2 text-right font-medium text-muted-foreground">Total</th>
            {editable && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={days.length + 3} className="px-3 py-6 text-center text-muted-foreground">
                {editable ? "Add a project and task to start logging time." : "No time logged this week."}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.key} className="border-b align-top" data-testid={`row-${r.projectCode}-${r.categoryName}`}>
              <td className="space-y-1 px-3 py-2">
                <div>
                  <span className="font-medium">{r.projectCode}</span> <span className="text-muted-foreground">{r.projectName}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.categoryName}
                  {r.clientName && ` · ${r.clientName}`}
                </div>
                {editable ? (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs">
                      <Checkbox checked={r.billable} onCheckedChange={(c) => onBillable?.(r.key, c === true)} aria-label={`${r.projectCode} ${r.categoryName} billable`} />
                      Billable
                    </label>
                    <Input
                      value={r.notes}
                      onChange={(e) => onNotes?.(r.key, e.target.value)}
                      placeholder="Note"
                      aria-label={`${r.projectCode} ${r.categoryName} note`}
                      className="h-7 text-xs"
                      maxLength={300}
                    />
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {r.billable ? "Billable" : "Not billable"}
                    {r.notes && ` · ${r.notes}`}
                  </div>
                )}
              </td>
              {days.map((d) => {
                const value = r.hours[d.date] ?? "";
                const invalid = parseHours(value) === null;
                const closed = d.date > today || d.kind === "not_employed";
                return (
                  <td key={d.date} className="px-1 py-2 text-center">
                    {editable && !closed ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        step={0.25}
                        min={0}
                        max={24}
                        value={value}
                        onChange={(e) => onHours?.(r.key, d.date, e.target.value)}
                        aria-label={`${r.projectCode} ${r.categoryName} ${d.date}`}
                        aria-invalid={invalid || undefined}
                        className={cn("h-8 px-1 text-center tabular-nums", invalid && "border-destructive")}
                      />
                    ) : (
                      <span className="tabular-nums">{value ? formatHours(parseHours(value) ?? 0) : ""}</span>
                    )}
                  </td>
                );
              })}
              <td className="px-2 py-2 text-right font-medium tabular-nums">{formatHours(rowTotal(r))}</td>
              {editable && (
                <td className="py-1 pr-2">
                  <Button variant="ghost" size="icon" onClick={() => onRemove?.(r.key)} aria-label={`Remove ${r.projectCode} ${r.categoryName}`}>
                    <Trash2 />
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot className="text-xs">
          <tr className="border-b font-medium">
            <td className="px-3 py-2">Logged</td>
            {days.map((d) => (
              <td key={d.date} className={cn("px-1 py-2 text-center tabular-nums", logged(d.date) > DAY_MINUTES && "text-destructive")}>
                {formatHours(logged(d.date))}
              </td>
            ))}
            <td className="px-2 py-2 text-right tabular-nums">{formatHours(weekLogged)}</td>
            {editable && <td />}
          </tr>
          {showAttendance && (
            <tr className="border-b text-muted-foreground">
              <td className="px-3 py-2" title="Worked time from clock in and out">
                Attendance
              </td>
              {days.map((d) => (
                <td
                  key={d.date}
                  className={cn("px-1 py-2 text-center tabular-nums", d.flag && "bg-warning/15 font-medium text-warning")}
                  title={d.flag ? "Logged time and attendance differ by more than an hour" : undefined}
                  data-flag={d.flag || undefined}
                >
                  {d.workedMinutes === null || (d.workedMinutes === 0 && d.availableMinutes === 0) ? "" : workedLabel(d.workedMinutes)}
                </td>
              ))}
              <td />
              {editable && <td />}
            </tr>
          )}
          <tr className="text-muted-foreground">
            <td className="px-3 py-2">Available</td>
            {days.map((d) => (
              <td key={d.date} className="px-1 py-2 text-center tabular-nums">
                {d.availableMinutes ? formatHours(d.availableMinutes) : ""}
              </td>
            ))}
            <td className="px-2 py-2 text-right tabular-nums">{formatHours(weekAvailable)}</td>
            {editable && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
