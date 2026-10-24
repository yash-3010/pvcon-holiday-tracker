import type { IdNumbers } from "@/lib/hr";
import type { BankInput } from "@/lib/validation/employees";
import { decrypt, encrypt, mask } from "@/server/lib/crypto";

/** How the bank block is stored on `employees` (and in change requests). */
export interface BankSource {
  bankName: string | null;
  bankAccountEnc: string | null;
  bankIfsc: string | null;
  idNumbersEnc: string | null;
}

/** The bank block as shown to a person: masked (`XXXX1234`) unless revealed. */
export interface BankView {
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  pan: string | null;
  aadhaar: string | null;
  passport: string | null;
  masked: boolean;
}

export function openIdNumbers(enc: string | null): IdNumbers {
  if (!enc) return { pan: null, aadhaar: null, passport: null };
  const parsed = JSON.parse(decrypt(enc)) as Partial<IdNumbers>;
  return { pan: parsed.pan ?? null, aadhaar: parsed.aadhaar ?? null, passport: parsed.passport ?? null };
}

export function sealBank(input: BankInput): BankSource {
  const ids: IdNumbers = { pan: input.pan, aadhaar: input.aadhaar, passport: input.passport };
  return {
    bankName: input.bankName,
    bankAccountEnc: input.bankAccount ? encrypt(input.bankAccount) : null,
    bankIfsc: input.bankIfsc,
    idNumbersEnc: ids.pan || ids.aadhaar || ids.passport ? encrypt(JSON.stringify(ids)) : null,
  };
}

export function openBank(source: BankSource): BankInput {
  return {
    bankName: source.bankName,
    bankAccount: source.bankAccountEnc ? decrypt(source.bankAccountEnc) : null,
    bankIfsc: source.bankIfsc,
    ...openIdNumbers(source.idNumbersEnc),
  };
}

const maskOrNull = (value: string | null) => (value ? mask(value) : null);

/** Pass `reveal: true` only when the viewer holds `employee.sensitive.view` (spec §3.4). */
export function bankView(source: BankSource, reveal: boolean): BankView {
  const plain = openBank(source);
  if (reveal) return { ...plain, masked: false };
  return {
    bankName: plain.bankName,
    bankAccount: maskOrNull(plain.bankAccount),
    bankIfsc: plain.bankIfsc,
    pan: maskOrNull(plain.pan),
    aadhaar: maskOrNull(plain.aadhaar),
    passport: maskOrNull(plain.passport),
    masked: true,
  };
}
