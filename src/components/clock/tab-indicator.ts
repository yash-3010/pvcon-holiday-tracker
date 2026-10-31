"use client";

import { useEffect } from "react";
import { clockTabTitle, type ClockStateName } from "@/lib/clock";

/** The tab icon while the clock runs: a green record symbol while working, an amber half circle on a break. */
const ICON = { working: "/icons/clock-working.png", break: "/icons/clock-break.png" } as const;

/** Points every tab icon at `href`, or back at its own (Next can add icon links after the first paint). */
function applyIcon(href: string | null) {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
    if (href) {
      link.dataset.originalHref ??= link.getAttribute("href") ?? "";
      link.dataset.originalType ??= link.type;
      if (link.getAttribute("href") !== href) {
        link.type = "image/png";
        link.href = href;
      }
    } else if (link.dataset.originalHref !== undefined) {
      link.href = link.dataset.originalHref;
      link.type = link.dataset.originalType ?? "";
      delete link.dataset.originalHref;
      delete link.dataset.originalType;
    }
  }
}

/**
 * While the clock runs, the browser tab says so from any other tab: its icon becomes the clock's symbol, and its
 * title starts with the time (3:12:45 · Dashboard · PVCON People, or Break 0:12:03 · … on a break).
 */
export function useTabIndicator(state: ClockStateName, seconds: number) {
  const reading = Math.floor(seconds);

  // Each tick puts the reading back in front of the page's own title (Next sets it on navigation) and the icon in place.
  useEffect(() => {
    document.title = clockTabTitle(document.title, state, reading);
    applyIcon(state === "working" || state === "break" ? ICON[state] : null);
  }, [state, reading]);

  // Leaving the app's pages (signing out) restores the plain icon.
  useEffect(() => () => applyIcon(null), []);
}
