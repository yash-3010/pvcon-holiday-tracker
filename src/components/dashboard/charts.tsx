"use client";

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const TOOLTIP = {
  contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" },
};

/** Headcount at each month end. */
export function HeadcountChart({ data }: { data: { label: string; headcount: number }[] }) {
  return (
    <div className="h-44" role="img" aria-label={`Headcount over the last ${data.length} months, now ${data.at(-1)?.headcount ?? 0}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip {...TOOLTIP} />
          <Line type="monotone" dataKey="headcount" name="Headcount" stroke="var(--primary)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const SLICE_COLORS: Record<string, string> = {
  In: "var(--success)", Remote: "var(--info)", "On leave": "var(--warning)", "Not in": "var(--destructive)", Off: "var(--muted-foreground)",
};

/** Today's attendance by state. */
export function AttendanceDonut({ slices }: { slices: { name: string; value: number }[] }) {
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((s, x) => s + x.value, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="h-36 w-36 shrink-0" role="img" aria-label={shown.map((s) => `${s.name} ${s.value}`).join(", ") || "No one expected today"}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={shown.length ? shown : [{ name: "None", value: 1 }]} dataKey="value" nameKey="name" innerRadius={42} outerRadius={64} strokeWidth={0} isAnimationActive={false}>
              {(shown.length ? shown : [{ name: "None", value: 1 }]).map((s) => (
                <Cell key={s.name} fill={SLICE_COLORS[s.name] ?? "var(--border)"} />
              ))}
            </Pie>
            {total > 0 && <Tooltip {...TOOLTIP} />}
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1 text-sm">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: SLICE_COLORS[s.name] }} aria-hidden />
            <span className="text-muted-foreground">{s.name}</span>
            <span className="font-medium tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Utilization per person, as a percentage of available hours. */
export function UtilizationBars({ people }: { people: { name: string; utilizationPct: number | null }[] }) {
  const data = people.map((p) => ({ name: p.name.split(" ")[0], value: p.utilizationPct ?? 0 }));
  return (
    <div className="h-44" role="img" aria-label={people.map((p) => `${p.name} ${p.utilizationPct ?? 0}%`).join(", ")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
          <YAxis unit="%" tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip {...TOOLTIP} formatter={(v) => [`${v}%`, "Utilization"]} />
          <Bar dataKey="value" name="Utilization" fill="var(--secondary)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
