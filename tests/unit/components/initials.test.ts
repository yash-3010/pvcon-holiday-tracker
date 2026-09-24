import { describe, expect, it } from "vitest";
import { initials } from "@/components/ui/avatar";

describe("initials", () => {
  it("takes the first letter of the first two words, uppercased", () => {
    expect(initials("asha kumari rao")).toBe("AK");
    expect(initials("System Admin")).toBe("SA");
  });
  it("ignores extra whitespace", () => {
    expect(initials("  Ravi   Menon ")).toBe("RM");
  });
  it("handles single words and empty names", () => {
    expect(initials("admin")).toBe("A");
    expect(initials("   ")).toBe("");
  });
});
