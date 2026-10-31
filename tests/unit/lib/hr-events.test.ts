import { describe, expect, it } from "vitest";
import { eventFieldLabel, formatEventValue } from "@/lib/hr-events";

describe("employee history values", () => {
  it("shows a CTC stored in paise as rupees", () => {
    expect(eventFieldLabel("annualCtc")).toBe("Annual CTC");
    expect(formatEventValue("annualCtc", 150_000_000)).toBe("₹15,00,000.00");
  });

  it("formats dates, labels other fields from their key, and shows a dash for nothing", () => {
    expect(eventFieldLabel("confirmationDate")).toBe("Confirmation Date");
    expect(formatEventValue("confirmationDate", "2027-04-01")).toBe("01 Apr 2027");
    expect(formatEventValue("department", "Engineering")).toBe("Engineering");
    expect(formatEventValue("manager", null)).toBe("—");
  });
});
