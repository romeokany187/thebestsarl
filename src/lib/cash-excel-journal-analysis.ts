import { prisma } from "@/lib/prisma";
import {
  buildCashJournalLedgerFromImportedLines,
  loadImportedJournalLinesForDateRange,
} from "@/lib/cash-journal-ledger";

/** Premier mois d’import Excel caissière (continuité report à nouveau). */
export const EXCEL_CAISSE_FIRST_MONTH = "2026-04";

export type ExcelJournalBilletageAnalysis = {
  reportMonth: string;
  hasExcelJournal: boolean;
  closingDate: string | null;
  journalClosingUsd: number;
  journalClosingCdf: number;
  billetageUsd: number | null;
  billetageCdf: number | null;
  deltaUsd: number | null;
  deltaCdf: number | null;
  isAligned: boolean;
  importFileName: string | null;
};

export async function loadExcelJournalBilletageAnalysis(
  reportMonth: string,
  periodStart: string,
  periodEnd: string,
  cashDesk = "THE_BEST",
): Promise<ExcelJournalBilletageAnalysis> {
  const importedLines = await loadImportedJournalLinesForDateRange(periodStart, periodEnd);
  const ledger = buildCashJournalLedgerFromImportedLines(importedLines);

  const latestImport = await prisma.cashReportImport.findFirst({
    where: { reportMonth, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { closingDate: true, fileName: true },
  });

  const closingDate = latestImport?.closingDate ?? null;
  let billetageUsd: number | null = null;
  let billetageCdf: number | null = null;

  if (closingDate) {
    const snapshot = await prisma.cashBilletageSnapshot.findUnique({
      where: {
        date_cashDesk: { date: closingDate, cashDesk },
      },
      select: { expectedUsd: true, expectedCdf: true },
    });
    if (snapshot) {
      billetageUsd = snapshot.expectedUsd;
      billetageCdf = snapshot.expectedCdf;
    }
  }

  const journalClosingUsd = ledger.periodClosingUsd;
  const journalClosingCdf = ledger.periodClosingCdf;

  const deltaUsd = billetageUsd == null ? null : journalClosingUsd - billetageUsd;
  const deltaCdf = billetageCdf == null ? null : journalClosingCdf - billetageCdf;
  const isAligned =
    deltaUsd != null &&
    deltaCdf != null &&
    Math.abs(deltaUsd) <= 0.05 &&
    Math.abs(deltaCdf) <= 0.05;

  return {
    reportMonth,
    hasExcelJournal: importedLines.length > 0,
    closingDate,
    journalClosingUsd,
    journalClosingCdf,
    billetageUsd,
    billetageCdf,
    deltaUsd,
    deltaCdf,
    isAligned,
    importFileName: latestImport?.fileName ?? null,
  };
}

export async function resolveExcelOnlyMainCashJournalLedger(periodStart: string, periodEnd: string) {
  const importedLines = await loadImportedJournalLinesForDateRange(periodStart, periodEnd);
  if (importedLines.length === 0) {
    return {
      rows: [] as ReturnType<typeof buildCashJournalLedgerFromImportedLines>["rows"],
      usesExcelDailyOpenings: false,
      periodOpeningUsd: 0,
      periodOpeningCdf: 0,
      periodClosingUsd: 0,
      periodClosingCdf: 0,
      source: "excel-import" as const,
      hasExcelData: false,
    };
  }

  return {
    ...buildCashJournalLedgerFromImportedLines(importedLines),
    source: "excel-import" as const,
    hasExcelData: true,
  };
}
