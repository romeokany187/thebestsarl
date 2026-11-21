import ExcelJS from "exceljs";
import type { CashJournalLedgerRow } from "@/lib/cash-journal-ledger";

/** Colonnes alignées sur le fichier Excel caissière THE BEST (écart USD / CDF). */
export type CashJournalExportColumnKey =
  | "date"
  | "type"
  | "libelle"
  | "usdIn"
  | "usdOut"
  | "usdBalance"
  | "gap"
  | "cdfIn"
  | "cdfOut"
  | "cdfBalance"
  | "reference";

export type CashJournalExportColumn = {
  key: CashJournalExportColumnKey;
  label: string;
  /** Largeur PDF (points). */
  pdfWidth: number;
  /** Largeur Excel (caractères). */
  excelWidth: number;
  money?: boolean;
  spacer?: boolean;
};

export const CASH_JOURNAL_EXPORT_COLUMNS: CashJournalExportColumn[] = [
  { key: "date", label: "Date", pdfWidth: 68, excelWidth: 12 },
  { key: "type", label: "Type d'opération", pdfWidth: 118, excelWidth: 18 },
  { key: "libelle", label: "Libellé", pdfWidth: 280, excelWidth: 42 },
  { key: "usdIn", label: "USD Entrées", pdfWidth: 72, excelWidth: 12, money: true },
  { key: "usdOut", label: "USD Sorties", pdfWidth: 72, excelWidth: 12, money: true },
  { key: "usdBalance", label: "USD Solde", pdfWidth: 78, excelWidth: 12, money: true },
  { key: "gap", label: "", pdfWidth: 28, excelWidth: 3, spacer: true },
  { key: "cdfIn", label: "CDF Entrées", pdfWidth: 78, excelWidth: 13, money: true },
  { key: "cdfOut", label: "CDF Sorties", pdfWidth: 78, excelWidth: 13, money: true },
  { key: "cdfBalance", label: "CDF Solde", pdfWidth: 86, excelWidth: 13, money: true },
  { key: "reference", label: "Référence", pdfWidth: 90, excelWidth: 14 },
];

export type CashJournalExportRow = {
  date: string;
  type: string;
  libelle: string;
  usdIn: number | null;
  usdOut: number | null;
  usdBalance: number | null;
  cdfIn: number | null;
  cdfOut: number | null;
  cdfBalance: number | null;
  reference: string;
  isOpeningRow?: boolean;
};

function moneyOrNull(value: number, treatZeroAsEmpty = true): number | null {
  if (!Number.isFinite(value)) return null;
  if (treatZeroAsEmpty && value === 0) return null;
  return Number(value.toFixed(2));
}

export function ledgerRowToExportRow(row: CashJournalLedgerRow): CashJournalExportRow {
  return {
    date: row.occurredAt.toISOString().slice(0, 10),
    type: row.typeOperation,
    libelle: row.libelle,
    usdIn: moneyOrNull(row.usdIn),
    usdOut: moneyOrNull(row.usdOut),
    usdBalance: moneyOrNull(row.usdBalance, false),
    cdfIn: moneyOrNull(row.cdfIn),
    cdfOut: moneyOrNull(row.cdfOut),
    cdfBalance: moneyOrNull(row.cdfBalance, false),
    reference: row.reference || "-",
    isOpeningRow: row.isOpeningRow,
  };
}

export function formatExportMoneyCell(value: number | null): string {
  if (value === null) return "-";
  return value.toFixed(2);
}

export type BuildCashJournalExcelOptions = {
  title: string;
  periodLabel: string;
  deskLabel: string;
  openingUsd: number;
  openingCdf: number;
  closingUsd: number;
  closingCdf: number;
  rows: CashJournalExportRow[];
  includeSyntheticOpening?: boolean;
  periodStart: string;
};

const EXCEL_BRAND = "0017365D";
const EXCEL_HEADER = "00E8EEF5";
const EXCEL_OPENING = "00FFF2CC";
const EXCEL_ALT = "00F8F9FB";

function excelSolid(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function excelThinBorder(): Partial<ExcelJS.Borders> {
  return {
    top: { style: "thin", color: { argb: "FFCBD5E1" } },
    left: { style: "thin", color: { argb: "FFCBD5E1" } },
    bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
    right: { style: "thin", color: { argb: "FFCBD5E1" } },
  };
}

function writeMoneyCell(cell: ExcelJS.Cell, value: number | null) {
  if (value === null) {
    cell.value = "-";
    cell.alignment = { horizontal: "center", vertical: "middle" };
    return;
  }
  cell.value = value;
  cell.numFmt = "#,##0.00";
  cell.alignment = { horizontal: "right", vertical: "middle" };
}

export async function buildCashJournalExcelBuffer(options: BuildCashJournalExcelOptions): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "THE BEST SARL";
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet("Journal de caisse", { views: [{ showGridLines: false }] });
  const colCount = CASH_JOURNAL_EXPORT_COLUMNS.length;

  sheet.mergeCells(1, 1, 1, colCount);
  sheet.getCell(1, 1).value = options.title;
  sheet.getCell(1, 1).font = { name: "Arial", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  sheet.getCell(1, 1).fill = excelSolid(EXCEL_BRAND);
  sheet.getCell(1, 1).alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 26;

  sheet.mergeCells(2, 1, 2, colCount);
  sheet.getCell(2, 1).value = `${options.periodLabel} · ${options.deskLabel}`;
  sheet.getCell(2, 1).font = { name: "Arial", size: 10, color: { argb: "FFFFFFFF" } };
  sheet.getCell(2, 1).fill = excelSolid(EXCEL_BRAND);
  sheet.getRow(2).height = 20;

  sheet.getCell(3, 1).value = `Ouverture USD ${options.openingUsd.toFixed(2)} | Clôture USD ${options.closingUsd.toFixed(2)} | Ouverture CDF ${options.openingCdf.toFixed(2)} | Clôture CDF ${options.closingCdf.toFixed(2)}`;
  sheet.getCell(3, 1).font = { name: "Arial", size: 10, bold: true };
  sheet.mergeCells(3, 1, 3, colCount);

  const headerRow = 5;
  CASH_JOURNAL_EXPORT_COLUMNS.forEach((column, index) => {
    const cell = sheet.getCell(headerRow, index + 1);
    cell.value = column.label;
    cell.font = { name: "Arial", bold: true, size: 10, color: { argb: EXCEL_BRAND } };
    cell.fill = excelSolid(EXCEL_HEADER);
    cell.border = excelThinBorder();
    cell.alignment = { horizontal: column.money ? "right" : "left", vertical: "middle", wrapText: true };
    sheet.getColumn(index + 1).width = column.excelWidth;
  });
  sheet.getRow(headerRow).height = 22;

  const dataRows: CashJournalExportRow[] = [];
  if (options.includeSyntheticOpening) {
    dataRows.push({
      date: options.periodStart,
      type: "Solde d'ouverture",
      libelle: "Report à nouveau calculé depuis l’historique caisse",
      usdIn: null,
      usdOut: null,
      usdBalance: Number(options.openingUsd.toFixed(2)),
      cdfIn: null,
      cdfOut: null,
      cdfBalance: Number(options.openingCdf.toFixed(2)),
      reference: "-",
      isOpeningRow: true,
    });
  }
  dataRows.push(...options.rows);

  dataRows.forEach((row, rowIndex) => {
    const excelRow = headerRow + 1 + rowIndex;
    const values: Array<string | number | null> = [
      row.date,
      row.type,
      row.libelle,
      row.usdIn,
      row.usdOut,
      row.usdBalance,
      null,
      row.cdfIn,
      row.cdfOut,
      row.cdfBalance,
      row.reference,
    ];

    values.forEach((value, colIndex) => {
      const column = CASH_JOURNAL_EXPORT_COLUMNS[colIndex];
      const cell = sheet.getCell(excelRow, colIndex + 1);
      cell.border = excelThinBorder();
      cell.font = { name: "Arial", size: 10, bold: Boolean(row.isOpeningRow) };
      if (row.isOpeningRow || rowIndex % 2 === 1) {
        cell.fill = excelSolid(row.isOpeningRow ? EXCEL_OPENING : EXCEL_ALT);
      }
      if (column.spacer) {
        cell.value = "";
        return;
      }
      if (column.money) {
        writeMoneyCell(cell, typeof value === "number" ? value : null);
        return;
      }
      cell.value = value ?? "";
      cell.alignment = { horizontal: colIndex === 0 ? "center" : "left", vertical: "middle", wrapText: colIndex === 2 };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
