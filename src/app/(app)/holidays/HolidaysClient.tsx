"use client";
import { useState } from "react";
import { Card, Badge } from "@/components/ui";
import { fmtDate, fmtDay } from "@/lib/utils";
import type { Holiday } from "@/db/schema";

export function HolidaysClient({
  holidays, initiallySelected, year,
}: { holidays: Holiday[]; initiallySelected: number[]; year: number }) {
  const [selected, setSelected] = useState<Set<number>>(new Set(initiallySelected));
  const [err, setErr] = useState<string | null>(null);

  const optional = holidays.filter((h) => h.type === "optional");
  const fixed = holidays.filter((h) => h.type === "fixed");

  async function toggle(id: number) {
    setErr(null);
    const willSelect = !selected.has(id);
    const next = new Set(selected);
    willSelect ? next.add(id) : next.delete(id);
    setSelected(next);
    const res = await fetch("/api/holiday-selections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holidayId: id, selected: willSelect }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Failed.");
      // revert
      const revert = new Set(selected);
      willSelect ? revert.delete(id) : revert.add(id);
      setSelected(revert);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Holidays — {year}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Pick up to 6 optional holidays. Fixed holidays apply to everyone.
        </p>
      </div>

      {err && <p className="text-sm text-[var(--destructive)]">{err}</p>}

      <Card>
        <h2 className="mb-3 font-semibold">Fixed holidays ({fixed.length})</h2>
        <ul className="divide-y divide-[var(--border)]">
          {fixed.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium">{fmtDate(h.date)}</span>
                <span className="ml-2 text-[var(--muted-foreground)]">{fmtDay(h.date)}</span>
                <span className="ml-3">{h.name}</span>
              </div>
              <Badge tone="green">Fixed</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Optional holidays — pick up to 6</h2>
          <Badge tone={selected.size > 6 ? "red" : "blue"}>{selected.size}/6 picked</Badge>
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {optional.map((h) => {
            const isSel = selected.has(h.id);
            return (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <label className="flex flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(h.id)}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  <span className="font-medium">{fmtDate(h.date)}</span>
                  <span className="text-[var(--muted-foreground)]">{fmtDay(h.date)}</span>
                  <span>{h.name}</span>
                </label>
                {isSel && <Badge tone="blue">Picked</Badge>}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
