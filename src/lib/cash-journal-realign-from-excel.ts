import { CashDirection, CashOperationCategory, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseCashReportWorkbook, type ParsedJournalLine } from "@/lib/cash-report-excel-parse";

const IMPORT_SOURCE = "EXCEL_CAISSE2";
const PRIMARY_CASH_DESK = "THE_BEST";

type ImportedCashLeg = {
  amount: number;
  currency: "USD" | "CDF";
  direction: CashDirection;
  externalKey: string;
};

function listLineCashLegs(line: ParsedJournalLine): ImportedCashLeg[] {
  const legs: ImportedCashLeg[] = [];
  const add = (amount: number, currency: "USD" | "CDF", direction: CashDirection, suffix: string) => {
    if (amount <= 0) return;
    legs.push({
      amount,
      currency,
      direction,
      externalKey: `${line.externalKey}:${suffix}`,
    });
  };
  add(line.usdIn, "USD", CashDirection.INFLOW, "USD:IN");
  add(line.usdOut, "USD", CashDirection.OUTFLOW, "USD:OUT");
  add(line.cdfIn, "CDF", CashDirection.INFLOW, "CDF:IN");
  add(line.cdfOut, "CDF", CashDirection.OUTFLOW, "CDF:OUT");
  return legs;
}

function categoryForImportedLeg(lineCategory: ParsedJournalLine["lineCategory"], direction: CashDirection) {
  if (direction === CashDirection.OUTFLOW) return CashOperationCategory.OTHER_EXPENSE;
  if (lineCategory === "TICKET_INFLOW") return CashOperationCategory.SERVICE_INCOME;
  return CashOperationCategory.SERVICE_INCOME;
}

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  return normalized === "CDF" || normalized === "XAF" || normalized === "FC" ? "CDF" : "USD";
}

async function syncCashLegsForLine(
  tx: Prisma.TransactionClient,
  line: ParsedJournalLine,
  importedById: string,
) {
  if (line.lineCategory === "OPENING" || line.lineCategory === "SKIP") return;

  const legs = listLineCashLegs(line);
  if (legs.length === 0) return;

  for (const leg of legs) {
    await tx.cashOperation.upsert({
      where: { importExternalKey: leg.externalKey },
      create: {
        occurredAt: new Date(`${line.businessDate}T12:00:00.000Z`),
        direction: leg.direction,
        category: categoryForImportedLeg(line.lineCategory, leg.direction),
        amount: leg.amount,
        currency: normalizeMoneyCurrency(leg.currency),
        amountUsd: leg.currency === "USD" ? leg.amount : null,
        amountCdf: leg.currency === "CDF" ? leg.amount : null,
        method: "CASH",
        reference: line.referenceDoc,
        description: line.libelle,
        cashDesk: PRIMARY_CASH_DESK,
        importSource: IMPORT_SOURCE,
        importExternalKey: leg.externalKey,
        createdById: importedById,
      },
      update: {
        occurredAt: new Date(`${line.businessDate}T12:00:00.000Z`),
        direction: leg.direction,
        category: categoryForImportedLeg(line.lineCategory, leg.direction),
        amount: leg.amount,
        currency: normalizeMoneyCurrency(leg.currency),
        amountUsd: leg.currency === "USD" ? leg.amount : null,
        amountCdf: leg.currency === "CDF" ? leg.amount : null,
        reference: line.referenceDoc,
        description: line.libelle,
      },
    });
  }
}

export type JournalRealignResult = {
  fileName: string;
  reportMonth: string;
  parsedLines: number;
  updatedLines: number;
  missingLines: number;
  dryRun: boolean;
};

/** Réécrit les lignes journal + opérations caisse déjà en base à partir d’un Excel (sans nouvel import). */
export async function realignJournalLinesFromWorkbookBuffer(options: {
  buffer: Buffer;
  fileName: string;
  dryRun?: boolean;
}): Promise<JournalRealignResult> {
  const parsed = parseCashReportWorkbook(options.buffer, {
    fallbackYear: Number(parsedYearFromName(options.fileName)) || new Date().getFullYear(),
    reportMonthHint: undefined,
  });

  let updatedLines = 0;
  let missingLines = 0;

  if (!options.dryRun) {
    await prisma.$transaction(async (tx) => {
      for (const line of parsed.journalLines) {
        const existing = await tx.cashReportJournalLine.findUnique({
          where: { externalKey: line.externalKey },
          select: { id: true, import: { select: { importedById: true } } },
        });
        if (!existing) {
          missingLines += 1;
          continue;
        }

        await tx.cashReportJournalLine.update({
          where: { id: existing.id },
          data: {
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
          },
        });

        await syncCashLegsForLine(tx, line, existing.import.importedById);
        updatedLines += 1;
      }
    });
  } else {
    for (const line of parsed.journalLines) {
      const existing = await prisma.cashReportJournalLine.findUnique({
        where: { externalKey: line.externalKey },
        select: { id: true },
      });
      if (existing) updatedLines += 1;
      else missingLines += 1;
    }
  }

  return {
    fileName: options.fileName,
    reportMonth: parsed.reportMonth,
    parsedLines: parsed.journalLines.length,
    updatedLines,
    missingLines,
    dryRun: Boolean(options.dryRun),
  };
}

function parsedYearFromName(fileName: string) {
  const match = fileName.match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}
