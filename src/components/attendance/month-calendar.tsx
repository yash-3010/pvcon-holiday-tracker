"use client";

import { Gift, Lock } from "lucide-react";
import { ATTENDANCE_CODES, ATTENDANCE_STATUS_LABELS } from "@/lib/attendance";
import { formatDate, formatMinutes } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { MyAttendanceDay } from "@/server/modules/attendance/queries";
import { ATTENDANCE_CELL_CLASSES } from "./status-badge";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(day: MyAttendanceDay): string {
  const parts = [formatDate(day.date, { weekday: "long", day: "numeric", month: "long" })];
  if (day.status) parts.push(ATTENDANCE_STATUS_LABELS[day.status]);
  else if (day.isToday) parts.push("today");
  if (day.holiday) parts.push(day.holiday);
  if (day.workedMinutes > 0) parts.push(`${formatMinutes(day.workedMinutes)} worked`);
  if (day.regularization?.status === "pending") parts.push("correction pending");
  return parts.join(", ");
}

/** A month of days as a week grid; each day opens its detail through `onSelect`. */
export function MonthCalendar({ days, onSelect }: { days: MyAttendanceDay[]; onSelect: (day: MyAttendanceDay) => void }) {
  const leading = days[0]?.weekday ?? 0;
  return (
    <div className="rounded-xl border bg-card p-2 sm:p-3">
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leading }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            onClick={() => onSelect(day)}
            disabled={day.isFuture}
            aria-label={dayLabel(day)}
            data-testid={`day-${day.date}`}
            className={cn(
              "flex min-h-16 flex-col items-start gap-0.5 rounded-lg border border-transparent p-1.5 text-left text-xs transition-colors sm:min-h-20",
              "hover:border-border focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:hover:border-transparent",
              day.status ? ATTENDANCE_CELL_CLASSES[day.status] : day.isFuture ? "text-muted-foreground/60" : "bg-muted/40",
              day.isToday && "ring-2 ring-primary",
            )}
          >
            <span className="flex w-full items-center justify-between">
              <span className="font-medium tabular-nums">{Number(day.date.slice(8))}</span>
              <span className="flex items-center gap-0.5">
                {day.locked && <Lock className="size-3" aria-hidden />}
                {day.compOff?.canClaim && <Gift className="size-3" aria-hidden />}
                {day.regularization?.status === "pending" && <span className="size-1.5 rounded-full bg-warning" aria-hidden />}
              </span>
            </span>
            {day.status && <span className="font-semibold">{day.leaveCode && day.status === "on_leave" ? day.leaveCode : ATTENDANCE_CODES[day.status]}</span>}
            {day.workedMinutes > 0 && <span className="tabular-nums opacity-80">{formatMinutes(day.workedMinutes)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
