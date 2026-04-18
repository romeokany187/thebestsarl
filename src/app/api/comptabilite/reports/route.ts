import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

const accountingEntryClient = (prisma as unknown as { accountingEntry: any }).accountingEntry;

type ReportType = "journal" | "ledger" | "trial-balance" | "general-balance";

type JournalPayload = ReturnType<typeof buildJournalPayload>;
type LedgerPayload = ReturnType<typeof buildLedgerPayload>;
type TrialBalancePayload = ReturnType<typeof buildTrialBalancePayload>;
type GeneralBalancePayload = ReturnType<typeof buildGeneralBalancePayload>;
type ReportPayload = JournalPayload | LedgerPayload | TrialBalancePayload | GeneralBalancePayload;

function canManageAccounting(role: string, jobTitle: string | null | undefined) {
  return role === "ADMIN" || role === "ACCOUNTANT" || (jobTitle ?? "") === "COMPTABLE";
}

async function ensureAccountingTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \
    \`AccountingEntry\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`sequence\` INT NOT NULL AUTO_INCREMENT,
      \`entryDate\` DATETIME(3) NOT NULL,
      \`pole\` VARCHAR(191) NULL,
      \`libelle\` VARCHAR(500) NOT NULL,
      \`pieceJustificative\` VARCHAR(191) NULL,
      \`exchangeRate\` DOUBLE NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`AccountingEntry_sequence_key\` (\`sequence\`),
      INDEX \`AccountingEntry_entryDate_idx\` (\`entryDate\`),
      INDEX \`AccountingEntry_createdById_idx\` (\`createdById\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \
    \`AccountingEntryLine\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`entryId\` VARCHAR(191) NOT NULL,
      \`side\` ENUM('DEBIT','CREDIT') NOT NULL,
      \`orderIndex\` INT NOT NULL DEFAULT 0,
      \`accountCode\` VARCHAR(191) NOT NULL,
      \`accountLabel\` VARCHAR(191) NOT NULL,
      \`amountUsd\` DOUBLE NULL,
      \`amountCdf\` DOUBLE NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`AccountingEntryLine_entryId_side_idx\` (\`entryId\`, \`side\`),
      INDEX \`AccountingEntryLine_accountCode_idx\` (\`accountCode\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
}

function parseDateRange(searchParams: URLSearchParams) {
  const now = new Date();
  const defaultMonth = now.toISOString().slice(0, 7);
  const startRaw = searchParams.get("startDate");
  const endRaw = searchParams.get("endDate");
  const monthRaw = searchParams.get("month") ?? defaultMonth;

  if (startRaw || endRaw) {
    const safeStart = startRaw ?? now.toISOString().slice(0, 10);
    const safeEnd = endRaw ?? safeStart;
    const start = new Date(`${safeStart}T00:00:00.000Z`);
    const end = new Date(`${safeEnd}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return {
      start,
      end,
      label: `Période du ${safeStart} au ${safeEnd}`,
      startRaw: safeStart,
      endRaw: safeEnd,
    };
  }

  const monthMatch = monthRaw.match(/^(\d{4})-(\d{2})$/);
  const year = monthMatch ? Number.parseInt(monthMatch[1], 10) : now.getUTCFullYear();
  const month = monthMatch ? Number.parseInt(monthMatch[2], 10) - 1 : now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return {
    start,
    end,
    label: `Période mensuelle ${start.toISOString().slice(0, 7)}`,
    startRaw: start.toISOString().slice(0, 10),
    endRaw: new Date(end.getTime() - 1).toISOString().slice(0, 10),
  };
}

function numberValue(value: number | null | undefined) {
  return Number(value ?? 0);
}

function formatMoney(value: number) {
  return value.toFixed(2);
}

function formatMoneyCell(value: number) {
  return value === 0 ? "" : Number(value).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatJournalDate(value: string | Date) {
  return new Date(value).toLocaleDateString("fr-FR");
}

function reportTypeFromSearch(searchParams: URLSearchParams): ReportType {
  const raw = searchParams.get("reportType");
  if (raw === "ledger") return "ledger";
  if (raw === "trial-balance") return "trial-balance";
  if (raw === "general-balance") return "general-balance";
  return "journal";
}

function matchesAccount(lineCode: string, selectedAccountCode: string, includeSubaccounts: boolean) {
  if (!selectedAccountCode) return true;
  if (includeSubaccounts) return lineCode === selectedAccountCode || lineCode.startsWith(selectedAccountCode);
  return lineCode === selectedAccountCode;
}

function buildJournalPayload(entries: any[], label: string) {
  const totals = entries.reduce(
    (sum, entry) => {
      for (const line of entry.lines) {
        if (line.side === "DEBIT") {
          sum.debitUsd += numberValue(line.amountUsd);
          sum.debitCdf += numberValue(line.amountCdf);
        } else {
          sum.creditUsd += numberValue(line.amountUsd);
          sum.creditCdf += numberValue(line.amountCdf);
        }
      }
      return sum;
    },
    { debitUsd: 0, creditUsd: 0, debitCdf: 0, creditCdf: 0 },
  );

  return {
    reportType: "journal" as const,
    periodLabel: label,
    entryCount: entries.length,
    totals,
    entries,
  };
}

type BalanceRow = {
  accountCode: string;
  accountLabel: string;
  debitUsd: number;
  creditUsd: number;
  debitCdf: number;
  creditCdf: number;
  balanceUsd: number;
  balanceCdf: number;
  balanceUsdSide: "DEBIT" | "CREDIT" | "ZERO";
  balanceCdfSide: "DEBIT" | "CREDIT" | "ZERO";
};

function balanceSide(value: number): "DEBIT" | "CREDIT" | "ZERO" {
  if (value > 0) return "DEBIT";
  if (value < 0) return "CREDIT";
  return "ZERO";
}

function buildBalanceRows(entries: any[], selectedAccountCode: string, includeSubaccounts: boolean) {
  const rows = new Map<string, BalanceRow>();

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (!matchesAccount(line.accountCode, selectedAccountCode, includeSubaccounts)) continue;
      const current = rows.get(line.accountCode) ?? {
        accountCode: line.accountCode,
        accountLabel: line.accountLabel,
        debitUsd: 0,
        creditUsd: 0,
        debitCdf: 0,
        creditCdf: 0,
        balanceUsd: 0,
        balanceCdf: 0,
        balanceUsdSide: "ZERO",
        balanceCdfSide: "ZERO",
      };

      if (line.side === "DEBIT") {
        current.debitUsd += numberValue(line.amountUsd);
        current.debitCdf += numberValue(line.amountCdf);
      } else {
        current.creditUsd += numberValue(line.amountUsd);
        current.creditCdf += numberValue(line.amountCdf);
      }

      current.balanceUsd = current.debitUsd - current.creditUsd;
      current.balanceCdf = current.debitCdf - current.creditCdf;
      current.balanceUsdSide = balanceSide(current.balanceUsd);
      current.balanceCdfSide = balanceSide(current.balanceCdf);
      rows.set(line.accountCode, current);
    }
  }

  return [...rows.values()].sort((left, right) => left.accountCode.localeCompare(right.accountCode));
}

function buildLedgerPayload(entries: any[], label: string, selectedAccountCode: string, includeSubaccounts: boolean) {
  type LedgerRow = {
    entryId: string;
    sequence: number;
    entryDate: string;
    libelle: string;
    pieceJustificative?: string | null;
    pole?: string | null;
    side: "DEBIT" | "CREDIT";
    debitUsd: number;
    creditUsd: number;
    debitCdf: number;
    creditCdf: number;
    counterparts: string;
  };

  type LedgerGroup = {
    accountCode: string;
    accountLabel: string;
    rows: LedgerRow[];
    totals: {
      debitUsd: number;
      creditUsd: number;
      debitCdf: number;
      creditCdf: number;
    };
  };

  const groups = new Map<string, LedgerGroup>();

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (!matchesAccount(line.accountCode, selectedAccountCode, includeSubaccounts)) continue;

      const key = line.accountCode;
      const existing: LedgerGroup = groups.get(key) ?? {
        accountCode: line.accountCode,
        accountLabel: line.accountLabel,
        rows: [],
        totals: { debitUsd: 0, creditUsd: 0, debitCdf: 0, creditCdf: 0 },
      };

      const debitUsd = line.side === "DEBIT" ? numberValue(line.amountUsd) : 0;
      const creditUsd = line.side === "CREDIT" ? numberValue(line.amountUsd) : 0;
      const debitCdf = line.side === "DEBIT" ? numberValue(line.amountCdf) : 0;
      const creditCdf = line.side === "CREDIT" ? numberValue(line.amountCdf) : 0;
      const counterparts = entry.lines
        .filter((candidate: any) => candidate.id !== line.id)
        .map((candidate: any) => `${candidate.accountCode} ${candidate.accountLabel}`)
        .join(" | ");

      existing.rows.push({
        entryId: entry.id,
        sequence: entry.sequence,
        entryDate: entry.entryDate,
        libelle: entry.libelle,
        pieceJustificative: entry.pieceJustificative,
        pole: entry.pole,
        side: line.side,
        debitUsd,
        creditUsd,
        debitCdf,
        creditCdf,
        counterparts,
      });
      existing.totals.debitUsd += debitUsd;
      existing.totals.creditUsd += creditUsd;
      existing.totals.debitCdf += debitCdf;
      existing.totals.creditCdf += creditCdf;
      groups.set(key, existing);
    }
  }

  const ledgerGroups = [...groups.values()].sort((left, right) => left.accountCode.localeCompare(right.accountCode));
  const totals = ledgerGroups.reduce(
    (sum, group) => {
      sum.debitUsd += group.totals.debitUsd;
      sum.creditUsd += group.totals.creditUsd;
      sum.debitCdf += group.totals.debitCdf;
      sum.creditCdf += group.totals.creditCdf;
      return sum;
    },
    { debitUsd: 0, creditUsd: 0, debitCdf: 0, creditCdf: 0 },
  );

  return {
    reportType: "ledger" as const,
    periodLabel: label,
    accountCode: selectedAccountCode || null,
    includeSubaccounts,
    groupCount: ledgerGroups.length,
    totals,
    groups: ledgerGroups,
  };
}

function buildTrialBalancePayload(entries: any[], label: string, selectedAccountCode: string, includeSubaccounts: boolean) {
  const rows = buildBalanceRows(entries, selectedAccountCode, includeSubaccounts);
  const totals = rows.reduce(
    (sum, row) => {
      sum.debitUsd += row.debitUsd;
      sum.creditUsd += row.creditUsd;
      sum.debitCdf += row.debitCdf;
      sum.creditCdf += row.creditCdf;
      return sum;
    },
    { debitUsd: 0, creditUsd: 0, debitCdf: 0, creditCdf: 0 },
  );

  return {
    reportType: "trial-balance" as const,
    periodLabel: label,
    accountCode: selectedAccountCode || null,
    includeSubaccounts,
    rowCount: rows.length,
    totals,
    rows,
  };
}

function buildGeneralBalancePayload(entries: any[], label: string, selectedAccountCode: string, includeSubaccounts: boolean) {
  const baseRows = buildBalanceRows(entries, selectedAccountCode, includeSubaccounts);
  const groups = new Map<string, {
    classCode: string;
    classLabel: string;
    debitUsd: number;
    creditUsd: number;
    debitCdf: number;
    creditCdf: number;
    balanceUsd: number;
    balanceCdf: number;
    accountCount: number;
  }>();

  for (const row of baseRows) {
    const classCode = row.accountCode.slice(0, 1) || "?";
    const current = groups.get(classCode) ?? {
      classCode,
      classLabel: `Classe ${classCode}`,
      debitUsd: 0,
      creditUsd: 0,
      debitCdf: 0,
      creditCdf: 0,
      balanceUsd: 0,
      balanceCdf: 0,
      accountCount: 0,
    };

    current.debitUsd += row.debitUsd;
    current.creditUsd += row.creditUsd;
    current.debitCdf += row.debitCdf;
    current.creditCdf += row.creditCdf;
    current.balanceUsd = current.debitUsd - current.creditUsd;
    current.balanceCdf = current.debitCdf - current.creditCdf;
    current.accountCount += 1;
    groups.set(classCode, current);
  }

  const rows = [...groups.values()].sort((left, right) => left.classCode.localeCompare(right.classCode));
  const totals = rows.reduce(
    (sum, row) => {
      sum.debitUsd += row.debitUsd;
      sum.creditUsd += row.creditUsd;
      sum.debitCdf += row.debitCdf;
      sum.creditCdf += row.creditCdf;
      return sum;
    },
    { debitUsd: 0, creditUsd: 0, debitCdf: 0, creditCdf: 0 },
  );

  return {
    reportType: "general-balance" as const,
    periodLabel: label,
    accountCode: selectedAccountCode || null,
    includeSubaccounts,
    rowCount: rows.length,
    totals,
    rows,
  };
}

type JournalPdfRow = {
  sequence: string;
  entryDate: string;
  pole: string;
  debitCode: string;
  debitLabel: string;
  creditCode: string;
  creditLabel: string;
  libelle: string;
  pieceJustificative: string;
  usdDebit: string;
  usdCredit: string;
  exchangeRate: string;
};

type JournalColumn = {
  key: keyof JournalPdfRow;
  label: string;
  width: number;
  align?: "left" | "center" | "right";
};

const JOURNAL_COLUMNS: JournalColumn[] = [
  { key: "sequence", label: "N°", width: 34, align: "center" },
  { key: "entryDate", label: "DATE", width: 66, align: "center" },
  { key: "pole", label: "POLE", width: 62, align: "center" },
  { key: "debitCode", label: "N°", width: 50, align: "center" },
  { key: "debitLabel", label: "INTITULE", width: 168 },
  { key: "creditCode", label: "N°", width: 50, align: "center" },
  { key: "creditLabel", label: "INTITULE", width: 168 },
  { key: "libelle", label: "LIBELLE", width: 252 },
  { key: "pieceJustificative", label: "PIECE JUSTIFICATIVE", width: 100 },
  { key: "usdDebit", label: "DEBIT", width: 66, align: "right" },
  { key: "usdCredit", label: "CREDIT", width: 66, align: "right" },
  { key: "exchangeRate", label: "TAUX", width: 55, align: "center" },
];

function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const content = (text ?? "").trim();
  if (!content) return [""];

  function splitTokenByWidth(token: string) {
    if (!token) return [""];
    if (font.widthOfTextAtSize(token, size) <= maxWidth) return [token];

    const parts: string[] = [];
    let current = "";

    for (const char of token) {
      const candidate = `${current}${char}`;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        parts.push(current);
        current = char;
      } else {
        current = candidate;
      }
    }

    if (current) parts.push(current);
    return parts;
  }

  const lines: string[] = [];
  for (const paragraph of content.split(/\r?\n/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      lines.push("");
      continue;
    }

    const words = trimmed.split(/\s+/);
    let current = "";
    for (const word of words) {
      const parts = splitTokenByWidth(word);
      for (const part of parts) {
        const candidate = current ? `${current} ${part}` : part;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          current = candidate;
        } else {
          if (current) lines.push(current);
          current = part;
        }
      }
    }
    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

function flattenJournalRows(entries: any[]): JournalPdfRow[] {
  const rows: JournalPdfRow[] = [];

  for (const entry of entries) {
    const debitLines = entry.lines.filter((line: any) => line.side === "DEBIT");
    const creditLines = entry.lines.filter((line: any) => line.side === "CREDIT");
    const rowCount = Math.max(debitLines.length, creditLines.length, 1);

    for (let index = 0; index < rowCount; index += 1) {
      const debitLine = debitLines[index] ?? null;
      const creditLine = creditLines[index] ?? null;
      rows.push({
        sequence: index === 0 ? String(entry.sequence) : "",
        entryDate: index === 0 ? formatJournalDate(entry.entryDate) : "",
        pole: index === 0 ? entry.pole ?? "" : "",
        debitCode: debitLine?.accountCode ?? "",
        debitLabel: debitLine?.accountLabel ?? "",
        creditCode: creditLine?.accountCode ?? "",
        creditLabel: creditLine?.accountLabel ?? "",
        libelle: index === 0 ? entry.libelle ?? "" : "",
        pieceJustificative: index === 0 ? entry.pieceJustificative ?? "" : "",
        usdDebit: formatMoneyCell(numberValue(debitLine?.amountUsd)),
        usdCredit: formatMoneyCell(numberValue(creditLine?.amountUsd)),
        exchangeRate: index === 0 && entry.exchangeRate ? formatMoneyCell(Number(entry.exchangeRate)) : "",
      });
    }
  }

  return rows;
}

function journalRowHeight(row: JournalPdfRow, font: PDFFont, size: number) {
  const wrappedLineCount = Math.max(
    wrapPdfText(row.debitLabel, font, size, 160).length,
    wrapPdfText(row.creditLabel, font, size, 160).length,
    wrapPdfText(row.libelle, font, size, 244).length,
    wrapPdfText(row.pieceJustificative, font, size, 92).length,
  );
  return Math.max(24, wrappedLineCount * (size + 3) + 8);
}

function drawCellText(params: {
  page: PDFPage;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: PDFFont;
  size: number;
  align?: "left" | "center" | "right";
}) {
  const { page, text, x, y, width, height, font, size, align = "left" } = params;
  const lines = wrapPdfText(text, font, size, Math.max(4, width - 8));
  const lineHeight = size + 3;
  const blockHeight = lines.length * lineHeight;
  let cursorY = y + ((height + blockHeight) / 2) - lineHeight + 1;

  for (const line of lines) {
    const textWidth = font.widthOfTextAtSize(line, size);
    const textX = align === "right"
      ? x + width - textWidth - 4
      : align === "center"
        ? x + (width - textWidth) / 2
        : x + 4;
    page.drawText(line, {
      x: Math.max(x + 2, textX),
      y: cursorY,
      size,
      font,
      color: rgb(0.08, 0.08, 0.08),
    });
    cursorY -= lineHeight;
  }
}

function drawJournalTableHeader(page: PDFPage, font: PDFFont, bold: PDFFont, startX: number, topY: number) {
  const groupRowHeight = 22;
  const subRowHeight = 24;
  const borderColor = rgb(0.15, 0.15, 0.15);
  const fill = rgb(0.93, 0.94, 0.96);
  const groupFill = rgb(0.84, 0.86, 0.9);
  const totalHeaderHeight = groupRowHeight + subRowHeight;

  const simpleKeys: Array<keyof JournalPdfRow> = ["sequence", "entryDate", "pole", "libelle", "pieceJustificative", "exchangeRate"];
  let cursorX = startX;

  for (const column of JOURNAL_COLUMNS) {
    if (simpleKeys.includes(column.key)) {
      page.drawRectangle({ x: cursorX, y: topY - totalHeaderHeight, width: column.width, height: totalHeaderHeight, borderWidth: 0.8, borderColor, color: fill });
      drawCellText({ page, text: column.label, x: cursorX, y: topY - totalHeaderHeight, width: column.width, height: totalHeaderHeight, font: bold, size: 8.2, align: "center" });
    }
    cursorX += column.width;
  }

  const debitGroupX = startX + JOURNAL_COLUMNS.slice(0, 3).reduce((sum, column) => sum + column.width, 0);
  const debitGroupWidth = JOURNAL_COLUMNS[3].width + JOURNAL_COLUMNS[4].width;
  const creditGroupX = debitGroupX + debitGroupWidth;
  const creditGroupWidth = JOURNAL_COLUMNS[5].width + JOURNAL_COLUMNS[6].width;
  const usdGroupX = startX + JOURNAL_COLUMNS.slice(0, 9).reduce((sum, column) => sum + column.width, 0);
  const usdGroupWidth = JOURNAL_COLUMNS[9].width + JOURNAL_COLUMNS[10].width;

  for (const [label, x, width] of [
    ["DEBIT", debitGroupX, debitGroupWidth],
    ["CREDIT", creditGroupX, creditGroupWidth],
    ["MONTANT USD", usdGroupX, usdGroupWidth],
  ] as const) {
    page.drawRectangle({ x, y: topY - groupRowHeight, width, height: groupRowHeight, borderWidth: 0.8, borderColor, color: groupFill });
    drawCellText({ page, text: label, x, y: topY - groupRowHeight, width, height: groupRowHeight, font: bold, size: 8.2, align: "center" });
  }

  cursorX = debitGroupX;
  for (const column of JOURNAL_COLUMNS.slice(3, 11)) {
    page.drawRectangle({ x: cursorX, y: topY - totalHeaderHeight, width: column.width, height: subRowHeight, borderWidth: 0.8, borderColor, color: fill });
    drawCellText({ page, text: column.label, x: cursorX, y: topY - totalHeaderHeight, width: column.width, height: subRowHeight, font: bold, size: 7.5, align: "center" });
    cursorX += column.width;
  }

  return totalHeaderHeight;
}

async function buildPdf(report: ReportPayload) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = report.reportType === "journal" ? 1191 : 842;
  const pageHeight = report.reportType === "journal" ? 842 : 595;
  const margin = report.reportType === "journal" ? 24 : 28;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function drawHeader(title: string, subtitle: string) {
    page.drawRectangle({ x: 0, y: pageHeight - 92, width: pageWidth, height: 92, color: rgb(0.08, 0.1, 0.14) });
    page.drawText("THEBEST SARL", { x: margin, y: pageHeight - 30, size: 18, font: bold, color: rgb(1, 1, 1) });
    page.drawText(title, { x: margin, y: pageHeight - 52, size: 12.5, font: bold, color: rgb(0.92, 0.94, 0.99) });
    page.drawText(subtitle, { x: margin, y: pageHeight - 70, size: 8.5, font, color: rgb(0.75, 0.79, 0.86) });
    y = pageHeight - 138;
  }

  function drawSummaryBox(text: string, offsetX: number, width: number) {
    const height = 34;
    page.drawRectangle({ x: offsetX, y, width, height, borderWidth: 1, borderColor: rgb(0.85, 0.87, 0.91) });
    const lines = wrapPdfText(text, bold, 9, width - 12).slice(0, 2);
    let textY = y + height - 12;
    for (const line of lines) {
      page.drawText(line, { x: offsetX + 6, y: textY, size: 9, font: bold, color: rgb(0.14, 0.16, 0.2) });
      textY -= 10;
    }
  }

  function addPage() {
    page = pdf.addPage([pageWidth, pageHeight]);
    drawHeader(
      report.reportType === "journal" ? "Livre journal comptable" : report.reportType === "ledger" ? "Grand livre comptable" : report.reportType === "trial-balance" ? "Balance des comptes" : "Balance generale",
      report.periodLabel,
    );
  }

  function line(text: string, options?: { size?: number; bold?: boolean; color?: [number, number, number] }) {
    const size = options?.size ?? 9;
    const currentFont = options?.bold ? bold : font;
    const color = options?.color ?? [0.15, 0.15, 0.15];
    if (y < 40) addPage();
    page.drawText(text, {
      x: margin,
      y,
      size,
      font: currentFont,
      color: rgb(color[0], color[1], color[2]),
      maxWidth: pageWidth - margin * 2,
    });
    y -= size + 6;
  }

  drawHeader(
    report.reportType === "journal" ? "Livre journal comptable" : report.reportType === "ledger" ? "Grand livre comptable" : report.reportType === "trial-balance" ? "Balance des comptes" : "Balance generale",
    report.periodLabel,
  );

  if (report.reportType === "journal") {
    drawSummaryBox(`Ecritures: ${report.entryCount}`, margin, 170);
    drawSummaryBox(`USD debit ${formatMoney(report.totals.debitUsd)} | credit ${formatMoney(report.totals.creditUsd)}`, margin + 182, 280);
    drawSummaryBox(`Modele: presentation livre journal`, margin + 474, 250);
    y -= 48;
  } else if (report.reportType === "ledger") {
    drawSummaryBox(`Comptes mouvementes: ${report.groupCount}`, margin, 180);
    drawSummaryBox(`Filtre: ${report.accountCode ?? "Tous les comptes"}`, margin + 192, 220);
    drawSummaryBox(`Sous-comptes: ${report.includeSubaccounts ? "Oui" : "Non"}`, margin + 424, 160);
    drawSummaryBox(`USD D ${formatMoney(report.totals.debitUsd)} | C ${formatMoney(report.totals.creditUsd)}`, margin + 596, 218);
    y -= 42;
  } else if (report.reportType === "trial-balance") {
    drawSummaryBox(`Comptes: ${report.rowCount}`, margin, 160);
    drawSummaryBox(`USD D ${formatMoney(report.totals.debitUsd)} | C ${formatMoney(report.totals.creditUsd)}`, margin + 172, 260);
    drawSummaryBox(`Filtre: ${report.accountCode ?? "Tous les comptes"}`, margin + 444, 260);
    y -= 42;
  } else {
    drawSummaryBox(`Classes: ${report.rowCount}`, margin, 160);
    drawSummaryBox(`USD D ${formatMoney(report.totals.debitUsd)} | C ${formatMoney(report.totals.creditUsd)}`, margin + 172, 260);
    drawSummaryBox(`Filtre: ${report.accountCode ?? "Toutes les classes"}`, margin + 444, 260);
    y -= 42;
  }

  if (report.reportType === "journal") {
    const rows = flattenJournalRows(report.entries);
    const tableStartX = margin;
    const borderColor = rgb(0.15, 0.15, 0.15);
    const rowFill = rgb(1, 1, 1);
    const alternateFill = rgb(0.985, 0.985, 0.985);
    const fontSize = 8.1;

    const drawJournalPageHeader = () => {
      const headerHeight = drawJournalTableHeader(page, font, bold, tableStartX, y);
      y -= headerHeight;
    };

    drawJournalPageHeader();

    rows.forEach((row, index) => {
      const rowHeight = journalRowHeight(row, font, fontSize);
      if (y - rowHeight < 42) {
        addPage();
        y -= 8;
        drawJournalPageHeader();
      }

      let cursorX = tableStartX;
      for (const column of JOURNAL_COLUMNS) {
        page.drawRectangle({
          x: cursorX,
          y: y - rowHeight,
          width: column.width,
          height: rowHeight,
          borderWidth: 0.75,
          borderColor,
          color: index % 2 === 0 ? rowFill : alternateFill,
        });
        drawCellText({
          page,
          text: row[column.key],
          x: cursorX,
          y: y - rowHeight,
          width: column.width,
          height: rowHeight,
          font: column.key === "sequence" || column.key === "entryDate" || column.key === "usdDebit" || column.key === "usdCredit" ? bold : font,
          size: fontSize,
          align: column.align,
        });
        cursorX += column.width;
      }
      y -= rowHeight;
    });

    const totalRow: JournalPdfRow = {
      sequence: "",
      entryDate: "",
      pole: "",
      debitCode: "",
      debitLabel: "TOTAL",
      creditCode: "",
      creditLabel: "",
      libelle: `${report.entryCount} ecritures`,
      pieceJustificative: "",
      usdDebit: formatMoneyCell(report.totals.debitUsd),
      usdCredit: formatMoneyCell(report.totals.creditUsd),
      exchangeRate: "",
    };
    const totalHeight = journalRowHeight(totalRow, bold, fontSize);
    if (y - totalHeight < 42) {
      addPage();
      y -= 8;
      drawJournalPageHeader();
    }

    let totalX = tableStartX;
    for (const column of JOURNAL_COLUMNS) {
      page.drawRectangle({
        x: totalX,
        y: y - totalHeight,
        width: column.width,
        height: totalHeight,
        borderWidth: 0.8,
        borderColor,
        color: rgb(0.94, 0.94, 0.94),
      });
      drawCellText({
        page,
        text: totalRow[column.key],
        x: totalX,
        y: y - totalHeight,
        width: column.width,
        height: totalHeight,
        font: column.key === "debitLabel" || column.key === "libelle" ? bold : font,
        size: fontSize,
        align: column.align,
      });
      totalX += column.width;
    }
  } else if (report.reportType === "ledger") {
    for (const group of report.groups) {
      line(`${group.accountCode} - ${group.accountLabel}`, { bold: true });
      line(`Totaux | USD debit ${formatMoney(group.totals.debitUsd)} / credit ${formatMoney(group.totals.creditUsd)}`, { size: 8, color: [0.35, 0.35, 0.35] });
      for (const row of group.rows) {
        line(`  #${row.sequence} | ${new Date(row.entryDate).toLocaleDateString("fr-FR")} | ${row.side} | USD ${formatMoney(row.debitUsd || row.creditUsd)} | ${row.libelle}`, { size: 8 });
        if (row.counterparts) line(`    Contreparties: ${row.counterparts}`, { size: 7, color: [0.4, 0.4, 0.4] });
      }
      y -= 4;
    }
  } else if (report.reportType === "trial-balance") {
    line("Compte | Intitule | Debit USD | Credit USD | Solde USD", { size: 9, bold: true });
    for (const row of report.rows) {
      line(`${row.accountCode} | ${row.accountLabel} | ${formatMoney(row.debitUsd)} | ${formatMoney(row.creditUsd)} | ${formatMoney(Math.abs(row.balanceUsd))} ${row.balanceUsdSide === "ZERO" ? "" : row.balanceUsdSide === "DEBIT" ? "D" : "C"}`, { size: 8 });
    }
  } else {
    line("Classe | Comptes | Debit USD | Credit USD | Solde USD", { size: 9, bold: true });
    for (const row of report.rows) {
      line(`${row.classLabel} | ${row.accountCount} | ${formatMoney(row.debitUsd)} | ${formatMoney(row.creditUsd)} | ${formatMoney(Math.abs(row.balanceUsd))} ${balanceSide(row.balanceUsd) === "ZERO" ? "" : balanceSide(row.balanceUsd) === "DEBIT" ? "D" : "C"}`, { size: 8 });
    }
  }

  return pdf.save();
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Accès réservé au comptable et à l'administrateur." }, { status: 403 });
  }

  await ensureAccountingTables();

  const searchParams = request.nextUrl.searchParams;
  const reportType = reportTypeFromSearch(searchParams);
  const format = searchParams.get("format") === "pdf" ? "pdf" : "json";
  const selectedAccountCode = (searchParams.get("accountCode") ?? "").trim();
  const includeSubaccounts = searchParams.get("includeSubaccounts") === "1";
  const range = parseDateRange(searchParams);

  const entries = await accountingEntryClient.findMany({
    where: {
      entryDate: {
        gte: range.start,
        lt: range.end,
      },
    },
    orderBy: [{ entryDate: "asc" }, { sequence: "asc" }],
    include: {
      createdBy: { select: { name: true } },
      lines: {
        orderBy: [{ side: "asc" }, { orderIndex: "asc" }],
      },
    },
  });

  const payload = reportType === "journal"
    ? buildJournalPayload(entries, range.label)
    : reportType === "ledger"
      ? buildLedgerPayload(entries, range.label, selectedAccountCode, includeSubaccounts)
      : reportType === "trial-balance"
        ? buildTrialBalancePayload(entries, range.label, selectedAccountCode, includeSubaccounts)
        : buildGeneralBalancePayload(entries, range.label, selectedAccountCode, includeSubaccounts);

  if (format === "json") {
    return NextResponse.json(payload);
  }

  const pdfBytes = await buildPdf(payload);
  const filename = reportType === "journal"
    ? `livre-journal-${range.startRaw}-${range.endRaw}.pdf`
    : reportType === "ledger"
      ? `grand-livre-${selectedAccountCode || "general"}-${range.startRaw}-${range.endRaw}.pdf`
      : reportType === "trial-balance"
        ? `balance-comptes-${selectedAccountCode || "general"}-${range.startRaw}-${range.endRaw}.pdf`
        : `balance-generale-${selectedAccountCode || "general"}-${range.startRaw}-${range.endRaw}.pdf`;
  const disposition = searchParams.get("download") === "1" ? "attachment" : "inline";

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}