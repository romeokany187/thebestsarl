import type { ImportedJournalLineRecord } from "@/lib/cash-journal-ledger";
import { refineJournalCategoryFromMovements, type CashReportJournalCategory } from "@/lib/cash-report-excel-parse";

/** Corrige à la volée les lignes importées avec l’ancien mapping colonnes (PDF / écran, sans toucher la base). */
export function sanitizeImportedJournalLineForDisplay(line: ImportedJournalLineRecord): ImportedJournalLineRecord {
  let {
    lineCategory,
    usdIn,
    usdOut,
    cdfIn,
    cdfOut,
    usdBalance,
    cdfBalance,
  } = line;

  if (lineCategory === "OPENING" && usdBalance == null && usdIn === 0 && usdOut === 0 && cdfIn > 0) {
    usdBalance = cdfIn;
    cdfIn = 0;
    cdfOut = 0;
  }

  lineCategory = refineJournalCategoryFromMovements(
    lineCategory as CashReportJournalCategory,
    usdIn,
    usdOut,
    cdfIn,
    cdfOut,
  );

  if (lineCategory === "OUTFLOW" && usdOut > 0 && cdfIn > 0 && cdfOut === 0) {
    cdfIn = 0;
  }

  if (lineCategory === "TICKET_INFLOW" && usdIn > 0 && cdfIn > 0 && cdfOut === 0 && cdfIn > usdIn * 10) {
    cdfIn = 0;
  }

  return {
    ...line,
    lineCategory,
    usdIn,
    usdOut,
    cdfIn,
    cdfOut,
    usdBalance,
    cdfBalance,
  };
}

export function sanitizeImportedJournalLinesForDisplay(lines: ImportedJournalLineRecord[]): ImportedJournalLineRecord[] {
  const sanitized = lines.map(sanitizeImportedJournalLineForDisplay);

  for (let index = 0; index < sanitized.length; index += 1) {
    const row = sanitized[index];
    if (row.lineCategory !== "OPENING" || row.cdfBalance != null) continue;

    const sameDayBalances = lines
      .filter((candidate) => candidate.businessDate === row.businessDate && candidate.cdfBalance != null)
      .map((candidate) => candidate.cdfBalance as number);
    if (sameDayBalances.length > 0) {
      sanitized[index] = { ...row, cdfBalance: sameDayBalances[0] };
    }
  }

  return sanitized;
}
