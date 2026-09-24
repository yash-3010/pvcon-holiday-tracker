/**
 * Calendar-date helpers for `YYYY-MM-DD` strings and `YYYY-MM` periods.
 * All arithmetic is UTC-based so results never depend on the server's local timezone.
 */
export type ISODate = string;
/** A calendar month, `YYYY-MM`. */
export type Period = string;

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD_RE = /^(\d{4})-(\d{2})$/;

export function isISODate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function toUTCDate(iso: ISODate): Date {
  if (!isISODate(iso)) throw new RangeError(`Invalid ISO date: ${iso}`);
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromUTCDate(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: ISODate, days: number): ISODate {
  return fromUTCDate(new Date(toUTCDate(iso).getTime() + days * DAY_MS));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((toUTCDate(to).getTime() - toUTCDate(from).getTime()) / DAY_MS);
}

/** Every date from `start` to `end`, inclusive. Empty when `end` < `start`. */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const n = diffDays(start, end);
  const out: ISODate[] = [];
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: ISODate): number {
  return toUTCDate(iso).getUTCDay();
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso: ISODate): ISODate {
  const dow = dayOfWeek(iso);
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

export function isPeriod(value: string): boolean {
  const m = PERIOD_RE.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

function parsePeriod(period: Period): [number, number] {
  if (!isPeriod(period)) throw new RangeError(`Invalid period: ${period}`);
  const [y, m] = period.split("-").map(Number);
  return [y, m];
}

export function periodOf(iso: ISODate): Period {
  if (!isISODate(iso)) throw new RangeError(`Invalid ISO date: ${iso}`);
  return iso.slice(0, 7);
}

export function daysInMonth(period: Period): number {
  const [y, m] = parsePeriod(period);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthRange(period: Period): { start: ISODate; end: ISODate } {
  const days = daysInMonth(period);
  return { start: `${period}-01`, end: `${period}-${String(days).padStart(2, "0")}` };
}

export function addMonths(period: Period, months: number): Period {
  const [y, m] = parsePeriod(period);
  return fromUTCDate(new Date(Date.UTC(y, m - 1 + months, 1))).slice(0, 7);
}

/** Calendar date of `instant` as seen in `timeZone` (IANA name). */
export function dateInTimeZone(instant: Date, timeZone: string): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function todayInTimeZone(timeZone: string, now: Date = new Date()): ISODate {
  return dateInTimeZone(now, timeZone);
}

export function formatDate(
  iso: ISODate,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" },
  locale = "en-IN",
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(toUTCDate(iso));
}

export function formatPeriod(period: Period, locale = "en-IN"): string {
  parsePeriod(period);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    toUTCDate(`${period}-01`),
  );
}

/** Formats an ISO-8601 instant in `timeZone`, e.g. "24 Sept 2026, 1:30 am". */
export function formatDateTime(isoInstant: string, timeZone: string, locale = "en-IN"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(isoInstant),
  );
}
