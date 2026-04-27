"use client";
import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";

export function ProfileForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) return setMsg({ ok: false, text: "Min 8 characters." });
    if (next !== confirm) return setMsg({ ok: false, text: "Passwords do not match." });
    setBusy(true);
    const res = await fetch("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setMsg({ ok: false, text: j.error ?? "Failed." });
    }
    setMsg({ ok: true, text: "Password updated." });
    setCurrent(""); setNext(""); setConfirm("");
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label>Current password</Label>
        <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label>New password</Label>
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label>Confirm</Label>
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-[var(--destructive)]"}`}>{msg.text}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</Button>
    </form>
  );
}
