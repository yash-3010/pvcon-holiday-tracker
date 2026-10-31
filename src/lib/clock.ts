/**
 * One day's work clock from its punches (roadmap refinement 84): where the person stands now, how long they have
 * worked and how long they have been on breaks. A break is an `out` punch marked `startsBreak`; the next `in` resumes.
 * Pure, so the server and the live clock in the browser agree.
 */

export type ClockStateName = "idle" | "working" | "break" | "done";

export interface ClockPunch {
  /** UTC instant (ISO). */
  at: string;
  direction: "in" | "out";
  /** An `out` that starts a break rather than ending the day. */
  startsBreak: boolean;
}

export interface DayClock {
  state: ClockStateName;
  /** Worked seconds up to now; an open session counts. */
  workedSeconds: number;
  /** Seconds on break up to now; an open break counts. */
  breakSeconds: number;
  /** When the current working session started (working only). */
  sessionStartedAt: string | null;
  /** When the current break started (break only). */
  breakStartedAt: string | null;
  firstInAt: string | null;
  /** The last clock-out, once the day is done. */
  endedAt: string | null;
}

const seconds = (fromMs: number, toMs: number) => Math.max(0, Math.floor((toMs - fromMs) / 1000));

/** A second `in` while one is open and an `out` with nothing open are ignored, as attendance pairs punches. */
export function dayClock(punches: readonly ClockPunch[], now: Date): DayClock {
  const sorted = [...punches].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let open: ClockPunch | null = null;
  let breakFrom: ClockPunch | null = null;
  let lastOut: ClockPunch | null = null;
  let firstIn: ClockPunch | null = null;
  let worked = 0;
  let onBreak = 0;
  for (const punch of sorted) {
    if (punch.direction === "in" && !open) {
      if (breakFrom) onBreak += seconds(Date.parse(breakFrom.at), Date.parse(punch.at));
      breakFrom = null;
      open = punch;
      firstIn ??= punch;
    } else if (punch.direction === "out" && open) {
      worked += seconds(Date.parse(open.at), Date.parse(punch.at));
      open = null;
      breakFrom = punch.startsBreak ? punch : null;
      lastOut = punch;
    }
  }
  const nowMs = now.getTime();
  if (open) worked += seconds(Date.parse(open.at), nowMs);
  if (breakFrom) onBreak += seconds(Date.parse(breakFrom.at), nowMs);
  const state: ClockStateName = open ? "working" : breakFrom ? "break" : firstIn ? "done" : "idle";
  return {
    state,
    workedSeconds: worked,
    breakSeconds: onBreak,
    sessionStartedAt: open ? open.at : null,
    breakStartedAt: breakFrom ? breakFrom.at : null,
    firstInAt: firstIn ? firstIn.at : null,
    endedAt: state === "done" && lastOut ? lastOut.at : null,
  };
}

/** A running clock's reading, e.g. 3:12:45. */
export function formatStopwatch(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** The reading a tab title starts with while the clock runs ("3:12:45 · " or "Break 0:12:03 · "). */
const TITLE_READING = /^(?:Break )?\d+:\d{2}:\d{2} · /;

/** A page's tab title with the clock's reading in front while it runs, and without it otherwise. */
export function clockTabTitle(title: string, state: ClockStateName, seconds: number): string {
  const page = title.replace(TITLE_READING, "");
  if (state === "working") return `${formatStopwatch(seconds)} · ${page}`;
  if (state === "break") return `Break ${formatStopwatch(seconds)} · ${page}`;
  return page;
}
