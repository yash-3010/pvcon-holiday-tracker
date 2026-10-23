import { FormulaError } from "./lexer";
import type { Node } from "./parser";

const truthy = (n: number) => n !== 0;
const bool = (b: boolean) => (b ? 1 : 0);

function roundTo(x: number, digits: number): number {
  if (!Number.isInteger(digits) || digits < 0 || digits > 6) throw new FormulaError("round digits must be a whole number from 0 to 6");
  const f = 10 ** digits;
  // Nudge by a tiny relative amount so values like 1.005 round the way people expect.
  return Math.round(x * f * (1 + Number.EPSILON * Math.sign(x))) / f;
}

function evalNode(node: Node, vars: Readonly<Record<string, number>>): number {
  switch (node.type) {
    case "num":
      return node.value;
    case "ident":
      if (!Object.hasOwn(vars, node.name)) throw new FormulaError(`Unknown name ${node.name}`, node.pos);
      return vars[node.name]!;
    case "unary": {
      const v = evalNode(node.arg, vars);
      return node.op === "-" ? -v : bool(!truthy(v));
    }
    case "binary": {
      if (node.op === "and") return bool(truthy(evalNode(node.left, vars)) && truthy(evalNode(node.right, vars)));
      if (node.op === "or") return bool(truthy(evalNode(node.left, vars)) || truthy(evalNode(node.right, vars)));
      const a = evalNode(node.left, vars);
      const b = evalNode(node.right, vars);
      switch (node.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/":
          if (b === 0) throw new FormulaError("Division by zero");
          return a / b;
        case "%":
          if (b === 0) throw new FormulaError("Division by zero");
          return a % b;
        case "<": return bool(a < b);
        case "<=": return bool(a <= b);
        case ">": return bool(a > b);
        case ">=": return bool(a >= b);
        case "==": return bool(a === b);
        case "!=": return bool(a !== b);
        default:
          throw new FormulaError(`Unknown operator ${node.op}`);
      }
    }
    case "call": {
      const args = node.args;
      switch (node.name) {
        case "if":
          return truthy(evalNode(args[0]!, vars)) ? evalNode(args[1]!, vars) : evalNode(args[2]!, vars);
        case "min":
          return Math.min(...args.map((a) => evalNode(a, vars)));
        case "max":
          return Math.max(...args.map((a) => evalNode(a, vars)));
        case "round":
          return roundTo(evalNode(args[0]!, vars), args[1] ? evalNode(args[1], vars) : 0);
        case "floor":
          return Math.floor(evalNode(args[0]!, vars));
        case "ceil":
          return Math.ceil(evalNode(args[0]!, vars));
        case "abs":
          return Math.abs(evalNode(args[0]!, vars));
      }
    }
  }
}

/** Evaluates a parsed formula. Booleans are 1/0. Throws `FormulaError` for unknown names, division by zero, non-finite results. */
export function evaluate(node: Node, vars: Readonly<Record<string, number>>): number {
  const result = evalNode(node, vars);
  if (!Number.isFinite(result)) throw new FormulaError("The result is not a finite number");
  return result;
}
