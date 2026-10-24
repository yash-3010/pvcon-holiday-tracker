"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { checkNetPayAction, type NetPayCheckState } from "./actions";

export function NetPayCheck({ code }: { code: string }) {
  const [state, formAction, pending] = useActionState<NetPayCheckState, FormData>(checkNetPayAction, {});
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="code" value={code} />
      <Field label="Net pay on the payslip" htmlFor="netPay" hint="We only say whether it matches; the amount is never shown here.">
        <Input id="netPay" name="netPay" inputMode="decimal" autoComplete="off" required placeholder="e.g. 46,367.00" />
      </Field>
      {state.error && <Alert variant="destructive">{state.error}</Alert>}
      {state.matched === true && <Alert variant="success" title="Match">The net pay matches the issued payslip.</Alert>}
      {state.matched === false && (
        <Alert variant="destructive" title="No match">The net pay doesn&apos;t match the issued payslip. The document may have been altered.</Alert>
      )}
      <Button type="submit" variant="outline" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        Check net pay
      </Button>
    </form>
  );
}
