"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Controller, FormProvider, useForm, useFormContext, type FieldErrors, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { BankFields } from "@/components/employees/bank-fields";
import { EMPTY_ADDRESS, EMPTY_EMERGENCY_CONTACT } from "@/components/employees/form-defaults";
import { JobFields } from "@/components/employees/job-fields";
import { PersonalFields } from "@/components/employees/personal-fields";
import { idOrNull } from "@/components/forms/select-values";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { RolePicker } from "@/components/users/role-picker";
import { TempPasswordDialog } from "@/components/users/temp-password-dialog";
import type { SelectOption } from "@/lib/hr";
import { cn } from "@/lib/utils";
import { createEmployeeSchema, type CreateEmployeeFormValues, type CreateEmployeeInput } from "@/lib/validation/employees";
import { createEmployeeAction } from "../actions";

type Values = CreateEmployeeFormValues;

const STEPS: { title: string; fields: FieldPath<Values>[] }[] = [
  { title: "Basics", fields: ["firstName", "lastName", "displayName", "workEmail", "phone"] },
  {
    title: "Job",
    fields: ["employeeCode", "dateOfJoining", "departmentId", "designationId", "reportingManagerId", "employmentType", "workLocation", "probationEndDate", "noticePeriodDays"],
  },
  { title: "Personal", fields: ["dateOfBirth", "gender", "maritalStatus", "personalEmail", "address", "emergencyContact"] },
  { title: "Bank & IDs", fields: ["bankName", "bankAccount", "bankIfsc", "pan", "aadhaar", "passport"] },
  { title: "Login", fields: ["loginMode", "loginRoles", "linkUserId"] },
];
const LAST = STEPS.length - 1;

/** First step that owns one of the invalid fields (`address.city` belongs to `address`). */
function firstStepWith(invalid: string[]): number {
  return STEPS.findIndex((step) => step.fields.some((field) => invalid.some((name) => name.split(".")[0] === field)));
}

function LoginStep({
  canManageLogins,
  canAssignPrivileged,
  linkableUsers,
  allowedDomain,
}: {
  canManageLogins: boolean;
  canAssignPrivileged: boolean;
  linkableUsers: SelectOption[];
  allowedDomain: string;
}) {
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = useFormContext<Values>();
  const mode = watch("loginMode");
  if (!canManageLogins) {
    return <p className="text-sm text-muted-foreground">An administrator can add a login for this employee later.</p>;
  }
  return (
    <div className="space-y-4">
      <Field label="Login" htmlFor="loginMode" hint={`Logins use the work email, which must be an @${allowedDomain} address.`}>
        <NativeSelect id="loginMode" {...register("loginMode")}>
          <option value="none">No login for now</option>
          <option value="create">Create a login with a temporary password</option>
          <option value="link">Link an existing login</option>
        </NativeSelect>
      </Field>
      {mode === "create" && (
        <Field label="Roles" error={errors.loginRoles?.message}>
          <Controller
            control={control}
            name="loginRoles"
            render={({ field }) => (
              <RolePicker value={field.value} onChange={field.onChange} canAssignPrivileged={canAssignPrivileged} idPrefix="wizard-role" />
            )}
          />
        </Field>
      )}
      {mode === "link" && (
        <Field label="Existing login" htmlFor="linkUserId" error={errors.linkUserId?.message} hint="Logins not yet linked to an employee record">
          <NativeSelect id="linkUserId" {...register("linkUserId", { setValueAs: idOrNull })}>
            <option value="">Choose a login</option>
            {linkableUsers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
    </div>
  );
}

export function EmployeeWizard({
  today,
  nextCode,
  departments,
  designations,
  managers,
  linkableUsers,
  canManageLogins,
  canAssignPrivileged,
  allowedDomain,
}: {
  today: string;
  nextCode: string;
  departments: SelectOption[];
  designations: SelectOption[];
  managers: SelectOption[];
  linkableUsers: SelectOption[];
  canManageLogins: boolean;
  canAssignPrivileged: boolean;
  allowedDomain: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState<{ id: number; email: string; password: string } | null>(null);
  const form = useForm<Values, unknown, CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeSchema),
    mode: "onTouched",
    defaultValues: {
      firstName: "", lastName: "", displayName: "", workEmail: "", personalEmail: "", phone: "",
      dateOfBirth: "", gender: null, maritalStatus: null, address: EMPTY_ADDRESS, emergencyContact: EMPTY_EMERGENCY_CONTACT,
      departmentId: null, designationId: null, reportingManagerId: null, employmentType: "full_time", workLocation: "",
      dateOfJoining: today, probationEndDate: "", confirmationDate: "", noticePeriodDays: 30,
      bankName: "", bankAccount: "", bankIfsc: "", pan: "", aadhaar: "", passport: "",
      employeeCode: "", loginMode: "none", loginRoles: ["employee"], linkUserId: null,
    },
  });
  const { run, pending } = useServerAction(createEmployeeAction, {
    onSuccess: (data) => {
      if (data.tempPassword && data.loginEmail) {
        setCreated({ id: data.id, email: data.loginEmail, password: data.tempPassword });
      } else {
        toast.success(`Added ${data.employeeCode}`);
        router.push(`/org/employees/${data.id}`);
      }
    },
    onError: (result) => {
      applyFieldErrors(form.setError, result.fieldErrors);
      const target = firstStepWith(Object.keys(result.fieldErrors ?? {}));
      if (target >= 0) setStep(target);
    },
  });

  const next = async () => {
    if (await form.trigger(STEPS[step]!.fields)) setStep((s) => Math.min(s + 1, LAST));
  };
  const submit = form.handleSubmit(
    (values) => run(values),
    (errors: FieldErrors<Values>) => {
      const target = firstStepWith(Object.keys(errors));
      if (target >= 0) setStep(target);
    },
  );

  return (
    <FormProvider {...form}>
      <ol className="mb-6 flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1",
              i === step ? "border-primary bg-primary-soft text-primary" : i < step ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span className="font-semibold">{i + 1}</span>
            {s.title}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(e) => {
          if (step < LAST) {
            e.preventDefault();
            void next();
          } else {
            void submit(e);
          }
        }}
      >
        <Card>
          <CardContent className="pt-5">
            {step === 0 && <PersonalFields part="basic" />}
            {step === 1 && (
              <JobFields departments={departments} designations={designations} managers={managers} codeHint={`Leave blank to use ${nextCode}`} />
            )}
            {step === 2 && <PersonalFields part="details" />}
            {step === 3 && <BankFields />}
            {step === 4 && (
              <LoginStep
                canManageLogins={canManageLogins}
                canAssignPrivileged={canAssignPrivileged}
                linkableUsers={linkableUsers}
                allowedDomain={allowedDomain}
              />
            )}
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" disabled={step === 0 || pending} onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft /> Back
            </Button>
            {step < LAST ? (
              <Button type="submit">
                Next <ArrowRight />
              </Button>
            ) : (
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />}
                Create employee
              </Button>
            )}
          </CardFooter>
        </Card>
      </form>
      <TempPasswordDialog
        value={created ? { email: created.email, password: created.password } : null}
        onClose={() => {
          const id = created?.id;
          setCreated(null);
          if (id) router.push(`/org/employees/${id}`);
        }}
      />
    </FormProvider>
  );
}
