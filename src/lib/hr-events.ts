import { formatDate, isISODate } from "./dates";
import { formatMoney } from "./money";

/** Fields of `employee_events` values stored in minor units (paise). */
const MONEY_FIELDS = new Set(["annualCtc"]);
const LABELS: Record<string, string> = { annualCtc: "Annual CTC" };

/** The label for a field in an employee's history ("annualCtc" → "Annual CTC", "confirmationDate" → "Confirmation Date"). */
export function eventFieldLabel(key: string): string {
  return LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** A history value as people read it: money in rupees, dates as dates, nothing as a dash. */
export function formatEventValue(key: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (MONEY_FIELDS.has(key) && typeof value === "number") return formatMoney(value);
  return typeof value === "string" && isISODate(value) ? formatDate(value) : String(value);
}
