"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { WEEKDAY_LABELS } from "@/lib/leave";

// Monday first, the way people read a week.
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** Checkboxes for the days of the week (0 = Sunday). */
export function WeekdayPicker({ value, onChange, idPrefix }: { value: number[]; onChange: (days: number[]) => void; idPrefix: string }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {WEEK.map((day) => {
        const id = `${idPrefix}-${day}`;
        return (
          <div key={day} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={value.includes(day)}
              onCheckedChange={(checked) => onChange(checked ? [...value, day] : value.filter((d) => d !== day))}
            />
            <Label htmlFor={id}>{WEEKDAY_LABELS[day]}</Label>
          </div>
        );
      })}
    </div>
  );
}
