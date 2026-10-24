"use client";

import { useRouter } from "next/navigation";
import { toggleChecklistItemAction } from "@/app/(app)/org/employees/actions";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CHECKLIST_KIND_LABELS, CHECKLIST_OWNER_LABELS, type ChecklistItemState, type ChecklistKind } from "@/lib/hr";
import { cn } from "@/lib/utils";

export interface ChecklistView {
  id: number;
  name: string;
  kind: ChecklistKind;
  status: "open" | "completed" | "cancelled";
  items: ChecklistItemState[];
}

const STATUS = {
  open: { label: "In progress", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
} as const;

export function ChecklistCard({ checklist, canTick }: { checklist: ChecklistView; canTick: boolean }) {
  const router = useRouter();
  const { run, pending } = useServerAction(toggleChecklistItemAction, { onSuccess: () => router.refresh() });
  const done = checklist.items.filter((item) => item.doneAt !== null).length;
  const status = STATUS[checklist.status];
  const disabled = !canTick || pending || checklist.status === "cancelled";
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{checklist.name}</CardTitle>
          <CardDescription>
            {CHECKLIST_KIND_LABELS[checklist.kind]} · {done} of {checklist.items.length} done
          </CardDescription>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {checklist.items.map((item, index) => {
          const id = `checklist-${checklist.id}-${index}`;
          return (
            <div key={id} className="flex items-start gap-3">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={item.doneAt !== null}
                disabled={disabled}
                onCheckedChange={(checked) => run({ checklistId: checklist.id, index, done: checked === true })}
              />
              <div className="min-w-0 flex-1">
                <Label htmlFor={id} className={cn("leading-snug", item.doneAt && "text-muted-foreground line-through")}>
                  {item.label}
                </Label>
                {item.doneByName && <p className="text-xs text-muted-foreground">Done by {item.doneByName}</p>}
              </div>
              <Badge variant="outline">{CHECKLIST_OWNER_LABELS[item.owner]}</Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
