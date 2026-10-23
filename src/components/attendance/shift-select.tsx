"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { assignShiftAction } from "@/app/(app)/time/shifts/actions";

/** Moves one employee to another shift (empty = the default). */
export function ShiftSelect({
  employeeId, current, defaultName, shifts,
}: {
  employeeId: number;
  current: number | null;
  defaultName: string;
  shifts: { id: number; name: string; times: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(current === null ? "" : String(current));
  const save = useServerAction(assignShiftAction, { successMessage: "Shift changed from today", onSuccess: () => router.refresh() });
  const changed = value !== (current === null ? "" : String(current));
  return (
    <div className="flex flex-wrap gap-2">
      <NativeSelect aria-label="Shift" value={value} onChange={(e) => setValue(e.target.value)} className="w-64">
        <option value="">Default ({defaultName})</option>
        {shifts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.times})
          </option>
        ))}
      </NativeSelect>
      <Button
        variant="outline"
        disabled={!changed || save.pending}
        onClick={() => save.run({ shiftId: value === "" ? null : Number(value), employeeIds: [employeeId] })}
      >
        {save.pending && <Spinner />}
        Change shift
      </Button>
    </div>
  );
}
