"use client";

import { useFormContext } from "react-hook-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export interface BankFormShape {
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  pan: string | null;
  aadhaar: string | null;
  passport: string | null;
}

/** `keepHint`: change-request mode, where blank fields keep the current value. */
export function BankFields({ keepHint = false }: { keepHint?: boolean }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<BankFormShape>();
  const hint = keepHint ? "Leave blank to keep the current value" : undefined;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Bank name" htmlFor="bankName" error={errors.bankName?.message} hint={hint}>
        <Input id="bankName" {...register("bankName")} />
      </Field>
      <Field label="Account number" htmlFor="bankAccount" error={errors.bankAccount?.message} hint={hint}>
        <Input id="bankAccount" inputMode="numeric" autoComplete="off" {...register("bankAccount")} />
      </Field>
      <Field label="IFSC" htmlFor="bankIfsc" error={errors.bankIfsc?.message} hint={hint}>
        <Input id="bankIfsc" autoComplete="off" {...register("bankIfsc")} />
      </Field>
      <Field label="PAN" htmlFor="pan" error={errors.pan?.message} hint={hint}>
        <Input id="pan" autoComplete="off" {...register("pan")} />
      </Field>
      <Field label="Aadhaar" htmlFor="aadhaar" error={errors.aadhaar?.message} hint={hint}>
        <Input id="aadhaar" inputMode="numeric" autoComplete="off" {...register("aadhaar")} />
      </Field>
      <Field label="Passport" htmlFor="passport" error={errors.passport?.message} hint={hint}>
        <Input id="passport" autoComplete="off" {...register("passport")} />
      </Field>
    </div>
  );
}
