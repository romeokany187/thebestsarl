import type { ParsedJournalLine } from "@/lib/cash-report-excel-parse";
import { kinshasaDateKey } from "@/lib/kinshasa-time";
import { prisma } from "@/lib/prisma";
import { buildDeskScopedCashOperationWhere } from "@/lib/payments-desk";

export type DayJournalTotals = {
  lineCount: number;
  ticketInUsd: number;
  ticketInCdf: number;
  otherInUsd: number;
  otherInCdf: number;
  outUsd: number;
  outCdf: number;
};

export type MonthDayStatus = "ALIGNED" | "MISSING_IN_SYSTEM" | "MISSING_IN_FILE" | "MISMATCH";

export type MonthDayConstat = {
  date: string;
  status: MonthDayStatus;
  excel: DayJournalTotals;
  system: DayJournalTotals;
};

export type GrossDayTotals = {
  inUsd: number;
  inCdf: number;
  outUsd: number;
  outCdf: number;
};

export type MonthlyConstat = {
  reportMonth: string;
  closedMonth: boolean;
  /** Même périmètre que le PDF « Journal de caisse » (opérations caisse THE BEST, hors paiements billets). */
  systemSourceLabel: string;
  excelSideLabel: string;
  excelJournalMeta: {
    linesInMonth: number;
    linesOutsideMonth: number;
    daysInMonth: number;
    dateFrom: string | null;
    dateTo: string | null;
  };
  verdict: string;
  aligned: boolean;
  summary: {
    excelDays: number;
    systemDays: number;
    alignedDays: number;
    missingInSystemDays: number;
    missingInFileDays: number;
    mismatchDays: number;
  };
  monthTotals: {
    excel: DayJournalTotals;
    system: DayJournalTotals;
    delta: DayJournalTotals;
  };
  monthGross: {
    excel: GrossDayTotals;
    system: GrossDayTotals;
    delta: GrossDayTotals;
  };
  days: MonthDayConstat[];
  datesToSync: string[];
};

const EMPTY_TOTALS: DayJournalTotals = {
  lineCount: 0,
  ticketInUsd: 0,
  ticketInCdf: 0,
  otherInUsd: 0,
  otherInCdf: 0,
  outUsd: 0,
  outCdf: 0,
};

const MONEY_EPS = 1;

/** Exclut les écritures créées par un import Excel, sans exclure importSource NULL (MySQL + Prisma NOT). */
export function whereNotExcelCaisse2Import() {
  return {
    OR: [{ importSource: null }, { importSource: { not: "EXCEL_CAISSE2" } }],
  };
}

export function isReportMonthClosed(reportMonth: string, todayKey = kinshasaDateKey()) {
  const currentMonth = todayKey.slice(0, 7);
  return reportMonth < currentMonth;
}

export function aggregateJournalDayTotals(lines: ParsedJournalLine[]): Map<string, DayJournalTotals> {
  const map = new Map<string, DayJournalTotals>();

  for (const line of lines) {
    if (line.lineCategory === "OPENING" || line.lineCategory === "SKIP") continue;

    const bucket = map.get(line.businessDate) ?? { ...EMPTY_TOTALS };
    bucket.lineCount += 1;

    if (line.lineCategory === "TICKET_INFLOW") {
      bucket.ticketInUsd += line.usdIn;
      bucket.ticketInCdf += line.cdfIn;
    } else if (line.lineCategory === "OTHER_INFLOW") {
      bucket.otherInUsd += line.usdIn;
      bucket.otherInCdf += line.cdfIn;
    } else if (line.lineCategory === "OUTFLOW") {
      bucket.outUsd += line.usdOut;
      bucket.outCdf += line.cdfOut;
    }

    map.set(line.businessDate, bucket);
  }

  return map;
}

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  return normalized === "CDF" || normalized === "XAF" || normalized === "FC" ? "CDF" : "USD";
}

function monthUtcRange(reportMonth: string) {
  const match = reportMonth.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`Mois invalide: ${reportMonth}`);
  }
  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

function addToDay(map: Map<string, DayJournalTotals>, businessDate: string, part: Omit<DayJournalTotals, "lineCount">) {
  const bucket = map.get(businessDate) ?? { ...EMPTY_TOTALS };
  bucket.lineCount += 1;
  bucket.ticketInUsd += part.ticketInUsd;
  bucket.ticketInCdf += part.ticketInCdf;
  bucket.otherInUsd += part.otherInUsd;
  bucket.otherInCdf += part.otherInCdf;
  bucket.outUsd += part.outUsd;
  bucket.outCdf += part.outCdf;
  map.set(businessDate, bucket);
}

/** Journal opérationnel (PDF) = opérations caisse manuelles + import Excel, sans paiements billets. */
export async function loadLiveCashJournalByDay(reportMonth: string): Promise<Map<string, DayJournalTotals>> {
  const { start, end } = monthUtcRange(reportMonth);
  const deskScope = buildDeskScopedCashOperationWhere("THE_BEST", { strict: true });

  const cashOperations = await prisma.cashOperation.findMany({
    where: {
      occurredAt: { gte: start, lt: end },
      category: { not: "OPENING_BALANCE" },
      ...whereNotExcelCaisse2Import(),
      ...deskScope,
    },
    select: {
      occurredAt: true,
      direction: true,
      amount: true,
      currency: true,
    },
  });

  const map = new Map<string, DayJournalTotals>();

  for (const operation of cashOperations) {
    const businessDate = kinshasaDateKey(operation.occurredAt);
    if (!businessDate.startsWith(`${reportMonth}-`)) continue;
    const currency = normalizeMoneyCurrency(operation.currency);
    const isInflow = operation.direction === "INFLOW";
    addToDay(
      map,
      businessDate,
      isInflow
        ? {
            ticketInUsd: 0,
            ticketInCdf: 0,
            otherInUsd: currency === "USD" ? operation.amount : 0,
            otherInCdf: currency === "CDF" ? operation.amount : 0,
            outUsd: 0,
            outCdf: 0,
          }
        : {
            ticketInUsd: 0,
            ticketInCdf: 0,
            otherInUsd: 0,
            otherInCdf: 0,
            outUsd: currency === "USD" ? operation.amount : 0,
            outCdf: currency === "CDF" ? operation.amount : 0,
          },
    );
  }

  return map;
}

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) <= MONEY_EPS;
}

function toGrossTotals(totals: DayJournalTotals): GrossDayTotals {
  return {
    inUsd: totals.ticketInUsd + totals.otherInUsd,
    inCdf: totals.ticketInCdf + totals.otherInCdf,
    outUsd: totals.outUsd,
    outCdf: totals.outCdf,
  };
}

/** Compare entrées/sorties globales (billets + autres), comme deux journaux du même mois. */
function totalsAligned(excel: DayJournalTotals, system: DayJournalTotals) {
  const e = toGrossTotals(excel);
  const s = toGrossTotals(system);
  return (
    nearlyEqual(e.inUsd, s.inUsd)
    && nearlyEqual(e.inCdf, s.inCdf)
    && nearlyEqual(e.outUsd, s.outUsd)
    && nearlyEqual(e.outCdf, s.outCdf)
  );
}

function subtractGross(a: GrossDayTotals, b: GrossDayTotals): GrossDayTotals {
  return {
    inUsd: a.inUsd - b.inUsd,
    inCdf: a.inCdf - b.inCdf,
    outUsd: a.outUsd - b.outUsd,
    outCdf: a.outCdf - b.outCdf,
  };
}

function sumMonthTotals(map: Map<string, DayJournalTotals>): DayJournalTotals {
  const total = { ...EMPTY_TOTALS };
  for (const day of map.values()) {
    total.lineCount += day.lineCount;
    total.ticketInUsd += day.ticketInUsd;
    total.ticketInCdf += day.ticketInCdf;
    total.otherInUsd += day.otherInUsd;
    total.otherInCdf += day.otherInCdf;
    total.outUsd += day.outUsd;
    total.outCdf += day.outCdf;
  }
  return total;
}

function subtractTotals(a: DayJournalTotals, b: DayJournalTotals): DayJournalTotals {
  return {
    lineCount: a.lineCount - b.lineCount,
    ticketInUsd: a.ticketInUsd - b.ticketInUsd,
    ticketInCdf: a.ticketInCdf - b.ticketInCdf,
    otherInUsd: a.otherInUsd - b.otherInUsd,
    otherInCdf: a.otherInCdf - b.otherInCdf,
    outUsd: a.outUsd - b.outUsd,
    outCdf: a.outCdf - b.outCdf,
  };
}

export function buildMonthlyConstat(options: {
  reportMonth: string;
  excelLines: ParsedJournalLine[];
  systemByDay: Map<string, DayJournalTotals>;
}): MonthlyConstat {
  const closedMonth = isReportMonthClosed(options.reportMonth);
  const monthPrefix = `${options.reportMonth}-`;

  const excelLinesInMonth = options.excelLines.filter(
    (line) => line.businessDate.startsWith(monthPrefix) && line.lineCategory !== "SKIP",
  );
  const excelLinesOutsideMonth = options.excelLines.filter(
    (line) => !line.businessDate.startsWith(monthPrefix) && line.lineCategory !== "SKIP",
  );

  const excelByDay = aggregateJournalDayTotals(excelLinesInMonth);

  const excelDayKeys = [...excelByDay.keys()].sort();
  const excelJournalMeta = {
    linesInMonth: excelLinesInMonth.length,
    linesOutsideMonth: excelLinesOutsideMonth.length,
    daysInMonth: excelByDay.size,
    dateFrom: excelDayKeys[0] ?? null,
    dateTo: excelDayKeys[excelDayKeys.length - 1] ?? null,
  };

  const allDates = [...new Set([...excelByDay.keys(), ...options.systemByDay.keys()])].sort();

  let alignedDays = 0;
  let missingInSystemDays = 0;
  let missingInFileDays = 0;
  let mismatchDays = 0;
  const days: MonthDayConstat[] = [];
  const datesToSync: string[] = [];

  for (const date of allDates) {
    const excel = excelByDay.get(date) ?? { ...EMPTY_TOTALS };
    const system = options.systemByDay.get(date) ?? { ...EMPTY_TOTALS };

    let status: MonthDayStatus;
    if (excel.lineCount === 0 && system.lineCount > 0) {
      status = "MISSING_IN_FILE";
      missingInFileDays += 1;
    } else if (excel.lineCount > 0 && system.lineCount === 0) {
      status = "MISSING_IN_SYSTEM";
      missingInSystemDays += 1;
      datesToSync.push(date);
    } else if (excel.lineCount > 0 && !totalsAligned(excel, system)) {
      status = "MISMATCH";
      mismatchDays += 1;
      datesToSync.push(date);
    } else if (excel.lineCount > 0) {
      status = "ALIGNED";
      alignedDays += 1;
    } else {
      continue;
    }

    days.push({ date, status, excel, system });
  }

  const monthTotalsExcel = sumMonthTotals(excelByDay);
  const monthTotalsSystem = sumMonthTotals(options.systemByDay);
  const monthDelta = subtractTotals(monthTotalsExcel, monthTotalsSystem);
  const monthGrossExcel = toGrossTotals(monthTotalsExcel);
  const monthGrossSystem = toGrossTotals(monthTotalsSystem);
  const monthGrossDelta = subtractGross(monthGrossExcel, monthGrossSystem);
  const monthGrossAligned =
    nearlyEqual(monthGrossExcel.inUsd, monthGrossSystem.inUsd)
    && nearlyEqual(monthGrossExcel.inCdf, monthGrossSystem.inCdf)
    && nearlyEqual(monthGrossExcel.outUsd, monthGrossSystem.outUsd)
    && nearlyEqual(monthGrossExcel.outCdf, monthGrossSystem.outCdf);

  const aligned = datesToSync.length === 0 && missingInFileDays === 0;

  let verdict: string;
  if (!closedMonth) {
    verdict = "Mois en cours : constat partiel (jours du fichier vs système).";
  } else if (aligned) {
    verdict = "Constat : le mois complet est aligné entre le rapport Excel caissière et le journal application (PDF).";
  } else if (monthGrossAligned && (mismatchDays > 0 || missingInSystemDays > 0)) {
    verdict =
      "Totaux mensuels globaux (entrées/sorties) concordent, mais certains jours ou libellés diffèrent — vérifiez le détail.";
  } else if (missingInSystemDays > 0 && mismatchDays === 0) {
    verdict = `Constat : ${missingInSystemDays} jour(s) du fichier absent(s) du système — import recommandé.`;
  } else if (mismatchDays > 0) {
    verdict = `Constat : ${mismatchDays} jour(s) en écart de totaux — réimport des jours concernés recommandé.`;
  } else if (missingInFileDays > 0) {
    verdict = `Constat : ${missingInFileDays} jour(s) en système sans équivalent dans le fichier (à vérifier).`;
  } else {
    verdict = "Constat : écarts détectés entre le fichier et le système.";
  }

  return {
    reportMonth: options.reportMonth,
    closedMonth,
    excelSideLabel: "Rapport Excel caissière (feuille journal de caisse)",
    systemSourceLabel: "Journal application = opérations caisse THE BEST (saisie + Excel), hors paiements billets",
    excelJournalMeta,
    verdict,
    aligned,
    summary: {
      excelDays: excelByDay.size,
      systemDays: options.systemByDay.size,
      alignedDays,
      missingInSystemDays,
      missingInFileDays,
      mismatchDays,
    },
    monthTotals: {
      excel: monthTotalsExcel,
      system: monthTotalsSystem,
      delta: monthDelta,
    },
    monthGross: {
      excel: monthGrossExcel,
      system: monthGrossSystem,
      delta: monthGrossDelta,
    },
    days,
    datesToSync: [...new Set(datesToSync)].sort(),
  };
}
