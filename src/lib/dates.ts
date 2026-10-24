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

/** The fiscal year holding `period`, starting in `startMonth` (1–12): its first and last periods and "FY 2026–27". */
export function fiscalYearOf(period: Period, startMonth: number): { start: Period; end: Period; label: string } {
  const [y, m] = parsePeriod(period);
  const startYear = m >= startMonth ? y : y - 1;
  const start = `${startYear}-${String(startMonth).padStart(2, "0")}`;
  const end = addMonths(start, 11);
  const label = startMonth === 1 ? `FY ${startYear}` : `FY ${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`;
  return { start, end, label };
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

function zoneParts(instant: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
}

/** Minutes since local midnight of `instant` in `timeZone`. */
export function minutesInZone(instant: Date, timeZone: string): number {
  const p = zoneParts(instant, timeZone);
  return (p.hour % 24) * 60 + p.minute;
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (IST = 330). */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zoneParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * The instant of local wall-clock `minutes` past midnight on `date` in `timeZone`. A time skipped by a DST change moves
 * forward (02:30 → 03:30); a repeated one takes its first occurrence.
 */
export function zonedInstant(date: ISODate, minutes: number, timeZone: string): Date {
  const wall = toUTCDate(date).getTime() + minutes * 60_000;
  const first = wall - zoneOffsetMinutes(new Date(wall), timeZone) * 60_000;
  const second = wall - zoneOffsetMinutes(new Date(first), timeZone) * 60_000;
  for (const candidate of [first, second]) {
    const instant = new Date(candidate);
    if (dateInTimeZone(instant, timeZone) === date && minutesInZone(instant, timeZone) === minutes) return instant;
  }
  return new Date(Math.max(first, second));
}

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "09:30" → 570. */
export function parseHm(value: string): number {
  const m = HM_RE.exec(value);
  if (!m) throw new RangeError(`Invalid time: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 570 → "09:30". */
export function formatHm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 125 → "2h 05m", 45 → "45m". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
] as const;
