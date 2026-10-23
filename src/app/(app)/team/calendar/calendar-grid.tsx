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

export function CalendarGrid({ calendar, todayDate }: { calendar: TeamCalendar; todayDate: string }) {
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
                    {cell?.kind === "leave" && <LeaveMark cell={cell} />}
                    {cell?.kind === "holiday" && (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-warning">H</span>
                    )}
                    {cell?.kind === "leave" && <span className="sr-only">{cellTitle(cell, row.employee.name, d.date)}</span>}
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
