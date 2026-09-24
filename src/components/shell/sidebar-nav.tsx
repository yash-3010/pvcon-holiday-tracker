"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Permission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { isActivePath, visibleNav } from "./nav";

export function SidebarNav({ permissions, onNavigate }: { permissions: Permission[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = visibleNav(permissions);
  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 px-5 py-4">
        <Image src="/brand/pvcon-logo-only.png" alt="" width={30} height={30} className="dark:hidden" />
        <Image src="/brand/pvcon-logo-inverted.png" alt="" width={30} height={30} className="hidden dark:block" />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-primary">PVCON People</p>
          <p className="text-xs text-muted-foreground">HR · Time · Payroll</p>
        </div>
      </Link>
      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group.title}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-sidebar-active text-sidebar-active-foreground"
                          : "text-sidebar-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <item.icon className="size-4" />
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
