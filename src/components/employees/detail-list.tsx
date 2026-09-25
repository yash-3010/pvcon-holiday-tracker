import type { ReactNode } from "react";
import type { BankView } from "@/server/modules/employees/sensitive";

export interface DetailItem {
  label: string;
  value: ReactNode;
}

const isEmpty = (value: ReactNode) => value === null || value === undefined || value === "" || value === false;

/** Label/value pairs; empty values show a dash. */
export function DetailList({ items, columns = 2 }: { items: DetailItem[]; columns?: 1 | 2 }) {
  return (
    <dl className={columns === 2 ? "grid gap-x-6 gap-y-4 sm:grid-cols-2" : "grid gap-y-4"}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 break-words text-sm">{isEmpty(item.value) ? <span className="text-muted-foreground">—</span> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function bankDetailItems(bank: Pick<BankView, "bankName" | "bankAccount" | "bankIfsc" | "pan" | "aadhaar" | "passport">): DetailItem[] {
  return [
    { label: "Bank name", value: bank.bankName },
    { label: "Account number", value: bank.bankAccount },
    { label: "IFSC", value: bank.bankIfsc },
    { label: "PAN", value: bank.pan },
    { label: "Aadhaar", value: bank.aadhaar },
    { label: "Passport", value: bank.passport },
  ];
}
