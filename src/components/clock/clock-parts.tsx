"use client";

import { useState } from "react";
import { ArrowRightLeft, Coffee, LogIn, LogOut, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { WORK_MODES, WORK_MODE_LABELS, type WorkMode } from "@/lib/attendance";
import { formatStopwatch, type ClockStateName } from "@/lib/clock";
import { cn } from "@/lib/utils";
import type { ClockContextValue, WorkSelectionInput } from "./clock-provider";

/** Colour coding shared by the top bar, the dashboard and the pop-out: green working, amber on a break. */
export const STATE_STYLE: Record<ClockStateName, { label: string; pill: string; dot: string }> = {
  idle: { label: "Not clocked in", pill: "border-input bg-card text-foreground", dot: "bg-muted-foreground" },
  working: { label: "Working", pill: "border-success/40 bg-success/15 text-success", dot: "bg-success" },
  break: { label: "On a break", pill: "border-warning/40 bg-warning/15 text-warning", dot: "bg-warning" },
  done: { label: "Done for today", pill: "border-input bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

export function StateDot({ state, className }: { state: ClockStateName; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2.5 shrink-0", className)} aria-hidden>
      {state === "working" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
      <span className={cn("relative inline-flex size-2.5 rounded-full", STATE_STYLE[state].dot)} />
    </span>
  );
}

/** The running number: worked today while working or done, the break so far while on a break. */
export function clockReading(clock: ClockContextValue): string {
  return formatStopwatch(clock.snapshot.state === "break" ? clock.onBreak : clock.worked);
}

/** Spoken summary for buttons whose visible text is the ticking time. */
export function clockSummary(clock: ClockContextValue): string {
  const minutes = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    return `${Math.floor(m / 60)} hours ${m % 60} minutes`;
  };
  const { state, logging } = clock.snapshot;
  if (state === "working") return `Working, ${minutes(clock.worked)} today${logging ? `, on ${logging.label}` : ""}`;
  if (state === "break") return `On a break for ${minutes(clock.onBreak)}, ${minutes(clock.worked)} worked today`;
  if (state === "done") return `Done for today, ${minutes(clock.worked)} worked`;
  return "Not clocked in";
}

/** The main actions for the clock's state. `compact` shows icons only (labels stay for screen readers). */
export function ClockActions({
  clock, compact = false, size = "sm", startWith, nextOnly = false,
}: {
  clock: ClockContextValue;
  compact?: boolean;
  size?: "sm" | "default" | "lg";
  /** Clock-in choices when the caller shows a picker; otherwise the last mode and task. */
  startWith?: { workMode: WorkMode; selection: WorkSelectionInput | null };
  /** Only the next step (clock in, take a break or resume), for a phone's top bar. */
  nextOnly?: boolean;
}) {
  const { snapshot, pending } = clock;
  const label = (text: string) => (compact ? <span className="sr-only">{text}</span> : text);
  const iconSize = compact ? "icon" : size;
  if (snapshot.state === "idle" || snapshot.state === "done") {
    return (
      <Button
        size={iconSize}
        variant={snapshot.state === "done" ? "outline" : "default"}
        disabled={pending}
        title={compact ? "Clock in" : undefined}
        onClick={() => clock.start(startWith?.workMode ?? snapshot.workMode, startWith?.selection ?? null)}
      >
        {pending ? <Spinner /> : <LogIn />}
        {label(snapshot.state === "done" ? "Clock in again" : "Clock in")}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {snapshot.state === "working" ? (
        <Button size={iconSize} variant="outline" disabled={pending} title={compact ? "Take a break" : undefined} onClick={clock.takeBreak}>
          {pending ? <Spinner /> : <Coffee />}
          {label("Take a break")}
        </Button>
      ) : (
        <Button size={iconSize} disabled={pending} title={compact ? "Resume" : undefined} onClick={clock.resume}>
          {pending ? <Spinner /> : <Play />}
          {label("Resume")}
        </Button>
      )}
      {!nextOnly && (
        <Button size={iconSize} variant="outline" disabled={pending} title={compact ? "Clock out" : undefined} onClick={clock.end}>
          <LogOut />
          {label("Clock out")}
        </Button>
      )}
    </div>
  );
}

/** Project, task and note for the clock: what clocking in logs to, or what to switch to. */
export function WorkPicker({
  clock, idPrefix, value, onChange,
}: {
  clock: ClockContextValue;
  idPrefix: string;
  value: WorkSelectionInput | null;
  onChange: (value: WorkSelectionInput | null) => void;
}) {
  const { projects, categories } = clock.snapshot;
  const set = (patch: Partial<WorkSelectionInput>) => {
    const next = { projectId: value?.projectId ?? 0, taskCategoryId: value?.taskCategoryId ?? 0, notes: value?.notes ?? null, ...patch };
    onChange(next.projectId && next.taskCategoryId ? next : { ...next });
  };
  if (projects.length === 0) return <p className="text-sm text-muted-foreground">You&apos;re not on any project yet, so the clock tracks attendance only.</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor={`${idPrefix}-project`}>
        Project
        <NativeSelect id={`${idPrefix}-project`} value={value?.projectId ?? ""} onChange={(e) => set({ projectId: Number(e.target.value) })}>
          <option value="">Choose…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor={`${idPrefix}-task`}>
        Task
        <NativeSelect id={`${idPrefix}-task`} value={value?.taskCategoryId ?? ""} onChange={(e) => set({ taskCategoryId: Number(e.target.value) })}>
          <option value="">Choose…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2" htmlFor={`${idPrefix}-note`}>
        Note (optional)
        <Input
          id={`${idPrefix}-note`}
          value={value?.notes ?? ""}
          maxLength={300}
          placeholder="What are you working on?"
          onChange={(e) => set({ notes: e.target.value || null })}
        />
      </label>
    </div>
  );
}

/** The picker plus its button: Switch while working, or set what's next otherwise. */
export function SwitchTask({ clock, idPrefix }: { clock: ClockContextValue; idPrefix: string }) {
  const { snapshot } = clock;
  const current = snapshot.logging ?? snapshot.selection;
  const [value, setValue] = useState<WorkSelectionInput | null>(
    current ? { projectId: current.projectId, taskCategoryId: current.taskCategoryId, notes: current.notes } : null,
  );
  const ready = !!value?.projectId && !!value.taskCategoryId;
  const same =
    !!current && ready && value!.projectId === current.projectId && value!.taskCategoryId === current.taskCategoryId && (value!.notes ?? null) === (current.notes ?? null);
  if (snapshot.projects.length === 0) return <WorkPicker clock={clock} idPrefix={idPrefix} value={null} onChange={() => undefined} />;
  return (
    <div className="space-y-2">
      <WorkPicker clock={clock} idPrefix={idPrefix} value={value} onChange={setValue} />
      <Button size="sm" variant="outline" disabled={!ready || same || clock.pending} onClick={() => value && clock.switchTo(value)}>
        <ArrowRightLeft />
        {snapshot.state === "working" ? "Switch task" : "Use this next"}
      </Button>
    </div>
  );
}

/** Office or remote, for clocking in. */
export function WorkModeToggle({ value, onChange, idPrefix }: { value: WorkMode; onChange: (mode: WorkMode) => void; idPrefix: string }) {
  return (
    <div role="radiogroup" aria-label="Work mode" className="inline-flex rounded-md border bg-card p-0.5">
      {WORK_MODES.map((mode) => (
        <button
          key={mode}
          id={`${idPrefix}-${mode}`}
          type="button"
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            "rounded px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {WORK_MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}
