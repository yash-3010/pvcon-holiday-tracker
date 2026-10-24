import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { addMonths, fiscalYearOf } from "@/lib/dates";
import type { FilterOptions } from "@/server/modules/reports/options";
import type { FilterKind, ReportParams } from "@/server/modules/reports/types";

/** A GET form, so a report's URL holds its filters and can be bookmarked or shared. */
export function FilterBar({ filters, params, options }: { filters: readonly FilterKind[]; params: ReportParams; options: FilterOptions }) {
  if (!filters.length) return null;
  const select = (name: string, label: string, value: number | null, choices: { id: number; label: string }[], any = "All") => (
    <Field key={name} label={label} htmlFor={`f-${name}`}>
      <NativeSelect id={`f-${name}`} name={name} defaultValue={value ?? ""}>
        <option value="">{any}</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      {filters.map((f) => {
        switch (f) {
          case "period":
            return (
              <Field key={f} label="Month" htmlFor="f-period">
                <Input id="f-period" name="period" type="month" defaultValue={params.period} />
              </Field>
            );
          case "range":
            return (
              <div key={f} className="flex gap-3">
                <Field label="From" htmlFor="f-from">
                  <Input id="f-from" name="from" type="date" defaultValue={params.from} />
                </Field>
                <Field label="To" htmlFor="f-to">
                  <Input id="f-to" name="to" type="date" defaultValue={params.to} />
                </Field>
              </div>
            );
          case "date":
            return (
              <Field key={f} label="Date" htmlFor="f-date">
                <Input id="f-date" name="date" type="date" defaultValue={params.date} />
              </Field>
            );
          case "year":
            return (
              <Field key={f} label="Year" htmlFor="f-year">
                <Input id="f-year" name="year" type="number" min={2000} max={2099} className="w-28" defaultValue={params.year} />
              </Field>
            );
          case "fiscalYear": {
            const [startYear, startMonth] = params.fiscalYear.start.split("-").map(Number) as [number, number];
            return (
              <Field key={f} label="Financial year" htmlFor="f-fy">
                <NativeSelect id="f-fy" name="fy" defaultValue={startYear}>
                  {[1, 0, -1, -2, -3, -4, -5].map((offset) => (
                    <option key={offset} value={startYear + offset}>
                      {fiscalYearOf(addMonths(params.fiscalYear.start, offset * 12), startMonth).label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            );
          }
          case "week":
            return (
              <Field key={f} label="Week of" htmlFor="f-week">
                <Input id="f-week" name="week" type="date" defaultValue={params.week} />
              </Field>
            );
          case "department":
            return select("department", "Department", params.departmentId, options.departments);
          case "employee":
            return select("employee", "Employee", params.employeeId, options.employees, "Choose…");
          case "project":
            return select("project", "Project", params.projectId, options.projects);
          case "run":
            return select("run", "Payroll run", params.runId, options.runs, "Choose…");
        }
      })}
      <Button type="submit">Run</Button>
    </form>
  );
}
