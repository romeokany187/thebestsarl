import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

async function buildPdf(report: ReportPayload) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regularBytes = await readFile(path.join(process.cwd(), "public", "fonts", "Montserrat-Regular.ttf"));
  const boldBytes = await readFile(path.join(process.cwd(), "public", "fonts", "Montserrat-Bold.ttf"));
  const font = await pdf.embedFont(regularBytes);
  const bold = await pdf.embedFont(boldBytes);
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 28;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function drawHeader(title: string, subtitle: string) {
    page.drawRectangle({ x: 0, y: pageHeight - 90, width: pageWidth, height: 90, color: rgb(0.08, 0.1, 0.14) });
    page.drawText("THEBEST SARL", { x: margin, y: pageHeight - 34, size: 18, font: bold, color: rgb(1, 1, 1) });
    page.drawText(title, { x: margin, y: pageHeight - 56, size: 13, font: bold, color: rgb(0.92, 0.94, 0.99) });
    page.drawText(subtitle, { x: margin, y: pageHeight - 74, size: 9, font, color: rgb(0.75, 0.79, 0.86) });
    y = pageHeight - 110;
  }

  function drawSummaryBox(text: string, offsetX: number, width: number) {
    page.drawRectangle({ x: offsetX, y, width, height: 38, borderWidth: 1, borderColor: rgb(0.85, 0.87, 0.91) });
    page.drawText(text, { x: offsetX + 10, y: y + 14, size: 9, font: bold, color: rgb(0.14, 0.16, 0.2), maxWidth: width - 18 });
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
    drawSummaryBox(`Ecritures: ${report.entryCount}`, margin, 160);
    drawSummaryBox(`USD D ${formatMoney(report.totals.debitUsd)} | C ${formatMoney(report.totals.creditUsd)}`, margin + 172, 260);
    drawSummaryBox(`CDF D ${formatMoney(report.totals.debitCdf)} | C ${formatMoney(report.totals.creditCdf)}`, margin + 444, 260);
    y -= 56;
  } else if (report.reportType === "ledger") {
    drawSummaryBox(`Comptes mouvementes: ${report.groupCount}`, margin, 180);
    drawSummaryBox(`Filtre: ${report.accountCode ?? "Tous les comptes"}`, margin + 192, 220);
    drawSummaryBox(`Sous-comptes: ${report.includeSubaccounts ? "Oui" : "Non"}`, margin + 424, 160);
    drawSummaryBox(`USD D ${formatMoney(report.totals.debitUsd)} | C ${formatMoney(report.totals.creditUsd)}`, margin + 596, 218);
    y -= 56;
  } else if (report.reportType === "trial-balance") {
    drawSummaryBox(`Comptes: ${report.rowCount}`, margin, 160);
    drawSummaryBox(`USD D ${formatMoney(report.totals.debitUsd)} | C ${formatMoney(report.totals.creditUsd)}`, margin + 172, 260);
    drawSummaryBox(`CDF D ${formatMoney(report.totals.debitCdf)} | C ${formatMoney(report.totals.creditCdf)}`, margin + 444, 260);
    y -= 56;
  } else {
    drawSummaryBox(`Classes: ${report.rowCount}`, margin, 160);
    drawSummaryBox(`USD D ${formatMoney(report.totals.debitUsd)} | C ${formatMoney(report.totals.creditUsd)}`, margin + 172, 260);
    drawSummaryBox(`CDF D ${formatMoney(report.totals.debitCdf)} | C ${formatMoney(report.totals.creditCdf)}`, margin + 444, 260);
    y -= 56;
  }

  if (report.reportType === "journal") {
    for (const entry of report.entries) {
      line(`Ecriture #${entry.sequence} - ${new Date(entry.entryDate).toLocaleString("fr-FR")} - ${entry.libelle}`, { bold: true });
      line(`Pole: ${entry.pole ?? "-"} | Piece: ${entry.pieceJustificative ?? "-"} | Taux: ${entry.exchangeRate ? `1 USD = ${Number(entry.exchangeRate).toFixed(2)} CDF` : "-"}`, { size: 8, color: [0.35, 0.35, 0.35] });
      for (const reportLine of entry.lines) {
        line(`  ${reportLine.side} | ${reportLine.accountCode} ${reportLine.accountLabel} | USD ${formatMoney(numberValue(reportLine.amountUsd))} | CDF ${formatMoney(numberValue(reportLine.amountCdf))}`, { size: 8 });
      }
      y -= 4;
    }
  } else if (report.reportType === "ledger") {
    for (const group of report.groups) {
      line(`${group.accountCode} - ${group.accountLabel}`, { bold: true });
      line(`Totaux | USD debit ${formatMoney(group.totals.debitUsd)} / credit ${formatMoney(group.totals.creditUsd)} | CDF debit ${formatMoney(group.totals.debitCdf)} / credit ${formatMoney(group.totals.creditCdf)}`, { size: 8, color: [0.35, 0.35, 0.35] });
      for (const row of group.rows) {
        line(`  #${row.sequence} | ${new Date(row.entryDate).toLocaleDateString("fr-FR")} | ${row.side} | USD ${formatMoney(row.debitUsd || row.creditUsd)} | CDF ${formatMoney(row.debitCdf || row.creditCdf)} | ${row.libelle}`, { size: 8 });
        if (row.counterparts) line(`    Contreparties: ${row.counterparts}`, { size: 7, color: [0.4, 0.4, 0.4] });
      }
      y -= 4;
    }
  } else if (report.reportType === "trial-balance") {
    line("Compte | Intitule | Debit USD | Credit USD | Solde USD | Debit CDF | Credit CDF | Solde CDF", { size: 9, bold: true });
    for (const row of report.rows) {
      line(`${row.accountCode} | ${row.accountLabel} | ${formatMoney(row.debitUsd)} | ${formatMoney(row.creditUsd)} | ${formatMoney(Math.abs(row.balanceUsd))} ${row.balanceUsdSide === "ZERO" ? "" : row.balanceUsdSide === "DEBIT" ? "D" : "C"} | ${formatMoney(row.debitCdf)} | ${formatMoney(row.creditCdf)} | ${formatMoney(Math.abs(row.balanceCdf))} ${row.balanceCdfSide === "ZERO" ? "" : row.balanceCdfSide === "DEBIT" ? "D" : "C"}`, { size: 8 });
    }
  } else {
    line("Classe | Comptes | Debit USD | Credit USD | Solde USD | Debit CDF | Credit CDF | Solde CDF", { size: 9, bold: true });
    for (const row of report.rows) {
      line(`${row.classLabel} | ${row.accountCount} | ${formatMoney(row.debitUsd)} | ${formatMoney(row.creditUsd)} | ${formatMoney(Math.abs(row.balanceUsd))} ${balanceSide(row.balanceUsd) === "ZERO" ? "" : balanceSide(row.balanceUsd) === "DEBIT" ? "D" : "C"} | ${formatMoney(row.debitCdf)} | ${formatMoney(row.creditCdf)} | ${formatMoney(Math.abs(row.balanceCdf))} ${balanceSide(row.balanceCdf) === "ZERO" ? "" : balanceSide(row.balanceCdf) === "DEBIT" ? "D" : "C"}`, { size: 8 });
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