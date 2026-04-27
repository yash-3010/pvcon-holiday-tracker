import * as XLSX from "xlsx";
import bcrypt from "bcryptjs";
import { db } from "./index";
import { users, holidays, holidaySelections, leaves, leavePolicy, userYearBalance } from "./schema";
import { eq } from "drizzle-orm";

const XLSX_PATH = process.env.SEED_XLSX ?? "C:/Users/Yash/Downloads/PVCON Leave Tracker 2026.xlsx";
const YEAR = 2026;

const EMPLOYEES = [
  { name: "Yash", email: "yash@pvcon.in" },
  { name: "Sonam", email: "sonam@pvcon.in" },
  { name: "Raj", email: "raj@pvcon.in" },
  { name: "Almas", email: "almas@pvcon.in" },
];
const ADMIN = { name: "Admin", email: "admin@pvcon.in", password: "Pvcon@1234" };
const DEFAULT_EMPLOYEE_PASSWORD = "Pvcon@1234";
const JOIN_DATE = "2025-01-01";

function excelDateToISO(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (typeof v === "string") {
    const t = v.trim();
    const d = new Date(t);
    if (!isNaN(+d)) return d.toISOString().slice(0, 10);
  }
  return null;
}

function isYes(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return v.replace(/\s| /g, "").toUpperCase() === "Y";
}

async function main() {
  console.log("Seeding from", XLSX_PATH);
  const wb = XLSX.readFile(XLSX_PATH);

  // 1. policy
  await db.insert(leavePolicy).values({
    year: YEAR,
    casualPerYear: 12,
    sickPerYear: 6,
    carryFwdMax: 6,
    maxConsecutiveDays: 3,
    optionalHolidaysAllowed: 6,
  }).onConflictDoNothing();

  // 2. users
  const adminHash = await bcrypt.hash(ADMIN.password, 10);
  await db.insert(users).values({
    name: ADMIN.name,
    email: ADMIN.email,
    passwordHash: adminHash,
    role: "admin",
    joinedDate: JOIN_DATE,
    mustChangePassword: true,
  }).onConflictDoNothing();

  for (const e of EMPLOYEES) {
    const hash = await bcrypt.hash(DEFAULT_EMPLOYEE_PASSWORD, 10);
    await db.insert(users).values({
      name: e.name,
      email: e.email,
      passwordHash: hash,
      role: "employee",
      joinedDate: JOIN_DATE,
      mustChangePassword: true,
    }).onConflictDoNothing();
  }

  const userRows = await db.select().from(users);
  const userByName = new Map(userRows.map((u) => [u.name.toLowerCase(), u]));

  // 3. holidays — Holiday List sheet
  const hsheet = wb.Sheets["Holiday List"];
  const hrows = XLSX.utils.sheet_to_json<unknown[]>(hsheet, { header: 1, raw: true });
  // header row 2 (index 1): Date, Day, Name, Type, Sonam, Yash, Raj, Almas
  const memberCols = ["Sonam", "Yash", "Raj", "Almas"];
  const memberColStart = 4;

  const holidayInsertedByDate = new Map<string, number>();
  for (let i = 2; i < hrows.length; i++) {
    const row = hrows[i] as unknown[];
    const iso = excelDateToISO(row[0]);
    const name = (row[2] as string)?.trim();
    const typeRaw = (row[3] as string)?.toLowerCase() ?? "";
    if (!iso || !name) continue;
    const type: "fixed" | "optional" = typeRaw.includes("fixed") ? "fixed" : "optional";
    const inserted = await db
      .insert(holidays)
      .values({ year: YEAR, date: iso, name, type })
      .onConflictDoNothing()
      .returning();
    let id = inserted[0]?.id;
    if (!id) {
      const found = await db.select().from(holidays).where(eq(holidays.date, iso));
      id = found[0]?.id;
    }
    if (id) holidayInsertedByDate.set(iso, id);

    // optional selections — Y marks per member
    if (type === "optional") {
      for (let m = 0; m < memberCols.length; m++) {
        if (isYes(row[memberColStart + m])) {
          const u = userByName.get(memberCols[m].toLowerCase());
          if (u && id) {
            await db.insert(holidaySelections).values({ userId: u.id, holidayId: id }).onConflictDoNothing();
          }
        }
      }
    }
  }
  console.log("Holidays seeded:", holidayInsertedByDate.size);

  // 4. leaves — Leave Tracker sheet
  const lsheet = wb.Sheets["Leave Tracker"];
  const lrows = XLSX.utils.sheet_to_json<unknown[]>(lsheet, { header: 1, raw: true });
  let leaveCount = 0;
  for (let i = 2; i < lrows.length; i++) {
    const row = lrows[i] as unknown[];
    const name = (row[1] as string)?.trim();
    if (!name) continue;
    const u = userByName.get(name.toLowerCase());
    if (!u) continue;
    let start = excelDateToISO(row[2]);
    let end = excelDateToISO(row[3]);
    const days = Number(row[4]);
    const reasonRaw = (row[5] as string)?.trim().toLowerCase() ?? "";
    const statusRaw = (row[6] as string)?.trim().toLowerCase() ?? "planned";
    if (!start || !end || !days) continue;
    const type: "casual" | "sick" | "unpaid" =
      reasonRaw.startsWith("sick") ? "sick" :
      reasonRaw.startsWith("unpaid") ? "unpaid" : "casual";
    const status: "planned" | "taken" | "cancelled" =
      statusRaw.startsWith("taken") ? "taken" :
      statusRaw.startsWith("cancel") ? "cancelled" : "planned";
    await db.insert(leaves).values({
      userId: u.id,
      startDate: start,
      endDate: end,
      days,
      type,
      reason: reasonRaw,
      status,
    });
    leaveCount++;
  }
  console.log("Leaves seeded:", leaveCount);

  // 5. carry-forward from summary sheet — Yash had 14 paid taken / 4 balance, etc.
  // Summary: Sonam 15.5 balance (so 18+? — actually balance includes carry-fwd 2025).
  // Sheet "Paid Leaves Balance + Carried forwarded leaves from 2025" hints carryforward.
  // We seed conservative: 0 carryforward, admin can adjust later via policy/balance UI.
  for (const u of userRows) {
    if (u.role === "employee") {
      await db.insert(userYearBalance).values({ userId: u.id, year: YEAR, carryForwardCl: 0 }).onConflictDoNothing();
    }
  }

  console.log("Seed complete.");
  console.log("Admin login: admin@pvcon.in / Pvcon@1234 (must change on first login)");
  console.log("Employees: yash/sonam/raj/almas @pvcon.in / Pvcon@1234");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
