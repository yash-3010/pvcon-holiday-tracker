import { getPolicy } from "@/lib/leaves";
import { currentYear } from "@/lib/utils";
import { PolicyForm } from "./PolicyForm";

export default async function PolicyPage() {
  const year = currentYear();
  const policy = await getPolicy(year);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Leave Policy — {year}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Edit annual entitlements and rules.</p>
      </div>
      <PolicyForm initial={policy} />
    </div>
  );
}
