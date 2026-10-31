"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { LEAVE_HALF_LABELS } from "@/lib/leave";
import type { CalendarCell, TeamCalendar } from "@/server/modules/leave/queries";

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

function cellTitle(cell: CalendarCell, name: string, date: string): string {
  const when = formatDate(date);
  if (cell.kind === "holiday") return `${name}: ${cell.name} (optional holiday), ${when}`;
  const part = cell.portion === "full" ? "" : ` (${LEAVE_HALF_LABELS[cell.portion].toLowerCase()})`;
  return `${name}: ${cell.name}${part}, ${cell.status}, ${when}`;
}

function LeaveMark({ cell }: { cell: Extract<CalendarCell, { kind: "leave" }> }) {
  const color = cell.color ?? "var(--color-muted-foreground)";
  const pending = cell.status === "pending";
  // Half days fill half the cell: the morning on the left, the afternoon on the right.
  const half = cell.portion === "first_half" ? "left-0 right-1/2" : cell.portion === "second_half" ? "left-1/2 right-0" : "inset-x-0";
  return (
    <span
      className={cn("absolute inset-y-1 rounded-sm", half, pending && "border border-dashed")}
      style={pending ? { borderColor: color, backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)` } : { backgroundColor: color }}
    />
  );
}

/** What a marked day is, for a click or a tap: the hover title alone never shows on a phone. */
function CellDetails({ cell, name, date, canApprove }: { cell: CalendarCell; name: string; date: string; canApprove: boolean }) {
  return (
    <div className="space-y-2">
      <div>
        <p className="font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </div>
      {cell.kind === "holiday" ? (
        <p>{cell.name}: an optional holiday they picked.</p>
      ) : (
        <>
          <p className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: cell.color ?? "var(--color-muted-foreground)" }} />
            {cell.name}
            {cell.portion !== "full" && <span className="text-muted-foreground">· {LEAVE_HALF_LABELS[cell.portion].toLowerCase()}</span>}
          </p>
          <Badge variant={cell.status === "approved" ? "success" : "warning"}>{cell.status === "approved" ? "Approved" : "Waiting for approval"}</Badge>
          {cell.status === "pending" && canApprove && (
            <p>
              <Link href="/approvals?tab=leave" className="text-primary underline underline-offset-2">
                Open approvals
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function CalendarGrid({ calendar, todayDate, canApprove }: { calendar: TeamCalendar; todayDate: string; canApprove: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-40 border-b bg-card px-3 py-2 text-left font-medium text-muted-foreground">Employee</th>
            {calendar.days.map((d) => (
              <th
                key={d.date}
                title={d.holiday ? `${d.holiday}, ${formatDate(d.date)}` : formatDate(d.date)}
                className={cn(
                  "min-w-6 border-b px-0 py-1 text-center font-normal text-muted-foreground",
                  d.holiday && "bg-warning/15 text-foreground",
                  d.date === todayDate && "font-semibold text-primary",
                )}
              >
                <div>{WEEKDAY_INITIALS[d.weekday]}</div>
                <div className="tabular-nums">{Number(d.date.slice(8))}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calendar.rows.map((row) => (
            <tr key={row.employee.id} className="hover:bg-muted/40">
              <th scope="row" className="sticky left-0 z-10 border-b bg-card px-3 py-1.5 text-left font-normal">
                <span className="block text-sm font-medium">{row.employee.name}</span>
                <span className="text-muted-foreground">{row.employee.code}</span>
              </th>
              {calendar.days.map((d) => {
                const cell = row.cells[d.date];
                const off = row.weeklyOffs.includes(d.weekday);
                return (
                  <td
                    key={d.date}
                    title={cell ? cellTitle(cell, row.employee.name, d.date) : undefined}
                    className={cn("relative h-10 border-b p-0", (off || d.holiday) && "bg-muted/60", d.holiday && "bg-warning/15")}
                  >
                    {cell && (
                      <Popover>
                        <PopoverTrigger
                          aria-label={cellTitle(cell, row.employee.name, d.date)}
                          className="absolute inset-0 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {cell.kind === "leave" && <LeaveMark cell={cell} />}
                          {cell.kind === "holiday" && (
                            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-warning">H</span>
                          )}
                        </PopoverTrigger>
                        <PopoverContent>
                          <CellDetails cell={cell} name={row.employee.name} date={d.date} canApprove={canApprove} />
                        </PopoverContent>
                      </Popover>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
