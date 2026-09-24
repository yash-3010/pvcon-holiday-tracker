import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listRecentJobRuns } from "@/server/jobs/queries";
import { JOBS } from "@/server/jobs/registry";
import { getSetting } from "@/server/modules/settings/service";
import { RunJobButton } from "./run-job-button";

export const metadata: Metadata = { title: "Jobs" };

const STATUS_VARIANT = { succeeded: "success", failed: "destructive", running: "info" } as const;

export default async function JobsPage() {
  await requirePermission("job.run");
  const { timezone } = getSetting(db, "locale");
  const runs = listRecentJobRuns(db, 50);
  return (
    <>
      <PageHeader
        title="Jobs"
        description="Scheduled background jobs. Cron calls POST /api/cron/<job>; you can also run them here. Each job runs once per period."
      />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {JOBS.map((job) => {
          const last = runs.find((r) => r.job === job.name);
          return (
            <Card key={job.name}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="space-y-1">
                  <CardTitle className="font-mono text-sm">{job.name}</CardTitle>
                  <CardDescription>{job.description}</CardDescription>
                  {last && (
                    <p className="text-xs text-muted-foreground">
                      Last: <Badge variant={STATUS_VARIANT[last.status]}>{last.status}</Badge>{" "}
                      {formatDateTime(last.startedAt, timezone)}
                    </p>
                  )}
                </div>
                <RunJobButton name={job.name} />
              </CardHeader>
            </Card>
          );
        })}
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Job</TableHead>
              <TableHead>Run key</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.job}</TableCell>
                <TableCell className="font-mono text-xs">{r.runKey}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{formatDateTime(r.startedAt, timezone)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
