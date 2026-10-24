import { cn } from "@/lib/utils";

/** Colour dot + code, with the name as a tooltip or alongside. */
export function LeaveTypeTag({
  code,
  name,
  color,
  showName = false,
  className,
}: {
  code: string;
  name: string;
  color: string | null;
  showName?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)} title={showName ? undefined : name}>
      <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-muted-foreground" style={color ? { backgroundColor: color } : undefined} />
      <span className="font-medium">{code}</span>
      {showName && <span className="text-muted-foreground">{name}</span>}
    </span>
  );
}
