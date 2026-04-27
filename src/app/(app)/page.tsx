import { auth } from "@/auth";
import { Stat, Card, Badge } from "@/components/ui";
import { getUserBalance, listUserLeaves } from "@/lib/leaves";
import { fmtDate, currentYear } from "@/lib/utils";
import { AdminOverview } from "@/components/AdminOverview";
import { db } from "@/db";
import { users, leaves, holidays } from "@/db/schema";
import { and, eq, gte, lte } from "drizzle-orm";

export default async function Home() {
  const session = await auth();
  const year = currentYear();

  if (session?.user?.role === "admin") {
    const employees = (await db.select().from(users)).filter((u) => u.role === "employee");
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const allLeaves = await db
      .select()
      .from(leaves)
      .where(and(gte(leaves.startDate, yearStart), lte(leaves.startDate, yearEnd)));
    const yearHolidays = await db.select().from(holidays).where(eq(holidays.year, year));

    const summaries = await Promise.all(
      employees.map(async (u) => ({ user: u, bal: await getUserBalance(u.id, year) }))
    );

    return <AdminOverview year={year} summaries={summaries} leaves={allLeaves} holidaysCount={yearHolidays.length} />;
  }

  const userId = Number(session!.user.id);
  const bal = await getUserBalance(userId, year);
  const lvs = await listUserLeaves(userId, year);
  const upcoming = lvs
    .filter((l) => l.status !== "cancelled" && l.startDate >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Hi, {session?.user?.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Your {year} leave snapshot</p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Casual leave" value={`${bal.casualBalance}`} sub={`of ${bal.casualTotal} left · ${bal.casualUsed} used`} accent="primary" />
        <Stat label="Sick leave" value={`${bal.sickBalance}`} sub={`of ${bal.sickTotal} left · ${bal.sickUsed} used`} accent="secondary" />
        <Stat label="Optional holidays" value={`${bal.optionalUsed}/${bal.optionalAllowed}`} sub="picked" accent="muted" />
        <Stat label="Unpaid leave" value={`${bal.unpaidUsed}`} sub="taken" accent="muted" />
      </div>
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-[var(--foreground)]">Upcoming leaves</h2>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            None planned. Add one from <a href="/leaves" className="text-[var(--primary)] underline">My Leaves</a>.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {upcoming.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <span className="font-medium">{fmtDate(l.startDate)}</span>
                  {l.startDate !== l.endDate && <> – <span className="font-medium">{fmtDate(l.endDate)}</span></>}
                  <span className="ml-3 text-[var(--muted-foreground)]">{l.days}d · {l.type}</span>
                </div>
                <Badge tone={l.status === "taken" ? "green" : l.status === "planned" ? "blue" : "default"}>
                  {l.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
