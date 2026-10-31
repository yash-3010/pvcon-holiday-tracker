import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/dates";
import { EMPLOYEE_EVENT_LABELS, type EventValues } from "@/lib/hr";
import { eventFieldLabel, formatEventValue } from "@/lib/hr-events";
import type { EmployeeEventView } from "@/server/modules/employees/queries";

function Changes({ from, to }: { from: EventValues | null; to: EventValues | null }) {
  const keys = [...new Set([...Object.keys(from ?? {}), ...Object.keys(to ?? {})])];
  if (keys.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-sm">
      {keys.map((key) => (
        <li key={key}>
          <span className="text-muted-foreground">{eventFieldLabel(key)}:</span>{" "}
          {from && key in from ? `${formatEventValue(key, from[key])} → ` : ""}
          {formatEventValue(key, to?.[key])}
        </li>
      ))}
    </ul>
  );
}

export function EventsTimeline({ events }: { events: EmployeeEventView[] }) {
  if (events.length === 0) {
    return <EmptyState title="No history yet" description="Joining, transfers and other job changes appear here." />;
  }
  return (
    <ol className="space-y-5 border-l pl-6">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span aria-hidden className="absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-background bg-primary" />
          <p className="text-sm font-medium">{EMPLOYEE_EVENT_LABELS[event.type]}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(event.effectiveDate)}
            {event.createdByName ? ` · by ${event.createdByName}` : ""}
          </p>
          <Changes from={event.from} to={event.to} />
          {event.note && <p className="mt-1 text-sm text-muted-foreground">{event.note}</p>}
        </li>
      ))}
    </ol>
  );
}
