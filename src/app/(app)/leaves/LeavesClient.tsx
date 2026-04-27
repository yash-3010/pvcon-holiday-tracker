"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, Select, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import type { Leave } from "@/db/schema";

export function LeavesClient({ initial, year, maxConsecutive }: { initial: Leave[]; year: number; maxConsecutive: number }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<Leave | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function refresh() {
    const r = await fetch(`/api/leaves?year=${year}`);
    setRows(await r.json());
    router.refresh();
  }

  async function remove(id: number) {
    if (!confirm("Delete this leave?")) return;
    await fetch(`/api/leaves/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">My Leaves — {year}</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Max {maxConsecutive} consecutive working days per leave.</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}>+ Add leave</Button>
      </div>

      {showForm && (
        <LeaveForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); refresh(); }}
        />
      )}

      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No leaves yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-[var(--muted-foreground)]">
                <tr>
                  <th className="py-2">Start</th>
                  <th>End</th>
                  <th>Days</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {[...rows].sort((a, b) => b.startDate.localeCompare(a.startDate)).map((l) => (
                  <tr key={l.id}>
                    <td className="py-2">{fmtDate(l.startDate)}</td>
                    <td>{fmtDate(l.endDate)}</td>
                    <td>{l.days}</td>
                    <td className="capitalize">{l.type}</td>
                    <td className="max-w-[200px] truncate text-[var(--muted-foreground)]">{l.reason}</td>
                    <td>
                      <Badge tone={l.status === "taken" ? "green" : l.status === "planned" ? "blue" : "default"}>
                        {l.status}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(l); setShowForm(true); }}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(l.id)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function LeaveForm({
  initial, onClose, onSaved, userId,
}: { initial: Leave | null; onClose: () => void; onSaved: () => void; userId?: number }) {
  const [startDate, setStart] = useState(initial?.startDate ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEnd] = useState(initial?.endDate ?? new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState<number | "">(initial?.days ?? "");
  const [type, setType] = useState<Leave["type"]>(initial?.type ?? "casual");
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [status, setStatus] = useState<Leave["status"]>(initial?.status ?? "planned");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const payload: Record<string, unknown> = { startDate, endDate, type, reason, status };
    if (days !== "") payload.days = Number(days);
    if (userId) payload.userId = userId;
    const url = initial ? `/api/leaves/${initial.id}` : "/api/leaves";
    const method = initial ? "PATCH" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.error ?? "Failed.");
    }
    onSaved();
  }

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Start date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>End date</Label>
          <Input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Days (override, supports 0.5)</Label>
          <Input type="number" step="0.5" min="0.5" value={days} onChange={(e) => setDays(e.target.value === "" ? "" : Number(e.target.value))} placeholder="auto from working days" />
        </div>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={type} onChange={(e) => setType(e.target.value as Leave["type"])}>
            <option value="casual">Casual</option>
            <option value="sick">Sick</option>
            <option value="unpaid">Unpaid</option>
          </Select>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Reason</Label>
          <Input value={reason ?? ""} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value as Leave["status"])}>
            <option value="planned">Planned</option>
            <option value="taken">Taken</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        {err && <p className="md:col-span-2 text-sm text-[var(--destructive)]">{err}</p>}
        <div className="md:col-span-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Card>
  );
}
