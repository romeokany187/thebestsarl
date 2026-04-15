import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

const accountingEntryClient = (prisma as unknown as { accountingEntry: any }).accountingEntry;

type ReportType = "journal" | "ledger";

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
  return raw === "ledger" ? "ledger" : "journal";
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

async function buildPdf(report: ReturnType<typeof buildJournalPayload> | ReturnType<typeof buildLedgerPayload>) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 32;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function addPage() {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
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

  line(report.reportType === "journal" ? "Livre journal comptable" : "Grand livre comptable", { size: 16, bold: true });
  line(report.periodLabel, { size: 10, color: [0.35, 0.35, 0.35] });
  y -= 4;

  if (report.reportType === "journal") {
    line(`Ecritures: ${report.entryCount} | USD debit ${formatMoney(report.totals.debitUsd)} / credit ${formatMoney(report.totals.creditUsd)} | CDF debit ${formatMoney(report.totals.debitCdf)} / credit ${formatMoney(report.totals.creditCdf)}`, { size: 10, bold: true });
    y -= 4;
    for (const entry of report.entries) {
      line(`Ecriture #${entry.sequence} - ${new Date(entry.entryDate).toLocaleString("fr-FR")} - ${entry.libelle}`, { bold: true });
      line(`Pole: ${entry.pole ?? "-"} | Piece: ${entry.pieceJustificative ?? "-"} | Taux: ${entry.exchangeRate ? `1 USD = ${Number(entry.exchangeRate).toFixed(2)} CDF` : "-"}`, { size: 8, color: [0.35, 0.35, 0.35] });
      for (const reportLine of entry.lines) {
        line(`  ${reportLine.side} | ${reportLine.accountCode} ${reportLine.accountLabel} | USD ${formatMoney(numberValue(reportLine.amountUsd))} | CDF ${formatMoney(numberValue(reportLine.amountCdf))}`, { size: 8 });
      }
      y -= 4;
    }
  } else {
    line(`Comptes mouvementes: ${report.groupCount} | USD debit ${formatMoney(report.totals.debitUsd)} / credit ${formatMoney(report.totals.creditUsd)} | CDF debit ${formatMoney(report.totals.debitCdf)} / credit ${formatMoney(report.totals.creditCdf)}`, { size: 10, bold: true });
    line(`Filtre compte: ${report.accountCode ?? "Tous les comptes mouvementes"} | Sous-comptes: ${report.includeSubaccounts ? "Oui" : "Non"}`, { size: 9, color: [0.35, 0.35, 0.35] });
    y -= 4;
    for (const group of report.groups) {
      line(`${group.accountCode} - ${group.accountLabel}`, { bold: true });
      line(`Totaux | USD debit ${formatMoney(group.totals.debitUsd)} / credit ${formatMoney(group.totals.creditUsd)} | CDF debit ${formatMoney(group.totals.debitCdf)} / credit ${formatMoney(group.totals.creditCdf)}`, { size: 8, color: [0.35, 0.35, 0.35] });
      for (const row of group.rows) {
        line(`  #${row.sequence} | ${new Date(row.entryDate).toLocaleDateString("fr-FR")} | ${row.side} | USD ${formatMoney(row.debitUsd || row.creditUsd)} | CDF ${formatMoney(row.debitCdf || row.creditCdf)} | ${row.libelle}`, { size: 8 });
        if (row.counterparts) line(`    Contreparties: ${row.counterparts}`, { size: 7, color: [0.4, 0.4, 0.4] });
      }
      y -= 4;
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
    : buildLedgerPayload(entries, range.label, selectedAccountCode, includeSubaccounts);

  if (format === "json") {
    return NextResponse.json(payload);
  }

  const pdfBytes = await buildPdf(payload);
  const filename = reportType === "journal"
    ? `livre-journal-${range.startRaw}-${range.endRaw}.pdf`
    : `grand-livre-${selectedAccountCode || "general"}-${range.startRaw}-${range.endRaw}.pdf`;
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