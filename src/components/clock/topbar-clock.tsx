"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, PictureInPicture2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WORK_MODE_LABELS, type WorkMode } from "@/lib/attendance";
import { formatMinutes } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ClockActions, STATE_STYLE, StateDot, SwitchTask, WorkModeToggle, WorkPicker, clockReading, clockSummary } from "./clock-parts";
import { useClock, type ClockContextValue, type WorkSelectionInput } from "./clock-provider";
import { usePopOutControls } from "./pop-out";

/** A clock time in the company's time zone. */
const hm = (iso: string | null, timeZone: string) =>
  iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso)) : null;

/** What clocking in will use, chosen in the panel before pressing Clock in. */
function StartPanel({ clock }: { clock: ClockContextValue }) {
  const { snapshot } = clock;
  const [mode, setMode] = useState<WorkMode>(snapshot.workMode);
  const [selection, setSelection] = useState<WorkSelectionInput | null>(
    snapshot.selection ? { projectId: snapshot.selection.projectId, taskCategoryId: snapshot.selection.taskCategoryId, notes: snapshot.selection.notes } : null,
  );
  const ready = !selection || (!!selection.projectId && !!selection.taskCategoryId);
  return (
    <div className="space-y-3">
      <WorkModeToggle value={mode} onChange={setMode} idPrefix="topbar-mode" />
      <WorkPicker clock={clock} idPrefix="topbar-start" value={selection} onChange={setSelection} />
      <div className={cn(!ready && "pointer-events-none opacity-50")}>
        <ClockActions clock={clock} startWith={{ workMode: mode, selection: ready ? selection : null }} />
      </div>
    </div>
  );
}

/** The panel behind the top-bar clock: today's figures, the task, and the rest of the actions. */
function ClockPanel({ clock }: { clock: ClockContextValue }) {
  const { snapshot } = clock;
  const popOut = usePopOutControls();
  const fullDay = snapshot.shift.fullDayMinutes * 60;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <StateDot state={snapshot.state} /> {STATE_STYLE[snapshot.state].label}
            {(snapshot.state === "working" || snapshot.state === "break") && (
              <span className="font-normal text-muted-foreground">· {WORK_MODE_LABELS[snapshot.workMode]}</span>
            )}
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{clockReading(clock)}</p>
          <p className="text-xs text-muted-foreground">
            {snapshot.state === "break" ? `on a break · ${formatMinutes(Math.floor(clock.worked / 60))} worked today` : "worked today"}
            {snapshot.firstInAt ? ` · in since ${hm(snapshot.firstInAt, snapshot.timeZone)}` : ""}
            {snapshot.breakSeconds > 0 || snapshot.state === "break" ? ` · breaks ${formatMinutes(Math.floor(clock.onBreak / 60))}` : ""}
          </p>
        </div>
        {popOut?.supported && (
          <Button size="icon" variant="ghost" title="Pop out: keep the clock on top of other windows" onClick={popOut.open}>
            <PictureInPicture2 />
            <span className="sr-only">Pop out the clock</span>
          </Button>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" title={`Full day: ${formatMinutes(snapshot.shift.fullDayMinutes)}`}>
        <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, (clock.worked / fullDay) * 100)}%` }} />
      </div>
      {snapshot.blocked && <p className="rounded-md bg-warning/15 px-2 py-1.5 text-xs text-warning">{snapshot.blocked}</p>}
      {snapshot.state === "idle" || snapshot.state === "done" ? (
        <StartPanel clock={clock} />
      ) : (
        <>
          {snapshot.logging && (
            <p className="text-sm">
              <span className="text-muted-foreground">Logging to </span>
              <span className="font-medium">{snapshot.logging.label}</span>
            </p>
          )}
          <ClockActions clock={clock} />
          <div className="border-t pt-3">
            <SwitchTask clock={clock} idPrefix="topbar-switch" />
          </div>
        </>
      )}
      <p className="text-xs">
        <Link href="/me/timesheets" className="text-primary underline underline-offset-2">
          This week&apos;s timesheet
        </Link>
      </p>
    </div>
  );
}

/** The always-visible clock between search and the bell: the running time, colour-coded, with the main actions. */
export function TopbarClock() {
  const clock = useClock();
  const [open, setOpen] = useState(false);
  if (!clock) return null;
  const { snapshot } = clock;
  const running = snapshot.state === "working" || snapshot.state === "break";
  const idle = snapshot.state === "idle";
  const trigger = idle ? (
    <Button variant="ghost" size="icon" aria-label="Clock options">
      <ChevronDown />
    </Button>
  ) : (
    <button
      type="button"
      aria-label={`${clockSummary(clock)}. Open the clock`}
      className={cn(
        "flex h-9 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-sm font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        STATE_STYLE[snapshot.state].pill,
      )}
    >
      <StateDot state={snapshot.state} />
      <span aria-hidden>
        {snapshot.state === "break" && <span className="hidden sm:inline">Break </span>}
        {clockReading(clock)}
      </span>
      {snapshot.state === "working" && snapshot.logging && (
        <span aria-hidden className="hidden max-w-36 truncate font-normal xl:inline">
          {snapshot.logging.label.split(" · ")[0]}
        </span>
      )}
      <ChevronDown aria-hidden className="hidden size-3.5 opacity-70 sm:inline" />
    </button>
  );
  return (
    <div className={cn("flex items-center gap-1.5", idle && "flex-row-reverse")} data-testid="topbar-clock">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
          <ClockPanel clock={clock} />
        </PopoverContent>
      </Popover>
      {/* One tap for the next step: clock in, take a break or resume. On a phone, clocking out is in the panel. */}
      {(idle || running) && (
        <>
          <div className="sm:hidden">
            <ClockActions clock={clock} compact nextOnly />
          </div>
          <div className="hidden sm:block">
            <ClockActions clock={clock} compact={running} />
          </div>
        </>
      )}
    </div>
  );
}
