import type { MetadataRoute } from "next";

/** Makes the app installable on phones and desktops (spec §6 "PWA"); no offline data. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PVCON People",
    short_name: "PVCON People",
    description: "HR, attendance, leave and payroll for PVCON Consulting",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#202f63",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press (phone) or right-click (desktop) the installed app's icon to jump straight to the daily tasks.
    shortcuts: [
      { name: "Clock in or out", short_name: "Clock", description: "Today's clock", url: "/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My timesheet", short_name: "Timesheet", url: "/me/timesheets", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Apply for leave", short_name: "Leave", url: "/me/leave", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
