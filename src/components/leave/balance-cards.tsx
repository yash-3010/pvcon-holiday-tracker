import { LeaveTypeTag } from "@/components/leave/leave-type-tag";
import { Card, CardContent } from "@/components/ui/card";
import { formatDays } from "@/lib/leave";
import type { LeaveBalance } from "@/server/modules/leave/ledger";

/** Leave taken as needed (no credits, may go negative) shows days used; everything else shows the balance. */
export function isUsageOnly(type: LeaveBalance["type"]): boolean {
  return type.allowNegative && type.accrual === "none" && type.annualQuota === 0 && !type.isCompOff;
}

export function BalanceCards({ balances, empty }: { balances: LeaveBalance[]; empty?: string }) {
  if (balances.length === 0) return <p className="text-sm text-muted-foreground">{empty ?? "No leave types yet."}</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {balances.map((b) => {
        const usageOnly = isUsageOnly(b.type);
        const value = usageOnly ? b.used : b.balance;
        const details = [
          !usageOnly && b.used ? `${formatDays(b.used)} used` : null,
          b.pending ? `${formatDays(b.pending)} pending` : null,
          b.opening > 0 ? `${formatDays(b.opening)} carried in` : null,
          b.closed > 0 ? `${formatDays(b.closed)} lapsed or carried on` : null,
        ].filter(Boolean);
        return (
          <Card key={b.type.id} data-testid={`balance-${b.type.code}`}>
            <CardContent className="space-y-1 p-4">
              <LeaveTypeTag code={b.type.code} name={b.type.name} color={b.type.color} showName className="text-sm" />
              <p className="text-2xl font-semibold tabular-nums">
                {Math.round(value * 100) / 100}
                <span className="ml-1 text-sm font-normal text-muted-foreground">{usageOnly ? "days used" : "days left"}</span>
              </p>
              <p className="text-xs text-muted-foreground">{details.length ? details.join(" · ") : "Nothing used yet"}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
