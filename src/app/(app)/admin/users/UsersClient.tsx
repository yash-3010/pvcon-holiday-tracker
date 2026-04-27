"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Input, Label, Select, Badge } from "@/components/ui";
import type { User } from "@/db/schema";

export function UsersClient({ initial }: { initial: User[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [tempPw, setTempPw] = useState<{ name: string; pw: string } | null>(null);

  async function refresh() {
    const r = await fetch("/api/admin/users");
    setRows(await r.json());
    router.refresh();
  }

  async function reset(id: number, name: string) {
    if (!confirm(`Reset password for ${name}?`)) return;
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resetPassword: true }),
    });
    const j = await res.json();
    if (j.tempPassword) setTempPw({ name, pw: j.tempPassword });
  }

  async function toggleActive(u: User) {
    await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    refresh();
  }

  async function remove(id: number, name: string) {
    if (!confirm(`Permanently delete ${name}? This wipes their leaves too.`)) return;
    await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <Button onClick={() => setShowForm(true)}>+ Add user</Button>
      </div>

      {tempPw && (
        <Card className="border-[var(--secondary)] bg-green-50">
          <p className="text-sm">
            Temporary password for <span className="font-semibold">{tempPw.name}</span>:
            <code className="ml-2 rounded bg-white px-2 py-1 font-mono text-sm">{tempPw.pw}</code>
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">Share it manually. They will be forced to change on first login.</p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setTempPw(null)}>Dismiss</Button>
        </Card>
      )}

      {showForm && (
        <AddUserForm
          onClose={() => setShowForm(false)}
          onCreated={(name, pw) => { setTempPw({ name, pw }); setShowForm(false); refresh(); }}
        />
      )}

      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-[var(--muted-foreground)]">
            <tr>
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="py-2 font-medium">{u.name}</td>
                <td className="text-[var(--muted-foreground)]">{u.email}</td>
                <td className="capitalize">{u.role}</td>
                <td>{u.joinedDate}</td>
                <td>{u.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}</td>
                <td className="space-x-1 text-right">
                  <Link href={`/admin/users/${u.id}`} className="text-sm text-[var(--primary)] underline">View</Link>
                  <Button size="sm" variant="ghost" onClick={() => reset(u.id, u.name)}>Reset PW</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(u)}>{u.active ? "Deactivate" : "Activate"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(u.id, u.name)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function AddUserForm({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, pw: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [joinedDate, setJoined] = useState(new Date().toISOString().slice(0, 10));
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, joinedDate, role }),
    });
    setBusy(false);
    const j = await res.json();
    if (!res.ok) return setErr(j.error ?? "Failed.");
    onCreated(j.user.name, j.tempPassword);
  }

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@pvcon.in" />
        </div>
        <div className="space-y-1.5">
          <Label>Joined date</Label>
          <Input type="date" required value={joinedDate} onChange={(e) => setJoined(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={role} onChange={(e) => setRole(e.target.value as "admin" | "employee")}>
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </Select>
        </div>
        {err && <p className="md:col-span-2 text-sm text-[var(--destructive)]">{err}</p>}
        <div className="md:col-span-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create + show temp password"}</Button>
        </div>
      </form>
    </Card>
  );
}
