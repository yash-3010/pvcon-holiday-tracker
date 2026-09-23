/** Money is stored as integer minor units (paise for INR). */
export type Minor = number;
export type RoundMode = "none" | "nearest" | "up" | "down";

const normalizeZero = (n: number) => (Object.is(n, -0) ? 0 : n);

export function toMinor(major: number): Minor {
  return normalizeZero(Math.round(major * 100));
}

export function toMajor(minor: Minor): number {
  return minor / 100;
}

/** `none` rounds to whole minor units; the others round to whole major units (e.g. rupees). */
export function roundMinor(minor: number, mode: RoundMode): Minor {
  let r: number;
  switch (mode) {
    case "none":
      r = Math.round(minor);
      break;
    case "nearest":
      r = Math.round(minor / 100) * 100;
      break;
    case "up":
      r = Math.ceil(minor / 100) * 100;
      break;
    case "down":
      r = Math.floor(minor / 100) * 100;
      break;
  }
  return normalizeZero(r);
}

export function formatMoney(
  minor: Minor,
  currency = "INR",
  locale = currency === "INR" ? "en-IN" : "en-US",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
}

function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? twoDigits(rest) : ""]
    .filter(Boolean)
    .join(" ");
}

function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  let rest = n % 10_000_000;
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

function internationalWords(n: number): string {
  if (n === 0) return "Zero";
  const scales: [number, string][] = [
    [1_000_000_000_000, "Trillion"],
    [1_000_000_000, "Billion"],
    [1_000_000, "Million"],
    [1000, "Thousand"],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [value, name] of scales) {
    const chunk = Math.floor(rest / value);
    if (chunk) {
      parts.push(`${internationalWords(chunk)} ${name}`);
      rest %= value;
    }
  }
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

export function amountInWords(minor: Minor, currency = "INR"): string {
  const abs = Math.round(Math.abs(minor));
  const major = Math.floor(abs / 100);
  const fraction = abs % 100;
  const sign = minor < 0 ? "Minus " : "";
  if (currency === "INR") {
    const paise = fraction ? ` and ${twoDigits(fraction)} Paise` : "";
    return `${sign}Rupees ${indianWords(major)}${paise} Only`;
  }
  const cents = fraction ? ` and ${String(fraction).padStart(2, "0")}/100` : "";
  return `${sign}${currency} ${internationalWords(major)}${cents} Only`;
}
