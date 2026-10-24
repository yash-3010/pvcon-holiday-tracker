import { Badge } from "@/components/ui/badge";

const BADGE = { pending: "warning", approved: "success", rejected: "destructive", withdrawn: "secondary" } as const;
const LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" } as const;

/** Status of a regularization request or a comp-off claim. */
export function RequestStatusBadge({ status }: { status: string }) {
  const s = status as keyof typeof BADGE;
  return <Badge variant={BADGE[s] ?? "secondary"}>{LABEL[s] ?? status}</Badge>;
}
