import * as XLSX from "xlsx";

export type CashReportJournalCategory = "OPENING" | "TICKET_INFLOW" | "OTHER_INFLOW" | "OUTFLOW" | "SKIP";

export type ParsedJournalLine = {
  businessDate: string;
  lineCategory: CashReportJournalCategory;
  typeOperation: string;
  libelle: string;
  referenceDoc: string | null;
  usdIn: number;
  usdOut: number;
  cdfIn: number;
  cdfOut: number;
  usdBalance: number | null;
  cdfBalance: number | null;
  externalKey: string;
};

export type ParsedBilletage = {
  variant: "THE_BEST" | "PROXY_BANKING" | "CAISSE_VISAS";
  usdCounts: Record<string, string>;
  cdfCounts: Record<string, string>;
  totalUsd: number;
  totalCdf: number;
};

export type ParsedVirtualChannel = {
  key: string;
  label: string;
  usd: number;
  cdf: number;
};

export type ParsedCashReportWorkbook = {
  reportMonth: string;
  journalLines: ParsedJournalLine[];
  billetages: ParsedBilletage[];
  virtualChannels: ParsedVirtualChannel[];
  warnings: string[];
};

const USD_DENOMS = [100, 50, 20, 10, 5, 1] as const;
const CDF_DENOMS = [20000, 10000, 5000, 1000, 500, 200, 100, 50] as const;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseMoneyCell(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/fc/gi, "")
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .trim();
  if (!raw || raw === "-" || raw === "-." || raw === "−") return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseBusinessDateCell(value: unknown, fallbackYear: number): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateKey(value);
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return formatDateKey(new Date(parsed));
  }

  if (/^\d{1,2}\/\d{1,2}$/.test(raw)) {
    const [m, d] = raw.split("/").map((part) => Number(part));
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${fallbackYear}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  return null;
}

function extractBonReference(typeOperation: string, libelle: string) {
  const haystack = `${typeOperation} ${libelle}`;
  const match = haystack.match(/n[°o]?\s*(\d{3,5})/i);
  return match?.[1] ?? null;
}

export function classifyJournalLine(typeOperation: string, libelle: string): CashReportJournalCategory {
  const type = normalizeText(typeOperation);
  const label = normalizeText(libelle);
  const combined = `${type} ${label}`;

  if (combined.includes("report a nouveau") || combined.includes("report à nouveau")) {
    return "OPENING";
  }

  const isEntry = type.includes("entree") || type.includes("entrée") || type.includes("bon d'entree") || type.includes("bon d entree");
  const isExit = type.includes("sortie") || type.includes("bon de sortie") || type.includes("bon de sorrtie");

  if (isEntry) {
    const ticketHints = [
      "paiement billet",
      "paimeent",
      "acompte",
      "solde billet",
      "penalite",
      "pénalité",
      "penalité",
      "billet",
      "remboursement billet",
    ];
    if (ticketHints.some((hint) => combined.includes(hint))) {
      return "TICKET_INFLOW";
    }
    return "OTHER_INFLOW";
  }

  if (isExit) return "OUTFLOW";

  if (label.includes("conversion") && (parseMoneyCell(typeOperation) || true)) {
    return "OTHER_INFLOW";
  }

  return "SKIP";
}

function buildExternalKey(reportMonth: string, businessDate: string, typeOperation: string, libelle: string, referenceDoc: string | null) {
  const ref = referenceDoc ?? extractBonReference(typeOperation, libelle) ?? "NA";
  const slug = normalizeText(`${typeOperation}|${libelle}|${ref}`).slice(0, 120);
  return `CAISSE2:${reportMonth}:${businessDate}:${ref}:${slug}`;
}

function findSheetName(sheetNames: string[], matcher: RegExp) {
  return sheetNames.find((name) => matcher.test(normalizeText(name))) ?? null;
}

function sheetRows(workbook: XLSX.WorkBook, sheetName: string) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [] as unknown[][];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }) as unknown[][];
}

export function inferReportMonthFromJournal(lines: ParsedJournalLine[], fallbackYear: number) {
  if (lines.length === 0) {
    const now = new Date();
    return `${fallbackYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  const counts = new Map<string, number>();
  for (const line of lines) {
    const month = line.businessDate.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }

  let bestMonth = "";
  let bestCount = 0;
  for (const [month, count] of counts) {
    if (count > bestCount) {
      bestMonth = month;
      bestCount = count;
    }
  }

  return bestMonth || lines[0].businessDate.slice(0, 7);
}

/** Dernier jour du journal pour le mois détecté (billetage / virtuel). */
export function suggestClosingDateForReport(journalLines: ParsedJournalLine[], reportMonth: string) {
  const prefix = `${reportMonth}-`;
  const datesInMonth = journalLines
    .map((line) => line.businessDate)
    .filter((date) => date.startsWith(prefix))
    .sort();

  if (datesInMonth.length > 0) return datesInMonth[datesInMonth.length - 1];

  const [yearText, monthText] = reportMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return `${reportMonth}-28`;
  }

  const lastDay = new Date(year, month, 0).getDate();
  return `${reportMonth}-${String(lastDay).padStart(2, "0")}`;
}

function parseJournalSheet(rows: unknown[][], fallbackYear: number, reportMonthHint?: string): { lines: ParsedJournalLine[]; warnings: string[] } {
  const warnings: string[] = [];
  let headerRowIndex = -1;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const c0 = normalizeText(row[0]);
    const c1 = normalizeText(row[1]);
    if (c0 === "date" && c1.includes("type") && c1.includes("operation")) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    warnings.push("Feuille journal: en-tête DATE / TYPE D'OPERATION introuvable.");
    return { lines: [], warnings };
  }

  const lines: ParsedJournalLine[] = [];

  for (let i = headerRowIndex + 2; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const dateCell = row[0];
    const typeOperation = String(row[1] ?? "").trim();
    const libelle = String(row[2] ?? "").trim();
    if (!dateCell && !typeOperation && !libelle) continue;

    const businessDate = parseBusinessDateCell(dateCell, fallbackYear);
    if (!businessDate) {
      if (typeOperation || libelle) warnings.push(`Journal ligne ${i + 1}: date invalide (${String(dateCell)})`);
      continue;
    }

    const usdIn = parseMoneyCell(row[3]);
    const usdOut = parseMoneyCell(row[4]);
    const cdfIn = parseMoneyCell(row[6]);
    const cdfOut = parseMoneyCell(row[7]);
    const usdBalanceRaw = row[5];
    const cdfBalanceRaw = row[8];
    const usdBalance = usdBalanceRaw === "" || usdBalanceRaw == null ? null : parseMoneyCell(usdBalanceRaw);
    const cdfBalance = cdfBalanceRaw === "" || cdfBalanceRaw == null ? null : parseMoneyCell(cdfBalanceRaw);

    const lineCategory = classifyJournalLine(typeOperation, libelle);
    if (lineCategory === "SKIP") continue;

    const referenceDoc = extractBonReference(typeOperation, libelle);
    const reportMonth = reportMonthHint ?? businessDate.slice(0, 7);

    lines.push({
      businessDate,
      lineCategory,
      typeOperation,
      libelle,
      referenceDoc,
      usdIn,
      usdOut,
      cdfIn,
      cdfOut,
      usdBalance,
      cdfBalance,
      externalKey: buildExternalKey(reportMonth, businessDate, typeOperation, libelle, referenceDoc),
    });
  }

  return { lines, warnings };
}

function parseDenomSection(rows: unknown[][], startIndex: number) {
  const counts: Record<string, string> = {};
  let total = 0;

  for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const marker = normalizeText(row[0]);
    if (marker.startsWith("total")) {
      total = parseMoneyCell(row[3] ?? row[2]);
      break;
    }
    if (marker.startsWith("i.") && rowIndex > startIndex) break;

    const denomination = parseMoneyCell(row[1]);
    if (!denomination) continue;

    const countRaw = String(row[2] ?? "").trim();
    const countParsed = Number.parseInt(countRaw.replace(/[^\d-]/g, ""), 10);
    const denomKey = String(denomination);
    if (Number.isFinite(countParsed) && countParsed > 0) {
      counts[denomKey] = String(countParsed);
    }
  }

  return { counts, total };
}

function parseBilletageSheet(rows: unknown[][], variant: ParsedBilletage["variant"]): ParsedBilletage | null {
  let usdStart = -1;
  let cdfStart = -1;

  for (let i = 0; i < rows.length; i += 1) {
    const label = normalizeText((rows[i] ?? [])[0]);
    if (label.includes("caisse usd")) usdStart = i + 2;
    if (label.includes("caisse cdf")) cdfStart = i + 2;
  }

  if (usdStart === -1 || cdfStart === -1) return null;

  const usd = parseDenomSection(rows, usdStart);
  const cdf = parseDenomSection(rows, cdfStart);

  return {
    variant,
    usdCounts: usd.counts,
    cdfCounts: cdf.counts,
    totalUsd: usd.total,
    totalCdf: cdf.total,
  };
}

function resolveBilletageVariant(sheetName: string): ParsedBilletage["variant"] | null {
  const normalized = normalizeText(sheetName);
  if (/^billetage$|^billeitage$/.test(normalized)) return "THE_BEST";
  if (normalized.includes("proxy")) return "PROXY_BANKING";
  if (normalized.includes("visa")) return "CAISSE_VISAS";
  return null;
}

function parseVirtualSheet(rows: unknown[][]): ParsedVirtualChannel[] {
  const channels: ParsedVirtualChannel[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const label = String(row[0] ?? "").trim();
    const normalized = normalizeText(label);
    if (!label || normalized === "comptes virtuels" || normalized === "devises" || normalized === "total") continue;

    const usd = parseMoneyCell(row[1]);
    const cdf = parseMoneyCell(row[2]);
    if (usd === 0 && cdf === 0) continue;

    channels.push({
      key: normalized.replace(/\s+/g, "_"),
      label,
      usd,
      cdf,
    });
  }

  return channels;
}

export function parseCashReportWorkbook(buffer: Buffer, options?: { fallbackYear?: number; reportMonthHint?: string }): ParsedCashReportWorkbook {
  const fallbackYear = options?.fallbackYear ?? new Date().getFullYear();
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const warnings: string[] = [];

  const journalSheet = findSheetName(workbook.SheetNames, /journal\s*de\s*caisse/);
  if (!journalSheet) warnings.push("Feuille « journal de caisse » introuvable.");

  let journalLines: ParsedJournalLine[] = [];
  if (journalSheet) {
    const parsed = parseJournalSheet(sheetRows(workbook, journalSheet), fallbackYear, options?.reportMonthHint);
    journalLines = parsed.lines;
    warnings.push(...parsed.warnings);
  }

  const reportMonth = options?.reportMonthHint ?? inferReportMonthFromJournal(journalLines, fallbackYear);
  journalLines = journalLines.map((line) => ({
    ...line,
    externalKey: buildExternalKey(reportMonth, line.businessDate, line.typeOperation, line.libelle, line.referenceDoc),
  }));

  const billetages: ParsedBilletage[] = [];
  for (const sheetName of workbook.SheetNames) {
    const variant = resolveBilletageVariant(sheetName);
    if (!variant) continue;
    const parsed = parseBilletageSheet(sheetRows(workbook, sheetName), variant);
    if (parsed) billetages.push(parsed);
  }

  const virtualSheet = findSheetName(workbook.SheetNames, /^virtuel$/);
  const virtualChannels = virtualSheet ? parseVirtualSheet(sheetRows(workbook, virtualSheet)) : [];
  if (!virtualSheet) warnings.push("Feuille VIRTUEL introuvable.");

  return {
    reportMonth,
    journalLines,
    billetages,
    virtualChannels,
    warnings,
  };
}

export function uniqueSortedDates(lines: ParsedJournalLine[]) {
  return [...new Set(lines.map((line) => line.businessDate))].sort();
}
