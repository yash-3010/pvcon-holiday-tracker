"use client";

import Link from "next/link";
import { useState } from "react";
import { Mail, Phone } from "lucide-react";
import { filterDirectory } from "@/components/employees/filters";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { SelectOption } from "@/lib/hr";
import type { DirectoryEntry } from "@/server/modules/employees/queries";

export function DirectoryClient({
  entries,
  departments,
  profileIds,
}: {
  entries: DirectoryEntry[];
  departments: SelectOption[];
  profileIds: number[];
}) {
  const [query, setQuery] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const visible = filterDirectory(entries, { query, departmentId: departmentId ? Number(departmentId) : null });
  const canOpen = new Set(profileIds);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, code, email or designation…"
          aria-label="Search the directory"
          className="max-w-sm"
        />
        <div className="w-56">
          <NativeSelect aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="Nobody matches" description="Try another name or department." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((person) => (
            <Card key={person.id}>
              <CardContent className="flex gap-3 pt-5">
                <Avatar name={person.displayName} className="size-10" />
                <div className="min-w-0 space-y-1 text-sm">
                  <p className="font-medium">
                    {canOpen.has(person.id) ? (
                      <Link href={`/org/employees/${person.id}`} className="hover:underline">
                        {person.displayName}
                      </Link>
                    ) : (
                      person.displayName
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {[person.designationName, person.departmentName].filter(Boolean).join(" · ") || person.employeeCode}
                  </p>
                  {person.workEmail && (
                    <a href={`mailto:${person.workEmail}`} className="flex items-center gap-1.5 truncate text-primary hover:underline">
                      <Mail className="size-3.5 shrink-0" />
                      {person.workEmail}
                    </a>
                  )}
                  {person.phone && (
                    <a href={`tel:${person.phone}`} className="flex items-center gap-1.5 hover:underline">
                      <Phone className="size-3.5 shrink-0" />
                      {person.phone}
                    </a>
                  )}
                  {person.managerName && <p className="text-xs text-muted-foreground">Reports to {person.managerName}</p>}
                  {person.status === "on_notice" && <Badge variant="warning">On notice</Badge>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
