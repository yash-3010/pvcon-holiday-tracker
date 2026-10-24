/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> renders into a PDF, which has no alt text. */
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { toMajor, type Minor } from "@/lib/money";
import type { PayslipSnapshot } from "@/server/db/schema";

export interface PayslipPdfLine {
  name: string;
  amount: Minor;
  /** Fiscal year to date, this payslip included. */
  ytd: Minor;
}

/** A PNG or JPEG image. */
export interface PdfImage {
  data: Buffer;
  format: "png" | "jpg";
}

export interface PayslipPdfData {
  company: { legalName: string; address: string };
  logo: PdfImage | null;
  /** "Payslip for November 2026". */
  title: string;
  /** "Payslip – Asha Rao – November 2026", the document title. */
  documentTitle: string;
  currency: string;
  employee: PayslipSnapshot;
  days: { total: number; working: number; paid: number; lop: number };
  earnings: PayslipPdfLine[];
  deductions: PayslipPdfLine[];
  reimbursements: PayslipPdfLine[];
  totalEarnings: Minor;
  totalDeductions: Minor;
  totalReimbursements: Minor;
  netPay: Minor;
  netInWords: string;
  /** "FY 2026–27". */
  fiscalYear: string;
  issuedOn: string;
  footer: string | null;
  verification: { code: string; url: string; qr: PdfImage } | null;
  signatory: { name: string; designation: string; image: PdfImage | null } | null;
}

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const SHADE = "#f3f4f6";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  brand: { flexDirection: "row", alignItems: "center", maxWidth: 330 },
  logo: { width: 44, height: 44, marginRight: 10, objectFit: "contain" },
  company: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  muted: { color: MUTED },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", textAlign: "right" },
  section: { borderWidth: 1, borderColor: RULE, borderRadius: 3, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: 8 },
  field: { width: "33.33%", marginBottom: 6, paddingRight: 6 },
  label: { color: MUTED, fontSize: 7.5, marginBottom: 1.5, textTransform: "uppercase" },
  days: { flexDirection: "row", backgroundColor: SHADE, padding: 8 },
  day: { flex: 1 },
  tables: { flexDirection: "row", marginBottom: 10 },
  table: { flex: 1, borderWidth: 1, borderColor: RULE, borderRadius: 3 },
  gap: { width: 10 },
  row: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: SHADE },
  headRow: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 6, backgroundColor: SHADE, fontFamily: "Helvetica-Bold" },
  totalRow: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, fontFamily: "Helvetica-Bold", borderTopWidth: 1, borderTopColor: RULE },
  name: { flex: 1 },
  amount: { width: 70, textAlign: "right" },
  net: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: SHADE, padding: 10, marginBottom: 10 },
  netAmount: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  footer: { marginTop: 4, color: MUTED },
  bottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 14 },
  verify: { flexDirection: "row", alignItems: "center", maxWidth: 300 },
  qr: { width: 64, height: 64, marginRight: 8 },
  signature: { width: 120, height: 40, objectFit: "contain", marginBottom: 2, alignSelf: "flex-end" },
  watermark: {
    position: "absolute", top: 330, left: 60, fontSize: 110, color: "#ef4444", opacity: 0.15, transform: "rotate(-30deg)",
    fontFamily: "Helvetica-Bold",
  },
});

const amount = (minor: Minor) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toMajor(minor));
const days = (n: number) => String(Number(n.toFixed(2)));

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Text>{value || "—"}</Text>
    </View>
  );
}

function LineTable({ heading, lines, total, totalLabel }: { heading: string; lines: PayslipPdfLine[]; total: Minor; totalLabel: string }) {
  return (
    <View style={s.table}>
      <View style={s.headRow}>
        <Text style={s.name}>{heading}</Text>
        <Text style={s.amount}>Amount</Text>
        <Text style={s.amount}>YTD</Text>
      </View>
      {lines.map((line, i) => (
        <View key={i} style={s.row} wrap={false}>
          <Text style={s.name}>{line.name}</Text>
          <Text style={s.amount}>{amount(line.amount)}</Text>
          <Text style={[s.amount, s.muted]}>{amount(line.ytd)}</Text>
        </View>
      ))}
      {lines.length === 0 && (
        <View style={s.row}>
          <Text style={[s.name, s.muted]}>None</Text>
        </View>
      )}
      <View style={s.totalRow}>
        <Text style={s.name}>{totalLabel}</Text>
        <Text style={s.amount}>{amount(total)}</Text>
        <Text style={s.amount} />
      </View>
    </View>
  );
}

export function PayslipPdf({ data, draft }: { data: PayslipPdfData; draft: boolean }) {
  const e = data.employee;
  return (
    <Document title={data.documentTitle} author={data.company.legalName} creator="PVCON People" producer="PVCON People">
      <Page size="A4" style={s.page}>
        {draft && (
          <Text style={s.watermark} fixed>
            DRAFT
          </Text>
        )}
        <View style={s.header}>
          <View style={s.brand}>
            {data.logo && <Image style={s.logo} src={data.logo} />}
            <View>
              <Text style={s.company}>{data.company.legalName}</Text>
              {data.company.address ? <Text style={s.muted}>{data.company.address}</Text> : null}
            </View>
          </View>
          <View>
            <Text style={s.title}>{data.title}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Amounts in {data.currency}</Text>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.grid}>
            <Field label="Employee" value={e.name} />
            <Field label="Employee code" value={e.code} />
            <Field label="Date of joining" value={e.dateOfJoining} />
            <Field label="Designation" value={e.designation} />
            <Field label="Department" value={e.department} />
            <Field label="PAN" value={e.pan} />
            <Field label="Bank" value={e.bankName} />
            <Field label="Account" value={e.bankAccountMasked} />
            <Field label="IFSC" value={e.bankIfsc} />
          </View>
          <View style={s.days}>
            <View style={s.day}>
              <Text style={s.label}>Total days</Text>
              <Text>{days(data.days.total)}</Text>
            </View>
            <View style={s.day}>
              <Text style={s.label}>Working days</Text>
              <Text>{days(data.days.working)}</Text>
            </View>
            <View style={s.day}>
              <Text style={s.label}>Paid days</Text>
              <Text>{days(data.days.paid)}</Text>
            </View>
            <View style={s.day}>
              <Text style={s.label}>Loss of pay days</Text>
              <Text>{days(data.days.lop)}</Text>
            </View>
          </View>
        </View>

        <View style={s.tables}>
          <LineTable heading="Earnings" lines={data.earnings} total={data.totalEarnings} totalLabel="Total earnings" />
          <View style={s.gap} />
          <LineTable heading="Deductions" lines={data.deductions} total={data.totalDeductions} totalLabel="Total deductions" />
        </View>
        {data.reimbursements.length > 0 && (
          <View style={[s.tables, { width: "50%" }]}>
            <LineTable heading="Reimbursements" lines={data.reimbursements} total={data.totalReimbursements} totalLabel="Total reimbursements" />
          </View>
        )}

        <View style={s.net} wrap={false}>
          <View>
            <Text style={s.label}>Net pay</Text>
            <Text>{data.netInWords}</Text>
          </View>
          <Text style={s.netAmount}>{amount(data.netPay)}</Text>
        </View>
        <Text style={s.muted}>
          Year to date figures cover {data.fiscalYear}. Issued on {data.issuedOn}.
        </Text>
        {data.footer ? <Text style={s.footer}>{data.footer}</Text> : null}

        <View style={s.bottom} wrap={false}>
          {data.verification ? (
            <View style={s.verify}>
              <Image style={s.qr} src={data.verification.qr} />
              <View>
                <Text style={s.label}>Verify this payslip</Text>
                <Text>{data.verification.url}</Text>
                <Text style={s.muted}>Code {data.verification.code}</Text>
              </View>
            </View>
          ) : (
            <Text style={s.muted}>{draft ? "Draft for review. Not a payslip." : ""}</Text>
          )}
          {data.signatory ? (
            <View>
              {data.signatory.image && <Image style={s.signature} src={data.signatory.image} />}
              <Text style={{ textAlign: "right", fontFamily: "Helvetica-Bold" }}>{data.signatory.name}</Text>
              <Text style={[s.muted, { textAlign: "right" }]}>{data.signatory.designation}</Text>
            </View>
          ) : (
            <Text style={[s.muted, { maxWidth: 200, textAlign: "right" }]}>
              This is a computer-generated payslip and does not require a signature.
            </Text>
          )}
        </View>
      </Page>
    </Document>
  );
}

/** Renders an A4 payslip; `draft` adds a DRAFT watermark for review before release. */
export async function renderPayslipPdf(data: PayslipPdfData, { draft }: { draft: boolean }): Promise<Buffer> {
  return renderToBuffer(<PayslipPdf data={data} draft={draft} />);
}
