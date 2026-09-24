"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Permission } from "@/lib/auth/permissions";
import { visibleNav } from "./nav";

export const OPEN_COMMAND_PALETTE = "open-command-palette";

const itemClass =
  "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[selected=true]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground";
const groupClass =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

export function CommandPalette({ permissions }: { permissions: Permission[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();

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
            {visibleNav(permissions).map((group) => (
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
