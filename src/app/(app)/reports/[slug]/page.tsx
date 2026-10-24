import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Download } from "lucide-react";
import { FilterBar } from "@/components/reports/filter-bar";
import { ReportChart } from "@/components/reports/report-chart";
import { ReportTable } from "@/components/reports/report-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { filterOptions } from "@/server/modules/reports/options";
import { findReport, runReport } from "@/server/modules/reports/registry";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return { title: findReport((await params).slug)?.title ?? "Report" };
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { slug } = await params;
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  let run;
  try {
    run = runReport(db, user, slug, raw);
  } catch (err) {
    if (err instanceof DomainError && err.code === "NOT_FOUND") notFound();
    if (err instanceof DomainError && err.code === "FORBIDDEN") forbidden();
    throw err;
  }
  const { report, params: values, result, ctx } = run;
  const query = new URLSearchParams(Object.entries(raw).filter((e): e is [string, string] => !!e[1]));
  const exportUrl = (format: string) => `/api/exports/${report.slug}?${new URLSearchParams([...query, ["format", format]])}`;
  return (
    <>
      <PageHeader
        title={report.title}
        description={report.description}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={exportUrl("xlsx")}>
                <Download /> Excel
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={exportUrl("csv")}>
                <Download /> CSV
              </a>
            </Button>
          </div>
        }
      />
      <div className="space-y-4">
        <p className="text-sm">
          <Link href="/reports" className="text-primary hover:underline">
            All reports
          </Link>
          {ctx.scope !== null && <span className="text-muted-foreground"> · Showing the people who report to you</span>}
        </p>
        <FilterBar filters={report.filters} params={values} options={filterOptions(db, report.filters, ctx.scope)} />
        {result.chart && result.rows.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <ReportChart chart={result.chart} rows={result.rows} />
            </CardContent>
          </Card>
        )}
        <ReportTable columns={result.columns} rows={result.rows} />
        {result.note && <p className="text-xs text-muted-foreground">{result.note}</p>}
      </div>
    </>
  );
}
