"use client";

import { useState } from "react";
import { PictureInPicture2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WORK_MODE_LABELS, type WorkMode } from "@/lib/attendance";
import { formatStopwatch } from "@/lib/clock";
import { formatMinutes } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ClockActions, STATE_STYLE, StateDot, SwitchTask, WorkModeToggle, WorkPicker, clockReading } from "./clock-parts";
import { useClock, type ClockContextValue, type WorkSelectionInput } from "./clock-provider";
import { usePopOutControls } from "./pop-out";

const BORDER = { idle: "border-primary/30", working: "border-success/50", break: "border-warning/50", done: "border-border" } as const;

function time(iso: string | null, timeZone: string): string | null {
  return iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso)) : null;
}

function TodayClockCard({ clock }: { clock: ClockContextValue }) {
  const { snapshot } = clock;
  const popOut = usePopOutControls();
  const [mode, setMode] = useState<WorkMode>(snapshot.workMode);
  const [selection, setSelection] = useState<WorkSelectionInput | null>(
    snapshot.selection ? { projectId: snapshot.selection.projectId, taskCategoryId: snapshot.selection.taskCategoryId, notes: snapshot.selection.notes } : null,
  );
  const startable = !selection || (!!selection.projectId && !!selection.taskCategoryId);
  const running = snapshot.state === "working" || snapshot.state === "break";
  const fullDay = snapshot.shift.fullDayMinutes * 60;
  const toGo = Math.max(0, fullDay - clock.worked);
  const firstIn = time(snapshot.firstInAt, snapshot.timeZone);

  return (
    <Card data-testid="clock-card" className={cn("border-2", BORDER[snapshot.state])}>
      <CardContent className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] lg:items-center">
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <StateDot state={snapshot.state} />
            {STATE_STYLE[snapshot.state].label}
            {running && <span className="font-normal text-muted-foreground">· {WORK_MODE_LABELS[snapshot.workMode]}</span>}
          </p>
          <p className="text-5xl font-semibold tabular-nums tracking-tight" aria-label={snapshot.state === "break" ? "Break so far" : "Worked today"}>
            {clockReading(clock)}
          </p>
          <p className="text-sm text-muted-foreground">
            {snapshot.state === "break"
              ? `on a break · ${formatStopwatch(clock.worked)} worked today`
              : snapshot.state === "idle"
                ? `${snapshot.shift.name} shift · ${snapshot.shift.times}`
                : toGo > 0
                  ? `worked today · ${formatMinutes(Math.ceil(toGo / 60))} to a full day`
                  : "worked today · full day reached"}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
            <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${Math.min(100, (clock.worked / fullDay) * 100)}%` }} />
          </div>
          {snapshot.state !== "idle" && (
            <p className="text-xs text-muted-foreground">
              {firstIn && `In since ${firstIn}`}
              {(snapshot.breakSeconds > 0 || snapshot.state === "break") && ` · breaks ${formatMinutes(Math.floor(clock.onBreak / 60))}`}
              {snapshot.state === "done" && snapshot.endedAt && ` · out at ${time(snapshot.endedAt, snapshot.timeZone)}`}
            </p>
          )}
        </div>

        <div className="space-y-3">
          {running ? (
            <>
              {snapshot.logging ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Logging to </span>
                  <span className="font-medium">{snapshot.logging.label}</span>
                  <span className="text-muted-foreground"> · {formatStopwatch(clock.piece)}</span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">On a break: nothing is being logged. Resume to carry on with your last task.</p>
              )}
              <SwitchTask clock={clock} idPrefix="today-switch" />
            </>
          ) : (
            <>
              <p className="text-sm font-medium">{snapshot.state === "done" ? "Clock in again on" : "What are you working on?"}</p>
              <WorkModeToggle value={mode} onChange={setMode} idPrefix="today-mode" />
              <WorkPicker clock={clock} idPrefix="today-start" value={selection} onChange={setSelection} />
            </>
          )}
          {snapshot.blocked && <Alert variant="warning">{snapshot.blocked}</Alert>}
        </div>

        <div className="flex flex-col items-stretch gap-2 lg:items-end">
          <div className={cn(!startable && "pointer-events-none opacity-50")}>
            <ClockActions clock={clock} size="lg" startWith={{ workMode: mode, selection: startable ? selection : null }} />
          </div>
          {popOut?.supported && (
            <Button variant="ghost" size="sm" onClick={popOut.open} title="Keep the clock on top of other windows">
              <PictureInPicture2 /> Pop out
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** The day's clock, first and full width on the dashboard: the number people check and the buttons they press daily. */
export function TodayClock() {
  const clock = useClock();
  return clock ? <TodayClockCard clock={clock} /> : null;
}
