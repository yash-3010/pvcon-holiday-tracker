"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw, Save, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useServerAction } from "@/components/forms/use-server-action";
import { parseHours, WeekGrid, type GridRow } from "@/components/timesheets/week-grid";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime, type ISODate } from "@/lib/dates";
import { formatHours } from "@/lib/timesheets";
import type { WeekDetail } from "@/server/modules/timesheets/queries";
import { saveWeekAction, submitWeekAction, withdrawWeekAction } from "../actions";

/** The clock (top bar) logs time into this grid; while it runs, this says where. */
function ClockNote({ timer, timeZone }: { timer: WeekDetail["timer"]; timeZone: string }) {
  if (!timer) return null;
  const since = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(timer.startedAt));
  return (
    <Alert title={`Your clock is logging to ${timer.projectCode} · ${timer.categoryName}`}>
      Since {since}. Switch task, take a break or clock out from the clock at the top of the page; the time lands here when it stops.
    </Alert>
  );
}

const toGridRow = (r: WeekDetail["rows"][number]): GridRow => ({
  key: `${r.projectId}:${r.taskCategoryId}`,
  projectCode: r.projectCode, projectName: r.projectName, clientName: r.clientName, categoryName: r.categoryName,
  billable: r.billable, notes: r.notes,
  hours: Object.fromEntries(Object.entries(r.minutes).map(([d, m]) => [d, formatHours(m)])),
});

export function WeekEditor({ detail, today, timeZone }: { detail: WeekDetail; today: ISODate; timeZone: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<GridRow[]>(() => detail.rows.map(toGridRow));
  const [dirty, setDirty] = useState(false);
  // The week as this grid last loaded it: saving sends it back, so the clock's newer time is never overwritten.
  const [version, setVersion] = useState(detail.version);
  const behind = detail.version !== version;
  const reload = () => {
    setRows(detail.rows.map(toGridRow));
    setVersion(detail.version);
    setDirty(false);
  };
  // The clock added time (or another tab saved): show it, unless there are unsaved changes to keep.
  const [seen, setSeen] = useState(detail.version);
  if (detail.version !== seen) {
    setSeen(detail.version);
    if (!dirty) {
      setRows(detail.rows.map(toGridRow));
      setVersion(detail.version);
    }
  }
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const editable = detail.editable;
  const projects = new Map(detail.options.projects.map((p) => [p.id, p]));
  const categories = new Map(detail.options.categories.map((c) => [c.id, c]));

  const change = (fn: (rows: GridRow[]) => GridRow[]) => {
    setRows(fn);
    setDirty(true);
  };
  const update = (key: string, patch: (r: GridRow) => GridRow) => change((rs) => rs.map((r) => (r.key === key ? patch(r) : r)));
  const newKey = projectId && categoryId ? `${projectId}:${categoryId}` : "";
  const addRow = () => {
    const p = projects.get(Number(projectId));
    const c = categories.get(Number(categoryId));
    if (!p || !c || rows.some((r) => r.key === newKey)) return;
    change((rs) => [
      ...rs,
      {
        key: newKey, projectCode: p.code, projectName: p.name, clientName: p.clientName, categoryName: c.name,
        billable: p.billableDefault && c.billableDefault, notes: "", hours: {},
      },
    ]);
    setCategoryId("");
  };

  const invalid = rows.some((r) => Object.values(r.hours).some((h) => parseHours(h) === null));
  const input = {
    weekStart: detail.weekStart,
    version,
    rows: rows.map((r) => {
      const [projectIdPart, categoryIdPart] = r.key.split(":");
      return {
        projectId: Number(projectIdPart), taskCategoryId: Number(categoryIdPart), billable: r.billable, notes: r.notes,
        minutes: Object.fromEntries(Object.entries(r.hours).map(([d, h]) => [d, parseHours(h) ?? 0])),
      };
    }),
  };
  const save = useServerAction(saveWeekAction, {
    successMessage: "Timesheet saved",
    onSuccess: (d) => {
      for (const w of d.warnings) toast.warning(w);
      setVersion(d.version);
      setDirty(false);
      router.refresh();
    },
  });
  const submit = useServerAction(submitWeekAction, { successMessage: "Timesheet submitted for approval", onSuccess: () => router.refresh() });
  const withdraw = useServerAction(withdrawWeekAction, { successMessage: "Timesheet withdrawn; you can edit it again", onSuccess: () => router.refresh() });
  const busy = save.pending || submit.pending || withdraw.pending;

  return (
    <div className="space-y-4">
      {detail.status === "rejected" && detail.decision && (
        <Alert variant="destructive" title={`Returned by ${detail.decision.by ?? "your manager"}`}>
          {detail.decision.note}
        </Alert>
      )}
      {detail.status === "submitted" && (
        <Alert title="Waiting for approval">
          Submitted {detail.submittedAt ? formatDateTime(detail.submittedAt, timeZone) : ""}. Withdraw it to make changes.
        </Alert>
      )}
      {detail.status === "approved" && detail.decision && (
        <Alert variant="success" title={`Approved by ${detail.decision.by ?? "your manager"}`}>
          {detail.decision.note ?? formatDateTime(detail.decision.at, timeZone)}
        </Alert>
      )}
      {behind && dirty && (
        <Alert variant="warning" title="This week changed while you were editing">
          <p>Your clock added time (or you saved in another tab). Saving now would undo that, so reload the week and make your changes again.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={reload}>
            <RotateCcw /> Reload the week
          </Button>
        </Alert>
      )}
      <ClockNote timer={detail.timer} timeZone={timeZone} />
      <WeekGrid
        days={detail.days}
        rows={rows}
        today={today}
        editable={editable}
        onHours={(key, date, value) => update(key, (r) => ({ ...r, hours: { ...r.hours, [date]: value } }))}
        onBillable={(key, billable) => update(key, (r) => ({ ...r, billable }))}
        onNotes={(key, notes) => update(key, (r) => ({ ...r, notes }))}
        onRemove={(key) => change((rs) => rs.filter((r) => r.key !== key))}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-56">
              <option value="">Project…</option>
              {detail.options.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Task" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-44">
              <option value="">Task…</option>
              {detail.options.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" onClick={addRow} disabled={!newKey || rows.some((r) => r.key === newKey)}>
              <Plus /> Add row
            </Button>
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {detail.status === "submitted" && detail.timesheetId !== null && (
            <Button variant="outline" disabled={busy} onClick={() => withdraw.run({ timesheetId: detail.timesheetId! })}>
              {withdraw.pending ? <Spinner /> : <Undo2 />} Withdraw
            </Button>
          )}
          {editable && (
            <>
              <Button variant="outline" disabled={busy || invalid || !dirty} onClick={() => save.run(input)}>
                {save.pending ? <Spinner /> : <Save />} Save
              </Button>
              <Button disabled={busy || invalid} onClick={() => submit.run(input)}>
                {submit.pending ? <Spinner /> : <Send />} Submit
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
