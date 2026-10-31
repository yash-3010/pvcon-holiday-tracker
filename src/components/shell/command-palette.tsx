"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { ArrowRightLeft, Coffee, LogIn, LogOut, Monitor, Moon, Play, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useClock } from "@/components/clock/clock-provider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Permission } from "@/lib/auth/permissions";
import { visibleNav } from "./nav";

export const OPEN_COMMAND_PALETTE = "open-command-palette";

const itemClass =
  "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[selected=true]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground";
const groupClass =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

export function CommandPalette({ permissions, hasEmployee }: { permissions: Permission[]; hasEmployee: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();
  const clock = useClock();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE, onOpen);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const theme = (value: string) => {
    setOpen(false);
    setTheme(value);
  };
  const act = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const state = clock?.snapshot.state;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showClose={false} className="overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command loop className="flex flex-col">
          <Command.Input
            placeholder="Search pages and actions…"
            className="h-12 border-b bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">No results.</Command.Empty>
            {clock && (
              <Command.Group heading="Clock" className={groupClass}>
                {(state === "idle" || state === "done") && (
                  <Command.Item value="clock in start work" onSelect={() => act(() => clock.start(clock.snapshot.workMode, null))} className={itemClass}>
                    <LogIn /> Clock in{clock.snapshot.selection ? ` · ${clock.snapshot.selection.label}` : ""}
                  </Command.Item>
                )}
                {state === "working" && (
                  <Command.Item value="clock take a break pause" onSelect={() => act(clock.takeBreak)} className={itemClass}>
                    <Coffee /> Take a break
                  </Command.Item>
                )}
                {state === "break" && (
                  <Command.Item value="clock resume back" onSelect={() => act(clock.resume)} className={itemClass}>
                    <Play /> Resume
                  </Command.Item>
                )}
                {(state === "working" || state === "break") && (
                  <>
                    <Command.Item value="clock switch task project" onSelect={() => go("/")} className={itemClass}>
                      <ArrowRightLeft /> Switch task
                    </Command.Item>
                    <Command.Item value="clock out stop end day" onSelect={() => act(clock.end)} className={itemClass}>
                      <LogOut /> Clock out
                    </Command.Item>
                  </>
                )}
              </Command.Group>
            )}
            {visibleNav(permissions, { hasEmployee }).map((group) => (
              <Command.Group key={group.title} heading={group.title} className={groupClass}>
                {group.items.map((item) => (
                  <Command.Item key={item.href} value={`${group.title} ${item.title}`} onSelect={() => go(item.href)} className={itemClass}>
                    <item.icon />
                    {item.title}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
            <Command.Group heading="Theme" className={groupClass}>
              <Command.Item value="theme light" onSelect={() => theme("light")} className={itemClass}>
                <Sun /> Light theme
              </Command.Item>
              <Command.Item value="theme dark" onSelect={() => theme("dark")} className={itemClass}>
                <Moon /> Dark theme
              </Command.Item>
              <Command.Item value="theme system" onSelect={() => theme("system")} className={itemClass}>
                <Monitor /> System theme
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
