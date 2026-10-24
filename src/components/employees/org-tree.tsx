import Link from "next/link";
import type { OrgChartNode } from "@/server/modules/employees/queries";
import { OrgBranch } from "./org-branch";

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

/** Nested reporting lines; the first two levels start expanded. */
export function OrgTree({ nodes, profileIds, depth = 0 }: { nodes: OrgChartNode[]; profileIds: "all" | Set<number>; depth?: number }) {
  const canOpen = (id: number) => profileIds === "all" || profileIds.has(id);
  return (
    <ul className={depth === 0 ? "space-y-2" : "mt-2 space-y-2 border-l pl-5"}>
      {nodes.map((node) => (
        <li key={node.id}>
          {node.reports.length > 0 ? (
            <OrgBranch name={node.displayName} defaultOpen={depth < 2} card={<NodeCard node={node} canOpen={canOpen(node.id)} />}>
              <OrgTree nodes={node.reports} profileIds={profileIds} depth={depth + 1} />
            </OrgBranch>
          ) : (
            // Lines up with the cards that have an expand button.
            <div className="pl-7">
              <NodeCard node={node} canOpen={canOpen(node.id)} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
