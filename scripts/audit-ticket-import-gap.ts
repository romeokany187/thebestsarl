import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

type Row = Record<string, unknown>;

type ExpectedRow = {
  sheet: string;
  line: number;
  sourcePnr: string;
  ticketNumber: string;
  emetteur: string;
  payant: string;
  montant: number;
  commission: number;
};

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function asString(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLikelyDailySheet(name: string) {
  return /^\d{1,2}\.\d{1,2}$/.test(name.trim()) || /^\d{4}$/.test(name.trim());
}

function parseSheetDateFromName(sheetName: string, year: number) {
  const clean = sheetName.trim();
  const dotted = clean.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dotted) {
    const day = Number.parseInt(dotted[1], 10);
    const month = Number.parseInt(dotted[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    }
  }
  return null;
}

function toRowsFromMatrix(sheet: XLSX.WorkSheet): Row[] {
  const matrix = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, { header: 1, raw: true, defval: null });
  if (!matrix.length) return [];

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(matrix.length, 8); i += 1) {
    const row = matrix[i] ?? [];
    const normalized = row.map((cell) => normalizeHeader(String(cell ?? "")));
    if (normalized.includes("pnr") && normalized.includes("emeteur") && normalized.includes("montant")) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    return XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: true });
  }

  const headerRow = matrix[headerRowIndex] ?? [];
  const headers = headerRow.map((cell, index) => asString(cell) ?? `col_${index}`);

  const out: Row[] = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const obj: Row = {};
    let hasAny = false;

    headers.forEach((header, index) => {
      const value = row[index] ?? null;
      obj[header] = value;
      if (!hasAny && asString(value)) hasAny = true;
    });

    if (hasAny) out.push(obj);
  }

  return out;
}

function pickValue(row: Row, headers: string[]) {
  const normalized = new Map<string, unknown>();
  Object.entries(row).forEach(([key, value]) => {
    normalized.set(normalizeHeader(key), value);
  });

  for (const header of headers) {
    const found = normalized.get(normalizeHeader(header));
    if (found !== undefined && found !== null && String(found).trim() !== "") {
      return found;
    }
  }
  return null;
}

async function main() {
  const filePath = process.argv[2] ?? "/Users/elkanamalik/Downloads/RAPPORT VENTE MARS  13  26.xlsx";
  const year = Number.parseInt(process.argv[3] ?? "2026", 10);
  const month = Number.parseInt(process.argv[4] ?? "1", 10);

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetNames = workbook.SheetNames.filter((name) => isLikelyDailySheet(name));

  const pnrSequence = new Map<string, number>();
  const expected: ExpectedRow[] = [];

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const sheetDate = parseSheetDateFromName(sheetName, year);
    if (!sheetDate) continue;
    if (sheetDate.getUTCFullYear() !== year || sheetDate.getUTCMonth() + 1 !== month) continue;

    const rows = toRowsFromMatrix(sheet);

    rows.forEach((row, idx) => {
      const sourcePnr = asString(pickValue(row, ["pnr", "ticketNumber", "numero billet", "num billet"])) ?? "";
      const montant = asNumber(pickValue(row, ["montant", "amount", "prix"])) ?? null;
      if (!sourcePnr || sourcePnr.toUpperCase() === "PNR" || !montant || montant <= 0) return;

      const seen = (pnrSequence.get(sourcePnr) ?? 0) + 1;
      pnrSequence.set(sourcePnr, seen);
      const ticketNumber = seen === 1 ? sourcePnr : `${sourcePnr}-R${seen}`;

      expected.push({
        sheet: sheetName,
        line: idx + 2,
        sourcePnr,
        ticketNumber,
        emetteur: asString(pickValue(row, ["emeteur", "emetteur", "sellerName"])) ?? "",
        payant: asString(pickValue(row, ["payant", "payerName"])) ?? "",
        montant,
        commission: asNumber(pickValue(row, ["commission", "commissionAmount"])) ?? 0,
      });
    });
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const dbRows = await prisma.ticketSale.findMany({
    where: { soldAt: { gte: monthStart, lt: monthEnd } },
    select: { ticketNumber: true },
  });

  const dbSet = new Set(dbRows.map((row) => row.ticketNumber));
  const baseInDb = new Set(dbRows.map((row) => row.ticketNumber.replace(/-R\d+$/, "")));

  const missing = expected
    .filter((row) => !dbSet.has(row.ticketNumber))
    .map((row) => {
      const hasBase = baseInDb.has(row.sourcePnr);
      const isVariant = /-R\d+$/.test(row.ticketNumber);
      const reason = isVariant && hasBase
        ? "Variante doublon absente (PNR source présent mais variante non conservée)"
        : "Ligne attendue absente en base";
      return { ...row, reason };
    });

  const outDir = path.join(process.cwd(), "imports");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `audit-gap-${year}-${String(month).padStart(2, "0")}.csv`);

  const headers = [
    "sheet",
    "line",
    "sourcePnr",
    "ticketNumber",
    "emetteur",
    "payant",
    "montant",
    "commission",
    "reason",
  ];

  const csv = [
    headers.join(","),
    ...missing.map((row) => headers.map((key) => {
      const value = String((row as Record<string, unknown>)[key] ?? "").replace(/"/g, '""');
      return `"${value}"`;
    }).join(",")),
  ].join("\n");

  writeFileSync(outPath, csv, "utf8");

  console.log(JSON.stringify({
    expectedRows: expected.length,
    dbRows: dbRows.length,
    missingRows: missing.length,
    output: outPath,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
