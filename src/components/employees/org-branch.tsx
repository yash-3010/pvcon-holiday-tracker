"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** A manager's card with a button that shows or hides their reports; a <summary> can't hold the card's profile link. */
export function OrgBranch({ name, defaultOpen, card, children }: { name: string; defaultOpen: boolean; card: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} the reports of ${name}`}
          onClick={() => setOpen(!open)}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden />
        </button>
        {card}
      </div>
      {open && children}
    </>
  );
}
