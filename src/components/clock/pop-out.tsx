"use client";

import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { formatStopwatch } from "@/lib/clock";
import { STATE_STYLE, ClockActions, StateDot, clockReading } from "./clock-parts";
import { useClock } from "./clock-provider";

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}
declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

const noSubscribe = () => () => {};
/** Chrome and Edge on desktop can keep a small window above every other app (Document Picture-in-Picture). */
export function usePopOutSupported(): boolean {
  return useSyncExternalStore(noSubscribe, () => "documentPictureInPicture" in window, () => false);
}

function copyStyles(target: Document) {
  for (const sheet of [...document.styleSheets]) {
    try {
      const style = target.createElement("style");
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      target.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.head.appendChild(link);
      }
    }
  }
  target.documentElement.className = document.documentElement.className;
  target.title = "PVCON People clock";
}

/** The pop-out's contents: the clock and its main actions, nothing else. */
function MiniClock() {
  const clock = useClock();
  if (!clock) return null;
  const { snapshot } = clock;
  return (
    <div className="flex min-h-screen flex-col justify-center gap-2 bg-background p-4 text-foreground">
      <p className="flex items-center gap-2 text-xs font-medium">
        <StateDot state={snapshot.state} />
        {STATE_STYLE[snapshot.state].label}
      </p>
      <p className="text-4xl font-semibold tabular-nums">{clockReading(clock)}</p>
      <p className="truncate text-xs text-muted-foreground">
        {snapshot.state === "working" && snapshot.logging
          ? snapshot.logging.label
          : snapshot.state === "break"
            ? `Worked today ${formatStopwatch(clock.worked)}`
            : "PVCON People"}
      </p>
      <ClockActions clock={clock} />
    </div>
  );
}

interface PopOutControls {
  supported: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const PopOutContext = createContext<PopOutControls | null>(null);

export function usePopOutControls(): PopOutControls | null {
  return useContext(PopOutContext);
}

/** Holds the always-on-top window at the shell, so it stays open while moving between pages. */
export function PopOutProvider({ children }: { children: React.ReactNode }) {
  const supported = usePopOutSupported();
  const [win, setWin] = useState<Window | null>(null);
  const open = async () => {
    if (!window.documentPictureInPicture) return;
    if (win) return win.focus();
    const pip = await window.documentPictureInPicture.requestWindow({ width: 320, height: 190 });
    copyStyles(pip.document);
    pip.addEventListener("pagehide", () => setWin(null));
    setWin(pip);
  };
  const controls: PopOutControls = { supported, isOpen: win !== null, open: () => void open(), close: () => win?.close() };
  return (
    <PopOutContext.Provider value={controls}>
      {children}
      {win && createPortal(<MiniClock />, win.document.body)}
    </PopOutContext.Provider>
  );
}
