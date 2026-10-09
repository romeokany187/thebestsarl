import type { ParsedJournalLine } from "@/lib/cash-report-excel-parse";
import { kinshasaDateKey } from "@/lib/kinshasa-time";
import { prisma } from "@/lib/prisma";

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

export type MonthlyConstat = {
  reportMonth: string;
  closedMonth: boolean;
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

function aggregateDbRow(row: {
  lineCategory: string;
  usdIn: number;
  usdOut: number;
  cdfIn: number;
  cdfOut: number;
}): Omit<DayJournalTotals, "lineCount"> {
  const delta = { ...EMPTY_TOTALS };
  if (row.lineCategory === "TICKET_INFLOW") {
    delta.ticketInUsd = row.usdIn;
    delta.ticketInCdf = row.cdfIn;
  } else if (row.lineCategory === "OTHER_INFLOW") {
    delta.otherInUsd = row.usdIn;
    delta.otherInCdf = row.cdfIn;
  } else if (row.lineCategory === "OUTFLOW") {
    delta.outUsd = row.usdOut;
    delta.outCdf = row.cdfOut;
  }
  return delta;
}

export async function loadSystemJournalByDay(reportMonth: string): Promise<Map<string, DayJournalTotals>> {
  const rows = await prisma.cashReportJournalLine.findMany({
    where: { reportMonth },
    select: {
      businessDate: true,
      lineCategory: true,
      usdIn: true,
      usdOut: true,
      cdfIn: true,
      cdfOut: true,
    },
  });

  const map = new Map<string, DayJournalTotals>();
  for (const row of rows) {
    if (row.lineCategory === "OPENING" || row.lineCategory === "SKIP") continue;

    const bucket = map.get(row.businessDate) ?? { ...EMPTY_TOTALS };
    bucket.lineCount += 1;
    const part = aggregateDbRow(row);
    bucket.ticketInUsd += part.ticketInUsd;
    bucket.ticketInCdf += part.ticketInCdf;
    bucket.otherInUsd += part.otherInUsd;
    bucket.otherInCdf += part.otherInCdf;
    bucket.outUsd += part.outUsd;
    bucket.outCdf += part.outCdf;
    map.set(row.businessDate, bucket);
  }

  return map;
}

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) <= MONEY_EPS;
}

function totalsAligned(excel: DayJournalTotals, system: DayJournalTotals) {
  if (excel.lineCount !== system.lineCount) return false;
  return (
    nearlyEqual(excel.ticketInUsd, system.ticketInUsd)
    && nearlyEqual(excel.ticketInCdf, system.ticketInCdf)
    && nearlyEqual(excel.otherInUsd, system.otherInUsd)
    && nearlyEqual(excel.otherInCdf, system.otherInCdf)
    && nearlyEqual(excel.outUsd, system.outUsd)
    && nearlyEqual(excel.outCdf, system.outCdf)
  );
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

  const excelByDay = aggregateJournalDayTotals(
    options.excelLines.filter((line) => line.businessDate.startsWith(monthPrefix)),
  );

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

  const aligned = datesToSync.length === 0 && missingInFileDays === 0;

  let verdict: string;
  if (!closedMonth) {
    verdict = "Mois en cours : constat partiel (jours du fichier vs système).";
  } else if (aligned) {
    verdict = "Constat : le mois complet est aligné entre le fichier Excel et le système.";
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
    days,
    datesToSync: [...new Set(datesToSync)].sort(),
  };
}
