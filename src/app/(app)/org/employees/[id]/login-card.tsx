"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { RolePicker } from "@/components/users/role-picker";
import { TempPasswordDialog } from "@/components/users/temp-password-dialog";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import type { SelectOption } from "@/lib/hr";
import { createEmployeeLoginAction, linkEmployeeUserAction } from "../actions";

export function LoginCard({
  employeeId,
  hasWorkEmail,
  user,
  canManage,
  canAssignPrivileged,
  linkableUsers,
}: {
  employeeId: number;
  hasWorkEmail: boolean;
  user: { email: string; status: "active" | "disabled"; roles: Role[] } | null;
  canManage: boolean;
  canAssignPrivileged: boolean;
  linkableUsers: SelectOption[];
}) {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>(["employee"]);
  const [linkId, setLinkId] = useState("");
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const create = useServerAction(createEmployeeLoginAction, {
    onSuccess: (data) => {
      setTemp({ email: data.email, password: data.tempPassword });
      router.refresh();
    },
  });
  const link = useServerAction(linkEmployeeUserAction, { successMessage: "Login linked", onSuccess: () => router.refresh() });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Login</CardTitle>
        <CardDescription>{user ? "This employee can sign in." : "No login yet."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {user ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium">{user.email}</p>
            <div className="flex flex-wrap gap-1">
              {user.roles.map((role) => (
                <Badge key={role}>{ROLE_LABELS[role]}</Badge>
              ))}
              {user.status === "disabled" && <Badge variant="secondary">Disabled</Badge>}
            </div>
            {canManage && (
              <Link href="/settings/users" className="text-primary underline underline-offset-2">
                Manage in Users &amp; roles
              </Link>
            )}
          </div>
        ) : canManage ? (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium">Create a login</p>
              {hasWorkEmail ? (
                <>
                  <RolePicker value={roles} onChange={setRoles} canAssignPrivileged={canAssignPrivileged} idPrefix="login-role" />
                  <Button size="sm" disabled={create.pending || roles.length === 0} onClick={() => create.run({ employeeId, roles })}>
                    {create.pending && <Spinner />}
                    Create login
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Add a work email on the Personal tab first.</p>
              )}
            </div>
            {linkableUsers.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="link-user">Or link an existing login</Label>
                <NativeSelect id="link-user" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                  <option value="">Choose a login</option>
                  {linkableUsers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
                <Button size="sm" variant="outline" disabled={!linkId || link.pending} onClick={() => link.run({ employeeId, userId: Number(linkId) })}>
                  Link login
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">An administrator can create one.</p>
        )}
      </CardContent>
      <TempPasswordDialog value={temp} onClose={() => setTemp(null)} />
    </Card>
  );
}
