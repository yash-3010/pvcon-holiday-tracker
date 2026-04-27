import * as React from "react";
import { cn } from "@/lib/utils";

export function Button({
  className, variant = "primary", size = "md", style, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "sm" | "md";
}) {
  const variantClass = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    outline: "btn-outline",
    ghost: "btn-ghost",
    destructive: "btn-destructive",
  }[variant];
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm" };
  return (
    <button
      style={style}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        variantClass, sizes[size], className
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-[var(--border-strong)] bg-white px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]",
        "focus:outline-none focus:ring-2 focus:ring-[var(--ring)]/30 focus:border-[var(--primary)]",
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-md border border-[var(--border-strong)] bg-white px-3 text-sm text-[var(--foreground)]",
        "focus:outline-none focus:ring-2 focus:ring-[var(--ring)]/30 focus:border-[var(--primary)]",
        className
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-[var(--foreground)]", className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--card)] p-6",
        "shadow-[0_1px_2px_rgba(20,28,64,0.04)]",
        className
      )}
      {...props}
    />
  );
}

export function Stat({
  label, value, sub, accent,
}: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: "primary" | "secondary" | "muted" }) {
  const accentBar = {
    primary: "bg-[var(--primary)]",
    secondary: "bg-[var(--secondary)]",
    muted: "bg-[var(--border-strong)]",
  }[accent ?? "muted"];
  return (
    <Card className="relative overflow-hidden p-5">
      <span className={cn("absolute left-0 top-0 h-full w-1", accentBar)} />
      <div className="flex flex-col gap-1 pl-2">
        <span className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{label}</span>
        <span className="text-2xl font-semibold text-[var(--foreground)]">{value}</span>
        {sub && <span className="text-xs text-[var(--muted-foreground)]">{sub}</span>}
      </div>
    </Card>
  );
}

export function Badge({
  children, tone = "default",
}: { children: React.ReactNode; tone?: "default" | "green" | "amber" | "red" | "blue" | "navy" }) {
  const tones = {
    default: "bg-[var(--muted)] text-[var(--foreground-soft)]",
    green: "bg-[var(--secondary-soft)] text-[#5a7234]",
    amber: "bg-amber-50 text-amber-800",
    red: "bg-red-50 text-red-700",
    blue: "bg-[var(--primary-soft)] text-[var(--primary)]",
    navy: "bg-[#202f63] text-[#ffffff]",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium", tones[tone])}>
      {children}
    </span>
  );
}
