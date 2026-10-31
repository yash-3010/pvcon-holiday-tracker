"use client";

import { useEffect } from "react";
import { formatStopwatch, type ClockStateName } from "@/lib/clock";

const PREFIX = /^(🟢|🟡) [^·]+ · /u;
const DOT = { working: "#16a34a", break: "#d97706" } as const;

/** A tab icon with a coloured dot in the corner, drawn from the app icon. */
async function dottedIcon(color: string): Promise<string> {
  const image = new Image();
  image.src = "/icons/icon-192.png";
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, 64, 64);
  context.beginPath();
  context.arc(46, 46, 16, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
  context.beginPath();
  context.arc(46, 46, 12, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  return canvas.toDataURL("image/png");
}

/** Dotted icons drawn so far, by state; drawn once per page load. */
const drawn: Partial<Record<keyof typeof DOT, string>> = {};
/** The state the tab shows now, so an icon finishing its drawing late doesn't land on the wrong state. */
let showing: ClockStateName = "idle";

/** Points every tab icon at the dotted one, or back at its own (Next can add icon links after the first paint). */
function applyIcon(href: string | null) {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
    if (href) {
      link.dataset.originalHref ??= link.href;
      if (link.href !== href) link.href = href;
    } else if (link.dataset.originalHref) {
      link.href = link.dataset.originalHref;
      delete link.dataset.originalHref;
    }
  }
}

/**
 * While the clock runs, the browser tab says so from any other tab: the title starts with a coloured dot and the time
 * (🟢 3:12:45 working, 🟡 on a break), and the tab icon gets a matching dot.
 */
export function useTabIndicator(state: ClockStateName, seconds: number) {
  const active = state === "working" || state === "break";
  const label = state === "working" ? formatStopwatch(seconds) : `Break ${formatStopwatch(seconds)}`;

  // Each tick puts the prefix back in front of the page's own title (Next sets it on navigation) and the icon in place.
  useEffect(() => {
    showing = state;
    const base = document.title.replace(PREFIX, "");
    document.title = active ? `${state === "working" ? "🟢" : "🟡"} ${label} · ${base}` : base;
    applyIcon(active ? (drawn[state as keyof typeof DOT] ?? null) : null);
  }, [active, state, label]);

  useEffect(() => {
    if (!active || drawn[state as keyof typeof DOT]) return;
    const key = state as keyof typeof DOT;
    dottedIcon(DOT[key]).then(
      (href) => {
        drawn[key] = href;
        if (showing === key) applyIcon(href);
      },
      () => undefined,
    );
  }, [active, state]);

  // Leaving the app's pages (signing out) restores the plain icon and title.
  useEffect(() => () => applyIcon(null), []);
}
