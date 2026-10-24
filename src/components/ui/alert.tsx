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
