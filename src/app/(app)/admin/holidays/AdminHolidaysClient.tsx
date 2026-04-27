"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, Select, Badge } from "@/components/ui";
import { fmtDate, fmtDay } from "@/lib/utils";
import type { Holiday } from "@/db/schema";

export function AdminHolidaysClient({ initial, year }: { initial: Holiday[]; year: number }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [show, setShow] = useState(false);

  async function refresh() {
    const r = await fetch(`/api/holidays?year=${year}`);
    const data = await r.json();
    setRows([...data].sort((a: Holiday, b: Holiday) => a.date.localeCompare(b.date)));
    router.refresh();
  }

  async function remove(id: number) {
    if (!confirm("Delete holiday?")) return;
    await fetch(`/api/holidays/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Holidays — {year}</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Add, remove, or change holiday types.</p>
        </div>
        <Button onClick={() => setShow(true)}>+ Add holiday</Button>
      </div>
      {show && <AddHoliday year={year} onClose={() => setShow(false)} onSaved={() => { setShow(false); refresh(); }} />}
      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-[var(--muted-foreground)]">
            <tr><th className="py-2">Date</th><th>Day</th><th>Name</th><th>Type</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((h) => (
              <tr key={h.id}>
                <td className="py-2">{fmtDate(h.date)}</td>
                <td className="text-[var(--muted-foreground)]">{fmtDay(h.date)}</td>
                <td>{h.name}</td>
                <td><Badge tone={h.type === "fixed" ? "green" : "blue"}>{h.type}</Badge></td>
                <td className="text-right"><Button size="sm" variant="ghost" onClick={() => remove(h.id)}>Delete</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function AddHoliday({ year, onClose, onSaved }: { year: number; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(`${year}-01-01`);
  const [name, setName] = useState("");
  const [type, setType] = useState<"fixed" | "optional">("fixed");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const res = await fetch("/api/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, date, name, type }),
    });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); return setErr(j.error ?? "Failed."); }
    onSaved();
  }
  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-4">
        <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        <div className="space-y-1.5 md:col-span-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label>Type</Label>
          <Select value={type} onChange={(e) => setType(e.target.value as "fixed" | "optional")}>
            <option value="fixed">Fixed</option><option value="optional">Optional</option>
          </Select>
        </div>
        {err && <p className="md:col-span-4 text-sm text-[var(--destructive)]">{err}</p>}
        <div className="md:col-span-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Card>
  );
}
