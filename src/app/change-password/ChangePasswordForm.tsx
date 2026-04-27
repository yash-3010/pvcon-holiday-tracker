"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { Button, Input, Label } from "@/components/ui";

export function ChangePasswordForm() {
  const { update } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next.length < 8) return setErr("Password must be at least 8 characters.");
    if (next !== confirm) return setErr("Passwords do not match.");
    setLoading(true);
    const res = await fetch("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.error ?? "Failed.");
    }
    await update({ mustChangePassword: false });
    window.location.assign("/");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Current password</Label>
        <Input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>New password</Label>
        <Input type="password" required value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Confirm new password</Label>
        <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {err && <p className="text-sm text-[var(--destructive)]">{err}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
