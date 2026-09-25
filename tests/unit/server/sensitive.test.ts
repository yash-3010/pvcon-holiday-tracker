import { describe, expect, it } from "vitest";
import { bankView, openBank, openIdNumbers, sealBank } from "@/server/modules/employees/sensitive";

const input = {
  bankName: "HDFC Bank", bankAccount: "123456789012", bankIfsc: "HDFC0001234",
  pan: "ABCDE1234F", aadhaar: "123412341234", passport: null,
};

describe("sensitive bank fields", () => {
  it("encrypts the account and ID numbers and restores them", () => {
    const sealed = sealBank(input);
    expect(sealed.bankAccountEnc).toMatch(/^v1:/);
    expect(sealed.bankAccountEnc).not.toContain("123456789012");
    expect(sealed.idNumbersEnc).not.toContain("ABCDE1234F");
    expect(sealed).toMatchObject({ bankName: "HDFC Bank", bankIfsc: "HDFC0001234" });
    expect(openBank(sealed)).toEqual(input);
  });

  it("stores nothing when there are no values to protect", () => {
    const sealed = sealBank({ ...input, bankAccount: null, pan: null, aadhaar: null });
    expect(sealed.bankAccountEnc).toBeNull();
    expect(sealed.idNumbersEnc).toBeNull();
    expect(openIdNumbers(null)).toEqual({ pan: null, aadhaar: null, passport: null });
  });

  it("masks all but the last four characters unless revealed", () => {
    const sealed = sealBank(input);
    expect(bankView(sealed, false)).toEqual({
      bankName: "HDFC Bank", bankAccount: "XXXX9012", bankIfsc: "HDFC0001234",
      pan: "XXXX234F", aadhaar: "XXXX1234", passport: null, masked: true,
    });
    expect(bankView(sealed, true)).toEqual({ ...input, masked: false });
  });
});
