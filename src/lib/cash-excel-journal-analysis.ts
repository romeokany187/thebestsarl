import { prisma } from "@/lib/prisma";
import {
  buildCashJournalLedgerFromImportedLines,
  loadImportedJournalLinesForDateRange,
} from "@/lib/cash-journal-ledger";
import { loadMainDeskExcelVirtualSnapshot } from "@/lib/cash-excel-virtual";

/** Premier mois d’import Excel caissière (continuité report à nouveau). */
export const EXCEL_CAISSE_FIRST_MONTH = "2026-04";

const MONEY_EPS = 0.05;

export type ExcelJournalBilletageAnalysis = {
  reportMonth: string;
  referenceDate: string | null;
  hasExcelJournal: boolean;
  closingDate: string | null;
  journalClosingUsd: number;
  journalClosingCdf: number;
  billetageUsd: number | null;
  billetageCdf: number | null;
  virtualUsd: number | null;
  virtualCdf: number | null;
  /** Billetage + virtuels (argent concret hors journal). */
  physicalUsd: number | null;
  physicalCdf: number | null;
  deltaUsd: number | null;
  deltaCdf: number | null;
  isAligned: boolean;
  importFileName: string | null;
};

async function loadBilletageSnapshotForReferenceDate(
  referenceDate: string,
  reportMonth: string,
  cashDesk: string,
) {
  const exact = await prisma.cashBilletageSnapshot.findUnique({
    where: { date_cashDesk: { date: referenceDate, cashDesk } },
    select: { expectedUsd: true, expectedCdf: true, date: true },
  });
  if (exact) return exact;

  return prisma.cashBilletageSnapshot.findFirst({
    where: {
      cashDesk,
      date: { lte: referenceDate, startsWith: `${reportMonth}-` },
    },
    orderBy: { date: "desc" },
    select: { expectedUsd: true, expectedCdf: true, date: true },
  });
}

export async function loadExcelJournalBilletageAnalysis(
  reportMonth: string,
  periodStart: string,
  periodEnd: string,
  cashDesk = "THE_BEST",
): Promise<ExcelJournalBilletageAnalysis> {
  const monthStart = `${reportMonth}-01`;
  const journalStart = periodStart < monthStart ? monthStart : periodStart;
  const importedLines = await loadImportedJournalLinesForDateRange(journalStart, periodEnd);
  const ledger = buildCashJournalLedgerFromImportedLines(importedLines);

  const latestImport = await prisma.cashReportImport.findFirst({
    where: { reportMonth, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { closingDate: true, fileName: true },
  });

  const referenceDate = periodEnd;
  const billetageSnapshot = await loadBilletageSnapshotForReferenceDate(referenceDate, reportMonth, cashDesk);
  const virtualSnapshot = await loadMainDeskExcelVirtualSnapshot(
    reportMonth,
    billetageSnapshot?.date ?? referenceDate,
    cashDesk,
  );

  let billetageUsd: number | null = billetageSnapshot?.expectedUsd ?? null;
  let billetageCdf: number | null = billetageSnapshot?.expectedCdf ?? null;
  const virtualUsd = virtualSnapshot?.totalUsd ?? null;
  const virtualCdf = virtualSnapshot?.totalCdf ?? null;

  const journalClosingUsd = ledger.periodClosingUsd;
  const journalClosingCdf = ledger.periodClosingCdf;

  const physicalUsd =
    billetageUsd != null || virtualUsd != null
      ? (billetageUsd ?? 0) + (virtualUsd ?? 0)
      : null;
  const physicalCdf =
    billetageCdf != null || virtualCdf != null
      ? (billetageCdf ?? 0) + (virtualCdf ?? 0)
      : null;

  const deltaUsd = physicalUsd != null ? journalClosingUsd - physicalUsd : null;
  const deltaCdf = physicalCdf != null ? journalClosingCdf - physicalCdf : null;
  const isAligned =
    deltaUsd != null &&
    deltaCdf != null &&
    Math.abs(deltaUsd) <= MONEY_EPS &&
    Math.abs(deltaCdf) <= MONEY_EPS;

  return {
    reportMonth,
    referenceDate,
    hasExcelJournal: importedLines.length > 0,
    closingDate: billetageSnapshot?.date ?? virtualSnapshot?.closingDate ?? latestImport?.closingDate ?? null,
    journalClosingUsd,
    journalClosingCdf,
    billetageUsd,
    billetageCdf,
    virtualUsd,
    virtualCdf,
    physicalUsd,
    physicalCdf,
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
