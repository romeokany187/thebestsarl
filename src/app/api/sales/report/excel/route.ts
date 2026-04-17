import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { getTicketCommissionAmount, getTicketTotalAmount } from "@/lib/ticket-pricing";

type SearchParams = {
  startDate?: string;
  endDate?: string;
};

type DayBucket = {
  date: Date;
  key: string;
  tickets: any[];
};

type PeriodBucket = {
  start: Date;
  end: Date;
  endExclusive: Date;
  label: string;
  sheetName: string;
};

const AIRLINE_DISPLAY_ORDER = ["CAA", "AIR CONGO", "ETHIOPIAN", "MG", "KP", "KENYA", "AIR FAST", "UR"];

function parseSearchParams(url: URL): SearchParams {
  return {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
  };
}

function dateRangeFromParams(params: SearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startRaw = params.startDate ?? defaultDay;
  const endRaw = params.endDate ?? startRaw;
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end, startRaw, endRaw };
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
}

function endInclusive(value: Date) {
  return new Date(value.getTime() - 1);
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatSheetDay(value: Date) {
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}`;
}

function formatFrenchDate(value: Date) {
  return value.toLocaleDateString("fr-FR", { timeZone: "UTC" });
}

function formatFrenchMonth(value: Date) {
  return value.toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" }).toUpperCase();
}

function formatFrenchMonthYear(value: Date) {
  return value.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase();
}

function getMondayStart(value: Date) {
  const start = startOfUtcDay(value);
  const day = start.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addUtcDays(start, diff);
}

function getSundayEnd(value: Date) {
  return addUtcDays(getMondayStart(value), 6);
}

function normalizeStatus(status: string) {
  if (status === "PAID") return "PAYE";
  if (status === "PARTIAL") return "PARTIEL";
  return "NON PAYE";
}

function normalizeAirlineDisplay(codeOrName: string) {
  const normalized = (codeOrName ?? "").trim().toUpperCase();
  if (normalized === "AIRCONGO" || normalized === "ACG") return "AIR CONGO";
  if (normalized === "ETH" || normalized === "ET") return "ETHIOPIAN";
  if (normalized === "AFC" || normalized === "AIRFAST" || normalized === "FST") return "AIR FAST";
  return normalized;
}

function listDays(start: Date, endExclusive: Date) {
  const days: Date[] = [];
  let cursor = startOfUtcDay(start);
  while (cursor < endExclusive) {
    days.push(cursor);
    cursor = addUtcDays(cursor, 1);
  }
  return days;
}

function listCompleteWeeks(start: Date, endExclusive: Date) {
  const periods: PeriodBucket[] = [];
  const inclusiveEnd = endInclusive(endExclusive);
  let cursor = startOfUtcDay(start);
  if (cursor.getUTCDay() !== 1) {
    cursor = addUtcDays(cursor, cursor.getUTCDay() === 0 ? 1 : 8 - cursor.getUTCDay());
  }

  while (cursor <= inclusiveEnd) {
    const weekEnd = addUtcDays(cursor, 6);
    if (weekEnd > inclusiveEnd) break;
    periods.push({
      start: cursor,
      end: weekEnd,
      endExclusive: addUtcDays(weekEnd, 1),
      label: `RAPPORT DE LA SEMAINE DU ${String(cursor.getUTCDate()).padStart(2, "0")} AU ${String(weekEnd.getUTCDate()).padStart(2, "0")} ${formatFrenchMonth(cursor)} ${cursor.getUTCFullYear()}`,
      sheetName: `SEMAINE ${periods.length + 1} ${formatFrenchMonth(cursor)}`,
    });
    cursor = addUtcDays(cursor, 7);
  }

  return periods;
}

function listCompleteMonths(start: Date, endExclusive: Date) {
  const periods: PeriodBucket[] = [];
  const inclusiveEnd = endInclusive(endExclusive);
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 0, 0, 0, 0));
  if (start.getUTCDate() !== 1) {
    cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  }

  while (cursor <= inclusiveEnd) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0, 0, 0, 0, 0));
    if (monthEnd > inclusiveEnd) break;
    periods.push({
      start: cursor,
      end: monthEnd,
      endExclusive: addUtcDays(monthEnd, 1),
      label: `RAPPORT MENSUEL DE VENTE DES BILLETS ${formatFrenchMonthYear(cursor)}`,
      sheetName: `MOIS DE ${formatFrenchMonth(cursor)}`,
    });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  }

  return periods;
}

function buildMonthSegments(period: PeriodBucket) {
  const segments: PeriodBucket[] = [];
  let cursor = period.start;
  while (cursor <= period.end) {
    const segmentEnd = getSundayEnd(cursor) < period.end ? getSundayEnd(cursor) : period.end;
    segments.push({
      start: cursor,
      end: segmentEnd,
      endExclusive: addUtcDays(segmentEnd, 1),
      label: `SEMAINE DU ${String(cursor.getUTCDate()).padStart(2, "0")} AU ${String(segmentEnd.getUTCDate()).padStart(2, "0")} ${formatFrenchMonth(period.start)}`,
      sheetName: "",
    });
    cursor = addUtcDays(segmentEnd, 1);
  }
  return segments;
}

function aggregateByAirline(tickets: any[]) {
  const map = new Map<string, { amount: number; count: number; commission: number }>();
  for (const ticket of tickets) {
    const airline = normalizeAirlineDisplay(ticket.airline?.code ?? ticket.airline?.name ?? "AUTRE");
    const current = map.get(airline) ?? { amount: 0, count: 0, commission: 0 };
    const commission = getTicketCommissionAmount(ticket);
    current.amount += getTicketTotalAmount(ticket, commission);
    current.count += 1;
    current.commission += commission;
    map.set(airline, current);
  }
  return map;
}

function airlineColumnsFromTickets(tickets: any[]) {
  const present = new Set(tickets.map((ticket) => normalizeAirlineDisplay(ticket.airline?.code ?? ticket.airline?.name ?? "AUTRE")));
  const ordered = AIRLINE_DISPLAY_ORDER.filter((name) => present.has(name));
  const extras = Array.from(present).filter((name) => !AIRLINE_DISPLAY_ORDER.includes(name)).sort();
  return [...ordered, ...extras];
}

function setThinBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "thin", color: { argb: "FF000000" } },
  };
}

function styleCell(cell: ExcelJS.Cell, options?: { bold?: boolean; fill?: string; align?: "left" | "center" | "right"; italic?: boolean }) {
  cell.font = {
    name: "Times New Roman",
    size: 11,
    bold: options?.bold ?? false,
    italic: options?.italic ?? false,
  };
  cell.alignment = { vertical: "middle", horizontal: options?.align ?? "left" };
  if (options?.fill) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: options.fill },
    };
  }
  setThinBorder(cell);
}

async function tryAddLogo(workbook: ExcelJS.Workbook) {
  const filePath = path.join(process.cwd(), "public/logo thebest.png");
  const image = await readFile(filePath).catch(() => null);
  if (!image) return null;
  return workbook.addImage({ base64: `data:image/png;base64,${image.toString("base64")}`, extension: "png" });
}

function configureDailySheet(sheet: ExcelJS.Worksheet, title: string, logoId: number | null) {
  sheet.properties.defaultRowHeight = 22;
  sheet.columns = [
    { width: 6 },
    { width: 18 },
    { width: 16 },
    { width: 36 },
    { width: 14 },
    { width: 16 },
    { width: 12 },
    { width: 16 },
    { width: 16 },
    { width: 12 },
    { width: 14 },
  ];

  sheet.mergeCells("B1:K1");
  sheet.getCell("B1").value = title;
  styleCell(sheet.getCell("B1"), { bold: true, align: "center" });

  const headers = ["N°", "EMETEUR", "COMPAGNIE", "BENEFICIARE", "PNR", "ITINERAIRE", "MONTANT", "NATURE DE VENTE", "PAYANT", "STATUT", "Commission"];
  headers.forEach((header, index) => {
    const cell = sheet.getRow(2).getCell(index + 1);
    cell.value = header;
    styleCell(cell, { bold: true, align: "center" });
  });

  if (logoId !== null) {
    sheet.addImage(logoId, {
      tl: { col: 0.1, row: 19.3 },
      ext: { width: 78, height: 36 },
    });
  }
}

function fillDailySheet(sheet: ExcelJS.Worksheet, tickets: any[]) {
  tickets.forEach((ticket, index) => {
    const row = sheet.getRow(index + 3);
    const commission = getTicketCommissionAmount(ticket);
    row.values = [
      index + 1,
      ticket.sellerName ?? ticket.seller?.name ?? "-",
      normalizeAirlineDisplay(ticket.airline?.code ?? ticket.airline?.name ?? "-"),
      ticket.customerName ?? "-",
      ticket.ticketNumber ?? "-",
      ticket.route ?? "-",
      getTicketTotalAmount(ticket, commission),
      ticket.saleNature ?? "-",
      ticket.payerName ?? "-",
      normalizeStatus(ticket.paymentStatus ?? "UNPAID"),
      commission || "",
    ];
    for (let index = 1; index <= 11; index += 1) {
      styleCell(row.getCell(index), { align: index === 1 || index >= 7 ? "center" : "left" });
    }
    row.getCell(7).numFmt = '$ #,##0.00';
    row.getCell(11).numFmt = '$ #,##0.00';
  });

  const totalTickets = tickets.length;
  const totalAmount = tickets.reduce((sum, ticket) => sum + getTicketTotalAmount(ticket, getTicketCommissionAmount(ticket)), 0);
  const totalCommission = tickets.reduce((sum, ticket) => sum + getTicketCommissionAmount(ticket), 0);
  const totalRow = sheet.getRow(Math.max(22, tickets.length + 4));
  totalRow.getCell(10).value = totalTickets;
  totalRow.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  styleCell(totalRow.getCell(10), { bold: true, align: "center" });

  const amountRow = sheet.getRow(Math.max(23, tickets.length + 5));
  amountRow.getCell(10).value = totalAmount;
  amountRow.getCell(11).value = totalCommission || "-";
  amountRow.getCell(10).numFmt = '$ #,##0.00';
  amountRow.getCell(11).numFmt = '$ #,##0.00';
  styleCell(amountRow.getCell(10), { bold: true, align: "center", fill: "FFFFFF00" });
  styleCell(amountRow.getCell(11), { bold: true, align: "center" });
}

function configureWeeklySheet(sheet: ExcelJS.Worksheet, title: string) {
  sheet.properties.defaultRowHeight = 22;
  const startColumn = 5;
  const headers = ["DATE", "BILLETS", "CAA", "AIR CONGO", "ETHIOPIAN", "MG", "KP", "KENYA", "AIR FAST", "UR", "MONTANTS", "Commission"];
  headers.forEach((_, index) => {
    sheet.getColumn(startColumn + index).width = index === 0 ? 14 : 12;
  });
  sheet.mergeCells(5, 5, 5, 5 + headers.length - 1);
  sheet.getCell(5, 5).value = title;
  styleCell(sheet.getCell(5, 5), { bold: true, align: "center" });

  headers.forEach((header, index) => {
    const cell = sheet.getCell(6, startColumn + index);
    cell.value = header;
    styleCell(cell, { bold: true, align: index === 0 ? "left" : "center" });
  });
}

function fillWeeklySheet(sheet: ExcelJS.Worksheet, period: PeriodBucket, tickets: any[]) {
  const startColumn = 5;
  const airlineColumns = airlineColumnsFromTickets(tickets);
  const rows = listDays(period.start, period.endExclusive).map((date) => {
    const key = formatIsoDate(date);
    const dayTickets = tickets.filter((ticket) => formatIsoDate(startOfUtcDay(new Date(ticket.soldAt))) === key);
    return { date, tickets: dayTickets, airlineMap: aggregateByAirline(dayTickets) };
  });

  const headers = ["DATE", "BILLETS", ...airlineColumns, "MONTANTS", "Commission"];
  headers.forEach((header, index) => {
    const cell = sheet.getCell(6, startColumn + index);
    cell.value = header;
    styleCell(cell, { bold: true, align: index === 0 ? "left" : "center" });
    sheet.getColumn(startColumn + index).width = index === 0 ? 14 : 12;
  });

  rows.forEach((entry, rowIndex) => {
    const row = sheet.getRow(7 + rowIndex);
    const totalAmount = entry.tickets.reduce((sum, ticket) => sum + getTicketTotalAmount(ticket, getTicketCommissionAmount(ticket)), 0);
    const totalCommission = entry.tickets.reduce((sum, ticket) => sum + getTicketCommissionAmount(ticket), 0);
    row.getCell(startColumn).value = entry.date;
    row.getCell(startColumn).numFmt = 'dd/mm/yyyy';
    row.getCell(startColumn + 1).value = entry.tickets.length;
    styleCell(row.getCell(startColumn), { bold: true });
    styleCell(row.getCell(startColumn + 1), { align: "center" });
    airlineColumns.forEach((name, index) => {
      const cell = row.getCell(startColumn + 2 + index);
      cell.value = entry.airlineMap.get(name)?.amount ?? "-";
      if (typeof cell.value === "number") cell.numFmt = '$ #,##0.00';
      styleCell(cell, { align: "center" });
    });
    const totalCell = row.getCell(startColumn + 2 + airlineColumns.length);
    totalCell.value = totalAmount;
    totalCell.numFmt = '$ #,##0.00';
    styleCell(totalCell, { align: "center" });
    const commissionCell = row.getCell(startColumn + 3 + airlineColumns.length);
    commissionCell.value = totalCommission;
    commissionCell.numFmt = '$ #,##0.00';
    styleCell(commissionCell, { align: "center" });
  });

  const totalRow = sheet.getRow(7 + rows.length);
  totalRow.getCell(startColumn).value = "TOTAL GENERAL";
  totalRow.getCell(startColumn + 1).value = tickets.length;
  styleCell(totalRow.getCell(startColumn), { bold: true, fill: "FFF4C7" });
  styleCell(totalRow.getCell(startColumn + 1), { bold: true, align: "center", fill: "FFF4C7" });
  airlineColumns.forEach((name, index) => {
    const cell = totalRow.getCell(startColumn + 2 + index);
    cell.value = aggregateByAirline(tickets).get(name)?.amount ?? 0;
    cell.numFmt = '$ #,##0.00';
    styleCell(cell, { bold: true, align: "center", fill: "FFF4C7" });
  });
  const totalAmountCell = totalRow.getCell(startColumn + 2 + airlineColumns.length);
  totalAmountCell.value = tickets.reduce((sum, ticket) => sum + getTicketTotalAmount(ticket, getTicketCommissionAmount(ticket)), 0);
  totalAmountCell.numFmt = '$ #,##0.00';
  styleCell(totalAmountCell, { bold: true, align: "center", fill: "FFF4C7" });
  const totalCommissionCell = totalRow.getCell(startColumn + 3 + airlineColumns.length);
  totalCommissionCell.value = tickets.reduce((sum, ticket) => sum + getTicketCommissionAmount(ticket), 0);
  totalCommissionCell.numFmt = '$ #,##0.00';
  styleCell(totalCommissionCell, { bold: true, align: "center", fill: "FFF4C7" });
}

function configureMonthlySheet(sheet: ExcelJS.Worksheet, title: string, logoId: number | null) {
  sheet.properties.defaultRowHeight = 22;
  if (logoId !== null) {
    sheet.addImage(logoId, {
      tl: { col: 5.3, row: 0.5 },
      ext: { width: 176, height: 48 },
    });
  }
  sheet.mergeCells("D6:M6");
  sheet.getCell("D6").value = title;
  styleCell(sheet.getCell("D6"), { bold: true, align: "center", fill: "FFF3CF" });
}

function fillMonthlySheet(sheet: ExcelJS.Worksheet, period: PeriodBucket, tickets: any[]) {
  const segments = buildMonthSegments(period);
  const airlineColumns = airlineColumnsFromTickets(tickets);
  const headers = ["N°", "PERIODES", "BILLETS", ...airlineColumns, "TOTAUX", "COMMISSION"];
  const headerRow = 7;
  headers.forEach((header, index) => {
    const cell = sheet.getCell(headerRow, 3 + index);
    cell.value = header;
    styleCell(cell, { bold: true, align: index <= 1 ? "left" : "center", fill: "FFF3CF" });
    sheet.getColumn(3 + index).width = index === 1 ? 26 : 12;
  });

  segments.forEach((segment, index) => {
    const segmentTickets = tickets.filter((ticket) => {
      const soldAt = startOfUtcDay(new Date(ticket.soldAt));
      return soldAt >= segment.start && soldAt < segment.endExclusive;
    });
    const airlineMap = aggregateByAirline(segmentTickets);
    const row = sheet.getRow(headerRow + 1 + index);
    row.getCell(3).value = index + 1;
    row.getCell(4).value = segment.label;
    row.getCell(5).value = segmentTickets.length;
    styleCell(row.getCell(3), { align: "center" });
    styleCell(row.getCell(4), { bold: true });
    styleCell(row.getCell(5), { align: "center" });
    airlineColumns.forEach((name, columnIndex) => {
      const cell = row.getCell(6 + columnIndex);
      cell.value = airlineMap.get(name)?.amount ?? "";
      if (typeof cell.value === "number") cell.numFmt = '$ #,##0.00';
      styleCell(cell, { align: "center" });
    });
    const totalCell = row.getCell(6 + airlineColumns.length);
    totalCell.value = segmentTickets.reduce((sum, ticket) => sum + getTicketTotalAmount(ticket, getTicketCommissionAmount(ticket)), 0);
    totalCell.numFmt = '$ #,##0.00';
    styleCell(totalCell, { align: "center" });
    const commissionCell = row.getCell(7 + airlineColumns.length);
    commissionCell.value = segmentTickets.reduce((sum, ticket) => sum + getTicketCommissionAmount(ticket), 0);
    commissionCell.numFmt = '$ #,##0.00';
    styleCell(commissionCell, { align: "center" });
  });

  const totalRow = sheet.getRow(headerRow + 1 + segments.length);
  const totalAirlineMap = aggregateByAirline(tickets);
  totalRow.getCell(4).value = "TOTAL GENERAL";
  totalRow.getCell(5).value = tickets.length;
  styleCell(totalRow.getCell(4), { bold: true, fill: "FFF3CF" });
  styleCell(totalRow.getCell(5), { bold: true, align: "center", fill: "FFF3CF" });
  airlineColumns.forEach((name, index) => {
    const cell = totalRow.getCell(6 + index);
    cell.value = totalAirlineMap.get(name)?.amount ?? 0;
    cell.numFmt = '$ #,##0.00';
    styleCell(cell, { bold: true, align: "center", fill: "FFF3CF" });
  });
  const totalCell = totalRow.getCell(6 + airlineColumns.length);
  totalCell.value = tickets.reduce((sum, ticket) => sum + getTicketTotalAmount(ticket, getTicketCommissionAmount(ticket)), 0);
  totalCell.numFmt = '$ #,##0.00';
  styleCell(totalCell, { bold: true, align: "center", fill: "FFF3CF" });
  const commissionCell = totalRow.getCell(7 + airlineColumns.length);
  commissionCell.value = tickets.reduce((sum, ticket) => sum + getTicketCommissionAmount(ticket), 0);
  commissionCell.numFmt = '$ #,##0.00';
  styleCell(commissionCell, { bold: true, align: "center", fill: "FFF3CF" });
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("sales", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const params = parseSearchParams(request.nextUrl);
  const range = dateRangeFromParams(params);

  const tickets = await prisma.ticketSale.findMany({
    where: {
      ...(access.role === "EMPLOYEE" ? { sellerId: access.session.user.id } : {}),
      soldAt: { gte: range.start, lt: range.end },
    },
    include: {
      airline: true,
      seller: { select: { name: true, team: { select: { name: true } } } },
    },
    orderBy: [{ soldAt: "asc" }, { createdAt: "asc" }],
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "THE BEST SARL";
  workbook.created = new Date();
  workbook.modified = new Date();
  const logoId = await tryAddLogo(workbook);

  const days = listDays(range.start, range.end);
  for (const day of days) {
    const dayKey = formatIsoDate(day);
    const sheet = workbook.addWorksheet(formatSheetDay(day));
    configureDailySheet(sheet, `RAPPORT VENTE BILLETS ${String(day.getUTCDate()).padStart(2, "0")} ${formatFrenchMonth(day)} ${day.getUTCFullYear()}`, logoId);
    fillDailySheet(sheet, tickets.filter((ticket) => formatIsoDate(startOfUtcDay(new Date(ticket.soldAt))) === dayKey));
  }

  const weeks = listCompleteWeeks(range.start, range.end);
  weeks.forEach((week) => {
    const sheet = workbook.addWorksheet(week.sheetName);
    configureWeeklySheet(sheet, week.label);
    fillWeeklySheet(sheet, week, tickets.filter((ticket) => {
      const soldAt = startOfUtcDay(new Date(ticket.soldAt));
      return soldAt >= week.start && soldAt < week.endExclusive;
    }));
  });

  const months = listCompleteMonths(range.start, range.end);
  months.forEach((month) => {
    const sheet = workbook.addWorksheet(month.sheetName);
    configureMonthlySheet(sheet, month.label, logoId);
    fillMonthlySheet(sheet, month, tickets.filter((ticket) => {
      const soldAt = startOfUtcDay(new Date(ticket.soldAt));
      return soldAt >= month.start && soldAt < month.endExclusive;
    }));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rapport-vente-${range.startRaw}-${range.endRaw}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}