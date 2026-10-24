"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, UserPlus } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SelectOption } from "@/lib/hr";
import type { ProjectRow } from "@/server/db/schema";
import type { ProjectMemberView } from "@/server/modules/projects/queries";
import { addMembersAction, setMemberActiveAction } from "../actions";
import { ProjectSheet, type ProjectSheetOptions } from "../project-sheet";

export function EditProjectButton({ project, options }: { project: ProjectRow; options: ProjectSheetOptions }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil /> Edit
      </Button>
      <ProjectSheet open={open} onOpenChange={setOpen} editing={project} options={options} />
    </>
  );
}

function AddMembersDialog({ projectId, candidates, open, onClose }: { projectId: number; candidates: SelectOption[]; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [role, setRole] = useState("");
  const [query, setQuery] = useState("");
  const add = useServerAction(addMembersAction, {
    successMessage: (d) => `Added ${d.added} member(s)`,
    onSuccess: () => {
      setSelected([]);
      setRole("");
      onClose();
      router.refresh();
    },
  });
  const q = query.trim().toLowerCase();
  const shown = candidates.filter((c) => !q || c.label.toLowerCase().includes(q));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add members</DialogTitle>
          <DialogDescription>Members can log time to this project while it is active.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Search employees…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search employees" />
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
          {shown.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">Nobody else to add.</p>
          ) : (
            shown.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/50">
                <Checkbox
                  id={`member-${c.id}`}
                  checked={selected.includes(c.id)}
                  onCheckedChange={(checked) => setSelected((s) => (checked ? [...s, c.id] : s.filter((x) => x !== c.id)))}
                />
                <Label htmlFor={`member-${c.id}`} className="flex-1 font-normal">
                  {c.label}
                </Label>
              </div>
            ))
          )}
        </div>
        <Field label="Role (optional)" htmlFor="member-role">
          <Input id="member-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Developer, Lead…" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={add.pending || selected.length === 0} onClick={() => add.run({ projectId, employeeIds: selected, role: role || null })}>
            {add.pending && <Spinner />}
            Add {selected.length || ""} member(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MembersCard({
  projectId, members, candidates, canManage, internal,
}: {
  projectId: number;
  members: ProjectMemberView[];
  candidates: SelectOption[];
  canManage: boolean;
  internal: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const toggle = useServerAction(setMemberActiveAction, {
    successMessage: (d) => (d.active ? "Member restored" : "Member removed"),
    onSuccess: () => router.refresh(),
  });
  const memberIds = new Set(members.filter((m) => m.active).map((m) => m.employeeId));
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Members</CardTitle>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <UserPlus /> Add members
          </Button>
        )}
      </CardHeader>
      <CardContent className={members.length ? "p-0" : undefined}>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {internal ? "Internal projects are open to everyone; members are optional." : "No members yet: nobody can log time to this project."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Employee</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="w-28" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.employeeId}>
                  <TableCell>
                    <span className="font-medium">{m.name}</span>
                    <p className="text-xs text-muted-foreground">{m.code}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.role ?? "—"}</TableCell>
                  <TableCell>{m.active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Removed</Badge>}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={toggle.pending}
                        onClick={() => toggle.run({ projectId, employeeId: m.employeeId, active: !m.active })}
                      >
                        {m.active ? "Remove" : "Restore"}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {canManage && (
        <AddMembersDialog projectId={projectId} candidates={candidates.filter((c) => !memberIds.has(c.id))} open={adding} onClose={() => setAdding(false)} />
      )}
    </Card>
  );
}
