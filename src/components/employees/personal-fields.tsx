"use client";

import { useFormContext } from "react-hook-form";
import { textOrNull } from "@/components/forms/select-values";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { GENDER_LABELS, GENDERS, MARITAL_STATUS_LABELS, MARITAL_STATUSES } from "@/lib/hr";

/** Form shape shared by the wizard, the HR Personal tab and self-service contact edits. */
export interface PersonalFormShape {
  firstName: string;
  lastName: string;
  displayName: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  address: { line1: string; line2: string; city: string; state: string; postalCode: string; country: string };
  emergencyContact: { name: string; relation: string; phone: string };
}

/**
 * `basic`: names, work email, phone (wizard step 1). `details`: DOB, gender, marital status, personal email, address,
 * emergency contact (wizard step 3). `contact`: what employees may change themselves. `all`: everything (HR).
 */
export type PersonalPart = "basic" | "details" | "contact" | "all";

export function PersonalFields({ part }: { part: PersonalPart }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<PersonalFormShape>();
  const basic = part === "basic" || part === "all";
  const identity = part === "details" || part === "all";
  const contact = part !== "basic";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {basic && (
        <>
          <Field label="First name" htmlFor="firstName" error={errors.firstName?.message} required>
            <Input id="firstName" autoComplete="off" {...register("firstName")} />
          </Field>
          <Field label="Last name" htmlFor="lastName" error={errors.lastName?.message}>
            <Input id="lastName" autoComplete="off" {...register("lastName")} />
          </Field>
          <Field label="Display name" htmlFor="displayName" error={errors.displayName?.message} hint="Defaults to first and last name">
            <Input id="displayName" {...register("displayName")} />
          </Field>
          <Field label="Work email" htmlFor="workEmail" error={errors.workEmail?.message}>
            <Input id="workEmail" type="email" autoComplete="off" {...register("workEmail")} />
          </Field>
        </>
      )}
      {(basic || part === "contact") && (
        <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" type="tel" {...register("phone")} />
        </Field>
      )}
      {identity && (
        <>
          <Field label="Date of birth" htmlFor="dateOfBirth" error={errors.dateOfBirth?.message}>
            <Input id="dateOfBirth" type="date" {...register("dateOfBirth")} />
          </Field>
          <Field label="Gender" htmlFor="gender">
            <NativeSelect id="gender" {...register("gender", { setValueAs: textOrNull })}>
              <option value="">Not set</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {GENDER_LABELS[g]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Marital status" htmlFor="maritalStatus">
            <NativeSelect id="maritalStatus" {...register("maritalStatus", { setValueAs: textOrNull })}>
              <option value="">Not set</option>
              {MARITAL_STATUSES.map((m) => (
                <option key={m} value={m}>
                  {MARITAL_STATUS_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </>
      )}
      {contact && (
        <>
          <Field label="Personal email" htmlFor="personalEmail" error={errors.personalEmail?.message}>
            <Input id="personalEmail" type="email" {...register("personalEmail")} />
          </Field>
          <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Address</legend>
            <Field label="Address line 1" htmlFor="address.line1" className="sm:col-span-2">
              <Input id="address.line1" {...register("address.line1")} />
            </Field>
            <Field label="Address line 2" htmlFor="address.line2" className="sm:col-span-2">
              <Input id="address.line2" {...register("address.line2")} />
            </Field>
            <Field label="City" htmlFor="address.city">
              <Input id="address.city" {...register("address.city")} />
            </Field>
            <Field label="State" htmlFor="address.state">
              <Input id="address.state" {...register("address.state")} />
            </Field>
            <Field label="Postal code" htmlFor="address.postalCode">
              <Input id="address.postalCode" {...register("address.postalCode")} />
            </Field>
            <Field label="Country" htmlFor="address.country">
              <Input id="address.country" {...register("address.country")} />
            </Field>
          </fieldset>
          <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-medium">Emergency contact</legend>
            <Field label="Contact name" htmlFor="emergencyContact.name">
              <Input id="emergencyContact.name" {...register("emergencyContact.name")} />
            </Field>
            <Field label="Relation" htmlFor="emergencyContact.relation">
              <Input id="emergencyContact.relation" {...register("emergencyContact.relation")} />
            </Field>
            <Field label="Contact phone" htmlFor="emergencyContact.phone" error={errors.emergencyContact?.phone?.message}>
              <Input id="emergencyContact.phone" type="tel" {...register("emergencyContact.phone")} />
            </Field>
          </fieldset>
        </>
      )}
    </div>
  );
}
