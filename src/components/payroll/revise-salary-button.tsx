"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StructureOption } from "@/server/modules/payroll/queries";
import { ReviseSalarySheet, type ReviseTarget } from "./revise-salary-sheet";

export function ReviseSalaryButton({ target, structures, defaultMonth }: { target: ReviseTarget; structures: StructureOption[]; defaultMonth: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil /> {target.current ? "Revise salary" : "Assign salary"}
      </Button>
      <ReviseSalarySheet open={open} onOpenChange={setOpen} target={target} structures={structures} defaultMonth={defaultMonth} />
    </>
  );
}
