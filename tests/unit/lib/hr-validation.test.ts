import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatAddress, fullName } from "@/lib/hr";
import { departmentSchema } from "@/lib/validation/org";
import {
  bankSchema, contactSchema, createEmployeeSchema, jobSchema, optionalText, resignationSchema,
} from "@/lib/validation/employees";

const fieldErrors = (result: { success: boolean; error?: z.ZodError }) =>
  result.success ? {} : (z.flattenError(result.error!).fieldErrors as Record<string, string[]>);

const job = {
  departmentId: null, designationId: null, reportingManagerId: null, employmentType: "full_time",
  workLocation: "", dateOfJoining: "2026-10-01", probationEndDate: "", confirmationDate: "", noticePeriodDays: 30,
};
const personal = {
  firstName: "Asha", lastName: "Rao", displayName: "", workEmail: "Asha.Rao@PVCON.in", personalEmail: "",
  phone: "", dateOfBirth: "", gender: null, maritalStatus: null,
  address: { line1: "", line2: "", city: "", state: "", postalCode: "", country: "" },
  emergencyContact: { name: "", relation: "", phone: "" },
};
const bank = { bankName: "", bankAccount: "", bankIfsc: "", pan: "", aadhaar: "", passport: "" };
const create = { ...personal, ...job, ...bank, employeeCode: "", loginMode: "none", loginRoles: [], linkUserId: null };

describe("hr helpers", () => {
  it("joins names and addresses without empty parts", () => {
    expect(fullName(" Asha ", "")).toBe("Asha");
    expect(fullName("Asha", "Rao")).toBe("Asha Rao");
    expect(formatAddress({ line1: "12 MG Road", line2: "", city: "Pune", state: "MH", postalCode: "411001", country: "India" }))
      .toBe("12 MG Road, Pune MH 411001, India");
    expect(formatAddress(null)).toBe("");
  });
});

describe("employee validation", () => {
  it("turns blank optional text into null and trims the rest", () => {
    expect(optionalText(10).parse("")).toBeNull();
    expect(optionalText(10).parse("  x  ")).toBe("x");
    expect(optionalText(10).parse(null)).toBeNull();
  });

  it("normalises bank and ID numbers", () => {
    const parsed = bankSchema.parse({
      bankName: " HDFC Bank ", bankAccount: "1234 5678 9012", bankIfsc: "hdfc0001234",
      pan: "abcde1234f", aadhaar: "1234 5678 9012", passport: "",
    });
    expect(parsed).toEqual({
      bankName: "HDFC Bank", bankAccount: "123456789012", bankIfsc: "HDFC0001234",
      pan: "ABCDE1234F", aadhaar: "123456789012", passport: null,
    });
  });

  it("rejects malformed IFSC, PAN and account numbers", () => {
    const errors = fieldErrors(bankSchema.safeParse({ ...bank, bankAccount: "12ab", bankIfsc: "HDFC1234", pan: "12345" }));
    expect(Object.keys(errors).sort()).toEqual(["bankAccount", "bankIfsc", "pan"]);
  });

  it("keeps probation and confirmation on or after the joining date", () => {
    const errors = fieldErrors(jobSchema.safeParse({ ...job, probationEndDate: "2026-09-30", confirmationDate: "2026-09-01" }));
    expect(errors.probationEndDate).toEqual(["Must be on or after the joining date"]);
    expect(errors.confirmationDate).toEqual(["Must be on or after the joining date"]);
  });

  it("drops an all-blank address or emergency contact", () => {
    const parsed = contactSchema.parse({ personalEmail: "", phone: "+91 98450 12345", address: personal.address, emergencyContact: personal.emergencyContact });
    expect(parsed).toEqual({ personalEmail: null, phone: "+91 98450 12345", address: null, emergencyContact: null });
  });

  it("lower-cases emails and validates phone numbers", () => {
    expect(createEmployeeSchema.parse(create).workEmail).toBe("asha.rao@pvcon.in");
    expect(fieldErrors(contactSchema.safeParse({ ...personal, phone: "call me" })).phone).toEqual(["Enter a valid phone number"]);
  });

  it("requires a work email and roles to create a login, and a user to link one", () => {
    expect(createEmployeeSchema.safeParse(create).success).toBe(true);
    const noEmail = fieldErrors(createEmployeeSchema.safeParse({ ...create, workEmail: "", loginMode: "create", loginRoles: [] }));
    expect(noEmail.workEmail).toEqual(["Required to create a login"]);
    expect(noEmail.loginRoles).toEqual(["Pick at least one role"]);
    expect(fieldErrors(createEmployeeSchema.safeParse({ ...create, loginMode: "link" })).linkUserId).toEqual(["Choose a user to link"]);
  });

  it("upper-cases an explicit employee code and rejects odd characters", () => {
    expect(createEmployeeSchema.parse({ ...create, employeeCode: "pv0042" }).employeeCode).toBe("PV0042");
    expect(fieldErrors(createEmployeeSchema.safeParse({ ...create, employeeCode: "PV 42" })).employeeCode).toBeDefined();
  });

  it("keeps the last working date on or after the resignation date", () => {
    const errors = fieldErrors(resignationSchema.safeParse({ resignationDate: "2026-10-10", lastWorkingDate: "2026-10-09", exitReason: "" }));
    expect(errors.lastWorkingDate).toEqual(["Must be on or after the resignation date"]);
  });
});

describe("org validation", () => {
  it("upper-cases department codes and turns blanks into null", () => {
    expect(departmentSchema.parse({ name: "Engineering", code: "eng-1", parentId: null, headEmployeeId: null }).code).toBe("ENG-1");
    expect(departmentSchema.parse({ name: "Engineering", code: "", parentId: null, headEmployeeId: null }).code).toBeNull();
    expect(departmentSchema.safeParse({ name: "Engineering", code: "en g", parentId: null, headEmployeeId: null }).success).toBe(false);
  });
});
