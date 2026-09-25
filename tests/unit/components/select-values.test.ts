import { describe, expect, it } from "vitest";
import { idOrNull, textOrNull } from "@/components/forms/select-values";

describe("select value converters", () => {
  it("turns empty select values into null and ids into numbers", () => {
    expect(idOrNull("")).toBeNull();
    expect(idOrNull(null)).toBeNull();
    expect(idOrNull("12")).toBe(12);
    expect(idOrNull(7)).toBe(7);
    expect(textOrNull("")).toBeNull();
    expect(textOrNull("female")).toBe("female");
  });
});
