import { describe, expect, it } from "vitest";
import { formatCell } from "@/components/reports/report-table";

describe("formatCell", () => {
  it("formats durations, including negative ones, as hours and minutes", () => {
    const column = { key: "m", label: "Remaining", type: "minutes" } as const;
    expect([formatCell(column, 90), formatCell(column, 5), formatCell(column, -90), formatCell(column, -30)]).toEqual(["1:30", "0:05", "-1:30", "-0:30"]);
  });

  it("shows a dash for empty values", () => {
    expect(formatCell({ key: "x", label: "X", type: "money" }, null)).toBe("—");
  });
});
