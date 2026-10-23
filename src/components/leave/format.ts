import { formatDate, type ISODate } from "@/lib/dates";
import { LEAVE_HALF_LABELS, type LeaveHalf } from "@/lib/leave";

/** "02 Nov 2026", "02 Nov 2026 (second half)", "02 Nov – 04 Nov 2026 (ends first half)". */
export function formatLeaveRange(r: { startDate: ISODate; endDate: ISODate; startHalf: LeaveHalf; endHalf: LeaveHalf }): string {
  if (r.startDate === r.endDate) {
    return r.startHalf === "full" ? formatDate(r.startDate) : `${formatDate(r.startDate)} (${LEAVE_HALF_LABELS[r.startHalf].toLowerCase()})`;
  }
  const sameYear = r.startDate.slice(0, 4) === r.endDate.slice(0, 4);
  const start = sameYear ? formatDate(r.startDate, { day: "2-digit", month: "short" }) : formatDate(r.startDate);
  const notes = [r.startHalf === "second_half" ? "from second half" : null, r.endHalf === "first_half" ? "ends first half" : null].filter(Boolean);
  return `${start} – ${formatDate(r.endDate)}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}
