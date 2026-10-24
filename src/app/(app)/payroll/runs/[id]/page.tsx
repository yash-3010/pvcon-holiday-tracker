import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { formatPeriod, todayInTimeZone } from "@/lib/dates";
import { RUN_TYPE_LABELS } from "@/lib/payroll/constants";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { runDetail, runInputOptions } from "@/server/modules/payroll/queries";
import { getSetting } from "@/server/modules/settings/service";
import { RunClient } from "./run-client";

export const metadata: Metadata = { title: "Payroll run" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyPermission(["payroll.run", "payroll.approve", "payroll.release"]);
  const id = Number((await params).id);
  const detail = Number.isInteger(id) && id > 0 ? runDetail(db, id) : null;
  if (!detail) notFound();
  const { run } = detail;
  const { people, components: inputComponents } = runInputOptions(db, run);
  return (
    <RunClient
      detail={detail}
      title={`${formatPeriod(run.period)} · ${RUN_TYPE_LABELS[run.type]}`}
      people={people}
      inputComponents={inputComponents}
      today={todayInTimeZone(getSetting(db, "locale").timezone)}
      rights={{
        run: can(user, "payroll.run"), approve: can(user, "payroll.approve"), release: can(user, "payroll.release"),
        revert: user.roles.includes("super_admin"), isMaker: run.computedBy === user.id,
      }}
    />
  );
}
