import Image from "next/image";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { NavLink } from "@/components/NavLink";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  const employeeNav = [
    { href: "/", label: "Dashboard" },
    { href: "/leaves", label: "My Leaves" },
    { href: "/holidays", label: "Holidays" },
  ];
  const adminNav = [
    { href: "/", label: "Overview" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/holidays", label: "Holidays" },
    { href: "/admin/policy", label: "Policy" },
  ];
  const nav = isAdmin ? adminNav : employeeNav;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/brand/pvcon-logo-only.png" alt="PVCON" width={28} height={28} />
            <div className="leading-tight">
              <div className="text-sm font-semibold text-[var(--primary)]">PVCON</div>
              <div className="text-[11px] text-[var(--muted-foreground)] -mt-0.5">Holiday Tracker</div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {nav.map((n) => <NavLink key={n.href} href={n.href}>{n.label}</NavLink>)}
            <span className="mx-2 h-5 w-px bg-[var(--border)]" />
            <Link href="/profile" className="rounded-md px-3 py-1.5 text-[var(--foreground-soft)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
              {session?.user?.name}
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button type="submit" className="rounded-md px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      <footer className="border-t border-[var(--border)] bg-white py-4 text-center text-xs text-[var(--muted-foreground)]">
        PVCON Consulting © {new Date().getFullYear()}
      </footer>
    </div>
  );
}
