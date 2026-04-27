import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getUserBalance, listUserLeaves } from "@/lib/leaves";
import { currentYear, fmtDate } from "@/lib/utils";
import { Card, Stat, Badge } from "@/components/ui";

export default async function AdminUserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await db.select().from(users).where(eq(users.id, Number(id))).limit(1);
  const u = r[0];
  if (!u) notFound();
  const year = currentYear();
  const bal = await getUserBalance(u.id, year);
  const lvs = await listUserLeaves(u.id, year);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{u.name}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{u.email} · {u.role} · joined {u.joinedDate}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="CL" value={`${bal.casualUsed}/${bal.casualTotal}`} sub="used / total" />
        <Stat label="SL" value={`${bal.sickUsed}/${bal.sickTotal}`} sub="used / total" />
        <Stat label="Optional" value={`${bal.optionalUsed}/${bal.optionalAllowed}`} sub="picked" />
        <Stat label="Unpaid" value={bal.unpaidUsed} />
      </div>
      <Card>
        <h2 className="mb-3 font-semibold">Leaves — {year}</h2>
        {lvs.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">None.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-[var(--muted-foreground)]">
              <tr>
                <th className="py-2">Start</th><th>End</th><th>Days</th><th>Type</th><th>Reason</th><th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {[...lvs].sort((a, b) => b.startDate.localeCompare(a.startDate)).map((l) => (
                <tr key={l.id}>
                  <td className="py-2">{fmtDate(l.startDate)}</td>
                  <td>{fmtDate(l.endDate)}</td>
                  <td>{l.days}</td>
                  <td className="capitalize">{l.type}</td>
                  <td className="text-[var(--muted-foreground)]">{l.reason}</td>
                  <td><Badge tone={l.status === "taken" ? "green" : l.status === "planned" ? "blue" : "default"}>{l.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
