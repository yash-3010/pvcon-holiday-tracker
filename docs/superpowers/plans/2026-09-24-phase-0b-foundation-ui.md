# Phase 0B — Foundation UI, Auth & Admin Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy holiday-tracker UI with the new PVCON People shell. This phase builds:
- the design system and dark mode;
- Auth.js wiring with DB-verified sessions and the Next 16 `proxy.ts`;
- login, forced password change, forgot/reset password;
- the sidebar shell with command palette and notifications;
- admin settings: company/locale/logo, security, users & roles, audit log, jobs;
- cron/health/file routes, and Playwright e2e for the auth flows.

**Architecture:**
- Pages are Server Components. They call `requireUser()` / `requirePermission()` (DB-backed) and read via services.
- Client components call server actions created with `defineAction` (wrapping `executeAction` from 0A).
- Forms use react-hook-form + zod schemas from `src/lib/validation`.
- `src/proxy.ts` only redirects anonymous users. Authorization always happens server-side.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, radix-ui, cva, @tanstack/react-table v8, react-hook-form, sonner, cmdk, next-themes, Auth.js v5, Playwright.

**Prerequisite:** Phase 0A complete (all its services and tests exist). Use the exact names listed in 0A's "Self-review notes".

**Build note:** Task 4 deletes the legacy UI. `npm run build` is expected to succeed again from the end of Task 6 onward. Unit tests stay green throughout.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/public-paths.ts` | Paths reachable without a session |
| `src/components/shell/nav.ts` | Navigation config + permission filtering |
| `src/app/globals.css` | Design tokens (light/dark), Tailwind theme |
| `src/components/ui/*` | Primitives: button, input, textarea, label, native-select, checkbox, switch, card, badge, alert, separator, skeleton, spinner, dialog, sheet, dropdown-menu, tabs, tooltip, avatar, table, data-table, page-header, empty-state, field, confirm-dialog, pagination-links, toaster |
| `src/components/theme-provider.tsx` | next-themes provider |
| `src/components/forms/use-server-action.ts` | Client helper: run action, toast, map field errors |
| `src/types/next-auth.d.ts` | Session/JWT augmentation |
| `src/auth.config.ts`, `src/auth.ts` | Auth.js config (edge-safe part / credentials provider) |
| `src/proxy.ts` | Anonymous → `/login` redirect |
| `src/server/auth/session.ts` | `getCurrentUser`, `requireUser`, `requirePermission`, `requireAnyPermission` |
| `src/server/actions/define.ts` | `defineAction` (Next integration of `executeAction`) |
| `src/app/(auth)/*` | Login, change/forgot/reset password pages + actions |
| `src/components/shell/*` | App shell, sidebar, topbar, command palette, bell, menus |
| `src/app/(app)/layout.tsx`, `page.tsx`, `error.tsx` | Authenticated layout + dashboard |
| `src/app/(app)/notifications/*` | Notification inbox |
| `src/app/(app)/settings/**` | Company, security, users, audit, jobs |
| `src/app/api/{cron/[job],health,files/[id]}/route.ts` | Route handlers |
| `playwright.config.ts`, `tests/e2e/auth.spec.ts` | E2E |

---

### Task 1: Lib additions — formatDateTime, public paths, navigation config

**Files:**
- Modify: `src/lib/dates.ts` (append `formatDateTime`)
- Create: `src/lib/public-paths.ts`, `src/components/shell/nav.ts`
- Test: `tests/unit/lib/dates.test.ts` (append), `tests/unit/lib/public-paths.test.ts`, `tests/unit/shell/nav.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/lib/dates.test.ts` (add `formatDateTime` to the import list):

```ts
describe("formatDateTime", () => {
  it("formats instants in the company timezone", () => {
    expect(formatDateTime("2026-09-23T20:00:00.000Z", "Asia/Kolkata")).toMatch(/24 .*2026.*1:30/);
  });
});
```

`tests/unit/lib/public-paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/public-paths";

describe("isPublicPath", () => {
  it("allows auth pages, health, cron, verification and static brand assets", () => {
    for (const p of ["/login", "/forgot-password", "/reset-password/abc", "/api/health", "/api/auth/session", "/api/cron/system:cleanup", "/verify/ABC123", "/brand/pvcon-logo-only.png"]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });
  it("protects everything else", () => {
    for (const p of ["/", "/settings/users", "/loginx", "/api/files/1", "/notifications"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});
```

`tests/unit/shell/nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { isActivePath, visibleNav } from "@/components/shell/nav";

const hrefs = (roles: Parameters<typeof permissionsForRoles>[0]) =>
  visibleNav(permissionsForRoles(roles)).flatMap((g) => g.items.map((i) => i.href));

describe("navigation", () => {
  it("shows employees only the home group", () => {
    expect(visibleNav(permissionsForRoles(["employee"])).map((g) => g.title)).toEqual(["Home"]);
  });
  it("shows HR users & roles but not company settings or jobs", () => {
    const items = hrefs(["hr_admin"]);
    expect(items).toContain("/settings/users");
    expect(items).not.toContain("/settings/company");
    expect(items).not.toContain("/settings/jobs");
  });
  it("shows super admins every settings page", () => {
    expect(hrefs(["super_admin"])).toEqual(
      expect.arrayContaining(["/settings/company", "/settings/users", "/settings/security", "/settings/audit", "/settings/jobs"]),
    );
  });
  it("matches active paths by segment", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/settings/users", "/")).toBe(false);
    expect(isActivePath("/settings/users/5", "/settings/users")).toBe(true);
    expect(isActivePath("/settings/usersx", "/settings/users")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib tests/unit/shell`
Expected: FAIL — `formatDateTime`, `@/lib/public-paths`, `@/components/shell/nav` missing.

- [ ] **Step 3: Implement**

Append to `src/lib/dates.ts`:

```ts
/** Formats an ISO-8601 instant in `timeZone`, e.g. "24 Sept 2026, 1:30 am". */
export function formatDateTime(isoInstant: string, timeZone: string, locale = "en-IN"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(isoInstant),
  );
}
```

`src/lib/public-paths.ts`:

```ts
const PUBLIC_EXACT = new Set(["/login", "/forgot-password", "/api/health", "/favicon.ico"]);
const PUBLIC_PREFIXES = ["/reset-password/", "/verify/", "/api/auth/", "/api/cron/", "/brand/", "/_next/"];

/** Paths that do not require a session. Cron routes authenticate with CRON_SECRET instead. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
```

`src/components/shell/nav.ts`:

```ts
import { Bell, Building2, House, ScrollText, ShieldCheck, Timer, Users, type LucideIcon } from "lucide-react";
import { canAny, type Permission } from "@/lib/auth/permissions";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Visible when the user has any of these permissions; omit for everyone. */
  anyOf?: Permission[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Later phases add groups (My Space, Team, Organization, Time, Leave, Payroll, Reports). */
export const NAV: NavGroup[] = [
  {
    title: "Home",
    items: [
      { title: "Dashboard", href: "/", icon: House },
      { title: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "Company", href: "/settings/company", icon: Building2, anyOf: ["settings.manage"] },
      { title: "Users & roles", href: "/settings/users", icon: Users, anyOf: ["user.manage", "role.assign"] },
      { title: "Security", href: "/settings/security", icon: ShieldCheck, anyOf: ["settings.manage"] },
      { title: "Audit log", href: "/settings/audit", icon: ScrollText, anyOf: ["audit.view"] },
      { title: "Jobs", href: "/settings/jobs", icon: Timer, anyOf: ["job.run"] },
    ],
  },
];

export function visibleNav(permissions: readonly Permission[]): NavGroup[] {
  const holder = { permissions };
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.anyOf || canAny(holder, item.anyOf)),
  })).filter((group) => group.items.length > 0);
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib tests/unit/shell`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib src/components/shell/nav.ts tests/unit
git commit -m "feat(shell): add nav config, public paths and datetime formatting"
```

---

### Task 2: Design tokens and base primitives

**Files:**
- Replace: `src/app/globals.css`
- Create: `src/components/ui/{button,input,textarea,label,native-select,checkbox,switch,card,badge,alert,separator,skeleton,spinner}.tsx`

- [ ] **Step 1: Replace `src/app/globals.css`**

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --background: #f6f7fb;
  --foreground: #161b33;
  --card: #ffffff;
  --card-foreground: #161b33;
  --popover: #ffffff;
  --popover-foreground: #161b33;
  --primary: #202f63;
  --primary-foreground: #ffffff;
  --primary-soft: #eef1f9;
  --secondary: #92b353;
  --secondary-foreground: #ffffff;
  --secondary-soft: #f1f6e6;
  --muted: #f1f3f8;
  --muted-foreground: #5f6780;
  --border: #e3e6ee;
  --input: #d3d8e4;
  --ring: #3b4f99;
  --destructive: #d92d20;
  --destructive-foreground: #ffffff;
  --success: #1f9d55;
  --warning: #b86e00;
  --info: #2563eb;
  --sidebar: #ffffff;
  --sidebar-foreground: #3b4260;
  --sidebar-active: #eef1f9;
  --sidebar-active-foreground: #202f63;
  --radius: 0.625rem;
}

.dark {
  --background: #0c1020;
  --foreground: #e6e9f5;
  --card: #131a30;
  --card-foreground: #e6e9f5;
  --popover: #161d36;
  --popover-foreground: #e6e9f5;
  --primary: #8fa3ec;
  --primary-foreground: #0c1020;
  --primary-soft: #1c2548;
  --secondary: #a6c66a;
  --secondary-foreground: #0c1020;
  --secondary-soft: #1f2a17;
  --muted: #1a2138;
  --muted-foreground: #97a0bd;
  --border: #242d4a;
  --input: #2e3858;
  --ring: #8fa3ec;
  --destructive: #f0605a;
  --destructive-foreground: #0c1020;
  --success: #3fca7f;
  --warning: #f0b43c;
  --info: #6b9cff;
  --sidebar: #0f1528;
  --sidebar-foreground: #b4bcd6;
  --sidebar-active: #1c2548;
  --sidebar-active-foreground: #e6e9f5;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary-soft: var(--primary-soft);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary-soft: var(--secondary-soft);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-info: var(--info);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-active: var(--sidebar-active);
  --color-sidebar-active-foreground: var(--sidebar-active-foreground);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --font-sans: var(--font-jakarta), ui-sans-serif, system-ui, sans-serif;
}

@layer base {
  * {
    @apply border-border;
  }
  html {
    color-scheme: light;
  }
  html.dark {
    color-scheme: dark;
  }
  body {
    @apply bg-background text-foreground antialiased;
    font-family: var(--font-sans);
  }
  ::selection {
    background: var(--primary);
    color: var(--primary-foreground);
  }
}
```

- [ ] **Step 2: Create the primitives**

`src/components/ui/button.tsx`:

```tsx
import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/90",
        outline: "border border-input bg-card hover:bg-muted",
        ghost: "hover:bg-muted",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
```

`src/components/ui/input.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-sm shadow-xs transition-colors",
        "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        "file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props}
    />
  );
}
```

`src/components/ui/textarea.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs transition-colors",
        "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}
```

`src/components/ui/label.tsx`:

```tsx
"use client";

import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-60", className)}
      {...props}
    />
  );
}
```

`src/components/ui/native-select.tsx`:

```tsx
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          "flex h-9 w-full appearance-none rounded-md border border-input bg-card py-1 pl-3 pr-9 text-sm shadow-xs",
          "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
```

`src/components/ui/checkbox.tsx`:

```tsx
"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-input bg-card shadow-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
```

`src/components/ui/switch.tsx`:

```tsx
"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-card shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}
```

`src/components/ui/card.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-xl border bg-card text-card-foreground shadow-xs", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 p-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("font-semibold leading-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-5 pt-2", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2 border-t px-5 py-3", className)} {...props} />;
}
```

`src/components/ui/badge.tsx`:

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary-soft text-primary",
        secondary: "border-transparent bg-muted text-foreground",
        outline: "text-foreground",
        success: "border-transparent bg-success/15 text-success",
        warning: "border-transparent bg-warning/15 text-warning",
        destructive: "border-transparent bg-destructive/15 text-destructive",
        info: "border-transparent bg-info/15 text-info",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

`src/components/ui/alert.tsx`:

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva("flex gap-3 rounded-lg border p-3 text-sm", {
  variants: {
    variant: {
      info: "border-info/30 bg-info/10",
      success: "border-success/30 bg-success/10",
      warning: "border-warning/30 bg-warning/10",
      destructive: "border-destructive/30 bg-destructive/10",
    },
  },
  defaultVariants: { variant: "info" },
});

const ICONS: Record<NonNullable<VariantProps<typeof alertVariants>["variant"]>, [LucideIcon, string]> = {
  info: [Info, "text-info"],
  success: [CircleCheck, "text-success"],
  warning: [TriangleAlert, "text-warning"],
  destructive: [CircleAlert, "text-destructive"],
};

export function Alert({
  variant = "info",
  title,
  children,
  className,
}: VariantProps<typeof alertVariants> & { title?: string; children?: React.ReactNode; className?: string }) {
  const [Icon, color] = ICONS[variant ?? "info"];
  return (
    <div role={variant === "destructive" ? "alert" : "status"} className={cn(alertVariants({ variant }), className)}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", color)} />
      <div className="space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
```

`src/components/ui/separator.tsx`:

```tsx
"use client";

import * as React from "react";
import { Separator as SeparatorPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
      {...props}
    />
  );
}
```

`src/components/ui/skeleton.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
```

`src/components/ui/spinner.tsx`:

```tsx
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn("size-4 animate-spin", className)} />;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (legacy pages still compile; they keep using `src/components/ui.tsx`).

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css src/components/ui
git commit -m "feat(ui): add design tokens, dark theme and base primitives"
```

---

### Task 3: Overlay, data and form primitives

**Files:**
- Create: `src/components/ui/{dialog,sheet,dropdown-menu,tabs,tooltip,avatar,table,data-table,page-header,empty-state,field,confirm-dialog,pagination-links,toaster}.tsx`, `src/components/theme-provider.tsx`, `src/components/forms/use-server-action.ts`

- [ ] **Step 1: Create the files**

`src/components/ui/dialog.tsx`:

```tsx
"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-popover p-6 text-popover-foreground shadow-lg",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 pr-6", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold leading-none", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
```

`src/components/ui/sheet.tsx`:

```tsx
"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

const SIDES = {
  right: "inset-y-0 right-0 h-full w-full max-w-md border-l",
  left: "inset-y-0 left-0 h-full w-72 border-r",
} as const;

export function SheetContent({
  side = "right",
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: keyof typeof SIDES }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <SheetPrimitive.Content
        className={cn("fixed z-50 flex flex-col gap-4 overflow-y-auto bg-popover p-6 text-popover-foreground shadow-lg", SIDES[side], className)}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 pr-6", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-auto flex gap-2 pt-2 sm:justify-end", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
```

`src/components/ui/dropdown-menu.tsx`:

```tsx
"use client";

import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn("z-50 min-w-44 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md", className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        destructive && "text-destructive focus:bg-destructive/10",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
```

`src/components/ui/tabs.tsx`:

```tsx
"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-4 focus-visible:outline-none", className)} {...props} />;
}
```

`src/components/ui/tooltip.tsx`:

```tsx
"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn("z-50 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md", className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
```

`src/components/ui/avatar.tsx`:

```tsx
"use client";

import * as React from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return (
    <AvatarPrimitive.Root className={cn("relative flex size-8 shrink-0 overflow-hidden rounded-full", className)}>
      {src && <AvatarPrimitive.Image src={src} alt="" className="aspect-square size-full object-cover" />}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center bg-primary-soft text-xs font-semibold text-primary">
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
```

`src/components/ui/table.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b transition-colors hover:bg-muted/50", className)} {...props} />;
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2.5 align-middle", className)} {...props} />;
}
```

`src/components/ui/data-table.tsx`:

```tsx
"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchPlaceholder?: string;
  pageSize?: number;
  emptyMessage?: string;
  toolbar?: React.ReactNode;
}

/** Client-side sorting, global search and pagination for small/medium datasets. */
export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder = "Search…",
  pageSize = 20,
  emptyMessage = "No results.",
  toolbar,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search"
          className="max-w-xs"
        />
        {toolbar}
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 uppercase hover:text-foreground"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <ArrowUpDown className="size-3 opacity-60" />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="py-10 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
```

`src/components/ui/page-header.tsx`:

```tsx
import * as React from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
```

`src/components/ui/empty-state.tsx`:

```tsx
import * as React from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
```

`src/components/ui/field.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
```

`src/components/ui/confirm-dialog.tsx`:

```tsx
"use client";

import * as React from "react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";
import { Spinner } from "./spinner";

/** Confirmation for destructive or irreversible actions. Controlled (`open`) or uncontrolled (`trigger`). */
export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await onConfirm();
                setOpen(false);
              })
            }
          >
            {pending && <Spinner />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`src/components/ui/pagination-links.tsx`:

```tsx
import Link from "next/link";
import { Button } from "./button";

/** Server-side pagination that preserves the current query string. */
export function PaginationLinks({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    qs.set("page", String(p));
    return `${basePath}?${qs.toString()}`;
  };
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        {total} {total === 1 ? "entry" : "entries"} · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}>Previous</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        )}
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>Next</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
```

`src/components/ui/toaster.tsx`:

```tsx
"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      richColors
      closeButton
      position="top-right"
    />
  );
}
```

`src/components/theme-provider.tsx`:

```tsx
"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider(props: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
```

`src/components/forms/use-server-action.ts`:

```ts
"use client";

import { useTransition } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import type { ActionResult } from "@/server/actions/execute";

type Failure<T> = Extract<ActionResult<T>, { ok: false }>;

/**
 * Runs a server action inside a transition and toasts the outcome.
 * Errors are toasted unless they only carry field errors and an `onError` handler is provided.
 */
export function useServerAction<I, T>(
  action: (input: I) => Promise<ActionResult<T>>,
  options: {
    successMessage?: string | ((data: T) => string);
    onSuccess?: (data: T) => void;
    onError?: (result: Failure<T>) => void;
  } = {},
) {
  const [pending, startTransition] = useTransition();

  function run(input: I): Promise<ActionResult<T>> {
    return new Promise((resolve) => {
      startTransition(async () => {
        let result: ActionResult<T>;
        try {
          result = await action(input);
        } catch {
          result = { ok: false, code: "NETWORK", error: "Could not reach the server. Please try again." };
        }
        if (result.ok) {
          const message =
            typeof options.successMessage === "function" ? options.successMessage(result.data) : options.successMessage;
          if (message) toast.success(message);
          options.onSuccess?.(result.data);
        } else {
          const onlyFieldErrors = !!result.fieldErrors && Object.keys(result.fieldErrors).length > 0 && !!options.onError;
          if (!onlyFieldErrors) toast.error(result.error);
          options.onError?.(result);
        }
        resolve(result);
      });
    });
  }

  return { run, pending };
}

export function applyFieldErrors<F extends FieldValues>(
  setError: UseFormSetError<F>,
  fieldErrors: Record<string, string[]> | undefined,
): void {
  for (const [field, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages?.length) setError(field as Path<F>, { type: "server", message: messages[0] });
  }
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components
git commit -m "feat(ui): add dialogs, menus, data table, form helpers and toaster"
```

---

### Task 4: Auth.js wiring, session helpers, defineAction, proxy — remove the legacy app

**Files:**
- Create: `src/types/next-auth.d.ts`, `src/server/auth/session.ts`, `src/server/actions/define.ts`, `src/proxy.ts`, `src/app/not-found.tsx`, `src/app/forbidden.tsx`, `src/app/global-error.tsx`
- Replace: `src/auth.config.ts`, `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/layout.tsx`, `src/lib/utils.ts`, `next.config.ts`
- Delete: legacy pages, API routes, components, DB layer, middleware (list in Step 1)

- [ ] **Step 1: Delete the legacy application code**

```bash
git rm -r "src/app/(app)" src/app/api/admin src/app/api/holiday-selections src/app/api/holidays src/app/api/leaves src/app/api/me src/app/login src/app/change-password
git rm src/components/AdminOverview.tsx src/components/AppShell.tsx src/components/NavLink.tsx src/components/SessionProvider.tsx src/components/ui.tsx
git rm -r src/db
git rm src/lib/leaves.ts src/middleware.ts src/auth-handlers.ts
```

The old logic stays available through `git show 489c251:<path>` for the Phase 2 legacy migration.

- [ ] **Step 2: Replace `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Create `src/types/next-auth.d.ts`**

```ts
import type { DefaultSession } from "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    sessionVersion?: number;
  }
  interface Session {
    user: { id: string; sessionVersion: number } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    sv?: number;
  }
}
```

- [ ] **Step 4: Replace `src/auth.config.ts`** (no DB imports — also used by `proxy.ts`)

```ts
import type { NextAuthConfig } from "next-auth";

/** The JWT carries only the user id and session version; everything else is read from the DB per request. */
export const authConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.sv = user.sessionVersion;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid ?? "";
      session.user.sessionVersion = token.sv ?? 0;
      return session;
    },
  },
} satisfies NextAuthConfig;
```

- [ ] **Step 5: Replace `src/auth.ts`**

```ts
import "server-only";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { isAllowedEmail } from "@/lib/auth/email-domain";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { createRateLimiter } from "@/server/lib/rate-limit";
import { clientIp } from "@/server/lib/request";
import { writeAudit } from "@/server/modules/audit/service";
import { getSetting } from "@/server/modules/settings/service";
import { verifyCredentials } from "@/server/modules/users/service";

class InvalidLogin extends CredentialsSignin {
  code = "invalid";
}
class AccountLocked extends CredentialsSignin {
  code = "locked";
}
class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const loginLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 20 });

const credentialsSchema = z.object({
  email: z.email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(1).max(200),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw, request) => {
        const ip = clientIp(request.headers);
        const userAgent = request.headers.get("user-agent");
        if (!loginLimiter.check(`ip:${ip ?? "unknown"}`)) throw new RateLimited();

        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success || !isAllowedEmail(parsed.data.email, config.allowedEmailDomain)) throw new InvalidLogin();

        const security = getSetting(db, "security");
        const result = await verifyCredentials(db, parsed.data.email, parsed.data.password, {
          now: new Date(),
          lockoutAttempts: security.lockoutAttempts,
          lockoutMinutes: security.lockoutMinutes,
        });
        if (!result.ok) {
          if (result.userId) {
            writeAudit(db, {
              actorUserId: result.userId,
              action: "auth.login_failed",
              entityType: "user",
              entityId: result.userId,
              summary: `Sign-in failed (${result.reason})`,
              ip,
              userAgent,
            });
          }
          if (result.reason === "locked") throw new AccountLocked();
          throw new InvalidLogin();
        }

        writeAudit(db, {
          actorUserId: result.user.id,
          action: "auth.login",
          entityType: "user",
          entityId: result.user.id,
          summary: "Signed in",
          ip,
          userAgent,
        });
        return {
          id: String(result.user.id),
          email: result.user.email,
          name: result.user.name,
          sessionVersion: result.user.sessionVersion,
        };
      },
    }),
  ],
});
```

- [ ] **Step 6: Replace `src/app/api/auth/[...nextauth]/route.ts`**

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 7: Create `src/server/auth/session.ts`**

```ts
import "server-only";
import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { auth } from "@/auth";
import { can, canAny, type Permission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { db } from "@/server/db";
import { loadSessionUser } from "@/server/modules/users/service";

/** The DB-verified current user, or null (no session, disabled user, or revoked session). Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const id = Number(session?.user?.id);
  if (!session || !Number.isInteger(id) || id <= 0) return null;
  return loadSessionUser(db, id, session.user.sessionVersion);
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, permission)) forbidden();
  return user;
}

export async function requireAnyPermission(permissions: Permission[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAny(user, permissions)) forbidden();
  return user;
}
```

- [ ] **Step 8: Create `src/server/actions/define.ts`**

```ts
import "server-only";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import type { SessionUser } from "@/lib/auth/types";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { logger } from "@/server/lib/logger";
import { clientIp } from "@/server/lib/request";
import { executeAction, type ActionDef, type ActionResult } from "./execute";

export type { ActionResult } from "./execute";

/**
 * Creates a server action. Export the result from a `"use server"` file:
 *   export const saveThing = defineAction({ name, schema, permission, handler });
 * The return value must be serializable.
 */
export function defineAction<S extends z.ZodType, P, T>(
  def: ActionDef<S, P, T> & {
    /** Paths to revalidate after success. */
    revalidate?: string[];
    /** Async side effects after commit (emails). Failures are logged, not returned. */
    after?: (data: T, user: SessionUser) => Promise<void>;
  },
) {
  return async function action(raw: z.input<S>): Promise<ActionResult<T>> {
    const user = await getCurrentUser();
    const h = await headers();
    const result = await executeAction(db, user, def, raw, { ip: clientIp(h), userAgent: h.get("user-agent") });
    if (result.ok) {
      for (const path of def.revalidate ?? []) revalidatePath(path);
      if (def.after && user) {
        try {
          await def.after(result.data, user);
        } catch (err) {
          logger.error({ err, action: def.name }, "after hook failed");
        }
      }
    }
    return result;
  };
}
```

- [ ] **Step 9: Create `src/proxy.ts`**

```ts
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { isPublicPath } from "@/lib/public-paths";

const { auth } = NextAuth(authConfig);

/** Optimistic check only: anonymous users go to /login. Pages and actions do the real authorization. */
export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (!req.auth) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = new URL("/login", req.nextUrl);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
```

- [ ] **Step 10: Replace `next.config.ts`**

```ts
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    authInterrupts: true,
    serverActions: { bodySizeLimit: "11mb" },
    proxyClientMaxBodySize: "11mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
```

(`output: "standalone"` is removed. Deployment uses `next start`, and the rewritten `DEPLOY.md` in Phase 6 confirms this.)

- [ ] **Step 11: Replace `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "PVCON People", template: "%s · PVCON People" },
  description: "HR, attendance, leave and payroll for PVCON Consulting",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={jakarta.variable}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 12: Create the error pages**

`src/app/not-found.tsx`:

```tsx
import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <EmptyState
        icon={SearchX}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={
          <Button asChild variant="outline">
            <Link href="/">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
```

`src/app/forbidden.tsx`:

```tsx
import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function Forbidden() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <EmptyState
        icon={Lock}
        title="You don't have access to this page"
        description="Ask an administrator if you think you should."
        action={
          <Button asChild variant="outline">
            <Link href="/">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
```

`src/app/global-error.tsx`:

```tsx
"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
          <p style={{ color: "#5f6780" }}>An unexpected error occurred. Please try again.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, background: "#202f63", color: "#fff", border: 0 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
```

`SearchX` and `Lock` exist in lucide-react 1.x. Confirm with `grep -o " SearchX," node_modules/lucide-react/dist/lucide-react.d.ts`.

- [ ] **Step 13: Typecheck and unit tests**

Run: `npm run typecheck && npm test`
Expected: PASS. There are no pages under `/` yet; the build is completed in Task 6. If `tsc` reports errors inside `.next/types` for deleted routes, run `rm -rf .next` and retry.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(auth): wire Auth.js with DB-verified sessions, proxy and defineAction; remove legacy UI"
```

---

### Task 5: Auth pages — login, change password, forgot and reset password

**Files:**
- Create: `src/app/(auth)/layout.tsx`, `src/app/(auth)/actions.ts`, `src/app/(auth)/login/{page,login-form}.tsx`, `src/app/(auth)/change-password/{page,change-password-form}.tsx`, `src/app/(auth)/forgot-password/{page,forgot-password-form}.tsx`, `src/app/(auth)/reset-password/[token]/{page,reset-password-form}.tsx`

- [ ] **Step 1: Create `src/app/(auth)/layout.tsx`**

```tsx
import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image src="/brand/pvcon-logo-only.png" alt="PVCON" width={44} height={44} priority className="dark:hidden" />
          <Image src="/brand/pvcon-logo-inverted.png" alt="PVCON" width={44} height={44} priority className="hidden dark:block" />
          <div>
            <p className="text-lg font-semibold text-primary">PVCON People</p>
            <p className="text-sm text-muted-foreground">HR, time and payroll</p>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-xs">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(auth)/actions.ts`**

```ts
"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { isAllowedEmail } from "@/lib/auth/email-domain";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getCurrentUser } from "@/server/auth/session";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { isEmailConfigured, renderEmail, sendEmail } from "@/server/lib/email";
import { logger } from "@/server/lib/logger";
import { createRateLimiter } from "@/server/lib/rate-limit";
import { clientIp } from "@/server/lib/request";
import { writeAudit } from "@/server/modules/audit/service";
import { getSetting } from "@/server/modules/settings/service";
import { changePassword, createPasswordResetToken, resetPasswordWithToken } from "@/server/modules/users/service";

export interface AuthFormState {
  error?: string;
  message?: string;
  email?: string;
  fieldErrors?: Record<string, string[]>;
}

const LOGIN_ERRORS: Record<string, string> = {
  invalid: "Incorrect email or password.",
  locked: "Too many failed attempts. Your account is locked for a few minutes.",
  rate_limited: "Too many sign-in attempts from this network. Please wait and try again.",
};

const forgotLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 5 });

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  try {
    await signIn("credentials", {
      email,
      password: String(formData.get("password") ?? ""),
      redirectTo: safeRedirectPath(formData.get("next")),
    });
    return {};
  } catch (err) {
    if (err instanceof CredentialsSignin) return { email, error: LOGIN_ERRORS[err.code] ?? LOGIN_ERRORS.invalid };
    if (err instanceof AuthError) return { email, error: LOGIN_ERRORS.invalid };
    throw err; // NEXT_REDIRECT on success
  }
}

export async function changePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (newPassword !== confirmPassword) return { fieldErrors: { confirmPassword: ["Passwords do not match."] } };

  const { passwordMinLength } = getSetting(db, "security");
  try {
    await changePassword(db, user.id, currentPassword, newPassword, { minLength: passwordMinLength });
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, fieldErrors: err.fieldErrors };
    throw err;
  }
  const h = await headers();
  writeAudit(db, {
    actorUserId: user.id,
    action: "user.password_changed",
    entityType: "user",
    entityId: user.id,
    summary: "Changed own password",
    ip: clientIp(h),
    userAgent: h.get("user-agent"),
  });
  // The password change revoked every session; sign this browser back in with the new password.
  await signIn("credentials", { email: user.email, password: newPassword, redirectTo: "/" });
  return {};
}

export async function forgotPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const h = await headers();
  const ip = clientIp(h) ?? "unknown";
  if (!forgotLimiter.check(ip)) return { error: "Too many requests. Please try again later." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const generic: AuthFormState = {
    message: "If an account exists for that email, a reset link is on its way. It expires in 30 minutes.",
  };
  if (!isAllowedEmail(email, config.allowedEmailDomain)) return generic;
  if (!isEmailConfigured()) {
    logger.warn({ email }, "password reset requested but SMTP is not configured");
    return { message: "Email delivery isn't set up yet. Ask an administrator to reset your password." };
  }

  const created = createPasswordResetToken(db, email);
  if (created) {
    const { html, text } = renderEmail({
      heading: "Reset your password",
      paragraphs: [
        `Hi ${created.user.name},`,
        "We received a request to reset your PVCON People password. The link below expires in 30 minutes.",
        "If you didn't ask for this, you can ignore this email.",
      ],
      action: { label: "Reset password", url: `${config.appUrl}/reset-password/${created.token}` },
    });
    try {
      await sendEmail({ to: created.user.email, subject: "Reset your PVCON People password", html, text });
    } catch (err) {
      logger.error({ err }, "failed to send password reset email");
    }
    writeAudit(db, {
      actorUserId: created.user.id,
      action: "auth.reset_requested",
      entityType: "user",
      entityId: created.user.id,
      summary: "Requested a password reset",
      ip,
      userAgent: h.get("user-agent"),
    });
  }
  return generic;
}

export async function resetPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const token = String(formData.get("token") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (newPassword !== confirmPassword) return { fieldErrors: { confirmPassword: ["Passwords do not match."] } };

  const { passwordMinLength } = getSetting(db, "security");
  let userId: number;
  try {
    userId = (await resetPasswordWithToken(db, token, newPassword, { minLength: passwordMinLength })).id;
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
  const h = await headers();
  writeAudit(db, {
    actorUserId: userId,
    action: "auth.password_reset",
    entityType: "user",
    entityId: userId,
    summary: "Reset password with an emailed link",
    ip: clientIp(h),
    userAgent: h.get("user-agent"),
  });
  redirect("/login?reset=1");
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
```

- [ ] **Step 3: Create the login page**

`src/app/(auth)/login/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { next, reset } = await searchParams;
  return <LoginForm next={next ?? "/"} resetDone={reset === "1"} />;
}
```

`src/app/(auth)/login/login-form.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { loginAction, type AuthFormState } from "../actions";

export function LoginForm({ next, resetDone }: { next: string; resetDone: boolean }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(loginAction, {});
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Use your PVCON work email.</p>
      </div>
      {resetDone && <Alert variant="success" title="Password updated">Sign in with your new password.</Alert>}
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} placeholder="you@pvcon.in" />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        Sign in
      </Button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-primary hover:underline">
          Forgot password?
        </Link>
      </p>
    </form>
  );
}
```

- [ ] **Step 4: Create the change-password page**

`src/app/(auth)/change-password/page.tsx`:

```tsx
import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getSetting } from "@/server/modules/settings/service";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const user = await requireUser();
  const { passwordMinLength } = getSetting(db, "security");
  return <ChangePasswordForm forced={user.mustChangePassword} minLength={passwordMinLength} />;
}
```

`src/app/(auth)/change-password/change-password-form.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { changePasswordAction, type AuthFormState } from "../actions";

export function ChangePasswordForm({ forced, minLength }: { forced: boolean; minLength: number }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(changePasswordAction, {});
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Change password</h1>
        <p className="text-sm text-muted-foreground">
          At least {minLength} characters with upper- and lowercase letters and a number.
        </p>
      </div>
      {forced && <Alert variant="warning" title="Password change required">Choose a new password to continue.</Alert>}
      <Field label="Current password" htmlFor="currentPassword" error={state.fieldErrors?.currentPassword?.[0]}>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" htmlFor="newPassword">
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={minLength} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirmPassword" error={state.fieldErrors?.confirmPassword?.[0]}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
      </Field>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        Update password
      </Button>
      {!forced && (
        <p className="text-center text-sm">
          <Link href="/" className="text-primary hover:underline">
            Cancel
          </Link>
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 5: Create forgot/reset password pages**

`src/app/(auth)/forgot-password/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
```

`src/app/(auth)/forgot-password/forgot-password-form.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { forgotPasswordAction, type AuthFormState } from "../actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(forgotPasswordAction, {});
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Forgot password</h1>
        <p className="text-sm text-muted-foreground">We'll email you a link to set a new password.</p>
      </div>
      {state.message && <Alert variant="info">{state.message}</Alert>}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@pvcon.in" />
      </Field>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        Send reset link
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
```

`src/app/(auth)/reset-password/[token]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { db } from "@/server/db";
import { getSetting } from "@/server/modules/settings/service";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { passwordMinLength } = getSetting(db, "security");
  return <ResetPasswordForm token={token} minLength={passwordMinLength} />;
}
```

`src/app/(auth)/reset-password/[token]/reset-password-form.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { resetPasswordAction, type AuthFormState } from "../../actions";

export function ResetPasswordForm({ token, minLength }: { token: string; minLength: number }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(resetPasswordAction, {});
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Set a new password</h1>
        <p className="text-sm text-muted-foreground">
          At least {minLength} characters with upper- and lowercase letters and a number.
        </p>
      </div>
      <input type="hidden" name="token" value={token} />
      <Field label="New password" htmlFor="newPassword">
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={minLength} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirmPassword" error={state.fieldErrors?.confirmPassword?.[0]}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
      </Field>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        Save password
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(auth)"
git commit -m "feat(auth): add login, change, forgot and reset password pages"
```

---

### Task 6: App shell, dashboard and notifications

**Files:**
- Create: `src/components/shell/{app-shell,sidebar-nav,topbar,command-palette,notification-bell,theme-toggle,user-menu}.tsx`
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/error.tsx`
- Create: `src/app/(app)/notifications/{page,actions,mark-all-button}.tsx` (`actions.ts` is a `.ts` file)

- [ ] **Step 1: Create the notification actions** — `src/app/(app)/notifications/actions.ts`

```ts
"use server";

import { z } from "zod";
import { defineAction } from "@/server/actions/define";
import { markRead } from "@/server/modules/notifications/service";

/** Marks the given notifications (or all when `ids` is omitted) as read for the current user. */
export const markNotificationsRead = defineAction({
  name: "notifications.mark_read",
  schema: z.object({ ids: z.array(z.number().int().positive()).max(200).optional() }),
  handler: ({ tx, user }, input) => ({ updated: markRead(tx, user.id, input.ids ?? "all") }),
});
```

- [ ] **Step 2: Create shell components**

`src/components/shell/sidebar-nav.tsx`:

```tsx
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
```

`src/components/shell/theme-toggle.tsx`:

```tsx
"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme("light")}>
          <Sun /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")}>
          <Moon /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")}>
          <Monitor /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`src/components/shell/user-menu.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useTransition } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
        <Avatar name={name} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-foreground">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/change-password">
            <KeyRound /> Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={pending} onSelect={() => startTransition(() => signOutAction())}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`src/components/shell/notification-bell.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bell } from "lucide-react";
import { markNotificationsRead } from "@/app/(app)/notifications/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface NotificationItem {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
}

export function NotificationBell({ unreadCount, recent }: { unreadCount: number; recent: NotificationItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const open = (n: NotificationItem) =>
    startTransition(async () => {
      if (!n.readAt) await markNotificationsRead({ ids: [n.id] });
      router.push(n.link ?? "/notifications");
      router.refresh();
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount ? `Notifications (${unreadCount} unread)` : "Notifications"}
        >
          <Bell />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              disabled={pending}
              className="text-xs text-primary hover:underline disabled:opacity-50"
              onClick={() =>
                startTransition(async () => {
                  await markNotificationsRead({});
                  router.refresh();
                })
              }
            >
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
        ) : (
          recent.map((n) => (
            <DropdownMenuItem key={n.id} onSelect={() => open(n)} className="flex-col items-start gap-0.5">
              <span className={cn("text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
              {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="justify-center">
          <Link href="/notifications">View all</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`src/components/shell/command-palette.tsx`:

```tsx
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
```

`src/components/shell/topbar.tsx`:

```tsx
"use client";

import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OPEN_COMMAND_PALETTE } from "./command-palette";
import { NotificationBell, type NotificationItem } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function Topbar({
  onMenu,
  name,
  email,
  unreadCount,
  recent,
}: {
  onMenu: () => void;
  name: string;
  email: string;
  unreadCount: number;
  recent: NotificationItem[];
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu />
      </Button>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
        className="flex h-9 w-full max-w-sm items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground shadow-xs hover:bg-muted"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <NotificationBell unreadCount={unreadCount} recent={recent} />
        <ThemeToggle />
        <UserMenu name={name} email={email} />
      </div>
    </header>
  );
}
```

`src/components/shell/app-shell.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { Permission } from "@/lib/auth/permissions";
import { CommandPalette } from "./command-palette";
import type { NotificationItem } from "./notification-bell";
import { SidebarNav } from "./sidebar-nav";
import { Topbar } from "./topbar";

export function AppShell({
  user,
  unreadCount,
  recentNotifications,
  children,
}: {
  user: { name: string; email: string; permissions: Permission[] };
  unreadCount: number;
  recentNotifications: NotificationItem[];
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r bg-sidebar lg:block">
        <SidebarNav permissions={user.permissions} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav permissions={user.permissions} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onMenu={() => setMobileOpen(true)}
          name={user.name}
          email={user.email}
          unreadCount={unreadCount}
          recent={recentNotifications}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
      <CommandPalette permissions={user.permissions} />
    </div>
  );
}
```

- [ ] **Step 3: Create the authenticated layout, dashboard and error boundary**

`src/app/(app)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listNotifications, unreadCount } from "@/server/modules/notifications/service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");
  const recent = listNotifications(db, user.id, { limit: 8 }).map(({ id, title, body, link, readAt }) => ({
    id, title, body, link, readAt,
  }));
  return (
    <AppShell
      user={{ name: user.name, email: user.email, permissions: user.permissions }}
      unreadCount={unreadCount(db, user.id)}
      recentNotifications={recent}
    >
      {children}
    </AppShell>
  );
}
```

`src/app/(app)/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { visibleNav } from "@/components/shell/nav";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { formatDate, todayInTimeZone } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { unreadCount } from "@/server/modules/notifications/service";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(new Date()),
  );
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage() {
  const user = await requireUser();
  const { timezone } = getSetting(db, "locale");
  const unread = unreadCount(db, user.id);
  const shortcuts = visibleNav(user.permissions)
    .flatMap((g) => g.items)
    .filter((i) => i.href !== "/");

  return (
    <>
      <PageHeader
        title={`${greeting(timezone)}, ${user.name.split(" ")[0]}`}
        description={formatDate(todayInTimeZone(timezone), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Signed in as</CardDescription>
            <CardTitle className="truncate text-base">{user.email}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {user.roles.map((role) => (
              <Badge key={role}>{ROLE_LABELS[role]}</Badge>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Unread notifications</CardDescription>
            <CardTitle className="text-3xl">{unread}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/notifications">Open inbox</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Shortcuts</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-0.5">
            {shortcuts.map((s) => (
              <Link key={s.href} href={s.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <s.icon className="size-4 text-muted-foreground" />
                {s.title}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
```

`src/app/(app)/error.tsx`:

```tsx
"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title="Something went wrong"
      description={error.digest ? `Reference: ${error.digest}` : "Please try again."}
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
```

- [ ] **Step 4: Create the notifications page**

`src/app/(app)/notifications/mark-all-button.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { markNotificationsRead } from "./actions";

export function MarkAllButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const { run, pending } = useServerAction(markNotificationsRead, {
    successMessage: "All caught up",
    onSuccess: () => router.refresh(),
  });
  return (
    <Button variant="outline" disabled={disabled || pending} onClick={() => run({})}>
      <CheckCheck /> Mark all read
    </Button>
  );
}
```

(`CheckCheck` exists in lucide-react; verify with grep if unsure.)

`src/app/(app)/notifications/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listNotifications } from "@/server/modules/notifications/service";
import { getSetting } from "@/server/modules/settings/service";
import { MarkAllButton } from "./mark-all-button";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const { timezone } = getSetting(db, "locale");
  const items = listNotifications(db, user.id, { limit: 100 });
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Approvals, reminders and updates for you."
        actions={<MarkAllButton disabled={!items.some((n) => !n.readAt)} />}
      />
      {items.length === 0 ? (
        <EmptyState title="No notifications yet" description="You'll see approvals and updates here." />
      ) : (
        <Card className="divide-y">
          {items.map((n) => {
            const content = (
              <div className="flex items-start gap-3 px-5 py-4">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", !n.readAt && "font-semibold")}>{n.title}</p>
                  {n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">{formatDateTime(n.createdAt, timezone)}</time>
              </div>
            );
            return n.link ? (
              <Link key={n.id} href={n.link} className="block hover:bg-muted/50">
                {content}
              </Link>
            ) : (
              <div key={n.id}>{content}</div>
            );
          })}
        </Card>
      )}
    </>
  );
}
```

- [ ] **Step 5: Build and smoke test**

```bash
cp -n .env.example .env.local   # then set AUTH_SECRET and DATA_ENCRYPTION_KEY (openssl rand -base64 32), CRON_SECRET (any random string)
npm run db:reset
npm run build
```

Expected: the build succeeds.

Then run `npm run dev` and check:
- `http://localhost:3000` redirects to `/login`.
- Sign in with `admin@pvcon.in` / `ChangeMe@2026`. You land on `/change-password`.
- After changing the password you see the dashboard with the sidebar and topbar.
- Ctrl+K opens the palette. The theme toggle switches dark/light. Sign out works.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell "src/app/(app)"
git commit -m "feat(shell): add app shell, command palette, notifications and dashboard"
```

---

### Task 7: Settings — company, locale, logo, security

**Files:**
- Create: `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/company/{page,actions,company-profile-form,locale-form,logo-card}.tsx` (`actions.ts` is a `.ts` file), `src/app/(app)/settings/security/{page,actions,security-form}.tsx` (`actions.ts` is a `.ts` file)

- [ ] **Step 1: Settings index redirect** — `src/app/(app)/settings/page.tsx`

```tsx
import { forbidden, redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/server/auth/session";

export default async function SettingsIndex() {
  const user = await requireUser();
  if (can(user, "settings.manage")) redirect("/settings/company");
  if (can(user, "user.manage") || can(user, "role.assign")) redirect("/settings/users");
  if (can(user, "audit.view")) redirect("/settings/audit");
  forbidden();
}
```

- [ ] **Step 2: Company actions** — `src/app/(app)/settings/company/actions.ts`

```ts
"use server";

import { z } from "zod";
import { companySettingsSchema, localeSettingsSchema } from "@/lib/validation/settings";
import { defineAction } from "@/server/actions/define";
import { config } from "@/server/config";
import { DomainError } from "@/server/errors";
import { diffObjects } from "@/server/modules/audit/service";
import { saveUpload } from "@/server/modules/files/service";
import { patchSetting } from "@/server/modules/settings/service";

export const updateCompanyProfile = defineAction({
  name: "settings.company.update",
  schema: companySettingsSchema.omit({ logoFileId: true }),
  permission: "settings.manage",
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = patchSetting(tx, "company", input, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "company", summary: "Updated company profile", diff: diffObjects(before, after) });
    return after;
  },
  revalidate: ["/settings/company"],
});

export const updateLocaleSettings = defineAction({
  name: "settings.locale.update",
  schema: localeSettingsSchema,
  permission: "settings.manage",
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = patchSetting(tx, "locale", input, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "locale", summary: "Updated regional settings", diff: diffObjects(before, after) });
    return after;
  },
  revalidate: ["/settings/company"],
});

export const uploadCompanyLogo = defineAction({
  name: "settings.company.logo",
  schema: z.instanceof(FormData),
  permission: "settings.manage",
  prepare: async (form) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("NO_FILE", "Choose an image to upload.");
    return { name: file.name, data: Buffer.from(await file.arrayBuffer()) };
  },
  handler: ({ tx, user, audit }, _input, upload) => {
    const stored = saveUpload(tx, {
      data: upload.data,
      originalName: upload.name,
      allowed: ["png", "jpeg", "webp"],
      uploadedBy: user.id,
      uploadDir: config.uploadDir,
      maxBytes: 2 * 1024 * 1024,
    });
    const { before, after } = patchSetting(tx, "company", { logoFileId: stored.id }, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "company", summary: "Uploaded company logo", diff: diffObjects(before, after) });
    return { logoFileId: stored.id };
  },
  revalidate: ["/settings/company"],
});

export const removeCompanyLogo = defineAction({
  name: "settings.company.logo_remove",
  schema: z.object({}),
  permission: "settings.manage",
  handler: ({ tx, user, audit }) => {
    const { before, after } = patchSetting(tx, "company", { logoFileId: null }, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "company", summary: "Removed company logo", diff: diffObjects(before, after) });
    return { ok: true };
  },
  revalidate: ["/settings/company"],
});
```

- [ ] **Step 3: Company forms**

`src/app/(app)/settings/company/company-profile-form.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { companySettingsSchema } from "@/lib/validation/settings";
import { updateCompanyProfile } from "./actions";

const schema = companySettingsSchema.omit({ logoFileId: true });
type Values = z.infer<typeof schema>;

export function CompanyProfileForm({ initial }: { initial: Values }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const { run, pending } = useServerAction(updateCompanyProfile, {
    successMessage: "Company profile saved",
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Company profile</CardTitle>
        <CardDescription>Shown on payslips, letters and emails.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="space-y-4">
          <Field label="Legal name" htmlFor="legalName" error={errors.legalName?.message} required>
            <Input id="legalName" {...form.register("legalName")} />
          </Field>
          <Field label="Display name" htmlFor="displayName" error={errors.displayName?.message} required>
            <Input id="displayName" {...form.register("displayName")} />
          </Field>
          <Field label="Registered address" htmlFor="address" error={errors.address?.message}>
            <Textarea id="address" rows={3} {...form.register("address")} />
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Save profile
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
```

`src/app/(app)/settings/company/locale-form.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { localeSettingsSchema } from "@/lib/validation/settings";
import { updateLocaleSettings } from "./actions";

type Values = z.infer<typeof localeSettingsSchema>;

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function LocaleForm({ initial, timeZones }: { initial: Values; timeZones: string[] }) {
  const form = useForm<Values>({ resolver: zodResolver(localeSettingsSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateLocaleSettings, {
    successMessage: "Regional settings saved",
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Regional settings</CardTitle>
        <CardDescription>Time zone for attendance and dates; currency and fiscal year for payroll.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Time zone" htmlFor="timezone" error={errors.timezone?.message} className="sm:col-span-2">
            <NativeSelect id="timezone" {...form.register("timezone")}>
              {timeZones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Currency" htmlFor="currency" error={errors.currency?.message}>
            <NativeSelect id="currency" {...form.register("currency")}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Fiscal year starts" htmlFor="fiscalYearStartMonth" error={errors.fiscalYearStartMonth?.message}>
            <NativeSelect id="fiscalYearStartMonth" {...form.register("fiscalYearStartMonth", { valueAsNumber: true })}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Save regional settings
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
```

`src/app/(app)/settings/company/logo-card.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Trash2, Upload } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { removeCompanyLogo, uploadCompanyLogo } from "./actions";

export function LogoCard({ logoFileId }: { logoFileId: number | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const upload = useServerAction(uploadCompanyLogo, { successMessage: "Logo uploaded", onSuccess: () => router.refresh() });
  const remove = useServerAction(removeCompanyLogo, { successMessage: "Logo removed", onSuccess: () => router.refresh() });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>PNG, JPG or WebP up to 2 MB. Used on payslips.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {logoFileId ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated dynamic file route
            <img src={`/api/files/${logoFileId}?inline=1`} alt="Company logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">No logo</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.set("file", file);
              void upload.run(form);
              e.target.value = "";
            }}
          />
          <Button variant="outline" disabled={upload.pending} onClick={() => input.current?.click()}>
            <Upload /> {logoFileId ? "Replace" : "Upload"}
          </Button>
          {logoFileId && (
            <Button variant="ghost" disabled={remove.pending} onClick={() => remove.run({})}>
              <Trash2 /> Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

`src/app/(app)/settings/company/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getSetting } from "@/server/modules/settings/service";
import { CompanyProfileForm } from "./company-profile-form";
import { LocaleForm } from "./locale-form";
import { LogoCard } from "./logo-card";

export const metadata: Metadata = { title: "Company settings" };

export default async function CompanySettingsPage() {
  await requirePermission("settings.manage");
  const company = getSetting(db, "company");
  const locale = getSetting(db, "locale");
  const timeZones = [...new Set([locale.timezone, ...Intl.supportedValuesOf("timeZone")])].sort();
  return (
    <>
      <PageHeader title="Company" description="Profile, branding and regional settings used across PVCON People." />
      <div className="grid gap-6 lg:grid-cols-2">
        <CompanyProfileForm
          initial={{ legalName: company.legalName, displayName: company.displayName, address: company.address }}
        />
        <div className="space-y-6">
          <LogoCard logoFileId={company.logoFileId} />
          <LocaleForm initial={locale} timeZones={timeZones} />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Security settings**

`src/app/(app)/settings/security/actions.ts`:

```ts
"use server";

import { securitySettingsSchema } from "@/lib/validation/settings";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { patchSetting } from "@/server/modules/settings/service";

export const updateSecuritySettings = defineAction({
  name: "settings.security.update",
  schema: securitySettingsSchema,
  permission: "settings.manage",
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = patchSetting(tx, "security", input, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "security", summary: "Updated security settings", diff: diffObjects(before, after) });
    return after;
  },
  revalidate: ["/settings/security"],
});
```

`src/app/(app)/settings/security/security-form.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { securitySettingsSchema } from "@/lib/validation/settings";
import { updateSecuritySettings } from "./actions";

type Values = z.infer<typeof securitySettingsSchema>;

export function SecurityForm({ initial }: { initial: Values }) {
  const form = useForm<Values>({ resolver: zodResolver(securitySettingsSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateSecuritySettings, {
    successMessage: "Security settings saved",
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Sign-in protection</CardTitle>
        <CardDescription>Applies to every account. Existing passwords remain valid until changed.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Failed attempts before lock" htmlFor="lockoutAttempts" error={errors.lockoutAttempts?.message}>
            <Input id="lockoutAttempts" type="number" min={3} max={20} {...form.register("lockoutAttempts", { valueAsNumber: true })} />
          </Field>
          <Field label="Lock duration (minutes)" htmlFor="lockoutMinutes" error={errors.lockoutMinutes?.message}>
            <Input id="lockoutMinutes" type="number" min={1} max={1440} {...form.register("lockoutMinutes", { valueAsNumber: true })} />
          </Field>
          <Field label="Minimum password length" htmlFor="passwordMinLength" error={errors.passwordMinLength?.message}>
            <Input id="passwordMinLength" type="number" min={8} max={64} {...form.register("passwordMinLength", { valueAsNumber: true })} />
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
```

`src/app/(app)/settings/security/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getSetting } from "@/server/modules/settings/service";
import { SecurityForm } from "./security-form";

export const metadata: Metadata = { title: "Security settings" };

export default async function SecuritySettingsPage() {
  await requirePermission("settings.manage");
  return (
    <>
      <PageHeader title="Security" description="Account lockout and password rules." />
      <SecurityForm initial={getSetting(db, "security")} />
    </>
  );
}
```

- [ ] **Step 5: Typecheck and manual check**

Run: `npm run typecheck`. Then in `npm run dev`, as the admin:
- save the company profile (a toast appears and the value persists on reload);
- change the time zone;
- upload a PNG logo (the preview appears only after Task 9 adds `/api/files/[id]`);
- save security settings;
- confirm the entries appear later in the audit log.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/settings"
git commit -m "feat(settings): add company, regional, logo and security settings"
```

---

### Task 8: Settings — users and roles

**Files:**
- Create: `src/lib/validation/users.ts`
- Create: `src/app/(app)/settings/users/{page,actions,users-table,add-user-sheet,role-picker,temp-password-dialog}.tsx` (`actions.ts` is a `.ts` file)

- [ ] **Step 1: Create `src/lib/validation/users.ts`**

```ts
import { z } from "zod";
import { ROLES } from "@/lib/auth/permissions";

export const rolesSchema = z.array(z.enum(ROLES)).max(ROLES.length);

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(100),
  email: z.email("Enter a valid email").transform((s) => s.trim().toLowerCase()),
  roles: rolesSchema.min(1, "Pick at least one role"),
});
```

- [ ] **Step 2: Create `src/app/(app)/settings/users/actions.ts`**

```ts
"use server";

import { z } from "zod";
import { isAllowedEmail } from "@/lib/auth/email-domain";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { createUserSchema, rolesSchema } from "@/lib/validation/users";
import { defineAction } from "@/server/actions/define";
import { config } from "@/server/config";
import { DomainError } from "@/server/errors";
import {
  assertCanGrantRoles, createUser, generateTempPassword, getUserById, getUserRoles, hashPassword,
  setTemporaryPassword, setUserRoles, setUserStatus,
} from "@/server/modules/users/service";

const canManageUsers = (user: SessionUser) => can(user, "user.manage") || can(user, "role.assign");

async function tempPassword() {
  const password = generateTempPassword();
  return { password, hash: await hashPassword(password) };
}

export const createUserAction = defineAction({
  name: "users.create",
  schema: createUserSchema,
  permission: canManageUsers,
  prepare: tempPassword,
  handler: ({ tx, user, audit }, input, temp) => {
    if (!isAllowedEmail(input.email, config.allowedEmailDomain)) {
      throw new DomainError("EMAIL_DOMAIN", `Use an @${config.allowedEmailDomain} address.`, {
        email: [`Must be an @${config.allowedEmailDomain} address`],
      });
    }
    assertCanGrantRoles(user, input.roles);
    const created = createUser(tx, {
      email: input.email,
      name: input.name,
      roles: input.roles,
      passwordHash: temp.hash,
      mustChangePassword: true,
    });
    audit({
      action: "user.create",
      entityType: "user",
      entityId: created.id,
      summary: `Created user ${created.email}`,
      diff: { roles: { from: null, to: input.roles } },
    });
    return { userId: created.id, email: created.email, tempPassword: temp.password };
  },
  revalidate: ["/settings/users"],
});

export const updateUserRolesAction = defineAction({
  name: "users.roles",
  schema: z.object({ userId: z.number().int().positive(), roles: rolesSchema }),
  permission: canManageUsers,
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = setUserRoles(tx, user, input.userId, input.roles);
    audit({ action: "user.roles", entityType: "user", entityId: input.userId, summary: "Changed roles", diff: { roles: { from: before, to: after } } });
    return { roles: after };
  },
  revalidate: ["/settings/users"],
});

export const resetUserPasswordAction = defineAction({
  name: "users.reset_password",
  schema: z.object({ userId: z.number().int().positive() }),
  permission: canManageUsers,
  prepare: tempPassword,
  handler: ({ tx, user, audit }, input, temp) => {
    const target = getUserById(tx, input.userId);
    if (!target) throw new DomainError("NOT_FOUND", "User not found.");
    assertCanGrantRoles(user, getUserRoles(tx, input.userId));
    setTemporaryPassword(tx, input.userId, temp.hash);
    audit({ action: "user.password_reset", entityType: "user", entityId: input.userId, summary: `Reset password for ${target.email}` });
    return { email: target.email, tempPassword: temp.password };
  },
  revalidate: ["/settings/users"],
});

export const setUserStatusAction = defineAction({
  name: "users.status",
  schema: z.object({ userId: z.number().int().positive(), status: z.enum(["active", "disabled"]) }),
  permission: canManageUsers,
  handler: ({ tx, user, audit }, input) => {
    const updated = setUserStatus(tx, user, input.userId, input.status);
    audit({
      action: input.status === "disabled" ? "user.disable" : "user.enable",
      entityType: "user",
      entityId: input.userId,
      summary: `${input.status === "disabled" ? "Disabled" : "Enabled"} ${updated.email}`,
    });
    return { status: updated.status };
  },
  revalidate: ["/settings/users"],
});
```

- [ ] **Step 3: Create `role-picker.tsx` and `temp-password-dialog.tsx`**

`src/app/(app)/settings/users/role-picker.tsx`:

```tsx
"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, ROLES, isPrivilegedRole, type Role } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

export function RolePicker({
  value,
  onChange,
  canAssignPrivileged,
  idPrefix,
}: {
  value: Role[];
  onChange: (roles: Role[]) => void;
  canAssignPrivileged: boolean;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {ROLES.map((role) => {
        const locked = isPrivilegedRole(role) && !canAssignPrivileged;
        const id = `${idPrefix}-${role}`;
        return (
          <div key={role} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={value.includes(role)}
              disabled={locked}
              onCheckedChange={(checked) => onChange(checked ? [...value, role] : value.filter((r) => r !== role))}
            />
            <Label htmlFor={id} className={cn(locked && "text-muted-foreground")}>
              {ROLE_LABELS[role]}
            </Label>
          </div>
        );
      })}
    </div>
  );
}
```

`src/app/(app)/settings/users/temp-password-dialog.tsx`:

```tsx
"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function TempPasswordDialog({
  value,
  onClose,
}: {
  value: { email: string; password: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!value} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Share this with {value?.email} privately. It is shown only once and must be changed at first sign-in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2">
          <code data-testid="temp-password" className="flex-1 font-mono text-base tracking-wide">
            {value?.password}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(value?.password ?? "");
              toast.success("Copied to clipboard");
            }}
          >
            <Copy /> Copy
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Create `add-user-sheet.tsx`**

```tsx
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { UserPlus } from "lucide-react";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { createUserSchema } from "@/lib/validation/users";
import { createUserAction } from "./actions";
import { RolePicker } from "./role-picker";

type FormInput = z.input<typeof createUserSchema>;
type FormOutput = z.output<typeof createUserSchema>;

export function AddUserSheet({
  canAssignPrivileged,
  allowedDomain,
  onCreated,
}: {
  canAssignPrivileged: boolean;
  allowedDomain: string;
  onCreated: (result: { email: string; tempPassword: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", roles: ["employee"] },
  });
  const { run, pending } = useServerAction(createUserAction, {
    onSuccess: (data) => {
      setOpen(false);
      form.reset();
      onCreated(data);
    },
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <UserPlus /> Add user
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>New user</SheetTitle>
          <SheetDescription>They get a temporary password and must change it at first sign-in.</SheetDescription>
        </SheetHeader>
        <form onSubmit={form.handleSubmit((values) => run(values))} className="flex flex-1 flex-col gap-4">
          <Field label="Full name" htmlFor="new-name" error={errors.name?.message} required>
            <Input id="new-name" autoComplete="off" {...form.register("name")} />
          </Field>
          <Field label="Work email" htmlFor="new-email" error={errors.email?.message} hint={`Must be an @${allowedDomain} address`} required>
            <Input id="new-email" type="email" autoComplete="off" {...form.register("email")} />
          </Field>
          <Field label="Roles" error={errors.roles?.message}>
            <Controller
              control={form.control}
              name="roles"
              render={({ field }) => (
                <RolePicker value={field.value} onChange={field.onChange} canAssignPrivileged={canAssignPrivileged} idPrefix="new-role" />
              )}
            />
          </Field>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create user
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Create `users-table.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, CircleCheck, Ellipsis, KeyRound, ShieldCheck } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { resetUserPasswordAction, setUserStatusAction, updateUserRolesAction } from "./actions";
import { AddUserSheet } from "./add-user-sheet";
import { RolePicker } from "./role-picker";
import { TempPasswordDialog } from "./temp-password-dialog";

export interface UserRowView {
  id: number;
  name: string;
  email: string;
  roles: Role[];
  status: "active" | "disabled";
  mustChangePassword: boolean;
  lastLoginLabel: string;
}

type Confirm = { kind: "reset" | "disable" | "enable"; user: UserRowView };

export function UsersTable({
  users,
  actorId,
  canAssignPrivileged,
  allowedDomain,
}: {
  users: UserRowView[];
  actorId: number;
  canAssignPrivileged: boolean;
  allowedDomain: string;
}) {
  const router = useRouter();
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [editing, setEditing] = useState<UserRowView | null>(null);
  const [editRoles, setEditRoles] = useState<Role[]>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const reset = useServerAction(resetUserPasswordAction, {
    onSuccess: (d) => {
      setTemp({ email: d.email, password: d.tempPassword });
      router.refresh();
    },
  });
  const status = useServerAction(setUserStatusAction, { successMessage: "User updated", onSuccess: () => router.refresh() });
  const roles = useServerAction(updateUserRolesAction, {
    successMessage: "Roles updated",
    onSuccess: () => {
      setEditing(null);
      router.refresh();
    },
  });

  const columns = useMemo<ColumnDef<UserRowView>[]>(
    () => [
      {
        id: "user",
        header: "User",
        accessorFn: (u) => `${u.name} ${u.email}`,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-medium">{row.original.name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
          </div>
        ),
      },
      {
        id: "roles",
        header: "Roles",
        accessorFn: (u) => u.roles.map((r) => ROLE_LABELS[r]).join(" "),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.roles.map((r) => (
              <Badge key={r}>{ROLE_LABELS[r]}</Badge>
            ))}
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (u) => u.status,
        cell: ({ row }) =>
          row.original.status === "active" ? (
            <Badge variant="success">{row.original.mustChangePassword ? "Pending first sign-in" : "Active"}</Badge>
          ) : (
            <Badge variant="secondary">Disabled</Badge>
          ),
      },
      { accessorKey: "lastLoginLabel", header: "Last sign-in" },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const u = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${u.email}`}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setEditRoles(u.roles);
                    setEditing(u);
                  }}
                >
                  <ShieldCheck /> Edit roles
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setConfirm({ kind: "reset", user: u })}>
                  <KeyRound /> Reset password
                </DropdownMenuItem>
                {u.id !== actorId && (
                  <>
                    <DropdownMenuSeparator />
                    {u.status === "active" ? (
                      <DropdownMenuItem destructive onSelect={() => setConfirm({ kind: "disable", user: u })}>
                        <Ban /> Disable
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => setConfirm({ kind: "enable", user: u })}>
                        <CircleCheck /> Enable
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [actorId],
  );

  const confirmCopy: Record<Confirm["kind"], { title: string; description: string; label: string; destructive: boolean }> = {
    reset: {
      title: "Reset password?",
      description: "A new temporary password is generated and all of the user's sessions are signed out.",
      label: "Reset password",
      destructive: false,
    },
    disable: {
      title: "Disable user?",
      description: "They are signed out everywhere and can no longer sign in. You can re-enable them later.",
      label: "Disable",
      destructive: true,
    },
    enable: { title: "Enable user?", description: "They will be able to sign in again.", label: "Enable", destructive: false },
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={users}
        searchPlaceholder="Search name, email or role…"
        toolbar={
          <AddUserSheet
            canAssignPrivileged={canAssignPrivileged}
            allowedDomain={allowedDomain}
            onCreated={(d) => {
              setTemp({ email: d.email, password: d.tempPassword });
              router.refresh();
            }}
          />
        }
      />

      <TempPasswordDialog value={temp} onClose={() => setTemp(null)} />

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit roles</DialogTitle>
            <DialogDescription>{editing?.email}</DialogDescription>
          </DialogHeader>
          <RolePicker value={editRoles} onChange={setEditRoles} canAssignPrivileged={canAssignPrivileged} idPrefix="edit-role" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={roles.pending} onClick={() => editing && roles.run({ userId: editing.id, roles: editRoles })}>
              {roles.pending && <Spinner />}
              Save roles
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={confirmCopy[confirm.kind].title}
          description={`${confirm.user.email}: ${confirmCopy[confirm.kind].description}`}
          confirmLabel={confirmCopy[confirm.kind].label}
          destructive={confirmCopy[confirm.kind].destructive}
          onConfirm={async () => {
            if (confirm.kind === "reset") await reset.run({ userId: confirm.user.id });
            else await status.run({ userId: confirm.user.id, status: confirm.kind === "disable" ? "disabled" : "active" });
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 6: Create `page.tsx`**

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/dates";
import { requireAnyPermission } from "@/server/auth/session";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { getSetting } from "@/server/modules/settings/service";
import { listUsers } from "@/server/modules/users/service";
import { UsersTable, type UserRowView } from "./users-table";

export const metadata: Metadata = { title: "Users & roles" };

export default async function UsersPage() {
  const actor = await requireAnyPermission(["user.manage", "role.assign"]);
  const { timezone } = getSetting(db, "locale");
  const users: UserRowView[] = listUsers(db).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roles: u.roles,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    lastLoginLabel: u.lastLoginAt ? formatDateTime(u.lastLoginAt, timezone) : "Never",
  }));
  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Sign-in accounts and what each person can access. Employee records are managed under Organization."
      />
      <UsersTable
        users={users}
        actorId={actor.id}
        canAssignPrivileged={can(actor, "role.assign")}
        allowedDomain={config.allowedEmailDomain}
      />
    </>
  );
}
```

(The "Organization" wording refers to Phase 1's `/org/employees`.)

- [ ] **Step 7: Typecheck and manual check**

Run: `npm run typecheck && npm run lint`. In the browser:
- create a user and see the temporary-password dialog;
- edit their roles;
- reset their password;
- disable and re-enable them;
- confirm you cannot disable yourself (no menu item);
- confirm an HR-only account cannot tick HR/Payroll/Super Admin.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validation/users.ts "src/app/(app)/settings/users"
git commit -m "feat(settings): add users and roles management"
```

---

### Task 9: Audit log and jobs pages; cron, health and file routes

**Files:**
- Create: `src/server/jobs/queries.ts`
- Create: `src/app/(app)/settings/audit/page.tsx`, `src/app/(app)/settings/jobs/{page,actions,run-job-button}.tsx` (`actions.ts` is a `.ts` file)
- Create: `src/app/api/cron/[job]/route.ts`, `src/app/api/health/route.ts`, `src/app/api/files/[id]/route.ts`

- [ ] **Step 1: Create `src/server/jobs/queries.ts`**

```ts
import { desc } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { jobRuns } from "@/server/db/schema";

export function listRecentJobRuns(db: DbLike, limit = 50) {
  return db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(limit).all();
}
```

- [ ] **Step 2: Audit log page** — `src/app/(app)/settings/audit/page.tsx`

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PaginationLinks } from "@/components/ui/pagination-links";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, isISODate } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listAudit } from "@/server/modules/audit/service";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = { title: "Audit log" };

type Search = { entity?: string; action?: string; from?: string; to?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const params = {
    entity: sp.entity?.trim() || undefined,
    action: sp.action?.trim() || undefined,
    from: sp.from && isISODate(sp.from) ? sp.from : undefined,
    to: sp.to && isISODate(sp.to) ? sp.to : undefined,
  };
  const { rows, total, page, pageSize } = listAudit(db, {
    entityType: params.entity,
    actionPrefix: params.action,
    from: params.from,
    to: params.to,
    page: Number(sp.page) || 1,
    pageSize: 50,
  });
  const { timezone } = getSetting(db, "locale");

  return (
    <>
      <PageHeader title="Audit log" description="Every change made in PVCON People, who made it and when." />
      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-5">
        <Input name="entity" placeholder="Entity (e.g. user)" defaultValue={params.entity} aria-label="Entity type" />
        <Input name="action" placeholder="Action prefix (e.g. settings.)" defaultValue={params.action} aria-label="Action prefix" />
        <Input name="from" type="date" defaultValue={params.from} aria-label="From date" />
        <Input name="to" type="date" defaultValue={params.to} aria-label="To date" />
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">
            Filter
          </Button>
          <Button asChild variant="outline">
            <Link href="/settings/audit">Reset</Link>
          </Button>
        </div>
      </form>
      <Card className="mb-4">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No entries match these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(r.at, timezone)}</TableCell>
                  <TableCell>{r.actorName ?? <span className="text-muted-foreground">System</span>}</TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="text-xs">
                    {r.entityType}
                    {r.entityId ? ` #${r.entityId}` : ""}
                  </TableCell>
                  <TableCell>{r.summary}</TableCell>
                  <TableCell>
                    {r.diff || r.ip ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-primary">View</summary>
                        {r.diff && <pre className="mt-2 max-w-md overflow-x-auto rounded bg-muted p-2">{JSON.stringify(r.diff, null, 2)}</pre>}
                        {r.ip && <p className="mt-1 text-muted-foreground">IP {r.ip}</p>}
                      </details>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <PaginationLinks page={page} pageSize={pageSize} total={total} basePath="/settings/audit" params={params} />
    </>
  );
}
```

- [ ] **Step 3: Jobs page**

`src/app/(app)/settings/jobs/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { defineAction } from "@/server/actions/define";
import { DomainError } from "@/server/errors";
import { findJob, runJobByName } from "@/server/jobs/registry";

export const runJobAction = defineAction({
  name: "jobs.run",
  schema: z.object({ name: z.string().min(1).max(100) }),
  permission: "job.run",
  handler: ({ tx, audit }, input) => {
    if (!findJob(input.name)) throw new DomainError("UNKNOWN_JOB", "Unknown job.");
    const outcome = runJobByName(tx, input.name);
    audit({ action: "job.run", entityType: "job", entityId: input.name, summary: `Ran manually: ${outcome.status} — ${outcome.detail}` });
    return outcome;
  },
  revalidate: ["/settings/jobs"],
});
```

`src/app/(app)/settings/jobs/run-job-button.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { runJobAction } from "./actions";

export function RunJobButton({ name }: { name: string }) {
  const router = useRouter();
  const { run, pending } = useServerAction(runJobAction, {
    onSuccess: (outcome) => {
      const show = outcome.status === "failed" ? toast.error : toast.success;
      show(`${name}: ${outcome.status}`, { description: outcome.detail });
      router.refresh();
    },
  });
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => run({ name })}>
      {pending ? <Spinner /> : <Play />} Run now
    </Button>
  );
}
```

`src/app/(app)/settings/jobs/page.tsx`:

```tsx
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listRecentJobRuns } from "@/server/jobs/queries";
import { JOBS } from "@/server/jobs/registry";
import { getSetting } from "@/server/modules/settings/service";
import { RunJobButton } from "./run-job-button";

export const metadata: Metadata = { title: "Jobs" };

const STATUS_VARIANT = { succeeded: "success", failed: "destructive", running: "info" } as const;

export default async function JobsPage() {
  await requirePermission("job.run");
  const { timezone } = getSetting(db, "locale");
  const runs = listRecentJobRuns(db, 50);
  return (
    <>
      <PageHeader
        title="Jobs"
        description="Scheduled background jobs. Cron calls POST /api/cron/<job>; you can also run them here. Each job runs once per period."
      />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {JOBS.map((job) => {
          const last = runs.find((r) => r.job === job.name);
          return (
            <Card key={job.name}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="space-y-1">
                  <CardTitle className="font-mono text-sm">{job.name}</CardTitle>
                  <CardDescription>{job.description}</CardDescription>
                  {last && (
                    <p className="text-xs text-muted-foreground">
                      Last: <Badge variant={STATUS_VARIANT[last.status]}>{last.status}</Badge>{" "}
                      {formatDateTime(last.startedAt, timezone)}
                    </p>
                  )}
                </div>
                <RunJobButton name={job.name} />
              </CardHeader>
            </Card>
          );
        })}
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Job</TableHead>
              <TableHead>Run key</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.job}</TableCell>
                <TableCell className="font-mono text-xs">{r.runKey}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{formatDateTime(r.startedAt, timezone)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
```

- [ ] **Step 4: Route handlers**

`src/app/api/cron/[job]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { findJob, runJobByName } from "@/server/jobs/registry";
import { safeEqual } from "@/server/lib/crypto";
import { writeAudit } from "@/server/modules/audit/service";

// Explicit params type: the generated RouteContext helper only exists after `next dev/build`, so a fresh
// `tsc --noEmit` would not know it.
export async function POST(request: Request, ctx: { params: Promise<{ job: string }> }) {
  const secret = config.cronSecret;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job } = await ctx.params;
  const name = decodeURIComponent(job);
  if (!findJob(name)) return NextResponse.json({ error: "unknown job" }, { status: 404 });

  const outcome = runJobByName(db, name);
  if (outcome.status !== "skipped") {
    writeAudit(db, { actorUserId: null, action: "job.run", entityType: "job", entityId: name, summary: `Cron: ${outcome.status} — ${outcome.detail}` });
  }
  return NextResponse.json(outcome, { status: outcome.status === "failed" ? 500 : 200 });
}
```

`src/app/api/health/route.ts`:

```ts
import { accessSync, constants, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    db.get(sql`select 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
    healthy = false;
  }

  try {
    const journalPath = path.join(process.cwd(), "src/server/db/migrations/meta/_journal.json");
    const expected = (JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] }).entries.length;
    const applied = db.get<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`)?.n ?? 0;
    checks.migrations = applied === expected ? "ok" : `pending (${applied}/${expected})`;
    if (applied !== expected) healthy = false;
  } catch {
    checks.migrations = "unknown";
  }

  try {
    accessSync(path.dirname(path.resolve(config.dbFile)), constants.W_OK);
    checks.storage = "ok";
  } catch {
    checks.storage = "not writable";
    healthy = false;
  }

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, time: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
```

`src/app/api/files/[id]/route.ts`:

```ts
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { canAccessFile } from "@/server/modules/files/access";
import { getFile, resolveStoredPath } from "@/server/modules/files/service";

const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await ctx.params).id);
  const file = Number.isInteger(id) ? getFile(db, id) : undefined;
  if (!file || !canAccessFile(db, user, file)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data = await readFile(resolveStoredPath(config.uploadDir, file.storageName));
  const inline = new URL(request.url).searchParams.get("inline") === "1" && INLINE_TYPES.has(file.mime);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
```

- [ ] **Step 5: Verify routes manually**

With `npm run dev` running and `CRON_SECRET` set in `.env.local`:

```bash
curl -s localhost:3000/api/health
curl -s -X POST localhost:3000/api/cron/system:cleanup -H "Authorization: Bearer $CRON_SECRET"
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/cron/system:cleanup -H "Authorization: Bearer wrong"
```

Expected:
- `{"status":"ok",...}`;
- `{"status":"succeeded",...}` (or `"skipped"` if already run today);
- `401`.

Also confirm the uploaded logo now previews on `/settings/company`.

- [ ] **Step 6: Commit**

```bash
git add src/server/jobs/queries.ts "src/app/(app)/settings/audit" "src/app/(app)/settings/jobs" src/app/api
git commit -m "feat(admin): add audit log, jobs page and cron, health and file routes"
```

---

### Task 10: Playwright e2e, full verification, docs

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/auth.spec.ts`
- Modify: `README.md`, `docs/superpowers/plans/2026-09-24-hrms-roadmap.md`

- [ ] **Step 1: Install the browser**

Run: `npx playwright install --with-deps chromium`
Expected: Chromium installed. The system dependencies need sudo in WSL; if the `--with-deps` step fails, run `sudo npx playwright install-deps chromium`.

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `rm -f data/e2e.db data/e2e.db-wal data/e2e.db-shm && npm run db:migrate && npm run db:seed && npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DB_FILE: "./data/e2e.db",
      UPLOAD_DIR: "./data/e2e-uploads",
      AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
      AUTH_TRUST_HOST: "true",
      APP_URL: `http://localhost:${PORT}`,
      DATA_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      CRON_SECRET: "e2e-cron-secret",
      SEED_ADMIN_EMAIL: "admin@pvcon.in",
      SEED_ADMIN_PASSWORD: "ChangeMe@2026",
      LOG_LEVEL: "warn",
    },
  },
});
```

- [ ] **Step 3: Write `tests/e2e/auth.spec.ts`**

```ts
import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin@pvcon.in";
const SEED_PASSWORD = "ChangeMe@2026";
const ADMIN_PASSWORD = "Adm1n-Strong-Pass";
const EMPLOYEE_EMAIL = "test.employee@pvcon.in";
const EMPLOYEE_PASSWORD = "Empl0yee-Strong-Pass";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function changePassword(page: Page, current: string, next: string) {
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("Current password").fill(current);
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password").fill(next);
  await page.getByRole("button", { name: "Update password" }).click();
}

test.describe.serial("authentication and user management", () => {
  let tempPassword = "";

  test("anonymous visitors are sent to login with a return path", async ({ page }) => {
    await page.goto("/settings/users");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fusers$/);
  });

  test("a wrong password shows a generic error", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, "Wrong-password-1");
    // Not getByRole("alert"): Next.js renders its route announcer with role="alert" too.
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  });

  test("first sign-in forces a password change, then shows the dashboard", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, SEED_PASSWORD);
    await changePassword(page, SEED_PASSWORD, ADMIN_PASSWORD);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Good (morning|afternoon|evening), System/);
  });

  test("an admin creates a user and receives a temporary password", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/settings/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByLabel("Full name").fill("Test Employee");
    await page.getByLabel("Work email").fill(EMPLOYEE_EMAIL);
    await page.getByRole("checkbox", { name: "Manager" }).check();
    await page.getByRole("button", { name: "Create user" }).click();

    const dialog = page.getByRole("dialog", { name: "Temporary password" });
    await expect(dialog).toBeVisible();
    tempPassword = (await dialog.getByTestId("temp-password").textContent())?.trim() ?? "";
    expect(tempPassword).toHaveLength(14);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("cell", { name: /test\.employee@pvcon\.in/ })).toBeVisible();
  });

  test("a regular user is forced to change password and cannot open admin settings", async ({ page }) => {
    await signIn(page, EMPLOYEE_EMAIL, tempPassword);
    await changePassword(page, tempPassword, EMPLOYEE_PASSWORD);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Test");
    await expect(page.getByRole("link", { name: "Users & roles" })).toHaveCount(0);
    await page.goto("/settings/users");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  test("the admin sees the activity in the audit log", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/settings/audit?action=user.");
    await expect(page.getByRole("cell", { name: "user.create" })).toBeVisible();
  });
});
```

- [ ] **Step 4: Run e2e**

Stop any running `npm run dev` first (it shares `.next`). Then run `npm run test:e2e`.
Expected: 6 passed. If a test fails, open the trace (`npx playwright show-trace test-results/**/trace.zip`), fix the app code (not the assertions, unless an assertion contradicts this plan), and re-run.

- [ ] **Step 5: Replace `README.md`**

````markdown
# PVCON People

Internal HR platform for PVCON Consulting: core HR, attendance, timesheets, leave and comp-off, payroll and payslips.

- Design spec: `docs/superpowers/specs/2026-09-24-hrms-overhaul-design.md`
- Roadmap and progress: `docs/superpowers/plans/2026-09-24-hrms-roadmap.md`
- Contributor and agent guide: `CLAUDE.md`

## Local development (WSL / Linux / macOS)

```bash
npm ci
cp .env.example .env.local   # set AUTH_SECRET, DATA_ENCRYPTION_KEY (openssl rand -base64 32), CRON_SECRET
npm run db:migrate
npm run db:seed              # admin@pvcon.in / ChangeMe@2026 (forced change at first sign-in)
npm run dev
```

## Quality gates

```bash
npm run verify     # typecheck + lint + unit/integration tests + build
npm run test:e2e   # Playwright (stop the dev server first)
```

Deployment: see `DEPLOY.md` (rewritten in Phase 6).
````

- [ ] **Step 6: Full verification**

Run: `npm run verify`
Expected: typecheck, lint, all vitest suites and `next build` pass.

- [ ] **Step 7: Update the roadmap tracker and commit**

Mark "0B Foundation — UI, auth pages, e2e" as `☑ done (<hash>)` in `docs/superpowers/plans/2026-09-24-hrms-roadmap.md`.

```bash
git add playwright.config.ts tests/e2e README.md docs/superpowers/plans/2026-09-24-hrms-roadmap.md
git commit -m "test(e2e): cover sign-in, forced password change and user management"
git push origin feat/hrms-overhaul
```

---

## Self-review notes (planner)

- Spec coverage for 0B:
  - §3.4:
    - domain allow-list, lockout, session revocation (`loadSessionUser` + re-sign-in after a password change);
    - reset tokens, email;
    - upload download rules, security headers, cron bearer auth.
  - §5.8: in-app bell. Email notifications are Phase 6.
  - §5.11: company/locale/security/roles/audit pages. The SMTP test-email button is deferred to Phase 6 with email notifications.
  - §6: shell, command palette, dark mode, mobile drawer. PWA is Phase 6.
  - §9: error boundaries, health.
- Names consumed from 0A match its Self-review list. New names introduced here that later phases reuse:
  - `defineAction`, `requireUser`, `requirePermission`, `requireAnyPermission`, `getCurrentUser`;
  - `useServerAction`, `applyFieldErrors`;
  - `NAV` / `visibleNav`, `PageHeader`, `DataTable`, `Field`, `ConfirmDialog`, `EmptyState`, `PaginationLinks`, `Badge` variants.
- Later phases add navigation groups to `NAV` in `src/components/shell/nav.ts`, and file-access resolvers to `src/server/modules/files/access.ts`.
