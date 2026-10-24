"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { WORK_MODES, WORK_MODE_LABELS, type WorkMode } from "@/lib/attendance";
import { formatMinutes } from "@/lib/dates";
import { clockInAction, clockOutAction } from "@/app/(app)/me/attendance/actions";

export interface ClockCardProps {
  state: "in" | "out";
  /** Local HH:MM of the open session's clock-in. */
  sinceLabel: string | null;
  workMode: WorkMode | null;
  /** Worked today as of `renderedAt`. */
  workedMinutes: number;
  /** Epoch milliseconds when the server read the state; the card ticks from here while clocked in. */
  renderedAt: number;
  shift: { name: string; times: string; auto: boolean };
}

/** Render with `key={renderedAt}` so a refresh restarts the ticking from the new reading. */
export function ClockCard({ state, sinceLabel, workMode, workedMinutes, renderedAt, shift }: ClockCardProps) {
  const router = useRouter();
  const [mode, setMode] = useState<WorkMode>("office");
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    if (state !== "in") return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [state]);
  const worked = workedMinutes + (state === "in" ? Math.max(0, Math.floor((now - renderedAt) / 60_000)) : 0);
  const clockIn = useServerAction(clockInAction, { successMessage: (d) => `Clocked in at ${d.time}`, onSuccess: () => router.refresh() });
  const clockOut = useServerAction(clockOutAction, { successMessage: (d) => `Clocked out at ${d.time}`, onSuccess: () => router.refresh() });
  const pending = clockIn.pending || clockOut.pending;

  return (
    <Card data-testid="clock-card">
      <CardHeader>
        <CardDescription>
          {shift.name} shift · {shift.times}
        </CardDescription>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {state === "in" ? (
            <>
              <Badge variant="success">In since {sinceLabel}</Badge>
              {workMode && <Badge variant="secondary">{WORK_MODE_LABELS[workMode]}</Badge>}
            </>
          ) : (
            <Badge variant="secondary">Not clocked in</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-3xl font-semibold tabular-nums" aria-label="Worked today">
            {formatMinutes(worked)}
          </div>
          <div className="text-xs text-muted-foreground">worked today</div>
        </div>
        {shift.auto && <p className="text-xs text-muted-foreground">Your shift marks you present automatically; clocking in is optional.</p>}
        {state === "in" ? (
          <Button variant="outline" disabled={pending} onClick={() => clockOut.run({})}>
            {pending ? <Spinner /> : <LogOut />}
            Clock out
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <NativeSelect aria-label="Work mode" value={mode} onChange={(e) => setMode(e.target.value as WorkMode)} className="w-32">
              {WORK_MODES.map((m) => (
                <option key={m} value={m}>
                  {WORK_MODE_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
            <Button disabled={pending} onClick={() => clockIn.run({ workMode: mode })}>
              {pending ? <Spinner /> : <LogIn />}
              Clock in
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
