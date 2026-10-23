"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Plus, Save, Send, Square, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useServerAction } from "@/components/forms/use-server-action";
import { parseHours, WeekGrid, type GridRow } from "@/components/timesheets/week-grid";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime, formatMinutes, type ISODate } from "@/lib/dates";
import { formatHours } from "@/lib/timesheets";
import type { WeekDetail } from "@/server/modules/timesheets/queries";
import {
  discardTimerAction, saveWeekAction, startTimerAction, stopTimerAction, submitWeekAction, withdrawWeekAction,
} from "../actions";

type Options = WeekDetail["options"];

function TimerBar({
  timer, options, canStart, dirty, timeZone, renderedAt,
}: {
  timer: WeekDetail["timer"];
  options: Options;
  canStart: boolean;
  dirty: boolean;
  timeZone: string;
  renderedAt: number;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [notes, setNotes] = useState("");
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    if (!timer) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [timer]);
  const refresh = () => router.refresh();
  const start = useServerAction(startTimerAction, { successMessage: "Timer started", onSuccess: refresh });
  const stop = useServerAction(stopTimerAction, {
    successMessage: (d) => (d.minutes ? `Added ${formatHours(d.minutes)} h` : "Under 8 minutes: nothing added"),
    onSuccess: refresh,
  });
  const discard = useServerAction(discardTimerAction, { successMessage: "Timer discarded", onSuccess: refresh });

  if (timer) {
    const since = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(timer.startedAt));
    const elapsed = Math.max(0, Math.floor((now - Date.parse(timer.startedAt)) / 60_000));
    return (
      <Card data-testid="timer">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="text-sm">
            <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-destructive" aria-hidden />
            Timing <span className="font-medium">{timer.projectCode}</span> · {timer.categoryName} since {since}
            <span className="ml-2 font-medium tabular-nums">{formatMinutes(elapsed)}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={discard.pending} onClick={() => discard.run({})}>
              <Trash2 /> Discard
            </Button>
            <Button size="sm" disabled={stop.pending || dirty} title={dirty ? "Save your changes first" : undefined} onClick={() => stop.run({})}>
              {stop.pending ? <Spinner /> : <Square />} Stop
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!canStart) return null;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 p-4">
        <NativeSelect aria-label="Timer project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-56">
          <option value="">Project…</option>
          {options.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Timer task" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-44">
          <option value="">Task…</option>
          {options.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <Input aria-label="Timer note" placeholder="What are you working on?" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-64" maxLength={300} />
        <Button
          variant="outline"
          disabled={!projectId || !categoryId || start.pending}
          onClick={() => start.run({ projectId: Number(projectId), taskCategoryId: Number(categoryId), notes: notes || null })}
        >
          {start.pending ? <Spinner /> : <Play />} Start timer
        </Button>
      </CardContent>
    </Card>
  );
}

const toGridRow = (r: WeekDetail["rows"][number]): GridRow => ({
  key: `${r.projectId}:${r.taskCategoryId}`,
  projectCode: r.projectCode, projectName: r.projectName, clientName: r.clientName, categoryName: r.categoryName,
  billable: r.billable, notes: r.notes,
  hours: Object.fromEntries(Object.entries(r.minutes).map(([d, m]) => [d, formatHours(m)])),
});

export function WeekEditor({
  detail, today, isCurrentWeek, timeZone, renderedAt,
}: {
  detail: WeekDetail;
  today: ISODate;
  isCurrentWeek: boolean;
  timeZone: string;
  renderedAt: number;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<GridRow[]>(() => detail.rows.map(toGridRow));
  const [dirty, setDirty] = useState(false);
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
      <TimerBar
        timer={detail.timer}
        options={detail.options}
        canStart={editable && isCurrentWeek}
        dirty={dirty}
        timeZone={timeZone}
        renderedAt={renderedAt}
      />
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
