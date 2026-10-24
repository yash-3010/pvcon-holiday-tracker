"use client";

import { useFormContext } from "react-hook-form";
import { idOrNull } from "@/components/forms/select-values";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, type SelectOption } from "@/lib/hr";

export interface JobFormShape {
  employeeCode?: string | null;
  departmentId: number | null;
  designationId: number | null;
  reportingManagerId: number | null;
  employmentType: string;
  workLocation: string | null;
  dateOfJoining: string;
  probationEndDate: string | null;
  confirmationDate: string | null;
  noticePeriodDays: number;
}

const options = (items: SelectOption[]) =>
  items.map((o) => (
    <option key={o.id} value={o.id}>
      {o.label}
    </option>
  ));

export function JobFields({
  departments,
  designations,
  managers,
  codeHint,
  showConfirmation = false,
}: {
  departments: SelectOption[];
  designations: SelectOption[];
  managers: SelectOption[];
  /** Shows the optional employee code field with this hint (wizard only). */
  codeHint?: string;
  showConfirmation?: boolean;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<JobFormShape>();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {codeHint !== undefined && (
        <Field label="Employee code" htmlFor="employeeCode" error={errors.employeeCode?.message} hint={codeHint}>
          <Input id="employeeCode" {...register("employeeCode")} />
        </Field>
      )}
      <Field label="Date of joining" htmlFor="dateOfJoining" error={errors.dateOfJoining?.message} required>
        <Input id="dateOfJoining" type="date" {...register("dateOfJoining")} />
      </Field>
      <Field label="Department" htmlFor="departmentId" error={errors.departmentId?.message}>
        <NativeSelect id="departmentId" {...register("departmentId", { setValueAs: idOrNull })}>
          <option value="">None</option>
          {options(departments)}
        </NativeSelect>
      </Field>
      <Field label="Designation" htmlFor="designationId" error={errors.designationId?.message}>
        <NativeSelect id="designationId" {...register("designationId", { setValueAs: idOrNull })}>
          <option value="">None</option>
          {options(designations)}
        </NativeSelect>
      </Field>
      <Field label="Reporting manager" htmlFor="reportingManagerId" error={errors.reportingManagerId?.message}>
        <NativeSelect id="reportingManagerId" {...register("reportingManagerId", { setValueAs: idOrNull })}>
          <option value="">None</option>
          {options(managers)}
        </NativeSelect>
      </Field>
      <Field label="Employment type" htmlFor="employmentType">
        <NativeSelect id="employmentType" {...register("employmentType")}>
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EMPLOYMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Work location" htmlFor="workLocation" error={errors.workLocation?.message}>
        <Input id="workLocation" {...register("workLocation")} />
      </Field>
      <Field label="Probation ends" htmlFor="probationEndDate" error={errors.probationEndDate?.message}>
        <Input id="probationEndDate" type="date" {...register("probationEndDate")} />
      </Field>
      {showConfirmation && (
        <Field label="Confirmed on" htmlFor="confirmationDate" error={errors.confirmationDate?.message}>
          <Input id="confirmationDate" type="date" {...register("confirmationDate")} />
        </Field>
      )}
      <Field label="Notice period (days)" htmlFor="noticePeriodDays" error={errors.noticePeriodDays?.message}>
        <Input id="noticePeriodDays" type="number" min={0} max={365} {...register("noticePeriodDays", { valueAsNumber: true })} />
      </Field>
    </div>
  );
}
