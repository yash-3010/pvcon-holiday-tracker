"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { reviseSalaryAction } from "@/app/(app)/payroll/salaries/actions";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, toMajor, toMinor } from "@/lib/money";
import { applyOverrides, calculatePayslip } from "@/lib/payroll/calculate";
import { calcSummary } from "@/lib/payroll/preview";
import type { StructureOption } from "@/server/modules/payroll/queries";

export interface ReviseTarget {
  employeeId: number;
  name: string;
  /** The earliest month a salary can start: the month the employee joined. */
  joinedMonth: string;
  current: { annualCtc: number; structureId: number; overrides: Record<string, number | string> } | null;
}

type Mode = "default" | "amount" | "formula";

export function ReviseSalarySheet({
  open, onOpenChange, target, structures, defaultMonth,
}: { open: boolean; onOpenChange: (open: boolean) => void; target: ReviseTarget | null; structures: StructureOption[]; defaultMonth: string }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        {target && (
          <ReviseForm key={`${target.employeeId}-${open}`} target={target} structures={structures} defaultMonth={defaultMonth} onDone={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReviseForm({ target, structures, defaultMonth, onDone }: { target: ReviseTarget; structures: StructureOption[]; defaultMonth: string; onDone: () => void }) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth < target.joinedMonth ? target.joinedMonth : defaultMonth);
  const [ctc, setCtc] = useState(target.current ? String(toMajor(target.current.annualCtc)) : "");
  const [structureId, setStructureId] = useState(target.current?.structureId ?? structures[0]?.id ?? 0);
  const [reason, setReason] = useState("");
  const initialOverrides = Object.fromEntries(
    Object.entries(target.current?.overrides ?? {}).map(([code, v]) => [code, typeof v === "number" ? { mode: "amount" as Mode, text: String(toMajor(v)) } : { mode: "formula" as Mode, text: v }]),
  );
  const [overrides, setOverrides] = useState<Record<string, { mode: Mode; text: string }>>(initialOverrides);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const structure = structures.find((s) => s.id === structureId);
  const editable = (structure?.components ?? []).filter((c) => c.calc !== "input");

  // Overrides for components of the chosen structure, in rupees (amounts) or formulas.
  const raw = useMemo(() => {
    const out: Record<string, number | string> = {};
    for (const c of editable) {
      const o = overrides[c.code];
      if (!o || o.mode === "default" || !o.text.trim()) continue;
      out[c.code] = o.mode === "amount" ? Number(o.text) : o.text.trim();
    }
    return out;
  }, [editable, overrides]);

  const preview = useMemo(() => {
    const annual = Number(ctc);
    if (!structure || !annual || annual <= 0) return null;
    const paise = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "number" ? toMinor(v) : v]));
    return calculatePayslip({
      annualCtc: toMinor(annual), components: applyOverrides(structure.components, paise), inputs: [],
      variables: { TOTAL_DAYS: 30, PAID_DAYS: 30, WORKING_DAYS: 22, PRESENT_DAYS: 22 },
    });
  }, [ctc, structure, raw]);

  const { run, pending } = useServerAction(reviseSalaryAction, {
    successMessage: "Salary saved",
    onSuccess: () => {
      onDone();
      router.refresh();
    },
    onError: (r) => setFieldErrors(r.fieldErrors ?? {}),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    void run({ employeeId: target.employeeId, effectiveFrom: `${month}-01`, annualCtc: Number(ctc), structureId, overrides: raw, reason });
  };
  const error = (field: string) => fieldErrors[field]?.[0];

  return (
    <>
      <SheetHeader>
        <SheetTitle>Revise salary · {target.name}</SheetTitle>
        <SheetDescription>A revision applies from the 1st of its month. Back-dated revisions pay arrears in the next run.</SheetDescription>
      </SheetHeader>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-4 overflow-y-auto px-1">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="From month" htmlFor="effectiveFrom" error={error("effectiveFrom")} required>
            <Input id="effectiveFrom" type="month" min={target.joinedMonth} value={month} onChange={(e) => setMonth(e.target.value)} required />
          </Field>
          <Field label="Annual CTC (₹)" htmlFor="annualCtc" error={error("annualCtc")} required>
            <Input id="annualCtc" type="number" min={1} step="0.01" value={ctc} onChange={(e) => setCtc(e.target.value)} required />
          </Field>
          <Field label="Structure" htmlFor="structureId" error={error("structureId")}>
            <NativeSelect id="structureId" value={structureId} onChange={(e) => setStructureId(Number(e.target.value))}>
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Overrides for this employee</p>
          {error("overrides") && <p className="text-xs text-destructive">{error("overrides")}</p>}
          <div className="divide-y rounded-lg border">
            {editable.map((c) => {
              const o = overrides[c.code] ?? { mode: "default" as Mode, text: "" };
              const set = (next: Partial<{ mode: Mode; text: string }>) => setOverrides((all) => ({ ...all, [c.code]: { ...o, ...next } }));
              return (
                <div key={c.code} className="grid items-center gap-2 p-2 sm:grid-cols-[1fr_9rem_12rem]">
                  <div>
                    <p className="font-mono text-sm">{c.code}</p>
                    <p className="text-xs text-muted-foreground">{calcSummary(c)}</p>
                  </div>
                  <NativeSelect aria-label={`${c.code} override`} value={o.mode} onChange={(e) => set({ mode: e.target.value as Mode, text: "" })}>
                    <option value="default">As structure</option>
                    <option value="amount">Fixed amount</option>
                    <option value="formula">Formula</option>
                  </NativeSelect>
                  {o.mode === "default" ? (
                    <span />
                  ) : (
                    <Input
                      aria-label={`${c.code} ${o.mode}`}
                      type={o.mode === "amount" ? "number" : "text"}
                      step="0.01"
                      className={o.mode === "formula" ? "font-mono text-xs" : undefined}
                      placeholder={o.mode === "amount" ? "₹ a month" : "e.g. MONTHLY_CTC * 0.45"}
                      value={o.text}
                      onChange={(e) => set({ text: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Field label="Reason" htmlFor="reason" error={error("reason")}>
          <Textarea id="reason" rows={2} maxLength={300} placeholder="Annual increment, promotion…" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        {preview && (
          <div className="rounded-lg bg-muted/60 p-3 text-sm">
            {preview.errors.length ? (
              <p className="text-destructive">{preview.errors[0]}</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="pb-1 text-left font-normal">A full month</th>
                    <th className="pb-1 text-right font-normal">Monthly</th>
                    <th className="pb-1 text-right font-normal">Annual</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((l) => (
                    <tr key={l.code}>
                      <td className="py-0.5">{l.name}</td>
                      <td className="py-0.5 text-right tabular-nums">
                        {l.kind === "deduction" ? "−" : ""}
                        {formatMoney(l.amount)}
                      </td>
                      <td className="py-0.5 text-right tabular-nums text-muted-foreground">{formatMoney(l.amount * 12)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-semibold">
                    <td className="pt-1">Net pay</td>
                    <td className="pt-1 text-right tabular-nums">{formatMoney(preview.netPay)}</td>
                    <td className="pt-1 text-right tabular-nums text-muted-foreground">{formatMoney(preview.netPay * 12)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {preview.warnings.map((w) => (
              <p key={w} className="mt-1 text-xs text-warning">
                {w}
              </p>
            ))}
          </div>
        )}
        <SheetFooter>
          <Button type="submit" disabled={pending || !structure}>
            {pending && <Spinner />}
            Save revision
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}
