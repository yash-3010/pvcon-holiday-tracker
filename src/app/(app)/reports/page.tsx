import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/server/auth/session";
import { reportsFor } from "@/server/modules/reports/registry";
import { AREA_LABELS, type ReportArea } from "@/server/modules/reports/types";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await requireUser();
  const reports = reportsFor(user);
  if (!reports.length) forbidden();
  const areas = (Object.keys(AREA_LABELS) as ReportArea[]).filter((a) => reports.some((r) => r.area === a));
  return (
    <>
      <PageHeader title="Reports" description="Pick a report, set its filters, and export it to Excel or CSV." />
      <div className="grid gap-6 lg:grid-cols-2">
        {areas.map((area) => (
          <Card key={area}>
            <CardHeader>
              <CardTitle>{AREA_LABELS[area]}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {reports
                .filter((r) => r.area === area)
                .map((r) => (
                  <Link key={r.slug} href={`/reports/${r.slug}`} className="flex items-center justify-between gap-4 px-6 py-3 hover:bg-muted/60">
                    <div>
                      <p className="text-sm font-medium">{r.title}</p>
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
