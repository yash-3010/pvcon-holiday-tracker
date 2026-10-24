import type { EmployeeDetail } from "@/server/modules/employees/queries";
import type { BankView } from "@/server/modules/employees/sensitive";

export const EMPTY_ADDRESS = { line1: "", line2: "", city: "", state: "", postalCode: "", country: "" };
export const EMPTY_EMERGENCY_CONTACT = { name: "", relation: "", phone: "" };

export function personalDefaults(e: EmployeeDetail) {
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    displayName: e.displayName,
    workEmail: e.workEmail ?? "",
    personalEmail: e.personalEmail ?? "",
    phone: e.phone ?? "",
    dateOfBirth: e.dateOfBirth ?? "",
    gender: e.gender,
    maritalStatus: e.maritalStatus,
    address: e.address ?? EMPTY_ADDRESS,
    emergencyContact: e.emergencyContact ?? EMPTY_EMERGENCY_CONTACT,
  };
}

export function jobDefaults(e: EmployeeDetail) {
  return {
    departmentId: e.departmentId,
    designationId: e.designationId,
    reportingManagerId: e.reportingManagerId,
    employmentType: e.employmentType,
    workLocation: e.workLocation ?? "",
    dateOfJoining: e.dateOfJoining,
    probationEndDate: e.probationEndDate ?? "",
    confirmationDate: e.confirmationDate ?? "",
    noticePeriodDays: e.noticePeriodDays,
  };
}

export function bankDefaults(bank: BankView) {
  return {
    bankName: bank.bankName ?? "",
    bankAccount: bank.bankAccount ?? "",
    bankIfsc: bank.bankIfsc ?? "",
    pan: bank.pan ?? "",
    aadhaar: bank.aadhaar ?? "",
    passport: bank.passport ?? "",
  };
}
