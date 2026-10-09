import { createHash } from "node:crypto";
import { CashDirection, CashOperationCategory, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  parseCashReportWorkbook,
  type ParsedJournalLine,
  uniqueSortedDates,
} from "@/lib/cash-report-excel-parse";

const IMPORT_SOURCE = "EXCEL_CAISSE2";
const PRIMARY_CASH_DESK = "THE_BEST";
const PLACEHOLDER_TICKET_NUMBER = "EXCEL-IMPORT-PENDING";

type ImportOptions = {
  buffer: Buffer;
  fileName: string;
  closingDate: string;
  importedById: string;
  dryRun: boolean;
  reconcileDates?: string[];
};

export type CashReportImportAnalysisLine = {
  date: string;
  typeOperation: string;
  libelle: string;
  amount: number;
  currency: "USD" | "CDF";
  ticketMatched: boolean;
};

export type CashReportImportAnalysis = {
  fileName: string;
  lastImportedDate: string | null;
  journalRange: { from: string | null; to: string | null };
  status: "NEW_DAYS" | "UP_TO_DATE" | "RECONCILE_ONLY" | "NO_JOURNAL";
  statusLabel: string;
  readyToCommit: boolean;
  duplicateFile: boolean;
  totals: {
    ticketInUsd: number;
    ticketInCdf: number;
    otherInUsd: number;
    otherInCdf: number;
    outUsd: number;
    outCdf: number;
  };
  samples: {
    tickets: CashReportImportAnalysisLine[];
    movements: CashReportImportAnalysisLine[];
  };
  virtual: {
    totalUsd: number;
    totalCdf: number;
    channels: Array<{ label: string; usd: number; cdf: number }>;
  };
};

type ImportPreview = {
  dryRun: boolean;
  fileHash: string;
  fileName: string;
  reportMonth: string;
  closingDate: string;
  journalDates: string[];
  datesToImport: string[];
  skippedDates: string[];
  stats: {
    totalJournalLines: number;
    importLines: number;
    ticketLines: number;
    otherInflowLines: number;
    outflowLines: number;
    openingLines: number;
    unmatchedTicketLines: number;
  };
  billetages: Array<{ variant: string; totalUsd: number; totalCdf: number }>;
  virtualChannelCount: number;
  warnings: string[];
  analysis: CashReportImportAnalysis;
};

type ImportResult = ImportPreview & {
  importId: string;
};

function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeMoneyCurrency(value: string): "USD" | "CDF" {
  return value === "CDF" ? "CDF" : "USD";
}

function linePrimaryAmount(line: ParsedJournalLine) {
  if (line.usdIn > 0 || line.usdOut > 0) {
    return {
      amount: line.usdIn > 0 ? line.usdIn : line.usdOut,
      currency: "USD" as const,
      direction: line.usdIn > 0 ? CashDirection.INFLOW : CashDirection.OUTFLOW,
    };
  }
  return {
    amount: line.cdfIn > 0 ? line.cdfIn : line.cdfOut,
    currency: "CDF" as const,
    direction: line.cdfIn > 0 ? CashDirection.INFLOW : CashDirection.OUTFLOW,
  };
}

async function getLastImportedJournalDate(reportMonth: string) {
  const row = await prisma.cashReportJournalLine.findFirst({
    where: { reportMonth },
    orderBy: { businessDate: "desc" },
    select: { businessDate: true },
  });
  return row?.businessDate ?? null;
}

function resolveDatesToImport(allDates: string[], lastDate: string | null, reconcileDates: string[]) {
  const reconcileSet = new Set(reconcileDates);
  const toImport = allDates.filter((date) => {
    if (reconcileSet.has(date)) return true;
    if (!lastDate) return true;
    return date > lastDate;
  });
  const skipped = allDates.filter((date) => !toImport.includes(date));
  return { toImport, skipped };
}

async function ensurePlaceholderTicket() {
  const existing = await prisma.ticketSale.findFirst({
    where: { ticketNumber: PLACEHOLDER_TICKET_NUMBER },
    select: { id: true },
  });
  if (existing) return existing.id;

  const airline = await prisma.airline.findFirst({ orderBy: { code: "asc" }, select: { id: true } });
  if (!airline) {
    throw new Error("Aucune compagnie aérienne en base pour créer le ticket placeholder import Excel.");
  }

  const created = await prisma.ticketSale.create({
    data: {
      ticketNumber: PLACEHOLDER_TICKET_NUMBER,
      customerName: "À rattacher (import Excel)",
      route: "N/A",
      travelDate: new Date(),
      soldAt: new Date(),
      amount: 0,
      currency: "USD",
      airlineId: airline.id,
      commissionRateUsed: 0,
      commissionAmount: 0,
      paymentStatus: "UNPAID",
      notes: "Ticket technique pour encaissements Excel en attente de rattachement.",
    },
    select: { id: true },
  });

  return created.id;
}

async function matchTicketFromLibelle(libelle: string) {
  const normalizedLibelle = libelle.trim().toLowerCase();
  if (!normalizedLibelle) return null;

  const tickets = await prisma.ticketSale.findMany({
    where: {
      ticketNumber: { not: PLACEHOLDER_TICKET_NUMBER },
    },
    select: { id: true, customerName: true, ticketNumber: true },
    orderBy: { soldAt: "desc" },
    take: 500,
  });

  let best: { id: string; score: number } | null = null;
  for (const ticket of tickets) {
    const name = ticket.customerName.trim().toLowerCase();
    if (name.length < 4) continue;
    if (!normalizedLibelle.includes(name)) continue;
    const score = name.length;
    if (!best || score > best.score) best = { id: ticket.id, score };
  }

  return best?.id ?? null;
}

async function purgeImportedDay(
  tx: Prisma.TransactionClient,
  reportMonth: string,
  businessDate: string,
) {
  const existingLines = await tx.cashReportJournalLine.findMany({
    where: { reportMonth, businessDate },
    select: { id: true, paymentId: true, cashOperationId: true },
  });

  const paymentIds = existingLines.map((line) => line.paymentId).filter(Boolean) as string[];
  const cashOperationIds = existingLines.map((line) => line.cashOperationId).filter(Boolean) as string[];

  if (paymentIds.length > 0) {
    await tx.payment.deleteMany({
      where: { id: { in: paymentIds }, importSource: IMPORT_SOURCE },
    });
  }

  if (cashOperationIds.length > 0) {
    await tx.cashOperation.deleteMany({
      where: { id: { in: cashOperationIds }, importSource: IMPORT_SOURCE },
    });
  }

  if (existingLines.length > 0) {
    await tx.cashReportJournalLine.deleteMany({
      where: { id: { in: existingLines.map((line) => line.id) } },
    });
  }
}

function buildStats(lines: ParsedJournalLine[]) {
  return {
    totalJournalLines: lines.length,
    importLines: lines.length,
    ticketLines: lines.filter((line) => line.lineCategory === "TICKET_INFLOW").length,
    otherInflowLines: lines.filter((line) => line.lineCategory === "OTHER_INFLOW").length,
    outflowLines: lines.filter((line) => line.lineCategory === "OUTFLOW").length,
    openingLines: lines.filter((line) => line.lineCategory === "OPENING").length,
    unmatchedTicketLines: 0,
  };
}

function sumJournalTotals(lines: ParsedJournalLine[]) {
  return lines.reduce(
    (acc, line) => {
      if (line.lineCategory === "TICKET_INFLOW") {
        acc.ticketInUsd += line.usdIn;
        acc.ticketInCdf += line.cdfIn;
      } else if (line.lineCategory === "OTHER_INFLOW") {
        acc.otherInUsd += line.usdIn;
        acc.otherInCdf += line.cdfIn;
      } else if (line.lineCategory === "OUTFLOW") {
        acc.outUsd += line.usdOut;
        acc.outCdf += line.cdfOut;
      }
      return acc;
    },
    {
      ticketInUsd: 0,
      ticketInCdf: 0,
      otherInUsd: 0,
      otherInCdf: 0,
      outUsd: 0,
      outCdf: 0,
    },
  );
}

function toAnalysisLine(line: ParsedJournalLine, ticketMatched: boolean): CashReportImportAnalysisLine {
  const primary = linePrimaryAmount(line);
  return {
    date: line.businessDate,
    typeOperation: line.typeOperation,
    libelle: line.libelle.length > 72 ? `${line.libelle.slice(0, 72)}…` : line.libelle,
    amount: primary.amount,
    currency: primary.currency,
    ticketMatched,
  };
}

async function buildImportAnalysis(options: {
  fileName: string;
  parsed: ReturnType<typeof parseCashReportWorkbook>;
  linesToImport: ParsedJournalLine[];
  journalDates: string[];
  datesToImport: string[];
  skippedDates: string[];
  lastImportedDate: string | null;
  duplicateFile: boolean;
  reconcileDates: string[];
}): Promise<CashReportImportAnalysis> {
  const { from, to } = options.journalDates.length
    ? { from: options.journalDates[0], to: options.journalDates[options.journalDates.length - 1] }
    : { from: null, to: null };

  let status: CashReportImportAnalysis["status"] = "NEW_DAYS";
  let statusLabel = "Nouveaux jours détectés dans le journal.";
  if (options.parsed.journalLines.length === 0) {
    status = "NO_JOURNAL";
    statusLabel = "Aucune ligne de journal reconnue dans le fichier.";
  } else if (options.datesToImport.length === 0) {
    status = "UP_TO_DATE";
    statusLabel = "Journal déjà à jour pour ce mois (aucun jour nouveau).";
  } else if (options.reconcileDates.length > 0 && options.skippedDates.length > 0) {
    status = "RECONCILE_ONLY";
    statusLabel = "Réconciliation de dates sélectionnées.";
  }

  const ticketLines = options.linesToImport.filter((line) => line.lineCategory === "TICKET_INFLOW");
  const movementLines = options.linesToImport.filter(
    (line) => line.lineCategory === "OTHER_INFLOW" || line.lineCategory === "OUTFLOW",
  );

  const ticketMatches = await Promise.all(ticketLines.map((line) => matchTicketFromLibelle(line.libelle)));

  const virtualTotalUsd = options.parsed.virtualChannels.reduce((sum, channel) => sum + channel.usd, 0);
  const virtualTotalCdf = options.parsed.virtualChannels.reduce((sum, channel) => sum + channel.cdf, 0);

  const readyToCommit = options.datesToImport.length > 0 && !options.duplicateFile;

  return {
    fileName: options.fileName,
    lastImportedDate: options.lastImportedDate,
    journalRange: { from, to },
    status,
    statusLabel,
    readyToCommit,
    duplicateFile: options.duplicateFile,
    totals: sumJournalTotals(options.linesToImport),
    samples: {
      tickets: ticketLines.slice(0, 4).map((line, index) => toAnalysisLine(line, Boolean(ticketMatches[index]))),
      movements: movementLines.slice(0, 4).map((line) => toAnalysisLine(line, false)),
    },
    virtual: {
      totalUsd: virtualTotalUsd,
      totalCdf: virtualTotalCdf,
      channels: options.parsed.virtualChannels.map((channel) => ({
        label: channel.label,
        usd: channel.usd,
        cdf: channel.cdf,
      })),
    },
  };
}

export async function runCashReportExcelImport(options: ImportOptions): Promise<ImportPreview | ImportResult> {
  const fileHash = hashBuffer(options.buffer);
  const parsed = parseCashReportWorkbook(options.buffer, {
    reportMonthHint: options.closingDate.slice(0, 7),
    fallbackYear: Number(options.closingDate.slice(0, 4)),
  });

  const journalDates = uniqueSortedDates(parsed.journalLines);
  const lastDate = await getLastImportedJournalDate(parsed.reportMonth);
  const reconcileDates = options.reconcileDates ?? [];
  const { toImport: datesToImport, skipped: skippedDates } = resolveDatesToImport(journalDates, lastDate, reconcileDates);

  const linesToImport = parsed.journalLines.filter((line) => datesToImport.includes(line.businessDate));
  const stats = buildStats(linesToImport);

  const duplicate = await prisma.cashReportImport.findFirst({
    where: { fileHash, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });
  const duplicateFile = Boolean(duplicate && reconcileDates.length === 0);

  const analysis = await buildImportAnalysis({
    fileName: options.fileName,
    parsed,
    linesToImport,
    journalDates,
    datesToImport,
    skippedDates,
    lastImportedDate: lastDate,
    duplicateFile,
    reconcileDates,
  });

  const previewBase = {
    fileHash,
    fileName: options.fileName,
    reportMonth: parsed.reportMonth,
    closingDate: options.closingDate,
    journalDates,
    datesToImport,
    skippedDates,
    stats,
    billetages: parsed.billetages.map((item) => ({
      variant: item.variant,
      totalUsd: item.totalUsd,
      totalCdf: item.totalCdf,
    })),
    virtualChannelCount: parsed.virtualChannels.length,
    warnings: [
      ...parsed.warnings,
      ...(duplicateFile ? ["Ce fichier a déjà été importé tel quel. Indiquez des dates à réconcilier pour réimporter."] : []),
    ],
    analysis,
  };

  if (options.dryRun) {
    const unmatchedPreview = await Promise.all(
      linesToImport
        .filter((line) => line.lineCategory === "TICKET_INFLOW")
        .map(async (line) => matchTicketFromLibelle(line.libelle)),
    );
    return {
      dryRun: true,
      ...previewBase,
      stats: {
        ...stats,
        unmatchedTicketLines: unmatchedPreview.filter((id) => !id).length,
      },
    };
  }

  if (duplicateFile) {
    throw new Error("Ce fichier a déjà été importé (contenu identique). Utilisez « dates à réconcilier » pour forcer une mise à jour.");
  }

  if (!analysis.readyToCommit) {
    throw new Error("Rien à importer : le journal est déjà à jour pour ce mois.");
  }

  const placeholderTicketId = await ensurePlaceholderTicket();
  let ticketSyncCount = 0;
  let cashOpSyncCount = 0;

  const importRecord = await prisma.$transaction(async (tx) => {
    for (const businessDate of datesToImport) {
      await purgeImportedDay(tx, parsed.reportMonth, businessDate);
    }

    const createdImport = await tx.cashReportImport.create({
      data: {
        reportMonth: parsed.reportMonth,
        fileName: options.fileName,
        fileHash,
        closingDate: options.closingDate,
        status: "COMPLETED",
        importedById: options.importedById,
      },
    });

    for (const line of linesToImport) {
      let paymentId: string | null = null;
      let cashOperationId: string | null = null;
      let ticketMatchStatus: string | null = null;

      if (line.lineCategory === "TICKET_INFLOW") {
        const primary = linePrimaryAmount(line);
        const matchedTicketId = await matchTicketFromLibelle(line.libelle);
        ticketMatchStatus = matchedTicketId ? "MATCHED" : "UNMATCHED";

        const payment = await tx.payment.upsert({
          where: { importExternalKey: line.externalKey },
          create: {
            ticketId: matchedTicketId ?? placeholderTicketId,
            amount: primary.amount,
            currency: primary.currency,
            amountUsd: primary.currency === "USD" ? primary.amount : null,
            amountCdf: primary.currency === "CDF" ? primary.amount : null,
            paidAt: new Date(`${line.businessDate}T12:00:00.000Z`),
            method: "CASH",
            reference: line.referenceDoc,
            importSource: IMPORT_SOURCE,
            importExternalKey: line.externalKey,
            excelLibelle: line.libelle,
          },
          update: {
            ticketId: matchedTicketId ?? placeholderTicketId,
            amount: primary.amount,
            currency: primary.currency,
            amountUsd: primary.currency === "USD" ? primary.amount : null,
            amountCdf: primary.currency === "CDF" ? primary.amount : null,
            paidAt: new Date(`${line.businessDate}T12:00:00.000Z`),
            reference: line.referenceDoc,
            excelLibelle: line.libelle,
          },
        });
        paymentId = payment.id;
        ticketSyncCount += 1;
      } else if (line.lineCategory === "OTHER_INFLOW" || line.lineCategory === "OUTFLOW") {
        const primary = linePrimaryAmount(line);
        if (primary.amount <= 0) continue;

        const cashOperation = await tx.cashOperation.upsert({
          where: { importExternalKey: line.externalKey },
          create: {
            occurredAt: new Date(`${line.businessDate}T12:00:00.000Z`),
            direction: primary.direction,
            category: primary.direction === CashDirection.INFLOW ? CashOperationCategory.SERVICE_INCOME : CashOperationCategory.OTHER_EXPENSE,
            amount: primary.amount,
            currency: normalizeMoneyCurrency(primary.currency),
            amountUsd: primary.currency === "USD" ? primary.amount : null,
            amountCdf: primary.currency === "CDF" ? primary.amount : null,
            method: "CASH",
            reference: line.referenceDoc,
            description: line.libelle,
            cashDesk: PRIMARY_CASH_DESK,
            importSource: IMPORT_SOURCE,
            importExternalKey: line.externalKey,
            createdById: options.importedById,
          },
          update: {
            occurredAt: new Date(`${line.businessDate}T12:00:00.000Z`),
            direction: primary.direction,
            amount: primary.amount,
            currency: normalizeMoneyCurrency(primary.currency),
            amountUsd: primary.currency === "USD" ? primary.amount : null,
            amountCdf: primary.currency === "CDF" ? primary.amount : null,
            reference: line.referenceDoc,
            description: line.libelle,
          },
        });
        cashOperationId = cashOperation.id;
        cashOpSyncCount += 1;
      }

      await tx.cashReportJournalLine.create({
        data: {
          importId: createdImport.id,
          reportMonth: parsed.reportMonth,
          businessDate: line.businessDate,
          lineCategory: line.lineCategory,
          typeOperation: line.typeOperation,
          libelle: line.libelle,
          referenceDoc: line.referenceDoc,
          usdIn: line.usdIn,
          usdOut: line.usdOut,
          cdfIn: line.cdfIn,
          cdfOut: line.cdfOut,
          usdBalance: line.usdBalance,
          cdfBalance: line.cdfBalance,
          externalKey: line.externalKey,
          ticketMatchStatus,
          paymentId,
          cashOperationId,
        },
      });
    }

    for (const billetage of parsed.billetages) {
      if (billetage.variant !== "THE_BEST") {
        await tx.cashBilletageSnapshot.upsert({
          where: {
            date_cashDesk: { date: options.closingDate, cashDesk: billetage.variant },
          },
          create: {
            date: options.closingDate,
            cashDesk: billetage.variant,
            usdCounts: billetage.usdCounts,
            cdfCounts: billetage.cdfCounts,
            expectedUsd: billetage.totalUsd,
            expectedCdf: billetage.totalCdf,
            savedById: options.importedById,
          },
          update: {
            usdCounts: billetage.usdCounts,
            cdfCounts: billetage.cdfCounts,
            expectedUsd: billetage.totalUsd,
            expectedCdf: billetage.totalCdf,
            savedById: options.importedById,
            savedAt: new Date(),
          },
        });
        continue;
      }

      await tx.cashBilletageSnapshot.upsert({
        where: {
          date_cashDesk: { date: options.closingDate, cashDesk: "THE_BEST" },
        },
        create: {
          date: options.closingDate,
          cashDesk: "THE_BEST",
          usdCounts: billetage.usdCounts,
          cdfCounts: billetage.cdfCounts,
          expectedUsd: billetage.totalUsd,
          expectedCdf: billetage.totalCdf,
          savedById: options.importedById,
        },
        update: {
          usdCounts: billetage.usdCounts,
          cdfCounts: billetage.cdfCounts,
          expectedUsd: billetage.totalUsd,
          expectedCdf: billetage.totalCdf,
          savedById: options.importedById,
          savedAt: new Date(),
        },
      });
    }

    if (parsed.virtualChannels.length > 0) {
      const totalUsd = parsed.virtualChannels.reduce((sum, channel) => sum + channel.usd, 0);
      const totalCdf = parsed.virtualChannels.reduce((sum, channel) => sum + channel.cdf, 0);
      await tx.cashReportVirtualSnapshot.upsert({
        where: {
          closingDate_cashDesk: { closingDate: options.closingDate, cashDesk: "THE_BEST" },
        },
        create: {
          closingDate: options.closingDate,
          cashDesk: "THE_BEST",
          channels: parsed.virtualChannels,
          totalUsd,
          totalCdf,
          importId: createdImport.id,
        },
        update: {
          channels: parsed.virtualChannels,
          totalUsd,
          totalCdf,
          importId: createdImport.id,
        },
      });
    }

    return tx.cashReportImport.update({
      where: { id: createdImport.id },
      data: {
        journalNewCount: linesToImport.length,
        journalSkipCount: skippedDates.length,
        ticketSyncCount,
        cashOpSyncCount,
      },
    });
  });

  const unmatchedTicketLines = await prisma.cashReportJournalLine.count({
    where: {
      importId: importRecord.id,
      lineCategory: "TICKET_INFLOW",
      ticketMatchStatus: "UNMATCHED",
    },
  });

  return {
    dryRun: false,
    importId: importRecord.id,
    ...previewBase,
    stats: {
      ...stats,
      unmatchedTicketLines,
    },
  };
}
