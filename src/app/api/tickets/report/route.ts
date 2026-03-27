import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { computeCaaCommissionMap } from "@/lib/caa-commission";

type ReportMode = "date" | "month" | "year" | "semester";

function parseYear(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return null;
  return parsed;
}

function dateRangeFromParams(params: URLSearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");

  if (startDate || endDate) {
    const startRaw = startDate ?? defaultDay;
    const endRaw = endDate ?? startRaw;
    const start = new Date(`${startRaw}T00:00:00.000Z`);
    const end = new Date(`${endRaw}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { mode: "date" as ReportMode, start, end, label: `Rapport du ${startRaw} au ${endRaw}` };
  }

  const mode = (["date", "month", "year", "semester"].includes(params.get("mode") ?? "")
    ? params.get("mode")
    : "date") as ReportMode;

  if (mode === "date") {
    const rawDate = params.get("date");
    const date = rawDate ? new Date(`${rawDate}T00:00:00.000Z`) : now;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    const start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0));
    return { mode, start, end, label: `Rapport du ${start.toISOString().slice(0, 10)}` };
  }

  if (mode === "year") {
    const year = parseYear(params.get("year")) ?? now.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    return { mode, start, end, label: `Rapport annuel ${year}` };
  }

  if (mode === "semester") {
    const semester = params.get("semester") === "2" ? 2 : 1;
    const year = parseYear(params.get("semesterYear")) ?? now.getUTCFullYear();
    const startMonth = semester === 1 ? 0 : 6;
    const endMonth = semester === 1 ? 6 : 12;
    const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, endMonth, 1, 0, 0, 0, 0));
    return { mode, start, end, label: `Rapport S${semester} ${year}` };
  }

  const rawMonth = params.get("month");
  const monthMatch = rawMonth?.match(/^(\d{4})-(\d{2})$/);
  const year = monthMatch ? Number.parseInt(monthMatch[1], 10) : now.getUTCFullYear();
  const month = monthMatch ? Number.parseInt(monthMatch[2], 10) - 1 : now.getUTCMonth();
  const safeMonth = Math.min(11, Math.max(0, month));
  const start = new Date(Date.UTC(year, safeMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, safeMonth + 1, 1, 0, 0, 0, 0));

  return {
    mode,
    start,
    end,
    label: `Rapport mensuel ${start.toISOString().slice(0, 7)}`,
  };
}

function formatMoney(value: number) {
  return `${value.toFixed(2)} USD`;
}

async function readFirstExistingFile(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(path.join(process.cwd(), candidate));
      return { bytes, path: candidate };
    } catch {
      continue;
    }
  }
  return null;
}

async function embedOptionalImage(pdf: PDFDocument, candidates: string[]) {
  const file = await readFirstExistingFile(candidates);
  if (!file) return null;

  const lower = file.path.toLowerCase();
  if (lower.endsWith(".png")) {
    return pdf.embedPng(file.bytes);
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return pdf.embedJpg(file.bytes);
  }

  return null;
}

function drawFooter(page: PDFPage, fontRegular: PDFFont, reportTitle: string, generatedBy: string) {
  const { width } = page.getSize();
  const textBlack = rgb(0, 0, 0);
  page.drawText(`Imprimé par: ${generatedBy}`, {
    x: 26,
    y: 24,
    size: 9,
    font: fontRegular,
    color: textBlack,
  });

  const rightTextWidth = fontRegular.widthOfTextAtSize(reportTitle, 9);
  page.drawText(reportTitle, {
    x: width - rightTextWidth - 26,
    y: 24,
    size: 9,
    font: fontRegular,
    color: textBlack,
  });
}

function drawTopInfo(
  page: PDFPage,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  subtitle: string,
  logoImage: PDFImage | null,
) {
  const textBlack = rgb(0, 0, 0);
  if (logoImage) {
    const scaled = logoImage.scale(0.14);
    page.drawImage(logoImage, {
      x: 26,
      y: 534,
      width: scaled.width,
      height: scaled.height,
    });
  }

  const titleX = logoImage ? 106 : 26;

  page.drawText("THE BEST SARL", {
    x: titleX,
    y: 560,
    size: 14,
    font: fontBold,
    color: textBlack,
  });

  page.drawText("RAPPORT DE VENTES BILLETS", {
    x: titleX,
    y: 545,
    size: 9,
    font: fontBold,
    color: textBlack,
  });

  page.drawText(subtitle, {
    x: titleX,
    y: 532,
    size: 8.5,
    font: fontRegular,
    color: textBlack,
  });

  page.drawLine({
    start: { x: 26, y: 522 },
    end: { x: 816, y: 522 },
    thickness: 0.8,
    color: rgb(0.75, 0.75, 0.75),
  });
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("tickets", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const range = dateRangeFromParams(request.nextUrl.searchParams);
  const roleFilter = access.role === "EMPLOYEE" ? { sellerId: access.session.user.id } : {};

  const tickets = await prisma.ticketSale.findMany({
    where: {
      ...roleFilter,
      soldAt: {
        gte: range.start,
        lt: range.end,
      },
    },
    include: {
      seller: { select: { name: true } },
      airline: true,
    },
    orderBy: { soldAt: "asc" },
  });

  const caaAirline = await prisma.airline.findUnique({
    where: { code: "CAA" },
    select: {
      id: true,
      commissionRules: {
        where: { isActive: true },
        orderBy: { startsAt: "desc" },
        select: {
          commissionMode: true,
          depositStockTargetAmount: true,
          batchCommissionAmount: true,
        },
      },
    },
  });

  const caaRule = caaAirline?.commissionRules.find((rule) => rule.commissionMode === "AFTER_DEPOSIT");
  const caaCommissionMap = caaAirline && caaRule
    ? computeCaaCommissionMap({
      periodTicketIds: tickets
        .filter((ticket) => ticket.airline.code === "CAA")
        .map((ticket) => ticket.id),
      orderedCaaTicketsUntilPeriodEnd: await prisma.ticketSale.findMany({
        where: {
          ...roleFilter,
          airlineId: caaAirline.id,
          soldAt: { lt: range.end },
        },
        select: { id: true, soldAt: true, amount: true },
        orderBy: [{ soldAt: "asc" }, { id: "asc" }],
      }),
      targetAmount: caaRule.depositStockTargetAmount ?? 0,
      batchCommissionAmount: caaRule.batchCommissionAmount ?? 0,
    })
    : new Map<string, number>();

  const ticketCommission = (ticket: { id: string; airline: { code: string }; amount: number; commissionAmount: number | null; commissionRateUsed: number }) => {
    if (ticket.airline.code === "CAA" && caaCommissionMap.has(ticket.id)) {
      return caaCommissionMap.get(ticket.id) ?? 0;
    }
    return ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
  };

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  let fontRegular: PDFFont;
  let fontBold: PDFFont;
  const textBlack = rgb(0, 0, 0);

  try {
    const regularBytes = await readFile(path.join(process.cwd(), "public/fonts/Montserrat-Regular.ttf"));
    fontRegular = await pdf.embedFont(regularBytes);
    fontBold = fontRegular;
  } catch {
    return NextResponse.json(
      { error: "Police Montserrat Regular introuvable. Vérifiez public/fonts/Montserrat-Regular.ttf." },
      { status: 500 },
    );
  }

  const periodLabel = `${range.label} • ${range.start.toISOString().slice(0, 10)} au ${new Date(range.end.getTime() - 1).toISOString().slice(0, 10)}`;
  const logoImage = await embedOptionalImage(pdf, [
    "public/branding/logo.png",
    "public/branding/logo.jpg",
    "public/branding/logo.jpeg",
    "public/logo.png",
    "public/logo.jpg",
    "public/logo.jpeg",
  ]);
  const generatedBy = access.session.user.name ?? access.session.user.email ?? "Compte inconnu";
  const generatedByWithRole = `${generatedBy} (${access.role})`;

  if (range.mode === "date") {
    const reportTitle = "Rapport Journalier";
    let page = pdf.addPage([842, 595]);
    drawTopInfo(page, fontBold, fontRegular, periodLabel, logoImage);
    drawFooter(page, fontRegular, reportTitle, generatedByWithRole);

    const headers = ["Date", "Émetteur", "Compagnie", "PNR", "Itinéraire", "Prix", "BaseFare", "Commission", "Nature", "Statut", "Payant"];
    const headerX = [26, 84, 160, 218, 278, 386, 454, 518, 578, 640, 708];

    let y = 504;
    headers.forEach((header, index) => {
      page.drawText(header, {
        x: headerX[index],
        y,
        size: 7.5,
        font: fontBold,
        color: textBlack,
      });
    });
    page.drawLine({
      start: { x: 26, y: y - 3 },
      end: { x: 816, y: y - 3 },
      thickness: 0.8,
      color: rgb(0.75, 0.75, 0.75),
    });
    y -= 16;

    const ensureSpace = () => {
      if (y < 70) {
        page = pdf.addPage([842, 595]);
        drawTopInfo(page, fontBold, fontRegular, `${periodLabel} (suite)`, logoImage);
        drawFooter(page, fontRegular, reportTitle, generatedByWithRole);
        y = 504;
        headers.forEach((header, index) => {
          page.drawText(header, {
            x: headerX[index],
            y,
            size: 7.5,
            font: fontBold,
            color: textBlack,
          });
        });
        page.drawLine({
          start: { x: 26, y: y - 3 },
          end: { x: 816, y: y - 3 },
          thickness: 0.8,
          color: rgb(0.75, 0.75, 0.75),
        });
        y -= 16;
      }
    };

    tickets.forEach((ticket) => {
      ensureSpace();
      const commission = ticketCommission(ticket);
      const row = [
        new Date(ticket.soldAt).toISOString().slice(0, 10),
        (ticket.sellerName ?? ticket.seller?.name ?? "-").slice(0, 12),
        ticket.airline.code,
        ticket.ticketNumber.slice(0, 10),
        ticket.route.slice(0, 16),
        ticket.amount.toFixed(0),
        (ticket.baseFareAmount ?? ticket.commissionBaseAmount).toFixed(0),
        commission.toFixed(0),
        ticket.saleNature,
        ticket.paymentStatus,
        (ticket.payerName ?? "-").slice(0, 10),
      ];

      row.forEach((value, index) => {
        page.drawText(String(value), {
          x: headerX[index],
          y,
          size: 8,
          font: fontRegular,
          color: textBlack,
        });
      });

      y -= 13;
    });

    const totalSales = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
    const totalCommissions = tickets.reduce((sum, ticket) => sum + ticketCommission(ticket), 0);

    if (y < 90) {
      page = pdf.addPage([842, 595]);
      drawTopInfo(page, fontBold, fontRegular, `${periodLabel} (totaux)`, logoImage);
      drawFooter(page, fontRegular, reportTitle, generatedByWithRole);
      y = 504;
    }

    y -= 14;
    page.drawLine({
      start: { x: 26, y: y + 10 },
      end: { x: 816, y: y + 10 },
      thickness: 1,
      color: rgb(0.55, 0.55, 0.55),
    });
    page.drawText(`TOTAL JOURNALIER  •  Billets: ${tickets.length}  •  Ventes: ${formatMoney(totalSales)}  •  Commissions: ${formatMoney(totalCommissions)}`, {
      x: 26,
      y,
      size: 10,
      font: fontBold,
      color: textBlack,
    });
  } else if (range.mode === "year") {
    const reportTitle = "Rapport Annuel";
    const page = pdf.addPage([842, 595]);
    drawTopInfo(page, fontBold, fontRegular, periodLabel, logoImage);
    drawFooter(page, fontRegular, reportTitle, generatedByWithRole);

    const monthLabels = [
      "JANVIER",
      "FÉVRIER",
      "MARS",
      "AVRIL",
      "MAI",
      "JUIN",
      "JUILLET",
      "AOÛT",
      "SEPTEMBRE",
      "OCTOBRE",
      "NOVEMBRE",
      "DÉCEMBRE",
    ];

    const preferredAirlineCodes = ["CAA", "AIRCONGO", "ET", "KENYA", "MG", "DAKOTA", "UR", "TC", "AF", "WB"];
    const presentCodes = Array.from(new Set(tickets.map((ticket) => ticket.airline.code.toUpperCase()))).sort();
    const hasOtherCodes = presentCodes.some((code) => !preferredAirlineCodes.includes(code));
    const airlineColumns = hasOtherCodes ? [...preferredAirlineCodes, "AUTRES"] : preferredAirlineCodes;

    type MonthlyRow = {
      month: string;
      tickets: number;
      amount: number;
      commission: number;
      byAirline: Map<string, number>;
    };

    const monthlyRows: MonthlyRow[] = monthLabels.map((label) => ({
      month: label,
      tickets: 0,
      amount: 0,
      commission: 0,
      byAirline: new Map<string, number>(),
    }));

    tickets.forEach((ticket) => {
      const soldAt = new Date(ticket.soldAt);
      const monthIndex = soldAt.getUTCMonth();
      if (monthIndex < 0 || monthIndex > 11) return;

      const row = monthlyRows[monthIndex];
      const code = ticket.airline.code.toUpperCase();
      const columnCode = preferredAirlineCodes.includes(code) ? code : "AUTRES";
      const commission = ticketCommission(ticket);

      row.tickets += 1;
      row.amount += ticket.amount;
      row.commission += commission;
      row.byAirline.set(columnCode, (row.byAirline.get(columnCode) ?? 0) + ticket.amount);
    });

    const grand = monthlyRows.reduce((acc, row) => {
      acc.tickets += row.tickets;
      acc.amount += row.amount;
      acc.commission += row.commission;
      airlineColumns.forEach((code) => {
        acc.byAirline.set(code, (acc.byAirline.get(code) ?? 0) + (row.byAirline.get(code) ?? 0));
      });
      return acc;
    }, {
      tickets: 0,
      amount: 0,
      commission: 0,
      byAirline: new Map<string, number>(),
    });

    const headers = ["MOIS", "BILLETS", ...airlineColumns, "TOTAUX", "COMMISSION"];
    const tableTop = 472;
    const rowHeight = 20;
    const left = 24;
    const right = 818;
    const tableWidth = right - left;

    const monthW = 92;
    const billetsW = 52;
    const totalsW = 86;
    const commissionW = 86;
    const airlineW = Math.max(38, (tableWidth - monthW - billetsW - totalsW - commissionW) / airlineColumns.length);
    const widths = [monthW, billetsW, ...airlineColumns.map(() => airlineW), totalsW, commissionW];
    const xs: number[] = [];
    let cursor = left;
    widths.forEach((width) => {
      xs.push(cursor);
      cursor += width;
    });

    const drawCell = (
      text: string,
      colIndex: number,
      y: number,
      opts?: { bold?: boolean; align?: "left" | "right"; size?: number },
    ) => {
      const bold = opts?.bold ?? false;
      const align = opts?.align ?? "left";
      const size = opts?.size ?? 7.2;
      const font = bold ? fontBold : fontRegular;
      const cellX = xs[colIndex];
      const cellWidth = widths[colIndex];
      const padding = 3;
      const available = Math.max(0, cellWidth - padding * 2);
      let safeText = text;
      while (safeText.length > 0 && font.widthOfTextAtSize(safeText, size) > available) {
        safeText = `${safeText.slice(0, -1)}`;
      }

      const textWidth = font.widthOfTextAtSize(safeText, size);
      const textX = align === "right"
        ? cellX + cellWidth - padding - textWidth
        : cellX + padding;

      page.drawText(safeText, {
        x: textX,
        y,
        size,
        font,
        color: textBlack,
      });
    };

    const formatInt = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(value));
    const formatAmountCell = (value: number) => (value > 0 ? formatInt(value) : "-");

    page.drawText(`RAPPORT ANNUEL ${range.start.getUTCFullYear()}`, {
      x: 24,
      y: 492,
      size: 10,
      font: fontBold,
      color: textBlack,
    });

    page.drawRectangle({
      x: left,
      y: tableTop,
      width: tableWidth,
      height: rowHeight,
      borderColor: rgb(0.3, 0.3, 0.3),
      borderWidth: 0.8,
      color: rgb(0.94, 0.9, 0.84),
    });

    headers.forEach((header, index) => {
      drawCell(header, index, tableTop + 6, { bold: true, size: 7.3, align: index >= 1 ? "right" : "left" });
    });

    monthlyRows.forEach((row, rowIndex) => {
      const y = tableTop - rowHeight * (rowIndex + 1);
      page.drawRectangle({
        x: left,
        y,
        width: tableWidth,
        height: rowHeight,
        borderColor: rgb(0.72, 0.72, 0.72),
        borderWidth: 0.35,
        color: rowIndex % 2 === 0 ? rgb(1, 1, 1) : rgb(0.985, 0.985, 0.985),
      });

      drawCell(row.month, 0, y + 6, { bold: true, size: 7.3, align: "left" });
      drawCell(String(row.tickets), 1, y + 6, { align: "right" });

      airlineColumns.forEach((code, idx) => {
        drawCell(formatAmountCell(row.byAirline.get(code) ?? 0), 2 + idx, y + 6, { align: "right" });
      });

      drawCell(formatInt(row.amount), 2 + airlineColumns.length, y + 6, { align: "right" });
      drawCell(formatInt(row.commission), 3 + airlineColumns.length, y + 6, { align: "right" });
    });

    const totalY = tableTop - rowHeight * 13;
    page.drawRectangle({
      x: left,
      y: totalY,
      width: tableWidth,
      height: rowHeight,
      borderColor: rgb(0.3, 0.3, 0.3),
      borderWidth: 0.8,
      color: rgb(0.94, 0.9, 0.84),
    });

    drawCell("TOTAL GÉNÉRAL", 0, totalY + 6, { bold: true, align: "left", size: 7.5 });
    drawCell(String(grand.tickets), 1, totalY + 6, { bold: true, align: "right", size: 7.5 });

    airlineColumns.forEach((code, idx) => {
      drawCell(formatAmountCell(grand.byAirline.get(code) ?? 0), 2 + idx, totalY + 6, { bold: true, align: "right", size: 7.5 });
    });

    drawCell(formatInt(grand.amount), 2 + airlineColumns.length, totalY + 6, { bold: true, align: "right", size: 7.5 });
    drawCell(formatInt(grand.commission), 3 + airlineColumns.length, totalY + 6, { bold: true, align: "right", size: 7.5 });
  } else {
    const reportTitle = "Rapport Synthèse";
    let page = pdf.addPage([842, 595]);
    drawTopInfo(page, fontBold, fontRegular, periodLabel, logoImage);
    drawFooter(page, fontRegular, reportTitle, generatedByWithRole);

    const grouped = Array.from(
      tickets.reduce((map, ticket) => {
        const day = new Date(ticket.soldAt).toISOString().slice(0, 10);
        const key = `${day}-${ticket.airline.code}`;
        const commission = ticketCommission(ticket);
        const existing = map.get(key) ?? {
          day,
          airline: ticket.airline.code,
          tickets: 0,
          sales: 0,
          commissions: 0,
        };
        existing.tickets += 1;
        existing.sales += ticket.amount;
        existing.commissions += commission;
        map.set(key, existing);
        return map;
      }, new Map<string, { day: string; airline: string; tickets: number; sales: number; commissions: number }>()),
    ).map((entry) => entry[1]).sort((a, b) => a.day.localeCompare(b.day) || a.airline.localeCompare(b.airline));

    const dailyTotals = new Map<string, { tickets: number; sales: number; commissions: number }>();
    grouped.forEach((item) => {
      const existing = dailyTotals.get(item.day) ?? { tickets: 0, sales: 0, commissions: 0 };
      existing.tickets += item.tickets;
      existing.sales += item.sales;
      existing.commissions += item.commissions;
      dailyTotals.set(item.day, existing);
    });

    const headers = ["Jour", "Compagnie", "Billets", "Ventes", "Commissions"];
    const headerX = [26, 190, 360, 455, 585];

    let y = 504;
    headers.forEach((header, index) => {
      page.drawText(header, {
        x: headerX[index],
        y,
        size: 8,
        font: fontBold,
        color: textBlack,
      });
    });
    page.drawLine({
      start: { x: 26, y: y - 3 },
      end: { x: 816, y: y - 3 },
      thickness: 0.8,
      color: rgb(0.75, 0.75, 0.75),
    });
    y -= 16;

    const ensureSpace = () => {
      if (y < 80) {
        page = pdf.addPage([842, 595]);
        drawTopInfo(page, fontBold, fontRegular, `${periodLabel} (suite)`, logoImage);
        drawFooter(page, fontRegular, reportTitle, generatedByWithRole);
        y = 504;
        headers.forEach((header, index) => {
          page.drawText(header, {
            x: headerX[index],
            y,
            size: 8,
            font: fontBold,
            color: textBlack,
          });
        });
        page.drawLine({
          start: { x: 26, y: y - 3 },
          end: { x: 816, y: y - 3 },
          thickness: 0.8,
          color: rgb(0.75, 0.75, 0.75),
        });
        y -= 16;
      }
    };

    let currentDay = "";
    grouped.forEach((item) => {
      if (currentDay && currentDay !== item.day) {
        const dayTotal = dailyTotals.get(currentDay)!;
        ensureSpace();
        page.drawText(`Sous-total ${currentDay}`, {
          x: 26,
          y,
          size: 8,
          font: fontBold,
          color: textBlack,
        });
        page.drawText(String(dayTotal.tickets), { x: 360, y, size: 8, font: fontBold, color: textBlack });
        page.drawText(formatMoney(dayTotal.sales), { x: 455, y, size: 8, font: fontBold, color: textBlack });
        page.drawText(formatMoney(dayTotal.commissions), { x: 585, y, size: 8, font: fontBold, color: textBlack });
        y -= 14;
      }

      currentDay = item.day;
      ensureSpace();
      page.drawText(item.day, { x: 26, y, size: 8.5, font: fontRegular, color: textBlack });
      page.drawText(item.airline, { x: 190, y, size: 8.5, font: fontRegular, color: textBlack });
      page.drawText(String(item.tickets), { x: 360, y, size: 8.5, font: fontRegular, color: textBlack });
      page.drawText(formatMoney(item.sales), { x: 455, y, size: 8.5, font: fontRegular, color: textBlack });
      page.drawText(formatMoney(item.commissions), { x: 585, y, size: 8.5, font: fontRegular, color: textBlack });
      y -= 13;
    });

    if (currentDay) {
      const dayTotal = dailyTotals.get(currentDay)!;
      ensureSpace();
      page.drawText(`Sous-total ${currentDay}`, {
        x: 26,
        y,
        size: 8,
        font: fontBold,
        color: textBlack,
      });
      page.drawText(String(dayTotal.tickets), { x: 360, y, size: 8, font: fontBold, color: textBlack });
      page.drawText(formatMoney(dayTotal.sales), { x: 455, y, size: 8, font: fontBold, color: textBlack });
      page.drawText(formatMoney(dayTotal.commissions), { x: 585, y, size: 8, font: fontBold, color: textBlack });
      y -= 18;
    }

    const grandTickets = grouped.reduce((sum, item) => sum + item.tickets, 0);
    const grandSales = grouped.reduce((sum, item) => sum + item.sales, 0);
    const grandCommissions = grouped.reduce((sum, item) => sum + item.commissions, 0);

    if (y < 95) {
      page = pdf.addPage([842, 595]);
      drawTopInfo(page, fontBold, fontRegular, `${periodLabel} (totaux)`, logoImage);
      drawFooter(page, fontRegular, reportTitle, generatedByWithRole);
      y = 504;
    }

    page.drawLine({
      start: { x: 26, y: y + 12 },
      end: { x: 816, y: y + 12 },
      thickness: 1,
      color: rgb(0.55, 0.55, 0.55),
    });

    page.drawText("TOTAL GÉNÉRAL", {
      x: 26,
      y,
      size: 10,
      font: fontBold,
      color: textBlack,
    });
    page.drawText(String(grandTickets), { x: 360, y, size: 10, font: fontBold, color: textBlack });
    page.drawText(formatMoney(grandSales), { x: 455, y, size: 10, font: fontBold, color: textBlack });
    page.drawText(formatMoney(grandCommissions), { x: 585, y, size: 10, font: fontBold, color: textBlack });
  }

  const bytes = await pdf.save();
  const filename = `rapport-billets-${range.mode}-${range.start.toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
