"use client";

import type { CSSProperties } from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

/** A status colour on its own tint, over the popover surface (the toast is opaque). */
const tint = (token: string, percent: number) => `color-mix(in oklab, var(${token}) ${percent}%, var(--popover))`;

/**
 * Sonner's rich colours miss WCAG AA (its success green is 4.25:1), so toasts use the app's status tokens, which are
 * tuned for text on their own tint in both themes.
 */
const STATUS_COLOURS = Object.fromEntries(
  (
    [
      ["success", "--success"],
      ["info", "--info"],
      ["warning", "--warning"],
      ["error", "--destructive"],
    ] as const
  ).flatMap(([type, token]) => [
    [`--${type}-bg`, tint(token, 15)],
    [`--${type}-border`, tint(token, 40)],
    [`--${type}-text`, `var(${token})`],
  ]),
) as CSSProperties;

export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      richColors
      closeButton
      position="top-right"
      style={STATUS_COLOURS}
    />
  );
}
