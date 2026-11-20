import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { PaymentStatus } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { getUserModuleAccessMap } from "@/lib/user-module-access";
import { getTicketCommissionAmount, getTicketTotalAmount } from "@/lib/ticket-pricing";
import { buildTicketReceivableBalance, type TicketSaleForBalance } from "@/lib/ticket-payment-balance";
import { paymentStatusLabel } from "@/lib/ticket-payment-status-export";

type CommissionCalc = (ticket: {
  id: string;
  airline?: { code?: string | null };
  amount: number;
  commissionAmount?: number | null;
  commissionRateUsed?: number | null;
  agencyMarkupAmount?: number | null;
  commissionModeApplied?: string | null;
  commissionCalculationStatus?: string | null;
  baseFareAmount?: number | null;
  commissionBaseAmount?: number | null;
}) => number;

type SearchParams = {
  startDate?: string;
  endDate?: string;
};

const DETAIL_HEADERS = [
  "N°",
  "DATE",
  "EMETEUR",
  "COMPAGNIE",
  "BENEFICIARE",
  "PNR",
  "ITINERAIRE",
  "MONTANT",
  "PAYANT",
  "Commission",
  "PAIEMENT",
] as const;

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

function formatFrenchDate(value: Date) {
  return value.toLocaleDateString("fr-FR", { timeZone: "UTC" });
}

function normalizeAirlineDisplay(codeOrName: string) {
  const normalized = (codeOrName ?? "").trim().toUpperCase();
  if (normalized === "AIRCONGO" || normalized === "ACG") return "AIR CONGO";
  if (normalized === "ETH" || normalized === "ET") return "ETHIOPIAN";
  if (normalized === "AFC" || normalized === "AIRFAST" || normalized === "FST") return "AIR FAST";
  return normalized;
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

/** Montant encaissé si connu (lignes caisse), sinon statut PAYÉ / PARTIEL / NON PAYÉ. */
function resolvePaymentCell(ticket: {
  paymentStatus: PaymentStatus;
  payments: TicketSaleForBalance["payments"];
} & TicketSaleForBalance): number | string {
  const balance = buildTicketReceivableBalance(ticket);
  if (ticket.payments.length > 0) {
    return Number(balance.paidAmount.toFixed(2));
  }
  return paymentStatusLabel(ticket.paymentStatus ?? balance.computedStatus);
}

function configureDetailSheet(sheet: ExcelJS.Worksheet, title: string, logoId: number | null) {
  sheet.properties.defaultRowHeight = 22;
  sheet.columns = [
    { width: 6 },
    { width: 12 },
    { width: 18 },
    { width: 14 },
    { width: 36 },
    { width: 14 },
    { width: 16 },
    { width: 12 },
    { width: 16 },
    { width: 12 },
    { width: 14 },
  ];

  sheet.mergeCells(1, 2, 1, DETAIL_HEADERS.length);
  sheet.getCell(1, 2).value = title;
  styleCell(sheet.getCell(1, 2), { bold: true, align: "center" });

  DETAIL_HEADERS.forEach((header, index) => {
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

function fillDetailSheet(sheet: ExcelJS.Worksheet, tickets: any[], commissionOf: CommissionCalc) {
  const colCount = DETAIL_HEADERS.length;

  tickets.forEach((ticket, index) => {
    const row = sheet.getRow(index + 3);
    const commission = commissionOf(ticket);
    const soldAt = ticket.soldAt instanceof Date ? ticket.soldAt : new Date(ticket.soldAt);
    const paymentValue = resolvePaymentCell(ticket);

    row.values = [
      index + 1,
      soldAt,
      ticket.sellerName ?? ticket.seller?.name ?? "-",
      normalizeAirlineDisplay(ticket.airline?.code ?? ticket.airline?.name ?? "-"),
      ticket.customerName ?? "-",
      ticket.ticketNumber ?? "-",
      ticket.route ?? "-",
      getTicketTotalAmount(ticket, commission),
      ticket.payerName ?? "-",
      commission || "",
      paymentValue,
    ];

    for (let col = 1; col <= colCount; col += 1) {
      const center = col <= 2 || col >= 8;
      styleCell(row.getCell(col), { align: center ? "center" : "left" });
    }
    row.getCell(2).numFmt = "dd/mm/yyyy";
    row.getCell(8).numFmt = "$ #,##0.00";
    row.getCell(10).numFmt = "$ #,##0.00";
    if (typeof paymentValue === "number") {
      row.getCell(11).numFmt = "$ #,##0.00";
    }
  });

  const totalTickets = tickets.length;
  const totalAmount = tickets.reduce((sum, ticket) => sum + getTicketTotalAmount(ticket, commissionOf(ticket)), 0);
  const totalCommission = tickets.reduce((sum, ticket) => sum + commissionOf(ticket), 0);
  const totalPaidKnown = tickets.reduce((sum, ticket) => {
    if (!ticket.payments?.length) return sum;
    return sum + buildTicketReceivableBalance(ticket).paidAmount;
  }, 0);

  const totalRow = sheet.getRow(tickets.length + 4);
  totalRow.getCell(9).value = totalTickets;
  styleCell(totalRow.getCell(9), { bold: true, align: "center", fill: "FFFFFF00" });

  const amountRow = sheet.getRow(tickets.length + 5);
  amountRow.getCell(9).value = totalAmount;
  amountRow.getCell(10).value = totalCommission || "-";
  amountRow.getCell(11).value = totalPaidKnown > 0 ? totalPaidKnown : "";
  amountRow.getCell(9).numFmt = "$ #,##0.00";
  amountRow.getCell(10).numFmt = "$ #,##0.00";
  if (totalPaidKnown > 0) amountRow.getCell(11).numFmt = "$ #,##0.00";
  styleCell(amountRow.getCell(9), { bold: true, align: "center", fill: "FFFFFF00" });
  styleCell(amountRow.getCell(10), { bold: true, align: "center" });
  if (totalPaidKnown > 0) styleCell(amountRow.getCell(11), { bold: true, align: "center" });
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("sales", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const moduleAccessMap = await getUserModuleAccessMap(access.session.user.id);
  const hasCustomTicketsAccess = Boolean(moduleAccessMap.tickets);

  const params = parseSearchParams(request.nextUrl);
  const range = dateRangeFromParams(params);

  const tickets = await prisma.ticketSale.findMany({
    where: {
      ...(access.role === "EMPLOYEE" && !hasCustomTicketsAccess ? { sellerId: access.session.user.id } : {}),
      soldAt: { gte: range.start, lt: range.end },
    },
    include: {
      airline: true,
      seller: { select: { name: true, team: { select: { name: true } } } },
      payments: {
        select: {
          amount: true,
          currency: true,
          amountUsd: true,
          amountCdf: true,
          fxRateUsdToCdf: true,
        },
        orderBy: { paidAt: "asc" },
      },
    },
    orderBy: [{ soldAt: "asc" }, { createdAt: "asc" }],
  });

  const commissionOf: CommissionCalc = (ticket) => getTicketCommissionAmount(ticket);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "THE BEST SARL";
  workbook.created = new Date();
  workbook.modified = new Date();
  const logoId = await tryAddLogo(workbook);

  const title =
    range.startRaw === range.endRaw
      ? `RAPPORT VENTE BILLETS ${formatFrenchDate(range.start)}`
      : `RAPPORT VENTE BILLETS DU ${formatFrenchDate(range.start)} AU ${formatFrenchDate(new Date(range.end.getTime() - 1))}`;

  const sheet = workbook.addWorksheet("Ventes");
  configureDetailSheet(sheet, title, logoId);
  fillDetailSheet(sheet, tickets, commissionOf);

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