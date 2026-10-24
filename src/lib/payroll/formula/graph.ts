import { FormulaError } from "./lexer";

/**
 * Topological order of components by their dependencies (Kahn's algorithm), stable with respect to the input order.
 * Dependencies on codes not in `nodes` are ignored; callers validate unknown names. Throws on a cycle, naming it.
 */
export function dependencyOrder(nodes: readonly { code: string; deps: readonly string[] }[]): string[] {
  const codes = new Set(nodes.map((n) => n.code));
  const deps = new Map(nodes.map((n) => [n.code, [...new Set(n.deps)].filter((d) => codes.has(d) && d !== n.code)]));
  const selfLoop = nodes.find((n) => n.deps.includes(n.code));
  if (selfLoop) throw new FormulaError(`Circular reference: ${selfLoop.code} → ${selfLoop.code}`);

  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < nodes.length) {
    const ready = nodes.find((n) => !done.has(n.code) && deps.get(n.code)!.every((d) => done.has(d)));
    if (!ready) throw new FormulaError(`Circular reference: ${findCycle(nodes.filter((n) => !done.has(n.code)).map((n) => n.code), deps).join(" → ")}`);
    order.push(ready.code);
    done.add(ready.code);
  }
  return order;
}

function findCycle(remaining: string[], deps: Map<string, string[]>): string[] {
  const left = new Set(remaining);
  const path: string[] = [];
  const onPath = new Set<string>();
  const visit = (code: string): string[] | null => {
    path.push(code);
    onPath.add(code);
    for (const d of deps.get(code) ?? []) {
      if (!left.has(d)) continue;
      if (onPath.has(d)) return [...path.slice(path.indexOf(d)), d];
      const found = visit(d);
      if (found) return found;
    }
    path.pop();
    onPath.delete(code);
    return null;
  };
  for (const code of remaining) {
    const cycle = visit(code);
    if (cycle) return cycle;
  }
  return remaining;
}
