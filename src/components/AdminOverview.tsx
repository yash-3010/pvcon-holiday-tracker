"use client";
import { Card, Stat, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

type Leave = {
  id: number;
  userId: number;
  startDate: string;
  endDate: string;
  days: number;
  type: "casual" | "sick" | "unpaid";
  reason: string | null;
  status: "planned" | "taken" | "cancelled";
};

type Summary = {
  user: { id: number; name: string; email: string };
  bal: {
    casualUsed: number; casualTotal: number; casualBalance: number;
    sickUsed: number; sickTotal: number; sickBalance: number;
    unpaidUsed: number; optionalUsed: number; optionalAllowed: number;
  };
};

const NAVY = "#202f63";
const GREEN = "#92b353";
const SLATE = "#cbd5e1";
const AMBER = "#f59e0b";

export function AdminOverview({
  year, summaries, leaves, holidaysCount,
}: { year: number; summaries: Summary[]; leaves: Leave[]; holidaysCount: number }) {
  const totalCl = summaries.reduce((a, s) => a + s.bal.casualUsed, 0);
  const totalSl = summaries.reduce((a, s) => a + s.bal.sickUsed, 0);
  const totalUnpaid = summaries.reduce((a, s) => a + s.bal.unpaidUsed, 0);

  const perUserBars = summaries.map((s) => ({
    name: s.user.name,
    Casual: s.bal.casualUsed,
    Sick: s.bal.sickUsed,
    Unpaid: s.bal.unpaidUsed,
  }));

  const monthly = Array.from({ length: 12 }, (_, m) => {
    const month = String(m + 1).padStart(2, "0");
    const inMonth = leaves.filter((l) => l.status !== "cancelled" && l.startDate.slice(5, 7) === month);
    const days = inMonth.reduce((a, l) => a + l.days, 0);
    return { month: new Date(year, m, 1).toLocaleString("en", { month: "short" }), days };
  });

  const typeBreakdown = [
    { name: "Casual", value: totalCl, color: NAVY },
    { name: "Sick", value: totalSl, color: GREEN },
    { name: "Unpaid", value: totalUnpaid, color: AMBER },
  ].filter((t) => t.value > 0);
  if (typeBreakdown.length === 0) typeBreakdown.push({ name: "No leaves yet", value: 1, color: SLATE });

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = leaves
    .filter((l) => l.status !== "cancelled" && l.startDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 6);

  const byUserId = new Map(summaries.map((s) => [s.user.id, s.user.name]));

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Overview — {year}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Team leave snapshot at a glance.</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/admin/users" className="rounded-md bg-[#202f63] px-3 py-2 text-[#ffffff] hover:bg-[#1a2756]">Manage users</Link>
          <Link href="/admin/holidays" className="rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-[var(--foreground)] hover:bg-[var(--muted)]">Holidays</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Employees" value={summaries.length} accent="primary" />
        <Stat label="Casual taken" value={totalCl} accent="primary" />
        <Stat label="Sick taken" value={totalSl} accent="secondary" />
        <Stat label="Holidays this year" value={holidaysCount} accent="muted" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 font-semibold text-[var(--foreground)]">Leaves taken — per employee</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perUserBars} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ef" vertical={false} />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e6e8ef", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Casual" stackId="a" fill={NAVY} radius={[0, 0, 0, 0]} />
                <Bar dataKey="Sick" stackId="a" fill={GREEN} />
                <Bar dataKey="Unpaid" stackId="a" fill={AMBER} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold text-[var(--foreground)]">Leave-type split</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={typeBreakdown}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  stroke="none"
                >
                  {typeBreakdown.map((t, i) => <Cell key={i} fill={t.color} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e6e8ef", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 font-semibold text-[var(--foreground)]">Leave days by month</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ef" vertical={false} />
              <XAxis dataKey="month" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e6e8ef", fontSize: 12 }} />
              <Bar dataKey="days" fill={NAVY} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-[var(--foreground)]">Team summary</h2>
            <Link href="/admin/users" className="text-xs text-[var(--primary)] hover:underline">Manage →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="pb-2">Name</th>
                  <th>CL</th>
                  <th>SL</th>
                  <th>Optional</th>
                  <th>Unpaid</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {summaries.map(({ user, bal }) => (
                  <tr key={user.id}>
                    <td className="py-2.5 font-medium">{user.name}</td>
                    <td>{bal.casualUsed} / {bal.casualTotal}</td>
                    <td>{bal.sickUsed} / {bal.sickTotal}</td>
                    <td>{bal.optionalUsed} / {bal.optionalAllowed}</td>
                    <td>{bal.unpaidUsed}</td>
                    <td className="text-right">
                      <Link href={`/admin/users/${user.id}`} className="text-xs text-[var(--primary)] hover:underline">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold text-[var(--foreground)]">Upcoming team leaves</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">None planned.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {upcoming.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <span className="font-medium">{byUserId.get(l.userId) ?? "—"}</span>
                    <span className="ml-2 text-[var(--muted-foreground)]">{fmtDate(l.startDate)}</span>
                    {l.startDate !== l.endDate && <span className="text-[var(--muted-foreground)]"> – {fmtDate(l.endDate)}</span>}
                    <span className="ml-2 text-[var(--muted-foreground)]">· {l.days}d · {l.type}</span>
                  </div>
                  <Badge tone={l.status === "taken" ? "green" : "blue"}>{l.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
