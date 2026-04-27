"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";

type Policy = {
  year: number;
  casualPerYear: number;
  sickPerYear: number;
  carryFwdMax: number;
  maxConsecutiveDays: number;
  optionalHolidaysAllowed: number;
};

export function PolicyForm({ initial }: { initial: Policy }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await fetch("/api/admin/policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); return setMsg({ ok: false, text: j.error ?? "Failed." }); }
    setMsg({ ok: true, text: "Policy saved." });
    router.refresh();
  }

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Casual leave / year" value={p.casualPerYear} onChange={(v) => setP({ ...p, casualPerYear: v })} />
        <Field label="Sick leave / year" value={p.sickPerYear} onChange={(v) => setP({ ...p, sickPerYear: v })} />
        <Field label="CL carry-forward max" value={p.carryFwdMax} onChange={(v) => setP({ ...p, carryFwdMax: v })} />
        <Field label="Max consecutive working days" value={p.maxConsecutiveDays} onChange={(v) => setP({ ...p, maxConsecutiveDays: v })} />
        <Field label="Optional holidays allowed" value={p.optionalHolidaysAllowed} onChange={(v) => setP({ ...p, optionalHolidaysAllowed: v })} />
        {msg && <p className={`md:col-span-2 text-sm ${msg.ok ? "text-green-700" : "text-[var(--destructive)]"}`}>{msg.text}</p>}
        <div className="md:col-span-2 flex justify-end">
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save policy"}</Button>
        </div>
      </form>
    </Card>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" min="0" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
