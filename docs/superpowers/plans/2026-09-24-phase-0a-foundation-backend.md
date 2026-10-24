# Phase 0A — Foundation Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side foundation of PVCON People:
- tooling, pure date/money utilities, crypto;
- permissions, the new SQLite schema, settings, audit log, notifications;
- users/auth services, the action executor, jobs, file storage, email, seed.
Everything is unit/integration tested. The old holiday-tracker UI keeps working until Phase 0B replaces it.

**Architecture:**
- New code lives in `src/server/**` (server-only domain code) and `src/lib/**` (isomorphic).
- Services are **synchronous** functions taking `db: DbLike` first, because better-sqlite3 transactions cannot `await`.
- Async work (bcrypt, file reads, email) is done outside transactions.
- All mutations will go through `executeAction`, which runs: auth → zod → permission → prepare → sync handler in a transaction with audit.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM 0.45 + better-sqlite3, zod 4, bcryptjs, pino, nodemailer, vitest.

**Read first:** `CLAUDE.md`, spec `docs/superpowers/specs/2026-09-24-hrms-overhaul-design.md` §2–§4.1, roadmap "Spec refinements".

---

## File map

| File | Responsibility |
|---|---|
| `vitest.config.ts`, `tests/setup.ts`, `tests/stubs/server-only.ts` | Test runner config |
| `src/lib/dates.ts` | Pure `YYYY-MM-DD` / `YYYY-MM` math in UTC, timezone conversion, formatting |
| `src/lib/money.ts` | Minor-unit money: rounding, formatting, amount in words |
| `src/lib/auth/permissions.ts` | Roles, permissions, role→permission map, `can()` |
| `src/lib/auth/types.ts` | `SessionUser` type |
| `src/lib/auth/password-policy.ts` | Password rules shared by client and server |
| `src/lib/auth/email-domain.ts` | Allowed login domain check |
| `src/lib/safe-redirect.ts` | Open-redirect-safe `next` param handling |
| `src/lib/validation/settings.ts` | Settings zod schemas + defaults (shared with forms) |
| `src/server/errors.ts` | `DomainError` |
| `src/server/lib/logger.ts` | pino logger |
| `src/server/lib/crypto.ts` | AES-256-GCM field encryption, hashing, tokens, masking |
| `src/server/lib/rate-limit.ts` | In-memory sliding-window limiter |
| `src/server/lib/request.ts` | Client IP from headers |
| `src/server/lib/email.ts` | SMTP send (no-op when unconfigured) + HTML email template |
| `src/server/config.ts` | Env-derived runtime config (lazy getters) |
| `src/server/db/columns.ts` | Shared column helpers (`timestamps()`, `nowIso`) |
| `src/server/db/schema/{auth,system,index}.ts` | Foundation tables |
| `src/server/db/client.ts` | `openDatabase()`, `DB`/`DbLike` types, legacy-DB detector |
| `src/server/db/index.ts` | App-wide singleton `db` (server-only) |
| `src/server/db/migrations/*` | drizzle-kit generated SQL |
| `src/server/modules/settings/service.ts` | `getSetting`, `updateSetting`, `patchSetting` |
| `src/server/modules/audit/service.ts` | `writeAudit`, `diffObjects`, `listAudit` |
| `src/server/modules/notifications/service.ts` | In-app notifications |
| `src/server/modules/users/service.ts` | Credentials, lockout, passwords, reset tokens, users & roles |
| `src/server/actions/execute.ts` | `executeAction` pipeline + `ActionResult` |
| `src/server/jobs/{runner,registry,system-cleanup}.ts` | Idempotent jobs |
| `src/server/modules/files/{service,access}.ts` | Upload storage + access rules |
| `scripts/_env.ts`, `scripts/migrate.ts`, `scripts/seed.ts` | CLI scripts |
| `tests/helpers/{db,fixtures}.ts` | In-memory DB + fixtures |

---

### Task 1: Tooling, dependencies, test runner, logger

**Files:**
- Modify: `package.json` (scripts, deps)
- Modify: `.gitignore`
- Delete: `src/db/seed.ts`, `src/db/migrate.ts` (legacy scripts; `seed.ts` is the only `xlsx` consumer)
- Create: `vitest.config.ts`, `tests/setup.ts`, `tests/stubs/server-only.ts`, `src/server/lib/logger.ts`

- [ ] **Step 1: Confirm branch and clean tree**

Run: `git status --short && git branch --show-current`
Expected: no output from status, branch `feat/hrms-overhaul`.

- [ ] **Step 2: Remove legacy seed/migrate scripts and the vulnerable `xlsx` package**

```bash
git rm src/db/seed.ts src/db/migrate.ts
npm uninstall xlsx
```

- [ ] **Step 3: Install foundation dependencies**

```bash
npm install radix-ui cmdk sonner next-themes @tanstack/react-table@^8 react-hook-form @hookform/resolvers pino server-only nodemailer
npm install -D vitest @types/nodemailer @playwright/test pino-pretty
```

Expected: installs succeed; `npm ls @tanstack/react-table` shows `8.x`.

- [ ] **Step 4: Replace the `scripts` block in `package.json`**

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx scripts/migrate.ts",
    "db:seed": "tsx scripts/seed.ts",
    "db:reset": "rm -f data/people.db data/people.db-wal data/people.db-shm && npm run db:migrate && npm run db:seed",
    "verify": "npm run typecheck && npm run lint && npm run test && npm run build"
  },
```

- [ ] **Step 5: Fix `.gitignore` so `.env.example` is tracked, and ignore test output**

Replace the line `.env*` with:

```gitignore
.env*
!.env.example
```

Append:

```gitignore

# test output
/test-results
/playwright-report
/blob-report
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
  },
});
```

- [ ] **Step 7: Create `tests/setup.ts` and `tests/stubs/server-only.ts`**

`tests/setup.ts`:

```ts
// Deterministic env for unit/integration tests. 32-byte key, base64.
process.env.DATA_ENCRYPTION_KEY ??= "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
process.env.CRON_SECRET ??= "test-cron-secret";
process.env.ALLOWED_EMAIL_DOMAIN ??= "pvcon.in";
process.env.LOG_LEVEL ??= "silent";
```

`tests/stubs/server-only.ts`:

```ts
// Vitest runs outside the react-server condition; this stub replaces the `server-only` guard.
export {};
```

- [ ] **Step 8: Create `src/server/lib/logger.ts`**

```ts
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { app: "pvcon-people" },
  redact: {
    paths: ["password", "*.password", "passwordHash", "*.passwordHash", "token", "*.token"],
    censor: "[redacted]",
  },
});
```

- [ ] **Step 9: Verify the runner works**

Run: `npx vitest run --passWithNoTests`
Expected: exits 0 ("No test files found").

Run: `npm run typecheck`
Expected: exits 0 (the legacy app code still compiles).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: add foundation tooling, vitest and drop xlsx"
```

---

### Task 2: Date utilities (IST-safe)

**Files:**
- Create: `src/lib/dates.ts`
- Test: `tests/unit/lib/dates.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, dateInTimeZone, dayOfWeek, daysInMonth, diffDays, eachDay, formatDate,
  formatPeriod, isISODate, isPeriod, monthRange, periodOf, startOfWeek, toUTCDate,
} from "@/lib/dates";

describe("dates", () => {
  it("validates ISO dates including leap years", () => {
    expect(isISODate("2026-09-24")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("26-09-24")).toBe(false);
    expect(() => toUTCDate("nope")).toThrow(RangeError);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("diffs and enumerates days inclusively", () => {
    expect(diffDays("2026-09-01", "2026-09-30")).toBe(29);
    expect(eachDay("2026-09-28", "2026-10-02")).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02",
    ]);
    expect(eachDay("2026-10-02", "2026-10-01")).toEqual([]);
  });

  it("computes weekday and Monday week start in UTC", () => {
    expect(dayOfWeek("2026-09-24")).toBe(4); // Thursday
    expect(startOfWeek("2026-09-24")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21"); // Sunday belongs to the week starting Monday 21st
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
  });

  it("handles periods", () => {
    expect(isPeriod("2026-09")).toBe(true);
    expect(isPeriod("2026-00")).toBe(false);
    expect(periodOf("2026-09-24")).toBe("2026-09");
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(monthRange("2026-09")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("converts instants to calendar dates in a timezone", () => {
    const instant = new Date("2026-09-23T20:00:00Z");
    expect(dateInTimeZone(instant, "Asia/Kolkata")).toBe("2026-09-24");
    expect(dateInTimeZone(instant, "UTC")).toBe("2026-09-23");
  });

  it("formats dates without timezone drift", () => {
    expect(formatDate("2026-01-05")).toBe("05 Jan 2026");
    expect(formatPeriod("2026-09")).toBe("September 2026");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/dates.test.ts`
Expected: FAIL — cannot resolve `@/lib/dates`.

- [ ] **Step 3: Implement `src/lib/dates.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib/dates.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts tests/unit/lib/dates.test.ts
git commit -m "feat(lib): add timezone-safe date utilities"
```

---

### Task 3: Money utilities

**Files:**
- Create: `src/lib/money.ts`
- Test: `tests/unit/lib/money.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { amountInWords, formatMoney, roundMinor, toMajor, toMinor } from "@/lib/money";

describe("money", () => {
  it("converts between major and minor units", () => {
    expect(toMinor(1234.56)).toBe(123456);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMajor(123456)).toBe(1234.56);
  });

  it("rounds minor units to whole currency units", () => {
    expect(roundMinor(12345, "nearest")).toBe(12300);
    expect(roundMinor(12350, "nearest")).toBe(12400);
    expect(roundMinor(12301, "up")).toBe(12400);
    expect(roundMinor(12399, "down")).toBe(12300);
    expect(roundMinor(123.6, "none")).toBe(124);
    expect(Object.is(roundMinor(-40, "nearest"), 0)).toBe(true);
  });

  it("formats with the Indian numbering system for INR", () => {
    expect(formatMoney(12345678)).toBe("₹1,23,456.78");
    expect(formatMoney(123456, "USD", "en-US")).toBe("$1,234.56");
  });

  it("spells INR amounts using lakh and crore", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(100)).toBe("Rupees One Only");
    expect(amountInWords(123456789)).toBe(
      "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Eighty Nine Paise Only",
    );
    expect(amountInWords(1_000_000_000)).toBe("Rupees One Crore Only");
    expect(amountInWords(1_234_567_800_000)).toBe(
      "Rupees One Thousand Two Hundred Thirty Four Crore Fifty Six Lakh Seventy Eight Thousand Only",
    );
    expect(amountInWords(-5000)).toBe("Minus Rupees Fifty Only");
  });

  it("spells other currencies with the international system", () => {
    expect(amountInWords(123456789, "USD")).toBe(
      "USD One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven and 89/100 Only",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/money.test.ts`
Expected: FAIL — cannot resolve `@/lib/money`.

- [ ] **Step 3: Implement `src/lib/money.ts`**

```ts
/** Money is stored as integer minor units (paise for INR). */
export type Minor = number;
export type RoundMode = "none" | "nearest" | "up" | "down";

const normalizeZero = (n: number) => (Object.is(n, -0) ? 0 : n);

export function toMinor(major: number): Minor {
  return normalizeZero(Math.round(major * 100));
}

export function toMajor(minor: Minor): number {
  return minor / 100;
}

/** `none` rounds to whole minor units; the others round to whole major units (e.g. rupees). */
export function roundMinor(minor: number, mode: RoundMode): Minor {
  let r: number;
  switch (mode) {
    case "none":
      r = Math.round(minor);
      break;
    case "nearest":
      r = Math.round(minor / 100) * 100;
      break;
    case "up":
      r = Math.ceil(minor / 100) * 100;
      break;
    case "down":
      r = Math.floor(minor / 100) * 100;
      break;
  }
  return normalizeZero(r);
}

export function formatMoney(
  minor: Minor,
  currency = "INR",
  locale = currency === "INR" ? "en-IN" : "en-US",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
}

function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? twoDigits(rest) : ""]
    .filter(Boolean)
    .join(" ");
}

function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  let rest = n % 10_000_000;
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

function internationalWords(n: number): string {
  if (n === 0) return "Zero";
  const scales: [number, string][] = [
    [1_000_000_000_000, "Trillion"],
    [1_000_000_000, "Billion"],
    [1_000_000, "Million"],
    [1000, "Thousand"],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [value, name] of scales) {
    const chunk = Math.floor(rest / value);
    if (chunk) {
      parts.push(`${internationalWords(chunk)} ${name}`);
      rest %= value;
    }
  }
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

export function amountInWords(minor: Minor, currency = "INR"): string {
  const abs = Math.round(Math.abs(minor));
  const major = Math.floor(abs / 100);
  const fraction = abs % 100;
  const sign = minor < 0 ? "Minus " : "";
  if (currency === "INR") {
    const paise = fraction ? ` and ${twoDigits(fraction)} Paise` : "";
    return `${sign}Rupees ${indianWords(major)}${paise} Only`;
  }
  const cents = fraction ? ` and ${String(fraction).padStart(2, "0")}/100` : "";
  return `${sign}${currency} ${internationalWords(major)}${cents} Only`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib/money.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/money.ts tests/unit/lib/money.test.ts
git commit -m "feat(lib): add minor-unit money helpers with amount in words"
```

---

### Task 4: Server utilities — DomainError, crypto, rate limiter, request helpers, config

**Files:**
- Create: `src/server/errors.ts`, `src/server/lib/crypto.ts`, `src/server/lib/rate-limit.ts`, `src/server/lib/request.ts`, `src/server/config.ts`
- Test: `tests/unit/server/crypto.test.ts`, `tests/unit/server/rate-limit.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/unit/server/crypto.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, mask, randomToken, safeEqual, sha256Hex } from "@/server/lib/crypto";

const KEY = process.env.DATA_ENCRYPTION_KEY;
afterEach(() => {
  process.env.DATA_ENCRYPTION_KEY = KEY;
});

describe("crypto", () => {
  it("round-trips field encryption with a random IV", () => {
    const a = encrypt("50100123456789");
    const b = encrypt("50100123456789");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(decrypt(a)).toBe("50100123456789");
  });

  it("detects tampering", () => {
    const payload = encrypt("secret");
    const parts = payload.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("requires a 32-byte key", () => {
    process.env.DATA_ENCRYPTION_KEY = "";
    expect(() => encrypt("x")).toThrow(/DATA_ENCRYPTION_KEY/);
    process.env.DATA_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    expect(() => encrypt("x")).toThrow(/32 bytes/);
  });

  it("masks all but the last four characters without leaking length", () => {
    expect(mask("123456789012")).toBe("XXXX9012");
    expect(mask("12")).toBe("XXXX");
    expect(mask("")).toBe("");
  });

  it("hashes, generates tokens and compares safely", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(safeEqual("Bearer abc", "Bearer abc")).toBe(true);
    expect(safeEqual("Bearer abc", "Bearer abcd")).toBe(false);
  });
});
```

`tests/unit/server/rate-limit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/server/lib/rate-limit";

describe("createRateLimiter", () => {
  it("allows up to max hits per window per key", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
    expect(limiter.check("ip:1", 0)).toBe(true);
    expect(limiter.check("ip:1", 100)).toBe(true);
    expect(limiter.check("ip:1", 200)).toBe(false);
    expect(limiter.check("ip:2", 200)).toBe(true);
  });

  it("frees capacity once hits leave the window", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.check("k", 0)).toBe(true);
    expect(limiter.check("k", 999)).toBe(false);
    expect(limiter.check("k", 1001)).toBe(true);
  });

  it("can be reset", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    limiter.check("k", 0);
    limiter.reset("k");
    expect(limiter.check("k", 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/server`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/server/errors.ts`**

```ts
/** A business-rule violation that is safe to show to the user. */
export class DomainError extends Error {
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(code: string, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}
```

- [ ] **Step 4: Implement `src/server/lib/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

function getKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

/** AES-256-GCM. Output format: `v1:<iv b64>:<tag b64>:<ciphertext b64>`. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== "v1" || !iv || !tag || ciphertext === undefined) {
    throw new Error("Unsupported ciphertext format");
  }
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** `XXXX` + last four characters; never reveals the original length. */
export function mask(value: string, visible = 4): string {
  if (!value) return "";
  if (value.length <= visible) return "XXXX";
  return `XXXX${value.slice(-visible)}`;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** URL-safe random token (32 bytes → 43 chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time string comparison that also works for different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
```

- [ ] **Step 5: Implement `src/server/lib/rate-limit.ts`**

```ts
export interface RateLimiter {
  /** Records a hit and returns false when the key is over its limit. */
  check(key: string, now?: number): boolean;
  reset(key: string): void;
}

/** In-memory sliding-window limiter. Suitable for the single-process deployment. */
export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key, now = Date.now()) {
      const cutoff = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.every((t) => t <= cutoff)) hits.delete(k);
      }
      return true;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
```

- [ ] **Step 6: Implement `src/server/lib/request.ts` and `src/server/config.ts`**

`src/server/lib/request.ts`:

```ts
/** Best-effort client IP. Caddy sets X-Forwarded-For in production. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || null;
}
```

`src/server/config.ts`:

```ts
/** Runtime configuration from environment variables, read lazily so tests can override them. */
export const config = {
  get dbFile() {
    return process.env.DB_FILE ?? "./data/people.db";
  },
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get allowedEmailDomain() {
    return (process.env.ALLOWED_EMAIL_DOMAIN ?? "pvcon.in").toLowerCase();
  },
  get uploadDir() {
    return process.env.UPLOAD_DIR ?? "./data/uploads";
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
};
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run tests/unit/server`
Expected: PASS (8 tests).

- [ ] **Step 8: Commit**

```bash
git add src/server tests/unit/server
git commit -m "feat(server): add DomainError, crypto, rate limiter and config"
```

---

### Task 5: Roles and permissions

**Files:**
- Create: `src/lib/auth/permissions.ts`, `src/lib/auth/types.ts`
- Test: `tests/unit/lib/permissions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  PERMISSIONS, ROLE_PERMISSIONS, ROLES, can, canAny, isPrivilegedRole, isRole, permissionsForRoles,
} from "@/lib/auth/permissions";

const holder = (...roles: (typeof ROLES)[number][]) => ({ permissions: permissionsForRoles(roles) });

describe("permissions", () => {
  it("gives employees self-service only", () => {
    const u = holder("employee");
    expect(can(u, "directory.view")).toBe(true);
    expect(can(u, "employee.view")).toBe(false);
    expect(can(u, "leave.approve")).toBe(false);
  });

  it("gives managers team approvals but not org-wide views", () => {
    const u = holder("employee", "manager");
    expect(can(u, "leave.approve")).toBe(true);
    expect(can(u, "compoff.approve")).toBe(true);
    expect(can(u, "leave.view.all")).toBe(false);
  });

  it("keeps salaries away from HR and HR tools away from payroll", () => {
    const hr = holder("hr_admin");
    expect(can(hr, "employee.create")).toBe(true);
    expect(can(hr, "user.manage")).toBe(true);
    expect(can(hr, "salary.view")).toBe(false);
    expect(can(hr, "payroll.run")).toBe(false);
    expect(can(hr, "role.assign")).toBe(false);
    const payroll = holder("payroll_admin");
    expect(can(payroll, "payroll.approve")).toBe(true);
    expect(can(payroll, "employee.create")).toBe(false);
  });

  it("gives super admins everything", () => {
    const u = holder("super_admin");
    for (const p of PERMISSIONS) expect(can(u, p)).toBe(true);
  });

  it("unions and de-duplicates role permissions", () => {
    const perms = permissionsForRoles(["manager", "hr_admin"]);
    expect(new Set(perms).size).toBe(perms.length);
    expect(perms).toEqual([...perms].sort());
  });

  it("only uses known permissions in role maps", () => {
    for (const role of ROLES) for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
  });

  it("has helpers for role checks", () => {
    expect(isRole("manager")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isPrivilegedRole("hr_admin")).toBe(true);
    expect(isPrivilegedRole("manager")).toBe(false);
    expect(canAny(holder("employee"), ["employee.view", "directory.view"])).toBe(true);
    expect(can(null, "directory.view")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/permissions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/auth/permissions.ts`**

```ts
export const ROLES = ["employee", "manager", "hr_admin", "payroll_admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  employee: "Employee",
  manager: "Manager",
  hr_admin: "HR Admin",
  payroll_admin: "Payroll Admin",
  super_admin: "Super Admin",
};

export const PERMISSIONS = [
  "directory.view",
  "employee.view",
  "employee.create",
  "employee.update",
  "employee.exit",
  "employee.import",
  "employee.sensitive.view",
  "document.manage",
  "org.manage",
  "attendance.view.all",
  "attendance.manage",
  "shift.manage",
  "regularization.approve",
  "timesheet.view.all",
  "timesheet.approve",
  "project.manage",
  "leave.view.all",
  "leave.approve",
  "leave.config",
  "leave.adjust",
  "holiday.manage",
  "compoff.approve",
  "salary.view",
  "salary.manage",
  "payroll.configure",
  "payroll.run",
  "payroll.approve",
  "payroll.release",
  "loan.manage",
  "claim.approve",
  "claim.pay",
  "report.hr",
  "report.attendance",
  "report.timesheet",
  "report.leave",
  "report.payroll",
  "announcement.manage",
  "settings.manage",
  "role.assign",
  "user.manage",
  "audit.view",
  "job.run",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const EMPLOYEE: Permission[] = ["directory.view"];

const MANAGER: Permission[] = [
  ...EMPLOYEE,
  "leave.approve",
  "compoff.approve",
  "regularization.approve",
  "timesheet.approve",
  "claim.approve",
  "report.attendance",
  "report.leave",
  "report.timesheet",
];

const HR_ADMIN: Permission[] = [
  ...MANAGER,
  "employee.view",
  "employee.create",
  "employee.update",
  "employee.exit",
  "employee.import",
  "employee.sensitive.view",
  "document.manage",
  "org.manage",
  "attendance.view.all",
  "attendance.manage",
  "shift.manage",
  "timesheet.view.all",
  "project.manage",
  "leave.view.all",
  "leave.config",
  "leave.adjust",
  "holiday.manage",
  "report.hr",
  "announcement.manage",
  "user.manage",
];

const PAYROLL_ADMIN: Permission[] = [
  ...EMPLOYEE,
  "employee.view",
  "employee.sensitive.view",
  "attendance.view.all",
  "leave.view.all",
  "salary.view",
  "salary.manage",
  "payroll.configure",
  "payroll.run",
  "payroll.approve",
  "payroll.release",
  "loan.manage",
  "claim.pay",
  "report.payroll",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  employee: EMPLOYEE,
  manager: MANAGER,
  hr_admin: HR_ADMIN,
  payroll_admin: PAYROLL_ADMIN,
  super_admin: PERMISSIONS,
};

/** Roles that only holders of `role.assign` may grant or revoke. */
const PRIVILEGED_ROLES: readonly Role[] = ["hr_admin", "payroll_admin", "super_admin"];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isPrivilegedRole(role: Role): boolean {
  return PRIVILEGED_ROLES.includes(role);
}

export function permissionsForRoles(roles: readonly Role[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) for (const p of ROLE_PERMISSIONS[role]) set.add(p);
  return [...set].sort();
}

export interface PermissionHolder {
  permissions: readonly Permission[];
}

export function can(user: PermissionHolder | null | undefined, permission: Permission): boolean {
  return !!user && user.permissions.includes(permission);
}

export function canAny(user: PermissionHolder | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(user, p));
}
```

- [ ] **Step 4: Implement `src/lib/auth/types.ts`**

```ts
import type { Permission, Role } from "./permissions";

/** The authenticated user as resolved from the database on each request. */
export interface SessionUser {
  id: number;
  email: string;
  name: string;
  roles: Role[];
  permissions: Permission[];
  mustChangePassword: boolean;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/unit/lib/permissions.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth tests/unit/lib/permissions.test.ts
git commit -m "feat(auth): add roles, permissions and SessionUser type"
```

---

### Task 6: Password policy, email domain, safe redirect

**Files:**
- Create: `src/lib/auth/password-policy.ts`, `src/lib/auth/email-domain.ts`, `src/lib/safe-redirect.ts`
- Test: `tests/unit/lib/auth-helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { passwordProblems } from "@/lib/auth/password-policy";
import { isAllowedEmail } from "@/lib/auth/email-domain";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("passwordProblems", () => {
  const policy = { minLength: 10 };
  it("accepts a strong password", () => {
    expect(passwordProblems("Str0ngPassword", policy)).toEqual([]);
  });
  it("lists every unmet rule", () => {
    expect(passwordProblems("short", policy)).toEqual([
      "At least 10 characters",
      "An uppercase letter",
      "A number",
    ]);
    expect(passwordProblems("A".repeat(73) + "a1", policy)).toContain("At most 72 characters");
  });
});

describe("isAllowedEmail", () => {
  it("matches the domain case-insensitively and exactly", () => {
    expect(isAllowedEmail("Yash@PVCON.in", "pvcon.in")).toBe(true);
    expect(isAllowedEmail("x@evil-pvcon.in", "pvcon.in")).toBe(false);
    expect(isAllowedEmail("x@pvcon.in.evil.com", "pvcon.in")).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("allows same-origin paths only", () => {
    expect(safeRedirectPath("/settings/users?tab=1")).toBe("/settings/users?tab=1");
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath("https://evil.com")).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/auth-helpers.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three helpers**

`src/lib/auth/password-policy.ts`:

```ts
export interface PasswordPolicy {
  minLength: number;
}

/** bcrypt only uses the first 72 bytes, so longer passwords are rejected. */
export const PASSWORD_MAX_LENGTH = 72;

export function passwordProblems(password: string, policy: PasswordPolicy): string[] {
  const problems: string[] = [];
  if (password.length < policy.minLength) problems.push(`At least ${policy.minLength} characters`);
  if (password.length > PASSWORD_MAX_LENGTH) problems.push(`At most ${PASSWORD_MAX_LENGTH} characters`);
  if (!/[a-z]/.test(password)) problems.push("A lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("An uppercase letter");
  if (!/\d/.test(password)) problems.push("A number");
  return problems;
}
```

`src/lib/auth/email-domain.ts`:

```ts
export function isAllowedEmail(email: string, domain: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${domain.toLowerCase()}`);
}
```

`src/lib/safe-redirect.ts`:

```ts
/** Returns `value` only when it is a same-origin absolute path; otherwise `/`. */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib/auth-helpers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib tests/unit/lib/auth-helpers.test.ts
git commit -m "feat(auth): add password policy, email domain and redirect guards"
```

---

### Task 7: Database schema, client, migrations, test helpers

**Files:**
- Create: `src/server/db/columns.ts`, `src/server/db/schema/auth.ts`, `src/server/db/schema/system.ts`, `src/server/db/schema/index.ts`, `src/server/db/client.ts`, `src/server/db/index.ts`, `scripts/_env.ts`, `scripts/migrate.ts`, `tests/helpers/db.ts`
- Modify: `drizzle.config.ts`
- Generated: `src/server/db/migrations/0000_*.sql` + `meta/`
- Test: `tests/integration/db/schema.test.ts`

- [ ] **Step 1: Create `src/server/db/columns.ts`**

```ts
import { text } from "drizzle-orm/sqlite-core";

export const nowIso = () => new Date().toISOString();

/** `created_at` / `updated_at` as ISO-8601 UTC strings. Call once per table. */
export function timestamps() {
  return {
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at").notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
  };
}
```

- [ ] **Step 2: Create `src/server/db/schema/auth.ts`** (relative imports only; drizzle-kit does not resolve `@/`)

```ts
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { ROLES } from "../../../lib/auth/permissions";
import { nowIso, timestamps } from "../columns";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  sessionVersion: integer("session_version").notNull().default(1),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: text("locked_until"),
  lastLoginAt: text("last_login_at"),
  ...timestamps(),
});

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("password_reset_tokens_user_idx").on(t.userId)],
);

export type UserRow = typeof users.$inferSelect;
```

- [ ] **Step 3: Create `src/server/db/schema/system.ts`**

```ts
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { nowIso } from "../columns";
import { users } from "./auth";

export const companySettings = sqliteTable("company_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: text("updated_at").notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    diff: text("diff", { mode: "json" }).$type<Record<string, unknown> | null>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    at: text("at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_at_idx").on(t.at),
    index("audit_logs_actor_idx").on(t.actorUserId),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)],
);

export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    job: text("job").notNull(),
    runKey: text("run_key").notNull(),
    status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    detail: text("detail"),
  },
  (t) => [uniqueIndex("job_runs_job_key_idx").on(t.job, t.runKey)],
);

export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storageName: text("storage_name").notNull().unique(),
  originalName: text("original_name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
});

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type JobRunRow = typeof jobRuns.$inferSelect;
export type FileRow = typeof files.$inferSelect;
```

- [ ] **Step 4: Create `src/server/db/schema/index.ts`**

```ts
export * from "./auth";
export * from "./system";
```

- [ ] **Step 5: Create `src/server/db/client.ts`**

```ts
import Database from "better-sqlite3";
import type { RunResult } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export type Schema = typeof schema;
/** The root database handle. */
export type DB = BetterSQLite3Database<Schema>;
/** A database or transaction handle. Every service function takes this as its first argument. */
export type DbLike = BaseSQLiteDatabase<"sync", RunResult, Schema>;

export function openDatabase(file: string): { db: DB; sqlite: Database.Database } {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return { db: drizzle(sqlite, { schema }), sqlite };
}

/** True for the old holiday-tracker database, which must never be migrated in place. */
export function isLegacyDatabase(sqlite: Database.Database): boolean {
  const row = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name = 'leave_policy'")
    .get();
  return row !== undefined;
}
```

- [ ] **Step 6: Create `src/server/db/index.ts`** (app singleton)

```ts
import "server-only";
import { config } from "@/server/config";
import { openDatabase, type DB } from "./client";

const globalForDb = globalThis as unknown as { __pvconDb?: ReturnType<typeof openDatabase> };
const connection = globalForDb.__pvconDb ?? openDatabase(config.dbFile);
if (process.env.NODE_ENV !== "production") globalForDb.__pvconDb = connection;

export const db: DB = connection.db;
export type { DB, DbLike } from "./client";
```

- [ ] **Step 7: Replace `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./src/server/db/migrations",
  dialect: "sqlite",
  dbCredentials: { url: process.env.DB_FILE ?? "./data/people.db" },
});
```

- [ ] **Step 8: Generate the initial migration**

Run: `npx drizzle-kit generate --name foundation`
Expected: creates `src/server/db/migrations/0000_foundation.sql` containing `CREATE TABLE \`users\``, `user_roles`, `password_reset_tokens`, `company_settings`, `audit_logs`, `notifications`, `job_runs`, `files`, and `meta/_journal.json`.

- [ ] **Step 9: Create `scripts/_env.ts` and `scripts/migrate.ts`**

`scripts/_env.ts`:

```ts
import { existsSync } from "node:fs";

// Load .env.local / .env for CLI scripts. Variables already in the environment win.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
```

`scripts/migrate.ts`:

```ts
import "./_env";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { isLegacyDatabase, openDatabase } from "../src/server/db/client";

const file = process.env.DB_FILE ?? "./data/people.db";
const { db, sqlite } = openDatabase(file);

if (isLegacyDatabase(sqlite)) {
  console.error(
    `Refusing to migrate ${file}: it is a legacy Holiday Tracker database.\n` +
      "Use scripts/migrate-legacy.ts to build a new database from it.",
  );
  process.exit(1);
}

migrate(db, { migrationsFolder: "./src/server/db/migrations" });
console.log(`Migrations applied to ${file}`);
```

- [ ] **Step 10: Create `tests/helpers/db.ts`**

```ts
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase, type DB } from "@/server/db/client";

/** Fresh in-memory database with all migrations applied. */
export function createTestDb(): DB {
  const { db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "src/server/db/migrations" });
  return db;
}
```

- [ ] **Step 11: Write the schema test**

`tests/integration/db/schema.test.ts`:

```ts
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isLegacyDatabase } from "@/server/db/client";
import { userRoles, users } from "@/server/db/schema";
import { createTestDb } from "../../helpers/db";

describe("foundation schema", () => {
  it("creates all foundation tables", () => {
    const db = createTestDb();
    const names = db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "users", "user_roles", "password_reset_tokens", "company_settings",
        "audit_logs", "notifications", "job_runs", "files",
      ]),
    );
  });

  it("enforces foreign keys", () => {
    const db = createTestDb();
    expect(() => db.insert(userRoles).values({ userId: 999, role: "employee" }).run()).toThrow(/FOREIGN KEY/);
  });

  it("fills ISO timestamps and defaults", () => {
    const db = createTestDb();
    const user = db
      .insert(users)
      .values({ email: "a@pvcon.in", name: "A", passwordHash: "x" })
      .returning()
      .get();
    expect(user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(user.status).toBe("active");
    expect(user.mustChangePassword).toBe(true);
    expect(user.sessionVersion).toBe(1);
  });

  it("detects legacy holiday-tracker databases", () => {
    const legacy = new Database(":memory:");
    legacy.exec("create table leave_policy (year integer primary key)");
    expect(isLegacyDatabase(legacy)).toBe(true);
    expect(isLegacyDatabase(new Database(":memory:"))).toBe(false);
  });
});
```

- [ ] **Step 12: Run tests**

Run: `npx vitest run tests/integration/db`
Expected: PASS (4 tests).

- [ ] **Step 13: Smoke-test the migrate script**

Run: `DB_FILE=./data/scratch.db npm run db:migrate && rm -f data/scratch.db*`
Expected: `Migrations applied to ./data/scratch.db`.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(db): add foundation schema, client, migrations and test helper"
```

---

### Task 8: Settings definitions and service

**Files:**
- Create: `src/lib/validation/settings.ts`, `src/server/modules/settings/service.ts`
- Test: `tests/integration/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { companySettings } from "@/server/db/schema";
import type { DB } from "@/server/db/client";
import { getSetting, patchSetting, updateSetting } from "@/server/modules/settings/service";
import { localeSettingsSchema } from "@/lib/validation/settings";
import { createTestDb } from "../helpers/db";

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

describe("settings service", () => {
  it("returns defaults when nothing is stored", () => {
    expect(getSetting(db, "locale")).toEqual({ timezone: "Asia/Kolkata", currency: "INR", fiscalYearStartMonth: 4 });
    expect(getSetting(db, "security").lockoutAttempts).toBe(5);
  });

  it("patches, persists and reports before/after", () => {
    const { before, after } = patchSetting(db, "security", { lockoutAttempts: 7 }, null);
    expect(before.lockoutAttempts).toBe(5);
    expect(after).toEqual({ lockoutAttempts: 7, lockoutMinutes: 15, passwordMinLength: 10 });
    expect(getSetting(db, "security").lockoutAttempts).toBe(7);
  });

  it("merges defaults into stored values that predate new keys", () => {
    db.insert(companySettings).values({ key: "compOff", value: { enabled: false } }).run();
    const value = getSetting(db, "compOff");
    expect(value.enabled).toBe(false);
    expect(value.expiryDays).toBe(90);
  });

  it("falls back to defaults when the stored value is invalid", () => {
    db.insert(companySettings).values({ key: "security", value: { lockoutAttempts: 0 } }).run();
    expect(getSetting(db, "security").lockoutAttempts).toBe(5);
  });

  it("rejects invalid updates", () => {
    expect(() => updateSetting(db, "security", { lockoutAttempts: 1, lockoutMinutes: 15, passwordMinLength: 10 }, null)).toThrow();
  });

  it("validates time zones", () => {
    expect(localeSettingsSchema.safeParse({ timezone: "Mars/Olympus", currency: "INR", fiscalYearStartMonth: 4 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/settings.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/lib/validation/settings.ts`**

```ts
import { z } from "zod";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const companySettingsSchema = z.object({
  legalName: z.string().trim().min(1, "Required").max(200),
  displayName: z.string().trim().min(1, "Required").max(100),
  address: z.string().trim().max(500),
  logoFileId: z.number().int().positive().nullable(),
});

export const localeSettingsSchema = z.object({
  timezone: z.string().refine(isValidTimeZone, "Unknown time zone"),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code"),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
});

export const employeeSettingsSchema = z.object({
  codePrefix: z.string().regex(/^[A-Z]{1,5}$/, "1–5 uppercase letters"),
  codeDigits: z.number().int().min(3).max(6),
});

export const leaveSettingsSchema = z.object({
  yearStartMonth: z.number().int().min(1).max(12),
});

export const attendanceSettingsSchema = z.object({
  defaultMode: z.enum(["punch", "auto"]),
  regularizationWindowDays: z.number().int().min(0).max(365),
});

export const compOffSettingsSchema = z.object({
  enabled: z.boolean(),
  /** null = use the employee's shift half-day threshold */
  halfDayMinutes: z.number().int().min(30).max(1440).nullable(),
  /** null = use the employee's shift full-day threshold */
  fullDayMinutes: z.number().int().min(30).max(1440).nullable(),
  claimWindowDays: z.number().int().min(1).max(365),
  expiryDays: z.number().int().min(1).max(730),
  payoutEnabled: z.boolean(),
});

export const payrollSettingsSchema = z.object({
  prorationBasis: z.enum(["calendar", "working"]),
  payDay: z.number().int().min(1).max(31),
  payslipFooter: z.string().max(500),
  varianceThresholdPct: z.number().min(0).max(100),
  signatoryEnabled: z.boolean(),
  signatoryName: z.string().max(100),
  signatoryDesignation: z.string().max(100),
  signatoryImageFileId: z.number().int().positive().nullable(),
  emailAttachment: z.enum(["none", "protected"]),
  pdfPasswordFormat: z.enum(["dob_ddmmyyyy", "employee_code"]),
});

export const securitySettingsSchema = z.object({
  lockoutAttempts: z.number().int().min(3).max(20),
  lockoutMinutes: z.number().int().min(1).max(1440),
  passwordMinLength: z.number().int().min(8).max(64),
});

function defineSetting<S extends z.ZodType>(schema: S, defaults: z.output<S>) {
  return { schema, defaults };
}

export const SETTINGS = {
  company: defineSetting(companySettingsSchema, {
    legalName: "PVCON Consulting",
    displayName: "PVCON",
    address: "",
    logoFileId: null,
  }),
  locale: defineSetting(localeSettingsSchema, {
    timezone: "Asia/Kolkata",
    currency: "INR",
    fiscalYearStartMonth: 4,
  }),
  employee: defineSetting(employeeSettingsSchema, { codePrefix: "PV", codeDigits: 4 }),
  leave: defineSetting(leaveSettingsSchema, { yearStartMonth: 1 }),
  attendance: defineSetting(attendanceSettingsSchema, { defaultMode: "punch", regularizationWindowDays: 30 }),
  compOff: defineSetting(compOffSettingsSchema, {
    enabled: true,
    halfDayMinutes: null,
    fullDayMinutes: null,
    claimWindowDays: 30,
    expiryDays: 90,
    payoutEnabled: false,
  }),
  payroll: defineSetting(payrollSettingsSchema, {
    prorationBasis: "calendar",
    payDay: 1,
    payslipFooter: "",
    varianceThresholdPct: 10,
    signatoryEnabled: false,
    signatoryName: "",
    signatoryDesignation: "",
    signatoryImageFileId: null,
    emailAttachment: "none",
    pdfPasswordFormat: "dob_ddmmyyyy",
  }),
  security: defineSetting(securitySettingsSchema, {
    lockoutAttempts: 5,
    lockoutMinutes: 15,
    passwordMinLength: 10,
  }),
};

export type SettingsKey = keyof typeof SETTINGS;
export type SettingsValue<K extends SettingsKey> = z.output<(typeof SETTINGS)[K]["schema"]>;
```

- [ ] **Step 4: Implement `src/server/modules/settings/service.ts`**

```ts
import { eq } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { companySettings } from "@/server/db/schema";
import { SETTINGS, type SettingsKey, type SettingsValue } from "@/lib/validation/settings";

export function getSetting<K extends SettingsKey>(db: DbLike, key: K): SettingsValue<K> {
  const def = SETTINGS[key];
  const row = db
    .select({ value: companySettings.value })
    .from(companySettings)
    .where(eq(companySettings.key, key))
    .get();
  const stored =
    row && typeof row.value === "object" && row.value !== null ? (row.value as Record<string, unknown>) : {};
  const parsed = def.schema.safeParse({ ...(def.defaults as object), ...stored });
  return (parsed.success ? parsed.data : def.defaults) as SettingsValue<K>;
}

/** Replaces the whole value. Throws a ZodError when invalid. */
export function updateSetting<K extends SettingsKey>(
  db: DbLike,
  key: K,
  value: unknown,
  actorUserId: number | null,
): { before: SettingsValue<K>; after: SettingsValue<K> } {
  const before = getSetting(db, key);
  const after = SETTINGS[key].schema.parse(value) as SettingsValue<K>;
  db.insert(companySettings)
    .values({ key, value: after, updatedBy: actorUserId })
    .onConflictDoUpdate({
      target: companySettings.key,
      set: { value: after, updatedBy: actorUserId, updatedAt: nowIso() },
    })
    .run();
  return { before, after };
}

/** Merges `partial` into the current value, then validates and saves. */
export function patchSetting<K extends SettingsKey>(
  db: DbLike,
  key: K,
  partial: Partial<SettingsValue<K>>,
  actorUserId: number | null,
) {
  const current = getSetting(db, key);
  return updateSetting(db, key, { ...(current as object), ...(partial as object) }, actorUserId);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/integration/settings.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/validation src/server/modules/settings tests/integration/settings.test.ts
git commit -m "feat(settings): add typed company settings with defaults"
```

---

### Task 9: Audit log service

**Files:**
- Create: `src/server/modules/audit/service.ts`
- Test: `tests/integration/audit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { diffObjects, listAudit, writeAudit } from "@/server/modules/audit/service";
import { createTestDb } from "../helpers/db";

let db: DB;
let actorId: number;
beforeEach(() => {
  db = createTestDb();
  actorId = db.insert(users).values({ email: "hr@pvcon.in", name: "HR Person", passwordHash: "x" }).returning().get().id;
});

describe("diffObjects", () => {
  it("returns changed keys only and redacts secrets", () => {
    expect(
      diffObjects(
        { name: "A", passwordHash: "old", bankAccountEnc: "v1:a", same: 1, updatedAt: "t1" },
        { name: "B", passwordHash: "new", bankAccountEnc: "v1:b", same: 1, updatedAt: "t2" },
      ),
    ).toEqual({
      name: { from: "A", to: "B" },
      passwordHash: { from: "[redacted]", to: "[redacted]" },
      bankAccountEnc: { from: "[redacted]", to: "[redacted]" },
    });
    expect(diffObjects({ a: 1 }, { a: 1 })).toBeNull();
  });
});

describe("audit log", () => {
  it("writes and lists entries newest first with actor names", () => {
    writeAudit(db, { actorUserId: actorId, action: "user.create", entityType: "user", entityId: 5, summary: "Created" });
    writeAudit(db, { actorUserId: null, action: "job.run", entityType: "job", entityId: "system:cleanup", summary: "Ran" });
    const { rows, total } = listAudit(db);
    expect(total).toBe(2);
    expect(rows[0].action).toBe("job.run");
    expect(rows[0].actorName).toBeNull();
    expect(rows[1].actorName).toBe("HR Person");
    expect(rows[1].entityId).toBe("5");
  });

  it("filters by entity type, action prefix, actor and date range and paginates", () => {
    for (let i = 0; i < 5; i++) {
      writeAudit(db, { actorUserId: actorId, action: "settings.update", entityType: "settings", entityId: "company", summary: `s${i}` });
    }
    writeAudit(db, { actorUserId: null, action: "user.create", entityType: "user", summary: "u" });
    expect(listAudit(db, { entityType: "settings" }).total).toBe(5);
    expect(listAudit(db, { actionPrefix: "user." }).total).toBe(1);
    expect(listAudit(db, { actorUserId: actorId }).total).toBe(5);
    const page2 = listAudit(db, { entityType: "settings", page: 2, pageSize: 2 });
    expect(page2.rows).toHaveLength(2);
    const today = new Date().toISOString().slice(0, 10);
    expect(listAudit(db, { from: today, to: today }).total).toBe(6);
    expect(listAudit(db, { to: "2000-01-01" }).total).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/audit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/modules/audit/service.ts`**

```ts
import { and, count, desc, eq, gte, like, lt, type SQL } from "drizzle-orm";
import { addDays } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { auditLogs, users } from "@/server/db/schema";

export interface AuditEntry {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary: string;
  diff?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

const REDACT = /password|secret|token|Enc$|_enc$/i;

/** Field-level diff for audit entries. Skips `updatedAt`, redacts secrets, returns null when nothing changed. */
export function diffObjects(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { from: unknown; to: unknown }> | null {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    if (key === "updatedAt") continue;
    const a = before?.[key];
    const b = after?.[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out[key] = REDACT.test(key) ? { from: "[redacted]", to: "[redacted]" } : { from: a ?? null, to: b ?? null };
  }
  return Object.keys(out).length ? out : null;
}

export function writeAudit(db: DbLike, entry: AuditEntry): void {
  db.insert(auditLogs)
    .values({
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId == null ? null : String(entry.entityId),
      summary: entry.summary,
      diff: entry.diff ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    })
    .run();
}

export interface AuditFilters {
  actorUserId?: number;
  entityType?: string;
  entityId?: string;
  actionPrefix?: string;
  /** Inclusive `YYYY-MM-DD` (UTC). */
  from?: string;
  /** Inclusive `YYYY-MM-DD` (UTC). */
  to?: string;
  page?: number;
  pageSize?: number;
}

export function listAudit(db: DbLike, filters: AuditFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
  const conditions: SQL[] = [];
  if (filters.actorUserId) conditions.push(eq(auditLogs.actorUserId, filters.actorUserId));
  if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId));
  if (filters.actionPrefix) conditions.push(like(auditLogs.action, `${filters.actionPrefix}%`));
  if (filters.from) conditions.push(gte(auditLogs.at, filters.from));
  if (filters.to) conditions.push(lt(auditLogs.at, addDays(filters.to, 1)));
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = db
    .select({
      id: auditLogs.id,
      at: auditLogs.at,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      summary: auditLogs.summary,
      diff: auditLogs.diff,
      ip: auditLogs.ip,
      userAgent: auditLogs.userAgent,
      actorUserId: auditLogs.actorUserId,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const total = db.select({ n: count() }).from(auditLogs).where(where).get()?.n ?? 0;
  return { rows, total, page, pageSize };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/integration/audit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/audit tests/integration/audit.test.ts
git commit -m "feat(audit): add audit log writer, diff and query"
```

---

### Task 10: Notifications service

**Files:**
- Create: `src/server/modules/notifications/service.ts`
- Test: `tests/integration/notifications.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { listNotifications, markRead, notify, notifyMany, unreadCount } from "@/server/modules/notifications/service";
import { createTestDb } from "../helpers/db";

let db: DB;
let a: number;
let b: number;
beforeEach(() => {
  db = createTestDb();
  a = db.insert(users).values({ email: "a@pvcon.in", name: "A", passwordHash: "x" }).returning().get().id;
  b = db.insert(users).values({ email: "b@pvcon.in", name: "B", passwordHash: "x" }).returning().get().id;
});

describe("notifications", () => {
  it("creates, lists newest first and counts unread", () => {
    notify(db, { userId: a, type: "test", title: "First" });
    notify(db, { userId: a, type: "test", title: "Second", link: "/x" });
    notifyMany(db, [a, b], { type: "announce", title: "Hello" });
    expect(unreadCount(db, a)).toBe(3);
    expect(unreadCount(db, b)).toBe(1);
    expect(listNotifications(db, a).map((n) => n.title)).toEqual(["Hello", "Second", "First"]);
    expect(listNotifications(db, a, { limit: 1 })).toHaveLength(1);
  });

  it("marks only the owner's notifications as read", () => {
    notify(db, { userId: a, type: "t", title: "A1" });
    notify(db, { userId: b, type: "t", title: "B1" });
    const bId = listNotifications(db, b)[0].id;
    expect(markRead(db, a, [bId])).toBe(0);
    expect(unreadCount(db, b)).toBe(1);
    const aId = listNotifications(db, a)[0].id;
    expect(markRead(db, a, [aId])).toBe(1);
    expect(listNotifications(db, a, { unreadOnly: true })).toHaveLength(0);
  });

  it("marks all as read", () => {
    notify(db, { userId: a, type: "t", title: "1" });
    notify(db, { userId: a, type: "t", title: "2" });
    expect(markRead(db, a, "all")).toBe(2);
    expect(unreadCount(db, a)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/notifications.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/modules/notifications/service.ts`**

```ts
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { notifications } from "@/server/db/schema";

export interface NewNotification {
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

export function notify(db: DbLike, n: NewNotification): void {
  db.insert(notifications)
    .values({ userId: n.userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null })
    .run();
}

export function notifyMany(db: DbLike, userIds: number[], n: Omit<NewNotification, "userId">): void {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  db.insert(notifications)
    .values(unique.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null })))
    .run();
}

export function listNotifications(
  db: DbLike,
  userId: number,
  { limit = 20, unreadOnly = false }: { limit?: number; unreadOnly?: boolean } = {},
) {
  const where = unreadOnly
    ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
    : eq(notifications.userId, userId);
  return db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit)
    .all();
}

export function unreadCount(db: DbLike, userId: number): number {
  return (
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .get()?.n ?? 0
  );
}

/** Returns the number of notifications marked read. Never touches other users' rows. */
export function markRead(db: DbLike, userId: number, ids: number[] | "all", now: string = nowIso()): number {
  const base = and(eq(notifications.userId, userId), isNull(notifications.readAt));
  const where = ids === "all" ? base : and(base, inArray(notifications.id, ids.length ? ids : [-1]));
  return db.update(notifications).set({ readAt: now }).where(where).run().changes;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/integration/notifications.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/notifications tests/integration/notifications.test.ts
git commit -m "feat(notifications): add in-app notification service"
```

---

### Task 11: Users and authentication service

**Files:**
- Create: `src/server/modules/users/service.ts`, `tests/helpers/fixtures.ts`
- Test: `tests/integration/users.test.ts`

- [ ] **Step 1: Create `tests/helpers/fixtures.ts`**

```ts
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import { users, type UserRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createUser, getUserById, loadSessionUser } from "@/server/modules/users/service";

export const TEST_COST = 4;
export const TEST_PASSWORD = "Passw0rd!Good";
let seq = 0;

export function insertUser(
  db: DbLike,
  opts: {
    email?: string;
    name?: string;
    password?: string;
    roles?: Role[];
    status?: "active" | "disabled";
    mustChangePassword?: boolean;
  } = {},
): UserRow {
  const created = createUser(db, {
    email: opts.email ?? `user${++seq}@pvcon.in`,
    name: opts.name ?? "Test User",
    roles: opts.roles ?? ["employee"],
    passwordHash: bcrypt.hashSync(opts.password ?? TEST_PASSWORD, TEST_COST),
    mustChangePassword: opts.mustChangePassword ?? false,
  });
  if (opts.status === "disabled") {
    db.update(users).set({ status: "disabled" }).where(eq(users.id, created.id)).run();
  }
  return getUserById(db, created.id)!;
}

export function sessionUserFor(db: DbLike, user: UserRow): SessionUser {
  const loaded = loadSessionUser(db, user.id, getUserById(db, user.id)!.sessionVersion);
  if (!loaded) throw new Error(`User ${user.id} has no active session`);
  return loaded;
}

export function expectDomainError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`Expected DomainError ${code}, but nothing was thrown`);
}
```

- [ ] **Step 2: Write the failing tests** — `tests/integration/users.test.ts`

```ts
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { passwordProblems } from "@/lib/auth/password-policy";
import { permissionsForRoles } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  changePassword, createPasswordResetToken, createUser, generateTempPassword, getUserById, listUsers,
  loadSessionUser, resetPasswordWithToken, setTemporaryPassword, setUserRoles, setUserStatus, verifyCredentials,
} from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { TEST_COST, TEST_PASSWORD, expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const LOGIN = { lockoutAttempts: 3, lockoutMinutes: 15, cost: TEST_COST };
const POLICY = { minLength: 10 };
let db: DB;
beforeEach(() => {
  db = createTestDb();
});

describe("verifyCredentials", () => {
  it("accepts the right password case-insensitively on email and resets counters", async () => {
    const u = insertUser(db, { email: "a@pvcon.in" });
    db.update(users).set({ failedLoginCount: 2 }).where(eq(users.id, u.id)).run();
    const now = new Date("2026-09-24T10:00:00Z");
    const res = await verifyCredentials(db, "A@PVCON.IN", TEST_PASSWORD, { ...LOGIN, now });
    expect(res.ok).toBe(true);
    const after = getUserById(db, u.id)!;
    expect(after.failedLoginCount).toBe(0);
    expect(after.lastLoginAt).toBe(now.toISOString());
  });

  it("rejects unknown emails as invalid", async () => {
    const res = await verifyCredentials(db, "ghost@pvcon.in", TEST_PASSWORD, { ...LOGIN, now: new Date() });
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });

  it("locks after the configured failures and unlocks after the lock period", async () => {
    insertUser(db, { email: "b@pvcon.in" });
    const now = new Date("2026-09-24T10:00:00Z");
    await verifyCredentials(db, "b@pvcon.in", "wrong", { ...LOGIN, now });
    await verifyCredentials(db, "b@pvcon.in", "wrong", { ...LOGIN, now });
    const third = await verifyCredentials(db, "b@pvcon.in", "wrong", { ...LOGIN, now });
    expect(third).toMatchObject({ ok: false, reason: "locked" });
    const whileLocked = await verifyCredentials(db, "b@pvcon.in", TEST_PASSWORD, {
      ...LOGIN,
      now: new Date("2026-09-24T10:10:00Z"),
    });
    expect(whileLocked).toMatchObject({ ok: false, reason: "locked" });
    const afterLock = await verifyCredentials(db, "b@pvcon.in", TEST_PASSWORD, {
      ...LOGIN,
      now: new Date("2026-09-24T10:16:00Z"),
    });
    expect(afterLock.ok).toBe(true);
  });

  it("rejects disabled users", async () => {
    insertUser(db, { email: "d@pvcon.in", status: "disabled" });
    const res = await verifyCredentials(db, "d@pvcon.in", TEST_PASSWORD, { ...LOGIN, now: new Date() });
    expect(res).toMatchObject({ ok: false, reason: "disabled" });
  });

  it("rehashes passwords stored with a lower bcrypt cost", async () => {
    const u = insertUser(db, { email: "c@pvcon.in" });
    await verifyCredentials(db, "c@pvcon.in", TEST_PASSWORD, { ...LOGIN, cost: 5, now: new Date() });
    expect(bcrypt.getRounds(getUserById(db, u.id)!.passwordHash)).toBe(5);
  });
});

describe("sessions", () => {
  it("loads roles and permissions and rejects stale session versions", () => {
    const u = insertUser(db, { roles: ["employee", "manager"] });
    const session = loadSessionUser(db, u.id, u.sessionVersion)!;
    expect(session.roles).toEqual(["employee", "manager"]);
    expect(session.permissions).toContain("leave.approve");
    expect(loadSessionUser(db, u.id, u.sessionVersion + 1)).toBeNull();
    expect(loadSessionUser(db, 999, 1)).toBeNull();
  });
});

describe("passwords", () => {
  it("changes the password, clears the forced-change flag and bumps the session version", async () => {
    const u = insertUser(db, { mustChangePassword: true });
    const updated = await changePassword(db, u.id, TEST_PASSWORD, "NewPassw0rd!", POLICY, TEST_COST);
    expect(updated.mustChangePassword).toBe(false);
    expect(updated.sessionVersion).toBe(u.sessionVersion + 1);
    expect(bcrypt.compareSync("NewPassw0rd!", updated.passwordHash)).toBe(true);
  });

  it("rejects a wrong current password, weak passwords and unchanged passwords", async () => {
    const u = insertUser(db);
    await expect(changePassword(db, u.id, "nope", "NewPassw0rd!", POLICY, TEST_COST)).rejects.toMatchObject({
      code: "WRONG_PASSWORD",
    });
    await expect(changePassword(db, u.id, TEST_PASSWORD, "short", POLICY, TEST_COST)).rejects.toMatchObject({
      code: "WEAK_PASSWORD",
    });
    await expect(changePassword(db, u.id, TEST_PASSWORD, TEST_PASSWORD, POLICY, TEST_COST)).rejects.toMatchObject({
      code: "SAME_PASSWORD",
    });
  });

  it("generates policy-compliant temporary passwords", () => {
    for (let i = 0; i < 50; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(14);
      expect(passwordProblems(p, POLICY)).toEqual([]);
    }
  });

  it("sets a temporary password that forces a change and revokes sessions", () => {
    const u = insertUser(db);
    db.update(users).set({ failedLoginCount: 2, lockedUntil: "2999-01-01T00:00:00.000Z" }).where(eq(users.id, u.id)).run();
    const updated = setTemporaryPassword(db, u.id, "hash");
    expect(updated.mustChangePassword).toBe(true);
    expect(updated.sessionVersion).toBe(u.sessionVersion + 1);
    expect(updated.lockedUntil).toBeNull();
  });
});

describe("password reset tokens", () => {
  it("resets a password with a valid token exactly once", async () => {
    const u = insertUser(db, { email: "r@pvcon.in" });
    const created = createPasswordResetToken(db, "r@pvcon.in", new Date("2026-09-24T10:00:00Z"))!;
    expect(created.token.length).toBeGreaterThan(30);
    const updated = await resetPasswordWithToken(
      db, created.token, "Brand-New-Pass1", POLICY, new Date("2026-09-24T10:10:00Z"), TEST_COST,
    );
    expect(updated.sessionVersion).toBe(u.sessionVersion + 1);
    await expect(
      resetPasswordWithToken(db, created.token, "Another-Pass12", POLICY, new Date("2026-09-24T10:11:00Z"), TEST_COST),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rejects expired tokens and weak passwords", async () => {
    insertUser(db, { email: "e@pvcon.in" });
    const created = createPasswordResetToken(db, "e@pvcon.in", new Date("2026-09-24T10:00:00Z"))!;
    await expect(
      resetPasswordWithToken(db, created.token, "short", POLICY, new Date("2026-09-24T10:05:00Z"), TEST_COST),
    ).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await expect(
      resetPasswordWithToken(db, created.token, "Brand-New-Pass1", POLICY, new Date("2026-09-24T10:31:00Z"), TEST_COST),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("returns null for unknown or disabled users", () => {
    insertUser(db, { email: "x@pvcon.in", status: "disabled" });
    expect(createPasswordResetToken(db, "x@pvcon.in")).toBeNull();
    expect(createPasswordResetToken(db, "nobody@pvcon.in")).toBeNull();
  });
});

describe("user management", () => {
  it("rejects duplicate emails", () => {
    insertUser(db, { email: "dup@pvcon.in" });
    expectDomainError(
      () => createUser(db, { email: "DUP@pvcon.in", name: "Dup", roles: [], passwordHash: "x" }),
      "EMAIL_TAKEN",
    );
  });

  it("lets user.manage holders grant employee/manager only", () => {
    const hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
    const target = insertUser(db);
    expect(setUserRoles(db, hr, target.id, ["manager", "employee"]).after).toEqual(["employee", "manager"]);
    expectDomainError(() => setUserRoles(db, hr, target.id, ["employee", "payroll_admin"]), "FORBIDDEN_ROLE");
  });

  it("prevents self-demotion and removing the last super admin", () => {
    const root = insertUser(db, { roles: ["super_admin"] });
    const actor = sessionUserFor(db, root);
    expectDomainError(() => setUserRoles(db, actor, root.id, ["employee"]), "SELF_DEMOTE");

    const other = insertUser(db, { roles: ["super_admin"] });
    setUserRoles(db, actor, other.id, ["employee"]);
    expect(listUsers(db).find((u) => u.id === other.id)!.roles).toEqual(["employee"]);

    const phantom: SessionUser = {
      id: 999, email: "p@pvcon.in", name: "P", roles: ["super_admin"],
      permissions: permissionsForRoles(["super_admin"]), mustChangePassword: false,
    };
    expectDomainError(() => setUserRoles(db, phantom, root.id, ["employee"]), "LAST_SUPER_ADMIN");
  });

  it("disables users, revoking sessions, with guards", () => {
    const root = insertUser(db, { roles: ["super_admin"] });
    const actor = sessionUserFor(db, root);
    expectDomainError(() => setUserStatus(db, actor, root.id, "disabled"), "SELF_DISABLE");

    const target = insertUser(db);
    const disabled = setUserStatus(db, actor, target.id, "disabled");
    expect(disabled.status).toBe("disabled");
    expect(loadSessionUser(db, target.id, target.sessionVersion)).toBeNull();

    const hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
    expectDomainError(() => setUserStatus(db, hr, root.id, "disabled"), "FORBIDDEN_ROLE");
  });

  it("lists users with roles and without password hashes", () => {
    insertUser(db, { email: "l@pvcon.in", roles: ["employee", "manager"] });
    const row = listUsers(db).find((u) => u.email === "l@pvcon.in")!;
    expect(row.roles).toEqual(["employee", "manager"]);
    expect("passwordHash" in row).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/integration/users.test.ts`
Expected: FAIL — module `@/server/modules/users/service` not found.

- [ ] **Step 4: Implement `src/server/modules/users/service.ts`**

```ts
import bcrypt from "bcryptjs";
import { and, asc, eq, isNull } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { passwordProblems, type PasswordPolicy } from "@/lib/auth/password-policy";
import { can, isPrivilegedRole, permissionsForRoles, type Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import { passwordResetTokens, userRoles, users, type UserRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { randomToken, sha256Hex } from "@/server/lib/crypto";

export const BCRYPT_COST = 12;

export function hashPassword(password: string, cost = BCRYPT_COST): Promise<string> {
  return bcrypt.hash(password, cost);
}

let dummyHash: string | undefined;
function getDummyHash(): string {
  return (dummyHash ??= bcrypt.hashSync("timing-equalizer-not-a-password", 10));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findUserByEmail(db: DbLike, email: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.email, normalizeEmail(email))).get();
}

export function getUserById(db: DbLike, id: number): UserRow | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function getUserRoles(db: DbLike, userId: number): Role[] {
  return db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .orderBy(asc(userRoles.role))
    .all()
    .map((r) => r.role);
}

/** Resolves the session user, or null when the user is gone, disabled, or the session was revoked. */
export function loadSessionUser(db: DbLike, userId: number, sessionVersion: number | undefined): SessionUser | null {
  const user = getUserById(db, userId);
  if (!user || user.status !== "active" || user.sessionVersion !== sessionVersion) return null;
  const roles = getUserRoles(db, userId);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles,
    permissions: permissionsForRoles(roles),
    mustChangePassword: user.mustChangePassword,
  };
}

export type LoginResult =
  | { ok: true; user: UserRow }
  | { ok: false; reason: "invalid" | "locked" | "disabled"; userId?: number };

export interface LoginOptions {
  now: Date;
  lockoutAttempts: number;
  lockoutMinutes: number;
  cost?: number;
}

export async function verifyCredentials(
  db: DbLike,
  email: string,
  password: string,
  opts: LoginOptions,
): Promise<LoginResult> {
  const user = findUserByEmail(db, email);
  if (!user) {
    await bcrypt.compare(password, getDummyHash());
    return { ok: false, reason: "invalid" };
  }
  if (user.status !== "active") return { ok: false, reason: "disabled", userId: user.id };
  const nowIso = opts.now.toISOString();
  if (user.lockedUntil && user.lockedUntil > nowIso) return { ok: false, reason: "locked", userId: user.id };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= opts.lockoutAttempts;
    db.update(users)
      .set({
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(opts.now.getTime() + opts.lockoutMinutes * 60_000).toISOString() : user.lockedUntil,
      })
      .where(eq(users.id, user.id))
      .run();
    return { ok: false, reason: lock ? "locked" : "invalid", userId: user.id };
  }

  const cost = opts.cost ?? BCRYPT_COST;
  const patch: Partial<typeof users.$inferInsert> = { failedLoginCount: 0, lockedUntil: null, lastLoginAt: nowIso };
  if (bcrypt.getRounds(user.passwordHash) < cost) patch.passwordHash = await bcrypt.hash(password, cost);
  const updated = db.update(users).set(patch).where(eq(users.id, user.id)).returning().get()!;
  return { ok: true, user: updated };
}

export interface CreateUserInput {
  email: string;
  name: string;
  roles: Role[];
  passwordHash: string;
  mustChangePassword?: boolean;
}

export function createUser(db: DbLike, input: CreateUserInput): UserRow {
  const email = normalizeEmail(input.email);
  if (findUserByEmail(db, email)) {
    throw new DomainError("EMAIL_TAKEN", "A user with this email already exists.", { email: ["Already in use"] });
  }
  const user = db
    .insert(users)
    .values({
      email,
      name: input.name.trim(),
      passwordHash: input.passwordHash,
      mustChangePassword: input.mustChangePassword ?? true,
    })
    .returning()
    .get();
  const roles = [...new Set(input.roles)];
  if (roles.length) db.insert(userRoles).values(roles.map((role) => ({ userId: user.id, role }))).run();
  return user;
}

export function assertCanGrantRoles(actor: Pick<SessionUser, "permissions">, roles: readonly Role[]): void {
  if (roles.some(isPrivilegedRole) && !can(actor, "role.assign")) {
    throw new DomainError("FORBIDDEN_ROLE", "Only a super admin can grant or revoke HR, payroll or super admin roles.");
  }
}

function otherActiveSuperAdmins(db: DbLike, excludingUserId: number): number {
  return db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.role, "super_admin"), eq(users.status, "active")))
    .all()
    .filter((r) => r.id !== excludingUserId).length;
}

export function setUserRoles(
  db: DbLike,
  actor: SessionUser,
  userId: number,
  roles: Role[],
): { before: Role[]; after: Role[] } {
  const target = getUserById(db, userId);
  if (!target) throw new DomainError("NOT_FOUND", "User not found.");
  const before = getUserRoles(db, userId);
  const after = [...new Set(roles)].sort() as Role[];
  const added = after.filter((r) => !before.includes(r));
  const removed = before.filter((r) => !after.includes(r));
  assertCanGrantRoles(actor, [...added, ...removed]);
  if (removed.includes("super_admin")) {
    if (userId === actor.id) throw new DomainError("SELF_DEMOTE", "You cannot remove your own super admin role.");
    if (target.status === "active" && otherActiveSuperAdmins(db, userId) === 0) {
      throw new DomainError("LAST_SUPER_ADMIN", "At least one active super admin must remain.");
    }
  }
  db.delete(userRoles).where(eq(userRoles.userId, userId)).run();
  if (after.length) db.insert(userRoles).values(after.map((role) => ({ userId, role }))).run();
  return { before, after };
}

export function setUserStatus(
  db: DbLike,
  actor: SessionUser,
  userId: number,
  status: "active" | "disabled",
): UserRow {
  const target = getUserById(db, userId);
  if (!target) throw new DomainError("NOT_FOUND", "User not found.");
  const roles = getUserRoles(db, userId);
  assertCanGrantRoles(actor, roles);
  if (status === "disabled") {
    if (userId === actor.id) throw new DomainError("SELF_DISABLE", "You cannot disable your own account.");
    if (roles.includes("super_admin") && otherActiveSuperAdmins(db, userId) === 0) {
      throw new DomainError("LAST_SUPER_ADMIN", "At least one active super admin must remain.");
    }
  }
  return db
    .update(users)
    .set({
      status,
      sessionVersion: status === "disabled" ? target.sessionVersion + 1 : target.sessionVersion,
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, userId))
    .returning()
    .get()!;
}

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";

/** Random, unambiguous temporary password containing upper, lower and digit characters. */
export function generateTempPassword(length = 14): string {
  const all = UPPER + LOWER + DIGITS;
  const pick = (chars: string) => chars[randomInt(chars.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Admin reset: stores a (pre-hashed) temporary password, forces a change, unlocks and revokes sessions. */
export function setTemporaryPassword(db: DbLike, userId: number, passwordHash: string): UserRow {
  const target = getUserById(db, userId);
  if (!target) throw new DomainError("NOT_FOUND", "User not found.");
  return db
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: true,
      sessionVersion: target.sessionVersion + 1,
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, userId))
    .returning()
    .get()!;
}

function assertStrongPassword(password: string, policy: PasswordPolicy): void {
  const problems = passwordProblems(password, policy);
  if (problems.length) {
    throw new DomainError("WEAK_PASSWORD", `Password needs: ${problems.join(", ")}.`, { password: problems });
  }
}

export async function changePassword(
  db: DbLike,
  userId: number,
  currentPassword: string,
  newPassword: string,
  policy: PasswordPolicy,
  cost = BCRYPT_COST,
): Promise<UserRow> {
  const user = getUserById(db, userId);
  if (!user) throw new DomainError("NOT_FOUND", "User not found.");
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new DomainError("WRONG_PASSWORD", "Current password is incorrect.", { currentPassword: ["Incorrect"] });
  }
  assertStrongPassword(newPassword, policy);
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw new DomainError("SAME_PASSWORD", "Choose a password different from the current one.");
  }
  const passwordHash = await bcrypt.hash(newPassword, cost);
  return db
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: false,
      sessionVersion: user.sessionVersion + 1,
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, userId))
    .returning()
    .get()!;
}

export function createPasswordResetToken(
  db: DbLike,
  email: string,
  now: Date = new Date(),
  ttlMinutes = 30,
): { user: UserRow; token: string } | null {
  const user = findUserByEmail(db, email);
  if (!user || user.status !== "active") return null;
  const token = randomToken(32);
  db.insert(passwordResetTokens)
    .values({
      userId: user.id,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
    })
    .run();
  return { user, token };
}

export async function resetPasswordWithToken(
  db: DbLike,
  token: string,
  newPassword: string,
  policy: PasswordPolicy,
  now: Date = new Date(),
  cost = BCRYPT_COST,
): Promise<UserRow> {
  const invalid = new DomainError("INVALID_TOKEN", "This reset link is invalid or has expired.");
  const nowIso = now.toISOString();
  const row = db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, sha256Hex(token)))
    .get();
  if (!row || row.usedAt || row.expiresAt <= nowIso) throw invalid;
  const user = getUserById(db, row.userId);
  if (!user || user.status !== "active") throw invalid;
  assertStrongPassword(newPassword, policy);
  const passwordHash = await bcrypt.hash(newPassword, cost);
  return db.transaction((tx) => {
    tx.update(passwordResetTokens)
      .set({ usedAt: nowIso })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)))
      .run();
    return tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        sessionVersion: user.sessionVersion + 1,
        failedLoginCount: 0,
        lockedUntil: null,
      })
      .where(eq(users.id, user.id))
      .returning()
      .get()!;
  });
}

export type UserListItem = Omit<UserRow, "passwordHash"> & { roles: Role[] };

export function listUsers(db: DbLike): UserListItem[] {
  const rows = db.select().from(users).orderBy(asc(users.name)).all();
  const roleRows = db.select().from(userRoles).all();
  return rows.map((row) => {
    const { passwordHash, ...rest } = row;
    void passwordHash;
    return {
      ...rest,
      roles: roleRows
        .filter((r) => r.userId === rest.id)
        .map((r) => r.role)
        .sort(),
    };
  });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/integration/users.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/users tests/helpers/fixtures.ts tests/integration/users.test.ts
git commit -m "feat(users): add credentials, lockout, password and role management"
```

---

### Task 12: Action executor

**Files:**
- Create: `src/server/actions/execute.ts`
- Test: `tests/integration/execute-action.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { executeAction } from "@/server/actions/execute";
import type { DB } from "@/server/db/client";
import { auditLogs, notifications } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { notify } from "@/server/modules/notifications/service";
import { createTestDb } from "../helpers/db";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const schema = z.object({ name: z.string().min(2) });
let db: DB;
let employee: SessionUser;
let admin: SessionUser;
beforeEach(() => {
  db = createTestDb();
  employee = sessionUserFor(db, insertUser(db, { roles: ["employee"] }));
  admin = sessionUserFor(db, insertUser(db, { roles: ["super_admin"] }));
});

describe("executeAction", () => {
  it("requires a user", async () => {
    const res = await executeAction(db, null, { name: "t", schema, handler: () => 1 }, { name: "ok" });
    expect(res).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("returns field errors for invalid input", async () => {
    const res = await executeAction(db, admin, { name: "t", schema, handler: () => 1 }, { name: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.fieldErrors?.name?.length).toBeGreaterThan(0);
    }
  });

  it("enforces string and function permissions", async () => {
    const denied = await executeAction(
      db, employee, { name: "t", schema, permission: "settings.manage", handler: () => 1 }, { name: "ok" },
    );
    expect(denied).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const byInput = await executeAction(
      db, employee,
      { name: "t", schema, permission: (u, input) => input.name === "self" || can(u, "settings.manage"), handler: () => 1 },
      { name: "self" },
    );
    expect(byInput).toEqual({ ok: true, data: 1 });
  });

  it("runs the handler in a transaction and audits with request metadata", async () => {
    const res = await executeAction(
      db, admin,
      {
        name: "test.run",
        schema,
        permission: "settings.manage",
        handler: ({ tx, user, audit }, input) => {
          notify(tx, { userId: user.id, type: "t", title: input.name });
          audit({ action: "test.run", entityType: "test", entityId: 1, summary: `Ran ${input.name}` });
          return { greeting: `hi ${input.name}` };
        },
      },
      { name: "there" },
      { ip: "1.2.3.4", userAgent: "vitest" },
    );
    expect(res).toEqual({ ok: true, data: { greeting: "hi there" } });
    const log = db.select().from(auditLogs).all();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorUserId: admin.id, ip: "1.2.3.4", userAgent: "vitest", entityId: "1" });
  });

  it("rolls back and maps DomainError", async () => {
    const res = await executeAction(
      db, admin,
      {
        name: "t",
        schema,
        handler: ({ tx, user, audit }) => {
          notify(tx, { userId: user.id, type: "t", title: "should roll back" });
          audit({ action: "t", entityType: "t", summary: "rolled back" });
          throw new DomainError("NOPE", "Not allowed right now.");
        },
      },
      { name: "ok" },
    );
    expect(res).toMatchObject({ ok: false, code: "NOPE", error: "Not allowed right now." });
    expect(db.select().from(notifications).all()).toHaveLength(0);
    expect(db.select().from(auditLogs).all()).toHaveLength(0);
  });

  it("maps unexpected errors and async handlers to INTERNAL", async () => {
    const boom = await executeAction(db, admin, { name: "t", schema, handler: () => { throw new Error("boom"); } }, { name: "ok" });
    expect(boom).toMatchObject({ ok: false, code: "INTERNAL" });
    const asyncHandler = await executeAction(
      db, admin,
      { name: "t", schema, handler: (async () => 1) as unknown as () => number },
      { name: "ok" },
    );
    expect(asyncHandler).toMatchObject({ ok: false, code: "INTERNAL" });
  });

  it("passes the result of async prepare to the handler and maps prepare DomainErrors", async () => {
    const res = await executeAction(
      db, admin,
      { name: "t", schema, prepare: async (input) => input.name.toUpperCase(), handler: (_ctx, _input, prepared) => prepared },
      { name: "ok" },
    );
    expect(res).toEqual({ ok: true, data: "OK" });
    const failed = await executeAction(
      db, admin,
      { name: "t", schema, prepare: async () => { throw new DomainError("PREP", "Bad"); }, handler: () => 1 },
      { name: "ok" },
    );
    expect(failed).toMatchObject({ ok: false, code: "PREP" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/execute-action.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/actions/execute.ts`**

```ts
import { z } from "zod";
import { can, type Permission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DB, DbLike } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { logger } from "@/server/lib/logger";
import { writeAudit, type AuditEntry } from "@/server/modules/audit/service";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]> };

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface ActionContext {
  tx: DbLike;
  user: SessionUser;
  audit: (entry: Omit<AuditEntry, "actorUserId" | "ip" | "userAgent">) => void;
}

export interface ActionDef<S extends z.ZodType, P, T> {
  /** Used in logs, e.g. `settings.company.update`. */
  name: string;
  schema: S;
  /** A permission, or a predicate for scope checks that need the parsed input. */
  permission?: Permission | ((user: SessionUser, input: z.output<S>) => boolean);
  /** Async work that must happen outside the transaction (hashing, reading uploads). */
  prepare?: (input: z.output<S>, user: SessionUser) => Promise<P>;
  /** Synchronous; runs inside a SQLite transaction. Must not return a promise. */
  handler: (ctx: ActionContext, input: z.output<S>, prepared: P) => T;
}

function fail(code: string, error: string): ActionResult<never> {
  return { ok: false, code, error };
}

export async function executeAction<S extends z.ZodType, P, T>(
  db: DB,
  user: SessionUser | null,
  def: ActionDef<S, P, T>,
  raw: unknown,
  meta: RequestMeta = {},
): Promise<ActionResult<T>> {
  if (!user) return fail("UNAUTHENTICATED", "Your session has expired. Please sign in again.");

  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      error: "Please correct the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;

  if (def.permission) {
    const allowed =
      typeof def.permission === "function" ? def.permission(user, input) : can(user, def.permission);
    if (!allowed) return fail("FORBIDDEN", "You don't have permission to do this.");
  }

  try {
    const prepared = def.prepare ? await def.prepare(input, user) : (undefined as P);
    const data = db.transaction((tx) =>
      def.handler(
        {
          tx,
          user,
          audit: (entry) =>
            writeAudit(tx, { ...entry, actorUserId: user.id, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }),
        },
        input,
        prepared,
      ),
    );
    return { ok: true, data };
  } catch (err) {
    if (err instanceof DomainError) {
      return { ok: false, code: err.code, error: err.message, fieldErrors: err.fieldErrors };
    }
    logger.error({ err, action: def.name, userId: user.id }, "action failed");
    return fail("INTERNAL", "Something went wrong. Please try again.");
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/integration/execute-action.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions tests/integration/execute-action.test.ts
git commit -m "feat(actions): add transactional action executor with audit"
```

---

### Task 13: Jobs runner, registry and system cleanup job

**Files:**
- Create: `src/server/jobs/runner.ts`, `src/server/jobs/system-cleanup.ts`, `src/server/jobs/registry.ts`
- Test: `tests/integration/jobs.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { jobRuns, notifications, passwordResetTokens, users } from "@/server/db/schema";
import { JOBS, findJob, runJobByName } from "@/server/jobs/registry";
import { runJob } from "@/server/jobs/runner";
import { createTestDb } from "../helpers/db";

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

describe("runJob", () => {
  it("runs once per key and skips repeats", () => {
    let calls = 0;
    const first = runJob(db, "demo", "2026-09-24", () => {
      calls++;
      return "done";
    });
    expect(first).toEqual({ status: "succeeded", detail: "done" });
    const second = runJob(db, "demo", "2026-09-24", () => {
      calls++;
    });
    expect(second.status).toBe("skipped");
    expect(calls).toBe(1);
  });

  it("records failures and retries them on the next run", () => {
    const failed = runJob(db, "demo", "k", () => {
      throw new Error("nope");
    });
    expect(failed).toEqual({ status: "failed", detail: "nope" });
    expect(runJob(db, "demo", "k", () => "fixed")).toEqual({ status: "succeeded", detail: "fixed" });
    expect(db.select().from(jobRuns).all()).toHaveLength(1);
  });

  it("reclaims runs stuck in running for over an hour", () => {
    db.insert(jobRuns).values({ job: "demo", runKey: "k", status: "running", startedAt: "2026-09-24T08:00:00.000Z" }).run();
    const now = new Date("2026-09-24T08:30:00.000Z");
    expect(runJob(db, "demo", "k", () => "x", now).status).toBe("skipped");
    const later = new Date("2026-09-24T09:30:00.000Z");
    expect(runJob(db, "demo", "k", () => "x", later).status).toBe("succeeded");
  });
});

describe("registry", () => {
  it("registers the system cleanup job", () => {
    expect(JOBS.map((j) => j.name)).toContain("system:cleanup");
    expect(findJob("missing")).toBeUndefined();
    expect(runJobByName(db, "missing")).toEqual({ status: "failed", detail: "Unknown job: missing" });
  });

  it("cleanup deletes used/expired tokens and old read notifications only", () => {
    const userId = db.insert(users).values({ email: "a@pvcon.in", name: "A", passwordHash: "x" }).returning().get().id;
    const now = new Date("2026-09-24T12:00:00.000Z");
    db.insert(passwordResetTokens).values([
      { userId, tokenHash: "used", expiresAt: "2026-09-25T00:00:00.000Z", usedAt: "2026-09-24T01:00:00.000Z" },
      { userId, tokenHash: "expired", expiresAt: "2026-09-24T11:00:00.000Z" },
      { userId, tokenHash: "valid", expiresAt: "2026-09-24T12:30:00.000Z" },
    ]).run();
    db.insert(notifications).values([
      { userId, type: "t", title: "old read", readAt: "2026-05-01T00:00:00.000Z", createdAt: "2026-05-01T00:00:00.000Z" },
      { userId, type: "t", title: "old unread", createdAt: "2026-05-01T00:00:00.000Z" },
      { userId, type: "t", title: "recent read", readAt: "2026-09-20T00:00:00.000Z", createdAt: "2026-09-20T00:00:00.000Z" },
    ]).run();

    const outcome = runJobByName(db, "system:cleanup", now);
    expect(outcome).toEqual({ status: "succeeded", detail: "Deleted 2 reset tokens and 1 old notifications" });
    expect(db.select().from(passwordResetTokens).all().map((t) => t.tokenHash)).toEqual(["valid"]);
    expect(db.select().from(notifications).all().map((n) => n.title).sort()).toEqual(["old unread", "recent read"]);
    const run = db.select().from(jobRuns).where(eq(jobRuns.job, "system:cleanup")).get()!;
    expect(run.runKey).toBe("2026-09-24");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/jobs.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/server/jobs/runner.ts`**

```ts
import { and, eq } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { jobRuns } from "@/server/db/schema";
import { logger } from "@/server/lib/logger";

export type JobOutcome = { status: "succeeded" | "skipped" | "failed"; detail: string };

const STALE_MS = 60 * 60 * 1000;

/**
 * Runs `fn` at most once successfully per (job, runKey). Failed runs are retried on the next call;
 * runs stuck in `running` for over an hour are reclaimed.
 */
export function runJob(
  db: DbLike,
  job: string,
  runKey: string,
  fn: (tx: DbLike) => string | void,
  now: Date = new Date(),
): JobOutcome {
  const existing = db
    .select()
    .from(jobRuns)
    .where(and(eq(jobRuns.job, job), eq(jobRuns.runKey, runKey)))
    .get();
  if (existing?.status === "succeeded") {
    return { status: "skipped", detail: `Already ran at ${existing.finishedAt}` };
  }
  if (existing?.status === "running" && now.getTime() - Date.parse(existing.startedAt) < STALE_MS) {
    return { status: "skipped", detail: "Already running" };
  }

  const startedAt = now.toISOString();
  let id: number;
  if (existing) {
    db.update(jobRuns)
      .set({ status: "running", startedAt, finishedAt: null, detail: null })
      .where(eq(jobRuns.id, existing.id))
      .run();
    id = existing.id;
  } else {
    id = db
      .insert(jobRuns)
      .values({ job, runKey, status: "running", startedAt })
      .returning({ id: jobRuns.id })
      .get().id;
  }

  try {
    const detail = db.transaction((tx) => fn(tx)) || "ok";
    db.update(jobRuns)
      .set({ status: "succeeded", finishedAt: new Date().toISOString(), detail })
      .where(eq(jobRuns.id, id))
      .run();
    return { status: "succeeded", detail };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    db.update(jobRuns)
      .set({ status: "failed", finishedAt: new Date().toISOString(), detail })
      .where(eq(jobRuns.id, id))
      .run();
    logger.error({ err, job, runKey }, "job failed");
    return { status: "failed", detail };
  }
}
```

- [ ] **Step 4: Implement `src/server/jobs/system-cleanup.ts`**

```ts
import { and, isNotNull, lt, or } from "drizzle-orm";
import { dateInTimeZone } from "@/lib/dates";
import { notifications, passwordResetTokens } from "@/server/db/schema";
import type { JobDefinition } from "./registry";

export const systemCleanupJob: JobDefinition = {
  name: "system:cleanup",
  description: "Deletes used or expired password-reset tokens and read notifications older than 90 days.",
  runKey: (now, timeZone) => dateInTimeZone(now, timeZone),
  run: (db, now) => {
    const nowIso = now.toISOString();
    const tokens = db
      .delete(passwordResetTokens)
      .where(or(isNotNull(passwordResetTokens.usedAt), lt(passwordResetTokens.expiresAt, nowIso)))
      .run().changes;
    const cutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString();
    const old = db
      .delete(notifications)
      .where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, cutoff)))
      .run().changes;
    return `Deleted ${tokens} reset tokens and ${old} old notifications`;
  },
};
```

- [ ] **Step 5: Implement `src/server/jobs/registry.ts`**

```ts
import type { DbLike } from "@/server/db/client";
import { getSetting } from "@/server/modules/settings/service";
import { runJob, type JobOutcome } from "./runner";
import { systemCleanupJob } from "./system-cleanup";

export interface JobDefinition {
  /** URL-safe name, e.g. `system:cleanup`; also the cron path segment. */
  name: string;
  description: string;
  /** Idempotency key for a given moment, e.g. the local date or `YYYY-MM`. */
  runKey: (now: Date, timeZone: string) => string;
  /** Synchronous; runs inside a transaction. Returns a human-readable summary. */
  run: (db: DbLike, now: Date, timeZone: string) => string;
}

/** Every scheduled job. Later phases append their jobs here. */
export const JOBS: JobDefinition[] = [systemCleanupJob];

export function findJob(name: string): JobDefinition | undefined {
  return JOBS.find((j) => j.name === name);
}

export function runJobByName(db: DbLike, name: string, now: Date = new Date()): JobOutcome {
  const job = findJob(name);
  if (!job) return { status: "failed", detail: `Unknown job: ${name}` };
  const timeZone = getSetting(db, "locale").timezone;
  return runJob(db, job.name, job.runKey(now, timeZone), (tx) => job.run(tx, now, timeZone), now);
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/integration/jobs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/server/jobs tests/integration/jobs.test.ts
git commit -m "feat(jobs): add idempotent job runner, registry and cleanup job"
```

---

### Task 14: File storage and access rules

**Files:**
- Create: `src/server/modules/files/service.ts`, `src/server/modules/files/access.ts`
- Test: `tests/integration/files.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { canAccessFile } from "@/server/modules/files/access";
import { resolveStoredPath, sanitizeFileName, saveUpload, sniffKind } from "@/server/modules/files/service";
import { patchSetting } from "@/server/modules/settings/service";
import { sha256Hex } from "@/server/lib/crypto";
import { createTestDb } from "../helpers/db";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const PDF = Buffer.from("%PDF-1.7\n%test\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
let db: DB;
let dir: string;
beforeEach(() => {
  db = createTestDb();
  dir = mkdtempSync(path.join(tmpdir(), "pvcon-uploads-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("files", () => {
  it("sniffs types from magic bytes", () => {
    expect(sniffKind(PDF, "a.pdf")).toBe("pdf");
    expect(sniffKind(PNG, "a.png")).toBe("png");
    expect(sniffKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "a.jpg")).toBe("jpeg");
    expect(sniffKind(Buffer.from("RIFF0000WEBPVP8 "), "a.webp")).toBe("webp");
    expect(sniffKind(Buffer.from("a,b\n1,2\n"), "data.csv")).toBe("csv");
    expect(sniffKind(Buffer.from("MZ\x90\x00"), "evil.pdf")).toBeNull();
  });

  it("stores allowed uploads with a hash and random storage name", () => {
    const user = insertUser(db);
    const row = saveUpload(db, { data: PDF, originalName: "../../Offer Letter.pdf", allowed: ["pdf"], uploadedBy: user.id, uploadDir: dir });
    expect(row.mime).toBe("application/pdf");
    expect(row.originalName).toBe("Offer Letter.pdf");
    expect(row.sha256).toBe(sha256Hex(PDF));
    expect(row.storageName).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    expect(readFileSync(resolveStoredPath(dir, row.storageName)).equals(PDF)).toBe(true);
  });

  it("rejects empty, oversized and disallowed files", () => {
    expectDomainError(() => saveUpload(db, { data: Buffer.alloc(0), originalName: "a.pdf", allowed: ["pdf"], uploadedBy: null, uploadDir: dir }), "EMPTY_FILE");
    expectDomainError(() => saveUpload(db, { data: PDF, originalName: "a.pdf", allowed: ["pdf"], uploadedBy: null, uploadDir: dir, maxBytes: 4 }), "FILE_TOO_LARGE");
    expectDomainError(() => saveUpload(db, { data: PNG, originalName: "a.png", allowed: ["pdf"], uploadedBy: null, uploadDir: dir }), "FILE_TYPE");
  });

  it("sanitizes names and blocks path traversal", () => {
    expect(sanitizeFileName("C:\\fakepath\\my<file>.pdf")).toBe("my_file_.pdf");
    expectDomainError(() => resolveStoredPath(dir, "../../etc/passwd"), "BAD_PATH");
  });

  it("allows the uploader, super admins and everyone for the company logo", () => {
    const owner = insertUser(db);
    const other = sessionUserFor(db, insertUser(db));
    const admin = sessionUserFor(db, insertUser(db, { roles: ["super_admin"] }));
    const file = saveUpload(db, { data: PNG, originalName: "logo.png", allowed: ["png"], uploadedBy: owner.id, uploadDir: dir });
    expect(canAccessFile(db, sessionUserFor(db, owner), file)).toBe(true);
    expect(canAccessFile(db, other, file)).toBe(false);
    expect(canAccessFile(db, admin, file)).toBe(true);
    patchSetting(db, "company", { logoFileId: file.id }, null);
    expect(canAccessFile(db, other, file)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/files.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/server/modules/files/service.ts`**

```ts
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DbLike } from "@/server/db/client";
import { files, type FileRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { sha256Hex } from "@/server/lib/crypto";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export type FileKind = "pdf" | "png" | "jpeg" | "webp" | "csv";

export const MIME_BY_KIND: Record<FileKind, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
};

/** Detects the real type from magic bytes; CSV is accepted only by extension and absence of NUL bytes. */
export function sniffKind(data: Buffer, originalName: string): FileKind | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  if (/\.csv$/i.test(originalName) && !data.includes(0)) return "csv";
  return null;
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "file";
}

export function resolveStoredPath(uploadDir: string, storageName: string): string {
  const root = path.resolve(uploadDir);
  const full = path.resolve(root, storageName);
  if (!full.startsWith(root + path.sep)) throw new DomainError("BAD_PATH", "Invalid file path.");
  return full;
}

export interface SaveUploadInput {
  data: Buffer;
  originalName: string;
  allowed: FileKind[];
  uploadedBy: number | null;
  uploadDir: string;
  maxBytes?: number;
  now?: Date;
}

export function saveUpload(db: DbLike, input: SaveUploadInput): FileRow {
  const maxBytes = input.maxBytes ?? MAX_UPLOAD_BYTES;
  if (input.data.length === 0) throw new DomainError("EMPTY_FILE", "The file is empty.");
  if (input.data.length > maxBytes) {
    throw new DomainError("FILE_TOO_LARGE", `Files must be ${Math.floor(maxBytes / 1024 / 1024) || 1} MB or smaller.`);
  }
  const kind = sniffKind(input.data, input.originalName);
  if (!kind || !input.allowed.includes(kind)) {
    throw new DomainError("FILE_TYPE", `Allowed file types: ${input.allowed.join(", ")}.`);
  }
  const now = input.now ?? new Date();
  const storageName = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  const fullPath = resolveStoredPath(input.uploadDir, storageName);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, input.data, { flag: "wx" });
  return db
    .insert(files)
    .values({
      storageName,
      originalName: sanitizeFileName(input.originalName),
      mime: MIME_BY_KIND[kind],
      size: input.data.length,
      sha256: sha256Hex(input.data),
      uploadedBy: input.uploadedBy,
    })
    .returning()
    .get();
}

export function getFile(db: DbLike, id: number): FileRow | undefined {
  return db.select().from(files).where(eq(files.id, id)).get();
}
```

- [ ] **Step 4: Implement `src/server/modules/files/access.ts`**

```ts
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import type { FileRow } from "@/server/db/schema";
import { getSetting } from "@/server/modules/settings/service";

export type FileAccessResolver = (db: DbLike, user: SessionUser, file: FileRow) => boolean;

/**
 * A file is readable when any resolver allows it.
 * Later phases append resolvers here (employee documents, payslips, receipts, …).
 */
const RESOLVERS: FileAccessResolver[] = [
  (_db, user, file) => file.uploadedBy === user.id,
  (_db, user) => user.roles.includes("super_admin"),
  (db, _user, file) => getSetting(db, "company").logoFileId === file.id,
];

export function canAccessFile(db: DbLike, user: SessionUser, file: FileRow): boolean {
  return RESOLVERS.some((resolve) => resolve(db, user, file));
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/integration/files.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/files tests/integration/files.test.ts
git commit -m "feat(files): add sniffed upload storage and access resolvers"
```

---

### Task 15: Email sending and templates

**Files:**
- Create: `src/server/lib/email.ts`
- Test: `tests/unit/server/email.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { isEmailConfigured, renderEmail, sendEmail } from "@/server/lib/email";

const saved = { host: process.env.SMTP_HOST, from: process.env.SMTP_FROM };
afterEach(() => {
  process.env.SMTP_HOST = saved.host;
  process.env.SMTP_FROM = saved.from;
});

describe("email", () => {
  it("skips sending when SMTP is not configured", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    expect(isEmailConfigured()).toBe(false);
    await expect(sendEmail({ to: "a@pvcon.in", subject: "Hi", text: "t", html: "<p>t</p>" })).resolves.toEqual({ sent: false });
  });

  it("renders escaped HTML and a plain-text alternative", () => {
    const { html, text } = renderEmail({
      heading: "Reset <your> password",
      paragraphs: ["Click the button & continue."],
      action: { label: "Reset password", url: "https://people.pvcon.in/reset-password/abc" },
    });
    expect(html).toContain("Reset &lt;your&gt; password");
    expect(html).toContain("Click the button &amp; continue.");
    expect(html).toContain('href="https://people.pvcon.in/reset-password/abc"');
    expect(text).toContain("Reset <your> password");
    expect(text).toContain("Reset password: https://people.pvcon.in/reset-password/abc");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/server/email.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/lib/email.ts`**

```ts
import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/** Sends via SMTP; when SMTP is not configured it logs and returns `{ sent: false }`. */
export async function sendEmail(message: EmailMessage): Promise<{ sent: boolean }> {
  if (!isEmailConfigured()) {
    logger.info({ to: message.to, subject: message.subject }, "SMTP not configured; email skipped");
    return { sent: false };
  }
  await getTransporter().sendMail({ from: process.env.SMTP_FROM, ...message });
  return { sent: true };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailContent {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
}

/** Brand-styled transactional email (navy #202f63) with a plain-text alternative. */
export function renderEmail({ heading, paragraphs, action }: EmailContent): { html: string; text: string } {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;color:#374151">${escapeHtml(p)}</p>`)
    .join("");
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#202f63;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<p style="margin:0 0 24px;font-weight:700;color:#202f63;font-size:18px">PVCON People</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#111827">${escapeHtml(heading)}</h1>
${body}${button}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">This is an automated message from PVCON People.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [heading, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : [])].join("\n");
  return { html, text };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/server/email.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/email.ts tests/unit/server/email.test.ts
git commit -m "feat(email): add optional SMTP sender and branded template"
```

---

### Task 16: Seed script, env example, full verification

**Files:**
- Create: `scripts/seed.ts`
- Modify: `.env.example`
- Modify: `docs/superpowers/plans/2026-09-24-hrms-roadmap.md` (progress tracker)

- [ ] **Step 1: Create `scripts/seed.ts`**

```ts
import "./_env";
import { openDatabase } from "../src/server/db/client";
import { createUser, findUserByEmail, hashPassword } from "../src/server/modules/users/service";

const file = process.env.DB_FILE ?? "./data/people.db";
const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@pvcon.in").toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe@2026";

async function main() {
  const { db } = openDatabase(file);
  if (findUserByEmail(db, email)) {
    console.log(`Super admin ${email} already exists in ${file}; nothing to do.`);
    return;
  }
  const passwordHash = await hashPassword(password);
  db.transaction((tx) =>
    createUser(tx, { email, name: "System Admin", roles: ["super_admin"], passwordHash, mustChangePassword: true }),
  );
  console.log(`Created super admin ${email} in ${file}. Temporary password: ${password} (must change at first sign-in).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

The seed imports services with relative paths. They import `@/…` internally, which `tsx` resolves through `tsconfig.json` paths.

- [ ] **Step 2: Replace `.env.example`**

```dotenv
# Auth.js — generate with: openssl rand -base64 32
AUTH_SECRET=
AUTH_TRUST_HOST=true

# New HRMS database. Never point this at the legacy holiday-tracker app.db.
DB_FILE=./data/people.db

# Only emails on this domain can sign in
ALLOWED_EMAIL_DOMAIN=pvcon.in

# Public base URL (links in emails, payslip QR codes)
APP_URL=http://localhost:3000

# AES-256-GCM key for bank/ID fields — openssl rand -base64 32
DATA_ENCRYPTION_KEY=

# Bearer secret for POST /api/cron/<job>
CRON_SECRET=

# Uploaded files directory (back it up with the database)
UPLOAD_DIR=./data/uploads

# SMTP (optional). Without it emails are skipped and logged.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Optional payslip signing certificate (Phase 5)
PAYSLIP_SIGN_P12_PATH=
PAYSLIP_SIGN_P12_PASSWORD=

# Seed (npm run db:seed)
SEED_ADMIN_EMAIL=admin@pvcon.in
SEED_ADMIN_PASSWORD=ChangeMe@2026

LOG_LEVEL=info
```

- [ ] **Step 3: Exercise migrate + seed on a scratch DB**

Run: `DB_FILE=./data/scratch.db npm run db:migrate && DB_FILE=./data/scratch.db npm run db:seed && DB_FILE=./data/scratch.db npm run db:seed && rm -f data/scratch.db*`
Expected: `Migrations applied…`, then `Created super admin admin@pvcon.in…`, then `…already exists…; nothing to do.`

- [ ] **Step 4: Full verification**

Run: `npm run verify`
Expected: typecheck, lint and all vitest suites pass, and `next build` succeeds. The legacy UI still builds because nothing imports the new server code yet.

- [ ] **Step 5: Update the roadmap progress tracker**

In `docs/superpowers/plans/2026-09-24-hrms-roadmap.md` set row "0A Foundation — backend" to `☑ done (<short commit hash of this task>)` after committing, or `◐` with the last task if anything is pending.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed.ts .env.example docs/superpowers/plans/2026-09-24-hrms-roadmap.md
git commit -m "chore: add seed script and document environment"
```

---

## Self-review notes (planner)

- Spec coverage for 0A:
  - §2.4 conventions: dates, money, IDs, validation.
  - §3.4 controls: lockout, session version, reset tokens, encryption, upload rules, cron secret (secret check wired in 0B).
  - §4.1 tables: users, user_roles, password_reset_tokens, company_settings, audit_logs, notifications, job_runs, files. Announcements are deferred to Phase 6 per roadmap.
  - §7 job framework; §9 DomainError; §10 env.
- Deferred to 0B: the Auth.js wiring (`auth.config.ts`, `auth.ts`, `proxy.ts`, `session.ts`, `define.ts`), the routes (cron, health, files), all UI, and e2e.
- Type names used across tasks:
  - `DbLike`, `DB`, `SessionUser`, `ActionResult`, `ActionDef`, `JobDefinition`, `JobOutcome`, `FileKind`, `SettingsKey`, `SettingsValue`.
  - Service functions: `getSetting`, `patchSetting`, `updateSetting`, `writeAudit`, `diffObjects`, `listAudit`, `notify`, `notifyMany`, `listNotifications`, `unreadCount`, `markRead`, `verifyCredentials`, `loadSessionUser`, `changePassword`, `setTemporaryPassword`, `generateTempPassword`, `createPasswordResetToken`, `resetPasswordWithToken`, `createUser`, `setUserRoles`, `setUserStatus`, `listUsers`, `hashPassword`, `runJob`, `runJobByName`, `findJob`, `saveUpload`, `getFile`, `resolveStoredPath`, `canAccessFile`.
  - 0B must use these exact names.
