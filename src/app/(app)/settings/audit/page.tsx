import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PaginationLinks } from "@/components/ui/pagination-links";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, isISODate } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listAudit } from "@/server/modules/audit/service";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = { title: "Audit log" };

type Search = { entity?: string; action?: string; from?: string; to?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const params = {
    entity: sp.entity?.trim() || undefined,
    action: sp.action?.trim() || undefined,
    from: sp.from && isISODate(sp.from) ? sp.from : undefined,
    to: sp.to && isISODate(sp.to) ? sp.to : undefined,
  };
  const { rows, total, page, pageSize } = listAudit(db, {
    entityType: params.entity,
    actionPrefix: params.action,
    from: params.from,
    to: params.to,
    page: Number(sp.page) || 1,
    pageSize: 50,
  });
  const { timezone } = getSetting(db, "locale");

  return (
    <>
      <PageHeader title="Audit log" description="Every change made in PVCON People, who made it and when." />
      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-5">
        <Input name="entity" placeholder="Entity (e.g. user)" defaultValue={params.entity} aria-label="Entity type" />
        <Input name="action" placeholder="Action prefix (e.g. settings.)" defaultValue={params.action} aria-label="Action prefix" />
        <Input name="from" type="date" defaultValue={params.from} aria-label="From date" />
        <Input name="to" type="date" defaultValue={params.to} aria-label="To date" />
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">
            Filter
          </Button>
          <Button asChild variant="outline">
            <Link href="/settings/audit">Reset</Link>
          </Button>
        </div>
      </form>
      <Card className="mb-4">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No entries match these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(r.at, timezone)}</TableCell>
                  <TableCell>{r.actorName ?? <span className="text-muted-foreground">System</span>}</TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="text-xs">
                    {r.entityType}
                    {r.entityId ? ` #${r.entityId}` : ""}
                  </TableCell>
                  <TableCell>{r.summary}</TableCell>
                  <TableCell>
                    {r.diff || r.ip ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-primary">View</summary>
                        {r.diff && <pre className="mt-2 max-w-md overflow-x-auto rounded bg-muted p-2">{JSON.stringify(r.diff, null, 2)}</pre>}
                        {r.ip && <p className="mt-1 text-muted-foreground">IP {r.ip}</p>}
                      </details>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <PaginationLinks page={page} pageSize={pageSize} total={total} basePath="/settings/audit" params={params} />
    </>
  );
}
