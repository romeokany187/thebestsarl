import { kinshasaDateKey } from "@/lib/kinshasa-time";
import { prisma } from "@/lib/prisma";
import { sanitizeImportedJournalLinesForDisplay } from "@/lib/cash-journal-import-sanitize";

export type ExcelDailyOpening = {
  usd: number;
  cdf: number;
  libelle: string;
  typeOperation: string;
};

export type CashJournalLedgerOperation = {
  id: string;
  occurredAt: Date;
  direction: string;
  currency: string;
  amount: number;
  description: string;
  reference: string | null;
  method?: string | null;
  category?: string | null;
};

export type CashJournalLedgerRow = {
  occurredAt: Date;
  typeOperation: string;
  libelle: string;
  reference: string;
  usdIn: number;
  usdOut: number;
  cdfIn: number;
  cdfOut: number;
  usdBalance: number;
  cdfBalance: number;
  isOpeningRow?: boolean;
  actionType?: "cash-operation";
  cashOperationId?: string;
  cashAmount?: number;
  cashCurrency?: "USD" | "CDF";
  cashMethod?: string;
  cashDescription?: string;
  cashOccurredAt?: string;
  cashDirection?: string;
  cashCategory?: string | null;
};

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  return normalized === "CDF" || normalized === "XAF" || normalized === "FC" ? "CDF" : "USD";
}

function openingAmountsFromLine(line: {
  usdBalance: number | null;
  cdfBalance: number | null;
}): { usd: number; cdf: number } {
  return {
    usd: line.usdBalance ?? 0,
    cdf: line.cdfBalance ?? 0,
  };
}

/** Report à nouveau par jour issu des imports Excel (dernier import gagnant par date). */
export async function loadExcelDailyOpeningsForDateRange(
  startDate: string,
  endDate: string,
): Promise<Map<string, ExcelDailyOpening>> {
  const lines = await prisma.cashReportJournalLine.findMany({
    where: {
      lineCategory: "OPENING",
      businessDate: { gte: startDate, lte: endDate },
    },
    select: {
      businessDate: true,
      typeOperation: true,
      libelle: true,
      usdBalance: true,
      cdfBalance: true,
      import: { select: { createdAt: true } },
    },
    orderBy: [{ businessDate: "asc" }, { import: { createdAt: "desc" } }],
  });

  const map = new Map<string, ExcelDailyOpening>();
  for (const line of lines) {
    if (map.has(line.businessDate)) continue;
    const { usd, cdf } = openingAmountsFromLine(line);
    map.set(line.businessDate, {
      usd,
      cdf,
      libelle: line.libelle,
      typeOperation: line.typeOperation,
    });
  }
  return map;
}

export type ImportedJournalLineRecord = {
  businessDate: string;
  lineCategory: string;
  typeOperation: string;
  libelle: string;
  referenceDoc: string | null;
  usdIn: number;
  usdOut: number;
  cdfIn: number;
  cdfOut: number;
  usdBalance: number | null;
  cdfBalance: number | null;
  createdAt: Date;
};

/** Lignes journal importées (colonnes USD + CDF comme dans Excel). */
export async function loadImportedJournalLinesForDateRange(
  startDate: string,
  endDate: string,
): Promise<ImportedJournalLineRecord[]> {
  return prisma.cashReportJournalLine.findMany({
    where: {
      businessDate: { gte: startDate, lte: endDate },
      lineCategory: { not: "SKIP" },
    },
    select: {
      businessDate: true,
      lineCategory: true,
      typeOperation: true,
      libelle: true,
      referenceDoc: true,
      usdIn: true,
      usdOut: true,
      cdfIn: true,
      cdfOut: true,
      usdBalance: true,
      cdfBalance: true,
      createdAt: true,
    },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Journal PDF / écran / Excel export.
 * Les lignes « REPORT À NOUVEAU » (OPENING) restent en base mais sont exclues
 * de l’affichage et des calculs de solde (évite de mélanger les mois).
 * Seul le premier report de la période sert éventuellement de solde d’ouverture KPI.
 */
export function buildCashJournalLedgerFromImportedLines(lines: ImportedJournalLineRecord[]): {
  rows: CashJournalLedgerRow[];
  usesExcelDailyOpenings: boolean;
  periodOpeningUsd: number;
  periodOpeningCdf: number;
  periodClosingUsd: number;
  periodClosingCdf: number;
} {
  const normalizedLines = sanitizeImportedJournalLinesForDisplay(lines);
  // OPENING (report à nouveau) : ignoré pour affichage et calculs (reste stocké en base).
  const movements = normalizedLines.filter((line) => line.lineCategory !== "OPENING");

  let periodOpeningUsd = 0;
  let periodOpeningCdf = 0;
  if (movements[0]) {
    const first = movements[0];
    const firstUsd = first.usdBalance ?? first.usdIn - first.usdOut;
    const firstCdf = first.cdfBalance ?? first.cdfIn - first.cdfOut;
    periodOpeningUsd = firstUsd - first.usdIn + first.usdOut;
    periodOpeningCdf = firstCdf - first.cdfIn + first.cdfOut;
  }

  let runningUsd = periodOpeningUsd;
  let runningCdf = periodOpeningCdf;

  const rows: CashJournalLedgerRow[] = movements.map((line) => {
    runningUsd += line.usdIn - line.usdOut;
    runningCdf += line.cdfIn - line.cdfOut;

    const usdBalance = line.usdBalance ?? runningUsd;
    const cdfBalance = line.cdfBalance ?? runningCdf;
    if (line.usdBalance != null) runningUsd = line.usdBalance;
    if (line.cdfBalance != null) runningCdf = line.cdfBalance;

    return {
      occurredAt: new Date(`${line.businessDate}T12:00:00.000Z`),
      typeOperation: line.typeOperation,
      libelle: line.libelle,
      reference: line.referenceDoc ?? "-",
      usdIn: line.usdIn,
      usdOut: line.usdOut,
      cdfIn: line.cdfIn,
      cdfOut: line.cdfOut,
      usdBalance,
      cdfBalance,
      isOpeningRow: false,
    };
  });

  const last = rows[rows.length - 1];

  return {
    rows,
    // Ne plus activer le mode « reports quotidiens » : les OPENING ne s’affichent plus.
    usesExcelDailyOpenings: false,
    periodOpeningUsd,
    periodOpeningCdf,
    periodClosingUsd: last?.usdBalance ?? periodOpeningUsd,
    periodClosingCdf: last?.cdfBalance ?? periodOpeningCdf,
  };
}

export async function resolveMainCashJournalLedger(options: {
  periodStart: string;
  periodEnd: string;
  periodStartDate: string;
  operations: CashJournalLedgerOperation[];
  periodFallbackOpening: { usd: number; cdf: number };
}) {
  const importedLines = await loadImportedJournalLinesForDateRange(options.periodStart, options.periodEnd);

  if (importedLines.length > 0) {
    return {
      ...buildCashJournalLedgerFromImportedLines(importedLines),
      source: "excel-import" as const,
    };
  }

  const excelDailyOpenings = await loadExcelDailyOpeningsForDateRange(options.periodStart, options.periodEnd);
  return {
    ...buildCashJournalLedger({
      operations: options.operations,
      excelOpeningsByDate: excelDailyOpenings,
      periodStartDate: options.periodStartDate,
      periodFallbackOpening: options.periodFallbackOpening,
    }),
    source: "cash-operations" as const,
  };
}

function mapOperationToMovementRow(operation: CashJournalLedgerOperation): Omit<CashJournalLedgerRow, "usdBalance" | "cdfBalance"> {
  const currency = normalizeMoneyCurrency(operation.currency);
  const isInflow = operation.direction === "INFLOW";
  return {
    occurredAt: new Date(operation.occurredAt),
    typeOperation: isInflow ? "Entrée en caisse" : "Sortie en caisse",
    libelle: operation.description,
    reference: operation.reference ?? "-",
    usdIn: isInflow && currency === "USD" ? operation.amount : 0,
    usdOut: !isInflow && currency === "USD" ? operation.amount : 0,
    cdfIn: isInflow && currency === "CDF" ? operation.amount : 0,
    cdfOut: !isInflow && currency === "CDF" ? operation.amount : 0,
    actionType: "cash-operation",
    cashOperationId: operation.id,
    cashAmount: operation.amount,
    cashCurrency: currency,
    cashMethod: operation.method ?? "CASH",
    cashDescription: operation.description,
    cashOccurredAt: new Date(operation.occurredAt).toISOString(),
    cashDirection: operation.direction,
    cashCategory: operation.category ?? null,
  };
}

export function buildCashJournalLedger(options: {
  operations: CashJournalLedgerOperation[];
  excelOpeningsByDate: Map<string, ExcelDailyOpening>;
  periodStartDate: string;
  periodFallbackOpening: { usd: number; cdf: number };
}): {
  rows: CashJournalLedgerRow[];
  usesExcelDailyOpenings: boolean;
  periodOpeningUsd: number;
  periodOpeningCdf: number;
  periodClosingUsd: number;
  periodClosingCdf: number;
} {
  const movementOps = options.operations.filter((operation) => operation.category !== "OPENING_BALANCE");

  const opsByDate = new Map<string, CashJournalLedgerOperation[]>();
  for (const operation of movementOps) {
    const dateKey = kinshasaDateKey(operation.occurredAt);
    const bucket = opsByDate.get(dateKey) ?? [];
    bucket.push(operation);
    opsByDate.set(dateKey, bucket);
  }
  for (const list of opsByDate.values()) {
    list.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }

  const dateKeys = [...opsByDate.keys()].sort();
  const rows: CashJournalLedgerRow[] = [];

  // Un seul report d’ouverture pour la période (premier jour), jamais affiché ni réappliqué chaque mois.
  const sortedOpeningDates = [...options.excelOpeningsByDate.keys()].sort();
  const periodStartOpening = options.excelOpeningsByDate.get(options.periodStartDate)
    ?? (sortedOpeningDates[0] ? options.excelOpeningsByDate.get(sortedOpeningDates[0]) : undefined);

  let periodOpeningUsd = periodStartOpening?.usd ?? options.periodFallbackOpening.usd;
  let periodOpeningCdf = periodStartOpening?.cdf ?? options.periodFallbackOpening.cdf;
  let runningUsd = periodOpeningUsd;
  let runningCdf = periodOpeningCdf;

  for (const dateKey of dateKeys) {
    for (const operation of opsByDate.get(dateKey) ?? []) {
      const movement = mapOperationToMovementRow(operation);
      runningUsd += movement.usdIn - movement.usdOut;
      runningCdf += movement.cdfIn - movement.cdfOut;
      rows.push({
        ...movement,
        usdBalance: runningUsd,
        cdfBalance: runningCdf,
      });
    }
  }

  const last = rows[rows.length - 1];

  return {
    rows,
    usesExcelDailyOpenings: false,
    periodOpeningUsd,
    periodOpeningCdf,
    periodClosingUsd: last?.usdBalance ?? periodOpeningUsd,
    periodClosingCdf: last?.cdfBalance ?? periodOpeningCdf,
  };
}
