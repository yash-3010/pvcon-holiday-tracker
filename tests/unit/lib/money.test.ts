import { describe, expect, it } from "vitest";
import { amountInWords, formatMoney, roundMinor, toMajor, toMinor } from "@/lib/money";

describe("money", () => {
  it("converts between major and minor units", () => {
    expect(toMinor(1234.56)).toBe(123456);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMajor(123456)).toBe(1234.56);
  });

  it("rounds minor units to whole currency units", () => {
    expect(roundMinor(12345, "nearest")).toBe(12300);
    expect(roundMinor(12350, "nearest")).toBe(12400);
    expect(roundMinor(12301, "up")).toBe(12400);
    expect(roundMinor(12399, "down")).toBe(12300);
    expect(roundMinor(123.6, "none")).toBe(124);
    expect(Object.is(roundMinor(-40, "nearest"), 0)).toBe(true);
  });

  it("formats with the Indian numbering system for INR", () => {
    expect(formatMoney(12345678)).toBe("₹1,23,456.78");
    expect(formatMoney(123456, "USD", "en-US")).toBe("$1,234.56");
  });

  it("spells INR amounts using lakh and crore", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(100)).toBe("Rupees One Only");
    expect(amountInWords(123456789)).toBe(
      "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Eighty Nine Paise Only",
    );
    expect(amountInWords(1_000_000_000)).toBe("Rupees One Crore Only");
    expect(amountInWords(1_234_567_800_000)).toBe(
      "Rupees One Thousand Two Hundred Thirty Four Crore Fifty Six Lakh Seventy Eight Thousand Only",
    );
    expect(amountInWords(-5000)).toBe("Minus Rupees Fifty Only");
  });

  it("spells other currencies with the international system", () => {
    expect(amountInWords(123456789, "USD")).toBe(
      "USD One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven and 89/100 Only",
    );
  });
});
