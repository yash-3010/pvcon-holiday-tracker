import { FormulaError, tokenize, type Token } from "./lexer";

export type Node =
  | { type: "num"; value: number }
  | { type: "ident"; name: string; pos: number }
  | { type: "unary"; op: "-" | "not"; arg: Node }
  | { type: "binary"; op: string; left: Node; right: Node }
  | { type: "call"; name: FunctionName; args: Node[] };

export const FUNCTIONS = ["min", "max", "round", "floor", "ceil", "abs", "if"] as const;
export type FunctionName = (typeof FUNCTIONS)[number];

const ARITY: Record<FunctionName, [number, number]> = {
  min: [1, Infinity], max: [1, Infinity], round: [1, 2], floor: [1, 1], ceil: [1, 1], abs: [1, 1], if: [3, 3],
};

// Binding powers for infix operators; unary minus binds tighter than all of them.
const INFIX: Record<string, number> = {
  or: 1, and: 2, "<": 3, "<=": 3, ">": 3, ">=": 3, "==": 3, "!=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5,
};
const UNARY = 6;
/** `not` binds looser than comparisons and arithmetic (as in Python): `not A > B` is `not (A > B)`. */
const NOT = 2.5;
const MAX_DEPTH = 50;

function arityMessage(name: FunctionName): string {
  const [min, max] = ARITY[name];
  if (min === max) return `${name} takes ${min} argument${min === 1 ? "" : "s"}`;
  if (max === Infinity) return `${name} takes at least ${min} argument${min === 1 ? "" : "s"}`;
  return `${name} takes ${min} or ${max} arguments`;
}

/** A Pratt parser over the formula tokens. Throws `FormulaError` with a position. */
export function parseFormula(text: string): Node {
  const tokens = tokenize(text);
  let i = 0;
  const peek = (): Token => tokens[i]!;
  const next = (): Token => tokens[i++]!;
  const describe = (t: Token) => (t.type === "eof" ? "end of formula" : t.value);

  function expectOp(value: string): void {
    const t = next();
    if (t.type !== "op" || t.value !== value) throw new FormulaError(`Expected ${value}`, t.pos);
  }

  function parse(minPower: number, depth: number): Node {
    if (depth > MAX_DEPTH) throw new FormulaError("The formula is nested too deeply", peek().pos);
    const t = next();
    let left: Node;
    if (t.type === "num") left = { type: "num", value: Number(t.value) };
    else if (t.type === "ident") {
      if (peek().type === "op" && peek().value === "(") {
        if (!(FUNCTIONS as readonly string[]).includes(t.value)) throw new FormulaError(`Unknown function ${t.value}`, t.pos);
        const name = t.value as FunctionName;
        next();
        const args: Node[] = [];
        if (!(peek().type === "op" && peek().value === ")")) {
          for (;;) {
            args.push(parse(0, depth + 1));
            if (peek().type === "op" && peek().value === ",") {
              next();
              continue;
            }
            break;
          }
        }
        expectOp(")");
        const [min, max] = ARITY[name];
        if (args.length < min || args.length > max) throw new FormulaError(arityMessage(name), t.pos);
        left = { type: "call", name, args };
      } else {
        left = { type: "ident", name: t.value, pos: t.pos };
      }
    } else if (t.type === "op" && t.value === "(") {
      left = parse(0, depth + 1);
      expectOp(")");
    } else if (t.type === "op" && t.value === "-") {
      left = { type: "unary", op: "-", arg: parse(UNARY, depth + 1) };
    } else if (t.type === "kw" && t.value === "not") {
      left = { type: "unary", op: "not", arg: parse(NOT, depth + 1) };
    } else if (t.type === "eof") {
      throw new FormulaError("Unexpected end of formula", t.pos);
    } else {
      throw new FormulaError(`Unexpected ${describe(t)}`, t.pos);
    }

    for (;;) {
      const op = peek();
      const power = (op.type === "op" || op.type === "kw") && op.value in INFIX ? INFIX[op.value]! : 0;
      if (power === 0 || power <= minPower) break;
      next();
      left = { type: "binary", op: op.value, left, right: parse(power, depth + 1) };
    }
    return left;
  }

  const ast = parse(0, 0);
  const rest = peek();
  if (rest.type !== "eof") throw new FormulaError(`Unexpected ${describe(rest)}`, rest.pos);
  return ast;
}

/** Identifiers in first-use order, without duplicates. */
export function identifiers(node: Node): string[] {
  const seen: string[] = [];
  const walk = (n: Node) => {
    if (n.type === "ident" && !seen.includes(n.name)) seen.push(n.name);
    else if (n.type === "unary") walk(n.arg);
    else if (n.type === "binary") {
      walk(n.left);
      walk(n.right);
    } else if (n.type === "call") n.args.forEach(walk);
  };
  walk(node);
  return seen;
}

function firstPosition(node: Node, name: string): number {
  if (node.type === "ident") return node.name === name ? node.pos : -1;
  const children = node.type === "unary" ? [node.arg] : node.type === "binary" ? [node.left, node.right] : node.type === "call" ? node.args : [];
  for (const child of children) {
    const pos = firstPosition(child, name);
    if (pos >= 0) return pos;
  }
  return -1;
}

/** Parses and checks every identifier against `known`. */
export function validateFormula(
  text: string,
  known: ReadonlySet<string>,
): { ok: true; identifiers: string[] } | { ok: false; error: string; position: number } {
  try {
    const ast = parseFormula(text);
    const names = identifiers(ast);
    const unknown = names.find((n) => !known.has(n));
    if (unknown) return { ok: false, error: `Unknown name ${unknown}`, position: firstPosition(ast, unknown) };
    return { ok: true, identifiers: names };
  } catch (err) {
    if (err instanceof FormulaError) return { ok: false, error: err.message, position: err.position };
    throw err;
  }
}
