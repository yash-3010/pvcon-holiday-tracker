"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, CircleCheck, Ellipsis, KeyRound, ShieldCheck } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { resetUserPasswordAction, setUserStatusAction, updateUserRolesAction } from "./actions";
import { AddUserSheet } from "./add-user-sheet";
import { RolePicker } from "./role-picker";
import { TempPasswordDialog } from "./temp-password-dialog";

export interface UserRowView {
  id: number;
  name: string;
  email: string;
  roles: Role[];
  status: "active" | "disabled";
  mustChangePassword: boolean;
  lastLoginLabel: string;
}

type Confirm = { kind: "reset" | "disable" | "enable"; user: UserRowView };

export function UsersTable({
  users,
  actorId,
  canAssignPrivileged,
  allowedDomain,
}: {
  users: UserRowView[];
  actorId: number;
  canAssignPrivileged: boolean;
  allowedDomain: string;
}) {
  const router = useRouter();
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [editing, setEditing] = useState<UserRowView | null>(null);
  const [editRoles, setEditRoles] = useState<Role[]>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const reset = useServerAction(resetUserPasswordAction, {
    onSuccess: (d) => {
      setTemp({ email: d.email, password: d.tempPassword });
      router.refresh();
    },
  });
  const status = useServerAction(setUserStatusAction, { successMessage: "User updated", onSuccess: () => router.refresh() });
  const roles = useServerAction(updateUserRolesAction, {
    successMessage: "Roles updated",
    onSuccess: () => {
      setEditing(null);
      router.refresh();
    },
  });

  const columns = useMemo<ColumnDef<UserRowView>[]>(
    () => [
      {
        id: "user",
        header: "User",
        accessorFn: (u) => `${u.name} ${u.email}`,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-medium">{row.original.name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
          </div>
        ),
      },
      {
        id: "roles",
        header: "Roles",
        accessorFn: (u) => u.roles.map((r) => ROLE_LABELS[r]).join(" "),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.roles.map((r) => (
              <Badge key={r}>{ROLE_LABELS[r]}</Badge>
            ))}
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (u) => u.status,
        cell: ({ row }) =>
          row.original.status === "active" ? (
            <Badge variant="success">{row.original.mustChangePassword ? "Pending first sign-in" : "Active"}</Badge>
          ) : (
            <Badge variant="secondary">Disabled</Badge>
          ),
      },
      { accessorKey: "lastLoginLabel", header: "Last sign-in" },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const u = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${u.email}`}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setEditRoles(u.roles);
                    setEditing(u);
                  }}
                >
                  <ShieldCheck /> Edit roles
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setConfirm({ kind: "reset", user: u })}>
                  <KeyRound /> Reset password
                </DropdownMenuItem>
                {u.id !== actorId && (
                  <>
                    <DropdownMenuSeparator />
                    {u.status === "active" ? (
                      <DropdownMenuItem destructive onSelect={() => setConfirm({ kind: "disable", user: u })}>
                        <Ban /> Disable
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => setConfirm({ kind: "enable", user: u })}>
                        <CircleCheck /> Enable
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [actorId],
  );

  const confirmCopy: Record<Confirm["kind"], { title: string; description: string; label: string; destructive: boolean }> = {
    reset: {
      title: "Reset password?",
      description: "A new temporary password is generated and all of the user's sessions are signed out.",
      label: "Reset password",
      destructive: false,
    },
    disable: {
      title: "Disable user?",
      description: "They are signed out everywhere and can no longer sign in. You can re-enable them later.",
      label: "Disable",
      destructive: true,
    },
    enable: { title: "Enable user?", description: "They will be able to sign in again.", label: "Enable", destructive: false },
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={users}
        searchPlaceholder="Search name, email or role…"
        toolbar={
          <AddUserSheet
            canAssignPrivileged={canAssignPrivileged}
            allowedDomain={allowedDomain}
            onCreated={(d) => {
              setTemp({ email: d.email, password: d.tempPassword });
              router.refresh();
            }}
          />
        }
      />

      <TempPasswordDialog value={temp} onClose={() => setTemp(null)} />

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit roles</DialogTitle>
            <DialogDescription>{editing?.email}</DialogDescription>
          </DialogHeader>
          <RolePicker value={editRoles} onChange={setEditRoles} canAssignPrivileged={canAssignPrivileged} idPrefix="edit-role" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={roles.pending} onClick={() => editing && roles.run({ userId: editing.id, roles: editRoles })}>
              {roles.pending && <Spinner />}
              Save roles
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={confirmCopy[confirm.kind].title}
          description={`${confirm.user.email}: ${confirmCopy[confirm.kind].description}`}
          confirmLabel={confirmCopy[confirm.kind].label}
          destructive={confirmCopy[confirm.kind].destructive}
          onConfirm={async () => {
            if (confirm.kind === "reset") await reset.run({ userId: confirm.user.id });
            else await status.run({ userId: confirm.user.id, status: confirm.kind === "disable" ? "disabled" : "active" });
          }}
        />
      )}
    </>
  );
}
