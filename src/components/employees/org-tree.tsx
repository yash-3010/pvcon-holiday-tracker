import Link from "next/link";
import type { OrgChartNode } from "@/server/modules/employees/queries";

function NodeCard({ node, canOpen }: { node: OrgChartNode; canOpen: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border bg-card px-3 py-2">
      <span className="text-sm font-medium">
        {canOpen ? (
          <Link href={`/org/employees/${node.id}`} className="hover:underline">
            {node.displayName}
          </Link>
        ) : (
          node.displayName
        )}
      </span>
      <span className="text-xs text-muted-foreground">{[node.designationName, node.departmentName].filter(Boolean).join(" · ")}</span>
      {node.reports.length > 0 && <span className="text-xs text-muted-foreground">{node.reports.length} direct report(s)</span>}
    </span>
  );
}

/** Nested reporting lines; the first two levels start expanded. Pure server component (native <details>). */
export function OrgTree({ nodes, profileIds, depth = 0 }: { nodes: OrgChartNode[]; profileIds: "all" | Set<number>; depth?: number }) {
  const canOpen = (id: number) => profileIds === "all" || profileIds.has(id);
  return (
    <ul className={depth === 0 ? "space-y-2" : "mt-2 space-y-2 border-l pl-5"}>
      {nodes.map((node) => (
        <li key={node.id}>
          {node.reports.length > 0 ? (
            <details open={depth < 2}>
              <summary className="cursor-pointer list-none">
                <NodeCard node={node} canOpen={canOpen(node.id)} />
              </summary>
              <OrgTree nodes={node.reports} profileIds={profileIds} depth={depth + 1} />
            </details>
          ) : (
            <NodeCard node={node} canOpen={canOpen(node.id)} />
          )}
        </li>
      ))}
    </ul>
  );
}
