import ExcelJS from "exceljs";

export type MbujimayiReportSaleRow = {
  rowNumber: number;
  reportMonth: string;
  businessDate: string | null;
  clientName: string;
  amountUsd: number;
  typeOperation: string;
};

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  janvier: 1,
  janv: 1,
  fevrier: 2,
  février: 2,
  fevr: 2,
  mars: 3,
  avril: 4,
  avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  juil: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  sept: 9,
  octobre: 10,
  oct: 10,
  novembre: 11,
  nov: 11,
  decembre: 12,
  décembre: 12,
  dec: 12,
};

function normalizeText(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const record = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> };
    if (typeof record.text === "string") return record.text.trim();
    if (record.result != null) return normalizeText(record.result);
    if (Array.isArray(record.richText)) return record.richText.map((part) => part.text ?? "").join("").trim();
  }
  return String(value).trim();
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date
    const excelEpoch = Date.UTC(1899, 11, 30);
    const ms = excelEpoch + value * 24 * 60 * 60 * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = normalizeText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const fr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (fr) {
    const day = Number(fr[1]);
    const month = Number(fr[2]);
    let year = Number(fr[3]);
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toMonthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function isPlausibleBusinessDate(date: Date) {
  const year = date.getUTCFullYear();
  return year >= 2020 && year <= 2100;
}

function parseMonthHeader(text: string, fallbackYear: number): string | null {
  const normalized = normalizeKey(text);
  if (!normalized.includes("mois de")) return null;
  const match = normalized.match(/mois de\s+([a-zéûô]+)\s*(\d{4})?/);
  if (!match) return null;
  const monthName = match[1].normalize("NFD").replace(/\p{M}/gu, "");
  const month = MONTH_NAME_TO_NUMBER[monthName];
  if (!month) return null;
  const year = match[2] ? Number(match[2]) : fallbackYear;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function isVenteBillet(typeOperation: string) {
  const normalized = normalizeKey(typeOperation);
  return /^vente\s*billets?$/.test(normalized) || normalized === "vente billet";
}

function asAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round((value + Number.EPSILON) * 100) / 100;
  const text = normalizeText(value).replace(/\s/g, "").replace(",", ".");
  if (!text) return 0;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
}

/**
 * Extrait uniquement les lignes « Vente billet » (client + entrées USD) du rapport global Mbujimayi,
 * découpé mois par mois via les en-têtes « MOIS DE … » et/ou la date de ligne.
 */
export async function parseMbujimayiReportSalesFromBuffer(buffer: Buffer, options?: { defaultYear?: number }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet =
    workbook.worksheets.find((candidate) => /vente|caisse/i.test(candidate.name))
    ?? workbook.worksheets[0];

  if (!sheet) {
    throw new Error("Feuille introuvable dans le rapport Mbujimayi.");
  }

  const defaultYear = options?.defaultYear ?? new Date().getUTCFullYear();
  let currentMonth: string | null = null;
  let inferredYear = defaultYear;
  const rows: MbujimayiReportSaleRow[] = [];
  const monthsDetected = new Set<string>();

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const col1 = row.getCell(1).value;
    const col2 = normalizeText(row.getCell(2).value);
    const col3 = normalizeText(row.getCell(3).value);
    const col4 = row.getCell(4).value;

    const headerMonth =
      parseMonthHeader(col2, inferredYear)
      ?? parseMonthHeader(col3, inferredYear)
      ?? parseMonthHeader(normalizeText(col1), inferredYear);

    if (headerMonth) {
      currentMonth = headerMonth;
      inferredYear = Number(headerMonth.slice(0, 4));
      monthsDetected.add(headerMonth);
      return;
    }

    if (!isVenteBillet(col2)) return;

    const parsedDate = cellDate(col1);
    const validDate = parsedDate && isPlausibleBusinessDate(parsedDate) ? parsedDate : null;
    const reportMonth = validDate ? toMonthKey(validDate) : currentMonth;
    if (!reportMonth) return;

    monthsDetected.add(reportMonth);
    const clientName = col3.trim();
    if (!clientName) return;

    rows.push({
      rowNumber,
      reportMonth,
      businessDate: validDate ? toIsoDate(validDate) : null,
      clientName,
      amountUsd: asAmount(col4),
      typeOperation: col2,
    });
  });

  return {
    sheetName: sheet.name,
    monthsDetected: [...monthsDetected].sort(),
    rows,
  };
}

export function filterMbujimayiReportRowsForMonth(rows: MbujimayiReportSaleRow[], month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Mois invalide: ${month}`);
  }
  return rows.filter((row) => row.reportMonth === month);
}
