"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/dates";
import { createAnnouncementAction, deleteAnnouncementAction, updateAnnouncementAction } from "./actions";

export interface AnnouncementItem {
  id: number;
  title: string;
  body: string;
  pinned: boolean;
  state: "scheduled" | "live" | "expired";
  publishOn: string;
  showUntil: string | null;
}

const STATE_BADGE = { scheduled: ["info", "Scheduled"], live: ["success", "Live"], expired: ["secondary", "Ended"] } as const;

function AnnouncementSheet({ open, onOpenChange, editing, today }: { open: boolean; onOpenChange: (open: boolean) => void; editing: AnnouncementItem | null; today: string }) {
  const router = useRouter();
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [pinned, setPinned] = useState(editing?.pinned ?? false);
  const [publishOn, setPublishOn] = useState(editing?.publishOn ?? today);
  const [showUntil, setShowUntil] = useState(editing?.showUntil ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => setErrors(r.fieldErrors ?? {});
  const create = useServerAction(createAnnouncementAction, { successMessage: "Announcement posted", onSuccess: done, onError });
  const update = useServerAction(updateAnnouncementAction, { successMessage: "Announcement saved", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit announcement" : "New announcement"}</SheetTitle>
          <SheetDescription>Everyone is notified once, on the day it starts.</SheetDescription>
        </SheetHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            const values = { title, body, pinned, publishOn, showUntil: showUntil || null };
            void (editing ? update.run({ ...values, id: editing.id }) : create.run(values));
          }}
          className="flex flex-1 flex-col gap-4"
        >
          <Field label="Title" htmlFor="ann-title" error={errors.title?.[0]} required>
            <Input id="ann-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="Message" htmlFor="ann-body" error={errors.body?.[0]} required>
            <Textarea id="ann-body" rows={8} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Show from" htmlFor="ann-from" error={errors.publishOn?.[0]} required>
              <Input id="ann-from" type="date" value={publishOn} onChange={(e) => setPublishOn(e.target.value)} required />
            </Field>
            <Field label="Show until" htmlFor="ann-until" error={errors.showUntil?.[0]} hint="Leave empty to keep it up">
              <Input id="ann-until" type="date" value={showUntil} min={publishOn} onChange={(e) => setShowUntil(e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <label htmlFor="ann-pinned" className="text-sm font-medium">
              Pin to the top
            </label>
            <Switch id="ann-pinned" checked={pinned} onCheckedChange={setPinned} />
          </div>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save" : "Post"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function AnnouncementsClient({ items, canManage, today }: { items: AnnouncementItem[]; canManage: boolean; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AnnouncementItem | null>(null);
  const remove = useServerAction(deleteAnnouncementAction, { successMessage: "Announcement deleted", onSuccess: () => router.refresh() });
  const openSheet = (item: AnnouncementItem | null) => {
    setEditing(item);
    setOpen(true);
  };
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => openSheet(null)}>
            <Plus /> New announcement
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState icon={Megaphone} title="No announcements" description="Company news appears here." />
      ) : (
        <div className="space-y-4">
          {items.map((a) => (
            <Card key={a.id} className={a.state === "expired" ? "opacity-70" : undefined}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {a.pinned && <Pin aria-label="Pinned" className="size-4 text-primary" />}
                    {a.title}
                    {canManage && <Badge variant={STATE_BADGE[a.state][0]}>{STATE_BADGE[a.state][1]}</Badge>}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(a.publishOn)}
                    {a.showUntil && ` – ${formatDate(a.showUntil)}`}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${a.title}`} onClick={() => openSheet(a)}>
                      <Pencil />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={`Delete ${a.title}`}>
                          <Trash2 />
                        </Button>
                      }
                      title="Delete this announcement?"
                      description={a.title}
                      confirmLabel="Delete"
                      destructive
                      onConfirm={() => remove.run({ id: a.id })}
                    />
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-sm leading-relaxed">{a.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <AnnouncementSheet key={`${editing?.id ?? "new"}-${open}`} open={open} onOpenChange={setOpen} editing={editing} today={today} />
    </div>
  );
}
