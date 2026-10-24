/** Formula language (spec §5.6): numbers, identifiers, arithmetic, comparisons, and/or/not, calls. Never `eval`. */

export class FormulaError extends Error {
  constructor(
    message: string,
    /** Character offset in the formula. */
    readonly position = 0,
  ) {
    super(message);
    this.name = "FormulaError";
  }
}

export const MAX_FORMULA_LENGTH = 500;

export type Token =
  | { type: "num"; value: string; pos: number }
  | { type: "ident"; value: string; pos: number }
  | { type: "op"; value: string; pos: number }
  | { type: "kw"; value: "and" | "or" | "not"; pos: number }
  | { type: "eof"; value: ""; pos: number };

const KEYWORDS = new Set(["and", "or", "not"]);
const TWO_CHAR = new Set(["<=", ">=", "==", "!="]);
const ONE_CHAR = new Set(["+", "-", "*", "/", "%", "(", ")", ",", "<", ">"]);

export function tokenize(text: string): Token[] {
  if (text.length > MAX_FORMULA_LENGTH) throw new FormulaError(`Formulas are limited to ${MAX_FORMULA_LENGTH} characters`, MAX_FORMULA_LENGTH);
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+(\.\d*)?|\.\d+)/.exec(text.slice(i));
      if (!m) throw new FormulaError(`Unexpected ${c}`, i);
      if (/^[A-Za-z_.]/.test(text.slice(i + m[0].length))) throw new FormulaError(`Unexpected ${text[i + m[0].length]}`, i + m[0].length);
      tokens.push({ type: "num", value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))!;
      if (text[i + m[0].length] === ".") throw new FormulaError("Unexpected .", i + m[0].length);
      tokens.push(KEYWORDS.has(m[0]) ? { type: "kw", value: m[0] as "and" | "or" | "not", pos: i } : { type: "ident", value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (TWO_CHAR.has(two)) {
      tokens.push({ type: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR.has(c)) {
      tokens.push({ type: "op", value: c, pos: i });
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected ${c}`, i);
  }
  tokens.push({ type: "eof", value: "", pos: text.length });
  return tokens;
}
