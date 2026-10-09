import { kinshasaDateKey } from "@/lib/kinshasa-time";
import { prisma } from "@/lib/prisma";

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
  const usesExcelDailyOpenings = options.excelOpeningsByDate.size > 0;
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

  const dateKeys = [...new Set([...options.excelOpeningsByDate.keys(), ...opsByDate.keys()])].sort();
  const rows: CashJournalLedgerRow[] = [];

  let runningUsd: number | null = null;
  let runningCdf: number | null = null;
  let periodOpeningUsd = options.periodFallbackOpening.usd;
  let periodOpeningCdf = options.periodFallbackOpening.cdf;

  for (const dateKey of dateKeys) {
    const excelOpening = options.excelOpeningsByDate.get(dateKey);

    if (excelOpening) {
      runningUsd = excelOpening.usd;
      runningCdf = excelOpening.cdf;
      if (dateKey === options.periodStartDate || rows.length === 0) {
        periodOpeningUsd = excelOpening.usd;
        periodOpeningCdf = excelOpening.cdf;
      }
      rows.push({
        occurredAt: new Date(`${dateKey}T00:00:00.000Z`),
        typeOperation: excelOpening.typeOperation || "Report à nouveau",
        libelle: excelOpening.libelle || "Report à nouveau (fichier Excel)",
        reference: "-",
        usdIn: 0,
        usdOut: 0,
        cdfIn: 0,
        cdfOut: 0,
        usdBalance: runningUsd,
        cdfBalance: runningCdf,
        isOpeningRow: true,
      });
    } else if (runningUsd === null) {
      runningUsd = options.periodFallbackOpening.usd;
      runningCdf = options.periodFallbackOpening.cdf;
      if (!usesExcelDailyOpenings) {
        periodOpeningUsd = runningUsd;
        periodOpeningCdf = runningCdf;
      }
    }

    if (runningUsd === null || runningCdf === null) {
      runningUsd = 0;
      runningCdf = 0;
    }

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
  let periodClosingUsd = last?.usdBalance ?? periodOpeningUsd;
  let periodClosingCdf = last?.cdfBalance ?? periodOpeningCdf;

  if (!usesExcelDailyOpenings && rows.length === 0) {
    periodOpeningUsd = options.periodFallbackOpening.usd;
    periodOpeningCdf = options.periodFallbackOpening.cdf;
  }

  if (usesExcelDailyOpenings && rows.length > 0) {
    const first = rows[0];
    periodOpeningUsd = first.usdBalance;
    periodOpeningCdf = first.cdfBalance;
    periodClosingUsd = last?.usdBalance ?? periodOpeningUsd;
    periodClosingCdf = last?.cdfBalance ?? periodOpeningCdf;
  }

  return {
    rows,
    usesExcelDailyOpenings,
    periodOpeningUsd,
    periodOpeningCdf,
    periodClosingUsd,
    periodClosingCdf,
  };
}
