"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-[var(--primary-soft)] text-[var(--primary)] font-medium"
          : "text-[var(--foreground-soft)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
      )}
    >
      {children}
    </Link>
  );
}
