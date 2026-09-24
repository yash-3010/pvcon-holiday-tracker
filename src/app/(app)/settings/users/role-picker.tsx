"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, ROLES, isPrivilegedRole, type Role } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

export function RolePicker({
  value,
  onChange,
  canAssignPrivileged,
  idPrefix,
}: {
  value: Role[];
  onChange: (roles: Role[]) => void;
  canAssignPrivileged: boolean;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {ROLES.map((role) => {
        const locked = isPrivilegedRole(role) && !canAssignPrivileged;
        const id = `${idPrefix}-${role}`;
        return (
          <div key={role} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={value.includes(role)}
              disabled={locked}
              onCheckedChange={(checked) => onChange(checked ? [...value, role] : value.filter((r) => r !== role))}
            />
            <Label htmlFor={id} className={cn(locked && "text-muted-foreground")}>
              {ROLE_LABELS[role]}
            </Label>
          </div>
        );
      })}
    </div>
  );
}
