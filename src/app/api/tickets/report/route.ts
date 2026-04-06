import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { computeCaaCommissionMap } from "@/lib/caa-commission";
import { getTicketTotalAmount } from "@/lib/ticket-pricing";

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
  const access = await requireApiModuleAccess("tickets", ["DIRECTEUR_GENERAL"]);
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
        getTicketTotalAmount(ticket, ticketCommission(ticket)).toFixed(0),
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

    const totalSales = tickets.reduce((sum, ticket) => sum + getTicketTotalAmount(ticket, ticketCommission(ticket)), 0);
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
  } else {
    const reportTitle = "Rapport Synthèse";
    let page = pdf.addPage([842, 595]);
    drawTopInfo(page, fontBold, fontRegular, periodLabel, logoImage);
    drawFooter(page, fontRegular, reportTitle, generatedByWithRole);

    if (range.mode === "year") {
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

      const aliasToKey = new Map<string, string>([
        ["ACG", "AIRCONGO"],
        ["AIRCONGO", "AIRCONGO"],
        ["ETH", "ET"],
        ["ETHIOPIAN", "ET"],
        ["KQ", "KENYA"],
        ["DK", "DAKOTA"],
        ["DKT", "DAKOTA"],
        ["FST", "AF"],
        ["AIRFAST", "AF"],
      ]);

      const normalizeAirlineCode = (airlineCodeRaw: string) => {
        const upper = airlineCodeRaw.trim().toUpperCase();
        return aliasToKey.get(upper) ?? upper;
      };

      const preferredOrder = ["CAA", "AIRCONGO", "ET", "KENYA", "MG", "DAKOTA", "UR", "TC", "AF", "WB"];
      const soldAirlineCodes = Array.from(new Set(tickets.map((ticket) => normalizeAirlineCode(ticket.airline.code))));
      const airlineColumns = [
        ...preferredOrder.filter((code) => soldAirlineCodes.includes(code)),
        ...soldAirlineCodes.filter((code) => !preferredOrder.includes(code)).sort(),
      ];

      const rows = monthLabels.map(() => ({
        tickets: 0,
        amountByAirline: Object.fromEntries(airlineColumns.map((code) => [code, 0])) as Record<string, number>,
        total: 0,
        commission: 0,
      }));

      const resolveColumnKey = (airlineCodeRaw: string) => {
        return normalizeAirlineCode(airlineCodeRaw);
      };

      tickets.forEach((ticket) => {
        const monthIndex = new Date(ticket.soldAt).getUTCMonth();
        if (monthIndex < 0 || monthIndex > 11) return;

        const commission = ticketCommission(ticket);
        const row = rows[monthIndex];
        const columnKey = resolveColumnKey(ticket.airline.code);

        row.tickets += 1;
        row.total += getTicketTotalAmount(ticket, ticketCommission(ticket));
        row.commission += commission;

        if (columnKey) {
          row.amountByAirline[columnKey] = (row.amountByAirline[columnKey] ?? 0) + getTicketTotalAmount(ticket, ticketCommission(ticket));
        }
      });

      const grandTotal = rows.reduce((acc, row) => {
        const next = { ...acc };
        next.tickets += row.tickets;
        next.total += row.total;
        next.commission += row.commission;
        airlineColumns.forEach((code) => {
          next.amountByAirline[code] = (next.amountByAirline[code] ?? 0) + (row.amountByAirline[code] ?? 0);
        });
        return next;
      }, {
        tickets: 0,
        total: 0,
        commission: 0,
        amountByAirline: Object.fromEntries(airlineColumns.map((code) => [code, 0])) as Record<string, number>,
      });

      const formatAmount = (value: number) => {
        if (value <= 0) return "-";
        return Math.round(value).toLocaleString("fr-FR");
      };

      const headers = ["N°", "MOIS", "BILLETS", ...airlineColumns, "TOTAUX", "COMMISSION"];
      const columnWidths = [24, 86, 48, ...airlineColumns.map(() => 44), 70, 70];
      const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);
      const startX = (842 - tableWidth) / 2;
      const startY = 470;
      const rowHeight = 23;

      const xPositions: number[] = [];
      let cursorX = startX;
      columnWidths.forEach((width) => {
        xPositions.push(cursorX);
        cursorX += width;
      });

      const drawCell = (
        text: string,
        rowIndex: number,
        colIndex: number,
        bold = false,
        align: "left" | "center" | "right" = "center",
      ) => {
        const x = xPositions[colIndex];
        const yTop = startY - rowIndex * rowHeight;
        const width = columnWidths[colIndex];
        const fontSize = rowIndex === 0 ? 8 : 7.5;
        const usedFont = bold ? fontBold : fontRegular;
        const textWidth = usedFont.widthOfTextAtSize(text, fontSize);
        const textY = yTop - rowHeight + 7;

        let textX = x + 3;
        if (align === "center") {
          textX = x + (width - textWidth) / 2;
        } else if (align === "right") {
          textX = x + width - textWidth - 3;
        }

        page.drawText(text, {
          x: textX,
          y: textY,
          size: fontSize,
          font: usedFont,
          color: textBlack,
        });
      };

      const tableTitle = `RAPPORT ANNUEL ${range.start.getUTCFullYear()}`;
      const titleWidth = fontBold.widthOfTextAtSize(tableTitle, 11);
      page.drawText(tableTitle, {
        x: (842 - titleWidth) / 2,
        y: 500,
        size: 11,
        font: fontBold,
        color: textBlack,
      });

      headers.forEach((header, index) => {
        drawCell(header, 0, index, true, "center");
      });

      rows.forEach((row, index) => {
        const rowIndex = index + 1;
        drawCell(String(index + 1), rowIndex, 0, false, "center");
        drawCell(monthLabels[index], rowIndex, 1, false, "left");
        drawCell(String(row.tickets), rowIndex, 2, false, "right");

        airlineColumns.forEach((code, columnIndex) => {
          drawCell(formatAmount(row.amountByAirline[code] ?? 0), rowIndex, 3 + columnIndex, false, "right");
        });

        drawCell(formatAmount(row.total), rowIndex, 3 + airlineColumns.length, false, "right");
        drawCell(formatAmount(row.commission), rowIndex, 4 + airlineColumns.length, false, "right");
      });

      const totalRowIndex = rows.length + 1;
      drawCell("", totalRowIndex, 0, true, "center");
      drawCell("TOTAL GENERAL", totalRowIndex, 1, true, "left");
      drawCell(String(grandTotal.tickets), totalRowIndex, 2, true, "right");

      airlineColumns.forEach((code, columnIndex) => {
        drawCell(formatAmount(grandTotal.amountByAirline[code] ?? 0), totalRowIndex, 3 + columnIndex, true, "right");
      });

      drawCell(formatAmount(grandTotal.total), totalRowIndex, 3 + airlineColumns.length, true, "right");
      drawCell(formatAmount(grandTotal.commission), totalRowIndex, 4 + airlineColumns.length, true, "right");

      const totalRows = rows.length + 2;
      for (let line = 0; line <= totalRows; line += 1) {
        const y = startY - line * rowHeight;
        page.drawLine({
          start: { x: startX, y },
          end: { x: startX + tableWidth, y },
          thickness: line === 0 || line === totalRows || line === totalRowIndex ? 0.9 : 0.45,
          color: rgb(0.6, 0.6, 0.6),
        });
      }

      for (let col = 0; col <= columnWidths.length; col += 1) {
        const x = col === columnWidths.length ? startX + tableWidth : xPositions[col];
        page.drawLine({
          start: { x, y: startY },
          end: { x, y: startY - totalRows * rowHeight },
          thickness: col === 0 || col === columnWidths.length ? 0.9 : 0.45,
          color: rgb(0.6, 0.6, 0.6),
        });
      }
    } else {

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
        existing.sales += getTicketTotalAmount(ticket, ticketCommission(ticket));
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
