"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { endWorkAction, resumeWorkAction, startWorkAction, switchTaskAction, takeBreakAction } from "@/app/(app)/actions";
import { useServerAction } from "@/components/forms/use-server-action";
import type { WorkMode } from "@/lib/attendance";
import { formatHours } from "@/lib/timesheets";
import type { ClockSnapshot } from "@/server/modules/clock/queries";
import { useTabIndicator } from "./tab-indicator";
import { getServerTick, getTick, subscribeNothing, subscribeTick } from "./tick";

export interface WorkSelectionInput {
  projectId: number;
  taskCategoryId: number;
  notes: string | null;
}

export interface ClockContextValue {
  snapshot: ClockSnapshot;
  /** Live seconds, counted on from the snapshot. */
  worked: number;
  onBreak: number;
  /** The piece being logged to the current task. */
  piece: number;
  pending: boolean;
  start: (workMode: WorkMode, selection: WorkSelectionInput | null) => void;
  takeBreak: () => void;
  resume: () => void;
  switchTo: (selection: WorkSelectionInput) => void;
  end: () => void;
}

const ClockContext = createContext<ClockContextValue | null>(null);

/** The work clock for the signed-in employee, or null for a login without an employee record. */
export function useClock(): ClockContextValue | null {
  return useContext(ClockContext);
}

const CHANNEL = "pvcon-clock";
const REFRESH_MS = 5 * 60_000;

type Base = { snapshot: ClockSnapshot; clientAt: number | null };
type ClockReply = { snapshot: ClockSnapshot; notices: string[]; added: { minutes: number; date: string } | null; time: string };

/**
 * Holds the clock for the top bar, the dashboard, the tab title and the pop-out. It counts on locally between
 * readings, takes the clock as it stands from every action's reply, and catches up when another tab or device changed
 * it (a broadcast from this browser's other tabs, the tab coming back into view, and every five minutes).
 */
export function ClockProvider({ initial, children }: { initial: ClockSnapshot; children: React.ReactNode }) {
  const router = useRouter();
  const [base, setBase] = useState<Base>({ snapshot: initial, clientAt: null });
  // This tab's end of the channel: what it posts reaches the other tabs only, not itself.
  const channelRef = useRef<BroadcastChannel | null>(null);
  const { snapshot } = base;
  const running = snapshot.state === "working" || snapshot.state === "break";
  const tick = useSyncExternalStore(running ? subscribeTick : subscribeNothing, getTick, getServerTick);
  const elapsed = base.clientAt !== null && tick > 0 ? Math.max(0, (tick - base.clientAt) / 1000) : 0;
  const worked = snapshot.workedSeconds + (snapshot.state === "working" ? elapsed : 0);
  const onBreak = snapshot.breakSeconds + (snapshot.state === "break" ? elapsed : 0);
  const piece = snapshot.logging ? Math.max(0, (snapshot.readAt - Date.parse(snapshot.logging.startedAt)) / 1000) + elapsed : 0;
  useTabIndicator(snapshot.state, snapshot.state === "break" ? onBreak : worked);

  useEffect(() => {
    // The server's reading arrived with the page: count on from now.
    const adopt = setTimeout(() => setBase((b) => (b.clientAt === null ? { ...b, clientAt: Date.now() } : b)), 0);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    channelRef.current = channel;
    const catchUp = async () => {
      const response = await fetch("/api/me/clock", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const fresh = (await response.json()) as ClockSnapshot;
      setBase((b) => (fresh.readAt >= b.snapshot.readAt ? { snapshot: fresh, clientAt: Date.now() } : b));
    };
    const onVisible = () => document.visibilityState === "visible" && void catchUp();
    if (channel) channel.onmessage = () => void catchUp();
    document.addEventListener("visibilitychange", onVisible);
    const every = setInterval(() => void catchUp(), REFRESH_MS);
    return () => {
      clearTimeout(adopt);
      channel?.close();
      channelRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(every);
    };
  }, []);

  const applied = (data: ClockReply) => {
    setBase({ snapshot: data.snapshot, clientAt: Date.now() });
    for (const notice of data.notices) toast.warning(notice);
    channelRef.current?.postMessage("changed");
    router.refresh();
  };
  const added = (data: ClockReply) => (data.added?.minutes ? ` · ${formatHours(data.added.minutes)} h added to your timesheet` : "");
  const startAction = useServerAction(startWorkAction, {
    successMessage: (d) => `Clocked in at ${d.time}${d.snapshot.logging ? ` · ${d.snapshot.logging.label}` : ""}`,
    onSuccess: applied,
  });
  const breakAction = useServerAction(takeBreakAction, { successMessage: (d) => `On a break since ${d.time}${added(d)}`, onSuccess: applied });
  const resumeAction = useServerAction(resumeWorkAction, { successMessage: (d) => `Back at ${d.time}`, onSuccess: applied });
  const switchAction = useServerAction(switchTaskAction, {
    successMessage: (d) => `${d.logging ? "Now logging to" : "Next you'll log to"} ${d.snapshot.selection?.label ?? "that task"}${added(d)}`,
    onSuccess: applied,
  });
  const endAction = useServerAction(endWorkAction, { successMessage: (d) => `Clocked out at ${d.time}${added(d)}`, onSuccess: applied });

  const value: ClockContextValue = {
    snapshot,
    worked,
    onBreak,
    piece,
    pending: startAction.pending || breakAction.pending || resumeAction.pending || switchAction.pending || endAction.pending,
    start: (workMode, selection) => void startAction.run({ workMode, selection }),
    takeBreak: () => void breakAction.run({}),
    resume: () => void resumeAction.run({}),
    switchTo: (selection) => void switchAction.run(selection),
    end: () => void endAction.run({}),
  };
  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}
