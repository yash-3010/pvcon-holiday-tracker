"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { CHECKLIST_KIND_LABELS, CHECKLIST_KINDS, CHECKLIST_OWNER_LABELS, CHECKLIST_OWNERS } from "@/lib/hr";
import { checklistTemplateSchema } from "@/lib/validation/org";
import type { ChecklistTemplateRow } from "@/server/db/schema";
import { archiveChecklistTemplateAction, createChecklistTemplateAction, updateChecklistTemplateAction } from "./actions";

type FormInput = z.input<typeof checklistTemplateSchema>;
type FormOutput = z.output<typeof checklistTemplateSchema>;
const BLANK: FormInput = { kind: "onboarding", name: "", items: [{ label: "", owner: "hr" }], isDefault: false };

function TemplateSheet({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ChecklistTemplateRow | null;
}) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(checklistTemplateSchema),
    values: editing ? { kind: editing.kind, name: editing.name, items: editing.items, isDefault: editing.isDefault } : BLANK,
  });
  const items = useFieldArray({ control: form.control, name: "items" });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createChecklistTemplateAction, { successMessage: "Template created", onSuccess: done, onError });
  const update = useServerAction(updateChecklistTemplateAction, { successMessage: "Template updated", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit checklist template" : "New checklist template"}</SheetTitle>
          <SheetDescription>
            New joiners get the default onboarding template; resignations get the default offboarding one.
          </SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <Field label="Name" htmlFor="tpl-name" error={errors.name?.message} required>
            <Input id="tpl-name" {...form.register("name")} />
          </Field>
          <Field label="Kind" htmlFor="tpl-kind">
            <NativeSelect id="tpl-kind" {...form.register("kind")}>
              {CHECKLIST_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {CHECKLIST_KIND_LABELS[kind]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex items-center gap-2">
            <Controller
              control={form.control}
              name="isDefault"
              render={({ field }) => <Switch id="tpl-default" checked={field.value} onCheckedChange={field.onChange} />}
            />
            <Label htmlFor="tpl-default">Default for this kind</Label>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Items</legend>
            {items.fields.map((item, index) => (
              <div key={item.id} className="flex items-start gap-2">
                <div className="flex-1 space-y-1">
                  <Input aria-label={`Item ${index + 1}`} placeholder="What needs doing" {...form.register(`items.${index}.label`)} />
                  {errors.items?.[index]?.label?.message && (
                    <p className="text-xs text-destructive">{errors.items[index]?.label?.message}</p>
                  )}
                </div>
                <div className="w-32 shrink-0">
                  <NativeSelect aria-label={`Owner of item ${index + 1}`} {...form.register(`items.${index}.owner`)}>
                    {CHECKLIST_OWNERS.map((owner) => (
                      <option key={owner} value={owner}>
                        {CHECKLIST_OWNER_LABELS[owner]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove item ${index + 1}`}
                  disabled={items.fields.length === 1}
                  onClick={() => items.remove(index)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            {errors.items?.message && <p className="text-xs text-destructive">{errors.items.message}</p>}
            <Button type="button" variant="outline" size="sm" onClick={() => items.append({ label: "", owner: "hr" })}>
              <Plus /> Add item
            </Button>
          </fieldset>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save template" : "Create template"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function TemplatesClient({ templates }: { templates: ChecklistTemplateRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistTemplateRow | null>(null);
  const archive = useServerAction(archiveChecklistTemplateAction, {
    successMessage: (d) => (d.archived ? "Template archived" : "Template restored"),
    onSuccess: () => router.refresh(),
  });
  const openSheet = (template: ChecklistTemplateRow | null) => {
    setEditing(template);
    setOpen(true);
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => openSheet(null)}>
          <Plus /> New template
        </Button>
      </div>
      {templates.length === 0 ? (
        <EmptyState title="No checklist templates" description="Create an onboarding template so every new joiner starts from the same list." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <Card key={template.id} className={template.archived ? "opacity-70" : undefined}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  <Badge variant="secondary">{CHECKLIST_KIND_LABELS[template.kind]}</Badge>
                  {template.isDefault && <Badge variant="success">Default</Badge>}
                  {template.archived && <Badge variant="outline">Archived</Badge>}
                </div>
                <CardDescription>{template.items.length} item(s)</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {template.items.map((item, i) => (
                    <li key={i}>
                      {item.label} <span className="text-muted-foreground">· {CHECKLIST_OWNER_LABELS[item.owner]}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
              <CardFooter className="justify-end">
                <Button variant="ghost" size="sm" onClick={() => openSheet(template)}>
                  <Pencil /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={archive.pending}
                  onClick={() => archive.run({ id: template.id, archived: !template.archived })}
                >
                  {template.archived ? <ArchiveRestore /> : <Archive />}
                  {template.archived ? "Restore" : "Archive"}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      <TemplateSheet open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}
