"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReportChart as Chart, ReportRow } from "@/server/modules/reports/types";

const COLORS = ["var(--primary)", "var(--secondary)", "var(--info)", "var(--warning)", "var(--destructive)"];
const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const TOOLTIP = {
  contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" },
};

export function ReportChart({ chart, rows }: { chart: Chart; rows: ReportRow[] }) {
  const data = rows.slice(0, 60);
  const Shape = chart.type === "line" ? LineChart : BarChart;
  return (
    <div className="h-64" role="img" aria-label={`Chart of ${chart.series.map((s) => s.label).join(", ")} by ${chart.x}`}>
      <ResponsiveContainer width="100%" height="100%">
        <Shape data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={chart.x} tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} />
          <Tooltip {...TOOLTIP} />
          {chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {chart.series.map((s, i) =>
            chart.type === "line" ? (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            ) : (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            ),
          )}
        </Shape>
      </ResponsiveContainer>
    </div>
  );
}
