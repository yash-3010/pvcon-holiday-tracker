import { PDFDocument } from "@cantoo/pdf-lib";
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { renderPayslipPdf, type PayslipPdfData } from "@/server/modules/payroll/payslip-pdf";

const data = async (): Promise<PayslipPdfData> => ({
  company: { legalName: "PVCON Consulting", address: "Pune" },
  logo: null,
  title: "Payslip for November 2026",
  documentTitle: "Payslip – Asha Rao – November 2026",
  currency: "INR",
  employee: {
    name: "Asha Rao", code: "PV001", designation: "Analyst", department: "Sales", dateOfJoining: "2024-03-15", bankName: "HDFC",
    bankAccountMasked: "XXXX5678", bankIfsc: "HDFC0001234", pan: "XXXX234F", annualCtc: 120_000_000, structure: "Standard",
  },
  days: { total: 30, working: 21, paid: 29.5, lop: 0.5 },
  earnings: [{ name: "Basic", amount: 4_916_700, ytd: 39_916_700 }],
  deductions: [{ name: "Loan repayment", amount: 400_000, ytd: 800_000 }],
  reimbursements: [{ name: "Claim: Travel on 02 Nov 2026", amount: 120_000, ytd: 120_000 }],
  totalEarnings: 4_916_700, totalDeductions: 400_000, totalReimbursements: 120_000, netPay: 4_636_700,
  netInWords: "Rupees Forty-Six Thousand Three Hundred Sixty-Seven Only", fiscalYear: "FY 2026–27", issuedOn: "02 Dec 2026",
  footer: "Questions? Write to payroll@pvcon.in.",
  verification: { code: "ABCDEFGHJKLM", url: "https://people.pvcon.in/verify/ABCDEFGHJKLM", qr: { data: await QRCode.toBuffer("x"), format: "png" } },
  signatory: null,
});

describe("payslip PDF", () => {
  it("renders an A4 page titled for the employee and period, with or without the draft mark", async () => {
    for (const draft of [false, true]) {
      const pdf = await renderPayslipPdf(await data(), { draft });
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const doc = await PDFDocument.load(pdf);
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getTitle()).toBe("Payslip – Asha Rao – November 2026");
      expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
    }
  });
});
