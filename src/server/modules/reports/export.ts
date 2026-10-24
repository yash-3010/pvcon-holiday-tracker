import ExcelJS from "exceljs";
import Papa from "papaparse";
import { toMajor } from "@/lib/money";
import type { ReportColumn, ReportResult } from "./types";

/** Text a spreadsheet would read as a formula gets a leading apostrophe. */
export function safeText(value: string | null): string {
  if (!value) return "";
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * A cell as exported: money in rupees, minutes as hours. CSV text is made formula-safe; XLSX string cells are never
 * evaluated, so they keep the text as typed.
 */
function cellValue(column: ReportColumn, value: string | number | null, format: "csv" | "xlsx"): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (column.type === "money") return toMajor(value);
    if (column.type === "minutes") return Math.round((value / 60) * 100) / 100;
    return value;
  }
  return format === "csv" ? safeText(value) : value;
}

const headerOf = (c: ReportColumn) => (c.type === "money" ? `${c.label} (₹)` : c.type === "minutes" ? `${c.label} (h)` : c.type === "percent" ? `${c.label} (%)` : c.label);

export function reportCsv(result: ReportResult): string {
  return `﻿${Papa.unparse({
    fields: result.columns.map(headerOf),
    data: result.rows.map((row) => result.columns.map((c) => cellValue(c, row[c.key] ?? null, "csv"))),
  })}`;
}

export async function reportXlsx(title: string, result: ReportResult): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "PVCON People";
  const sheet = book.addWorksheet(title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  sheet.addRow(result.columns.map(headerOf));
  for (const row of result.rows) sheet.addRow(result.columns.map((c) => cellValue(c, row[c.key] ?? null, "xlsx")));
  result.columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = Math.min(40, Math.max(10, headerOf(c).length + 2));
    if (c.type === "money") column.numFmt = "#,##0.00";
    if (c.type === "minutes") column.numFmt = "0.00";
  });
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  if (result.note) {
    sheet.addRow([]);
    sheet.addRow([result.note]);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
