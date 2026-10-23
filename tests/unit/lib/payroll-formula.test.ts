import { describe, expect, it } from "vitest";
import { evaluate } from "@/lib/payroll/formula/evaluate";
import { dependencyOrder } from "@/lib/payroll/formula/graph";
import { FormulaError, tokenize } from "@/lib/payroll/formula/lexer";
import { identifiers, parseFormula, validateFormula } from "@/lib/payroll/formula/parser";

const run = (text: string, vars: Record<string, number> = {}) => evaluate(parseFormula(text), vars);
const fails = (text: string, vars: Record<string, number> = {}) => {
  try {
    run(text, vars);
  } catch (err) {
    expect(err).toBeInstanceOf(FormulaError);
    return (err as FormulaError).message;
  }
  throw new Error(`"${text}" did not fail`);
};

describe("lexer", () => {
  it("reads numbers, identifiers, operators and keywords with positions", () => {
    expect(tokenize("BASIC_RATE * .5 >= 10 and not X").map((t) => [t.type, t.value, t.pos])).toEqual([
      ["ident", "BASIC_RATE", 0], ["op", "*", 11], ["num", ".5", 13], ["op", ">=", 16], ["num", "10", 19], ["kw", "and", 22],
      ["kw", "not", 26], ["ident", "X", 30], ["eof", "", 31],
    ]);
  });

  it("rejects anything outside the language", () => {
    for (const bad of ["a.b", "[1]", "'x'", '"x"', "a; b", "a = 1", "a & b", "1e5", "€"]) {
      expect(() => tokenize(bad), bad).toThrow(FormulaError);
    }
  });
});

describe("parser and evaluator", () => {
  it("follows precedence and associativity", () => {
    expect(run("2 + 3 * 4")).toBe(14);
    expect(run("(2 + 3) * 4")).toBe(20);
    expect(run("10 - 4 - 3")).toBe(3);
    expect(run("100 / 10 / 5")).toBe(2);
    expect(run("7 % 4 + -2")).toBe(1);
    expect(run("- - 3")).toBe(3);
    expect(run("1 + 2 > 2 and 3 < 4")).toBe(1);
    expect(run("1 == 2 or not 0")).toBe(1);
    expect(run("not 1 + 1")).toBe(0);
  });

  it("evaluates functions, with if() short-circuiting", () => {
    expect(run("min(3, 1, 2) + max(4, 9)")).toBe(10);
    expect(run("round(1.235, 2)")).toBe(1.24);
    expect(run("round(2.5)")).toBe(3);
    expect(run("floor(2.7) + ceil(2.1) + abs(-4)")).toBe(9);
    expect(run("if(0, 1 / 0, 2)")).toBe(2);
    expect(run("if(PAID_DAYS < TOTAL_DAYS, BASIC_RATE, 0)", { PAID_DAYS: 28, TOTAL_DAYS: 30, BASIC_RATE: 50000 })).toBe(50000);
    expect(run("0 and 1 / 0")).toBe(0);
    expect(run("1 or 1 / 0")).toBe(1);
  });

  it("reports unknown names, bad arity and runtime errors as formula errors", () => {
    expect(fails("UNKNOWN + 1")).toBe("Unknown name UNKNOWN");
    expect(fails("sqrt(4)")).toBe("Unknown function sqrt");
    expect(fails("round(1, 2, 3)")).toBe("round takes 1 or 2 arguments");
    expect(fails("if(1, 2)")).toBe("if takes 3 arguments");
    expect(fails("min()")).toBe("min takes at least 1 argument");
    expect(fails("1 / (2 - 2)")).toBe("Division by zero");
    expect(fails("5 % 0")).toBe("Division by zero");
    expect(fails("BASIC(2)", { BASIC: 1 })).toBe("Unknown function BASIC");
    expect(fails("(1 + 2")).toBe("Expected )");
    expect(fails("1 +")).toBe("Unexpected end of formula");
    expect(fails("1 2")).toBe("Unexpected 2");
  });

  it("stays inside its sandbox for hostile input", () => {
    const hostile = [
      "constructor", "__proto__", "toString", "process.exit()", "require('fs')", "globalThis", "this", "x => x",
      "`a`", "a[0]", "new Date()", "eval(1)", "Function(1)", "valueOf()",
      "1".repeat(501), `${"(".repeat(10_000)}1${")".repeat(10_000)}`, "-".repeat(400) + "1",
    ];
    for (const text of hostile) {
      try {
        run(text, { BASIC: 1 });
        throw new Error(`"${text.slice(0, 20)}" evaluated`);
      } catch (err) {
        expect(err, text.slice(0, 40)).toBeInstanceOf(FormulaError);
      }
    }
  });

  it("lists identifiers and validates against known names", () => {
    expect(identifiers(parseFormula("if(BASIC_RATE > 0, HRA + BASIC_RATE * 0.1, round(CTC))"))).toEqual(["BASIC_RATE", "HRA", "CTC"]);
    expect(validateFormula("BASIC * 0.12", new Set(["BASIC"]))).toEqual({ ok: true, identifiers: ["BASIC"] });
    expect(validateFormula("BASIC * PF_RATE", new Set(["BASIC"]))).toEqual({ ok: false, error: "Unknown name PF_RATE", position: 8 });
    expect(validateFormula("BASIC *", new Set(["BASIC"]))).toMatchObject({ ok: false, error: "Unexpected end of formula" });
  });
});

describe("dependency order", () => {
  it("orders components after what they depend on, keeping the given order otherwise", () => {
    expect(
      dependencyOrder([
        { code: "HRA", deps: ["BASIC"] },
        { code: "PF", deps: ["BASIC"] },
        { code: "BASIC", deps: [] },
        { code: "SPECIAL", deps: ["BASIC", "HRA"] },
      ]),
    ).toEqual(["BASIC", "HRA", "PF", "SPECIAL"]);
  });

  it("names the cycle it finds", () => {
    expect(() => dependencyOrder([{ code: "A", deps: ["B"] }, { code: "B", deps: ["C"] }, { code: "C", deps: ["A"] }])).toThrow(
      "Circular reference: A → B → C → A",
    );
  });
});
