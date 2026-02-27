import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

type ReportMode = "date" | "month" | "year" | "semester";

function parseYear(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return null;
  return parsed;
}

function dateRangeFromParams(params: URLSearchParams) {
  const now = new Date();
  const mode = (["date", "month", "year", "semester"].includes(params.get("mode") ?? "")
    ? params.get("mode")
    : "month") as ReportMode;

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

function drawPageFrame(page: PDFPage) {
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: 18,
    y: 18,
    width: width - 36,
    height: height - 36,
    borderColor: rgb(0.12, 0.12, 0.12),
    borderWidth: 1,
  });
}

function drawHeader(page: PDFPage, fontBold: PDFFont, fontRegular: PDFFont, title: string, subtitle: string) {
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: 18,
    y: height - 92,
    width: width - 36,
    height: 74,
    color: rgb(0.96, 0.96, 0.96),
    borderColor: rgb(0.15, 0.15, 0.15),
    borderWidth: 1,
  });

  page.drawText("THE BEST SARL", {
    x: 30,
    y: height - 44,
    size: 16,
    font: fontBold,
    color: rgb(0.07, 0.07, 0.07),
  });

  page.drawText("Agence de voyage & ventes billets", {
    x: 30,
    y: height - 60,
    size: 9,
    font: fontRegular,
    color: rgb(0.22, 0.22, 0.22),
  });

  page.drawText(title, {
    x: width - 330,
    y: height - 44,
    size: 12,
    font: fontBold,
    color: rgb(0.08, 0.08, 0.08),
  });

  page.drawText(subtitle, {
    x: width - 330,
    y: height - 60,
    size: 9,
    font: fontRegular,
    color: rgb(0.28, 0.28, 0.28),
  });
}

function drawFooter(page: PDFPage, fontRegular: PDFFont, generatedBy: string) {
  const { width } = page.getSize();
  const generatedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

  page.drawText(`Généré le ${generatedAt} UTC`, {
    x: 30,
    y: 26,
    size: 8,
    font: fontRegular,
    color: rgb(0.35, 0.35, 0.35),
  });

  page.drawText(`Utilisateur: ${generatedBy}`, {
    x: width - 210,
    y: 26,
    size: 8,
    font: fontRegular,
    color: rgb(0.35, 0.35, 0.35),
  });
}

function drawSummaryBox(page: PDFPage, fontBold: PDFFont, fontRegular: PDFFont, lines: string[]) {
  const { width, height } = page.getSize();
  const boxY = height - 142;
  page.drawRectangle({
    x: 18,
    y: boxY,
    width: width - 36,
    height: 42,
    color: rgb(0.985, 0.985, 0.985),
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 1,
  });

  page.drawText("Récapitulatif", {
    x: 30,
    y: boxY + 27,
    size: 9,
    font: fontBold,
    color: rgb(0.12, 0.12, 0.12),
  });

  lines.forEach((line, index) => {
    page.drawText(line, {
      x: 30,
      y: boxY + 14 - index * 10,
      size: 8,
      font: fontRegular,
      color: rgb(0.2, 0.2, 0.2),
    });
  });
}

export async function GET(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
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

  const pdf = await PDFDocument.create();
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const headers = [
    "Date",
    "Émetteur",
    "Compagnie",
    "PNR",
    "Itinéraire",
    "Prix",
    "BaseFare",
    "Commission",
    "Nature",
    "Statut",
    "Payant",
  ];

  if (range.mode === "date") {
    let page = pdf.addPage([842, 595]);
    drawPageFrame(page);
    drawHeader(page, fontBold, fontRegular, "Rapport Journalier", `${range.label}`);

    const totalSales = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
    const totalCommissions = tickets.reduce(
      (sum, ticket) => sum + (ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100)),
      0,
    );

    drawSummaryBox(page, fontBold, fontRegular, [
      `Billets: ${tickets.length}`,
      `Ventes: ${formatMoney(totalSales)} • Commissions: ${formatMoney(totalCommissions)}`,
    ]);

    let y = 424;
    const headerX = [24, 80, 153, 210, 272, 385, 450, 510, 570, 632, 700];

    page.drawRectangle({
      x: 20,
      y: y - 4,
      width: 804,
      height: 16,
      color: rgb(0.92, 0.92, 0.92),
      borderColor: rgb(0.7, 0.7, 0.7),
      borderWidth: 0.7,
    });

    headers.forEach((header, index) => {
      page.drawText(header, { x: headerX[index], y, size: 7.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    });
    y -= 14;

    const ensureSpace = () => {
      if (y < 48) {
        page = pdf.addPage([842, 595]);
        drawPageFrame(page);
        drawHeader(page, fontBold, fontRegular, "Rapport Journalier", `${range.label} (suite)`);
        drawFooter(page, fontRegular, access.session.user.name ?? access.session.user.email ?? "Utilisateur");
        y = 424;
        page.drawRectangle({
          x: 20,
          y: y - 4,
          width: 804,
          height: 16,
          color: rgb(0.92, 0.92, 0.92),
          borderColor: rgb(0.7, 0.7, 0.7),
          borderWidth: 0.7,
        });
        headers.forEach((header, index) => {
          page.drawText(header, { x: headerX[index], y, size: 7.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
        });
        y -= 14;
      }
    };

    tickets.forEach((ticket, rowIndex) => {
      ensureSpace();

      page.drawRectangle({
        x: 20,
        y: y - 2,
        width: 804,
        height: 11,
        color: rowIndex % 2 === 0 ? rgb(0.985, 0.985, 0.985) : rgb(1, 1, 1),
      });

      const commission = ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
      const row = [
        new Date(ticket.soldAt).toISOString().slice(0, 10),
        ticket.seller.name?.slice(0, 12) ?? "-",
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
          size: 6.8,
          font: fontRegular,
          color: rgb(0.13, 0.13, 0.13),
        });
      });
      y -= 10;
    });

    if (y > 62) {
      page.drawRectangle({
        x: 20,
        y: y - 8,
        width: 804,
        height: 20,
        color: rgb(0.94, 0.94, 0.94),
        borderColor: rgb(0.75, 0.75, 0.75),
        borderWidth: 0.8,
      });
      page.drawText(`TOTAL JOURNALIER • Billets: ${tickets.length} • Ventes: ${formatMoney(totalSales)} • Commissions: ${formatMoney(totalCommissions)}`, {
        x: 28,
        y,
        size: 9,
        font: fontBold,
        color: rgb(0.08, 0.08, 0.08),
      });
    }

    drawFooter(page, fontRegular, access.session.user.name ?? access.session.user.email ?? "Utilisateur");
  } else {
    let page = pdf.addPage([842, 595]);
    drawPageFrame(page);
    drawHeader(
      page,
      fontBold,
      fontRegular,
      "Rapport Synthèse",
      `${range.label} • ${range.start.toISOString().slice(0, 10)} → ${new Date(range.end.getTime() - 1).toISOString().slice(0, 10)}`,
    );

    const grouped = Array.from(
      tickets.reduce((map, ticket) => {
        const day = new Date(ticket.soldAt).toISOString().slice(0, 10);
        const key = `${day}-${ticket.airline.code}`;
        const commission = ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
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
    ).map((item) => item[1]).sort((a, b) => a.day.localeCompare(b.day) || a.airline.localeCompare(b.airline));

    const grandTickets = grouped.reduce((sum, item) => sum + item.tickets, 0);
    const grandSales = grouped.reduce((sum, item) => sum + item.sales, 0);
    const grandCommissions = grouped.reduce((sum, item) => sum + item.commissions, 0);

    drawSummaryBox(page, fontBold, fontRegular, [
      `Lignes agrégées: ${grouped.length} • Billets: ${grandTickets}`,
      `Ventes: ${formatMoney(grandSales)} • Commissions: ${formatMoney(grandCommissions)}`,
    ]);

    let y = 424;
    const headerX = [30, 160, 320, 410, 540];
    page.drawRectangle({
      x: 20,
      y: y - 4,
      width: 804,
      height: 16,
      color: rgb(0.92, 0.92, 0.92),
      borderColor: rgb(0.7, 0.7, 0.7),
      borderWidth: 0.7,
    });
    ["Jour", "Compagnie", "Billets", "Ventes", "Commissions"].forEach((header, index) => {
      page.drawText(header, { x: headerX[index], y, size: 8, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    });
    y -= 14;

    const dailyTotals = new Map<string, { tickets: number; sales: number; commissions: number }>();
    grouped.forEach((item) => {
      const current = dailyTotals.get(item.day) ?? { tickets: 0, sales: 0, commissions: 0 };
      current.tickets += item.tickets;
      current.sales += item.sales;
      current.commissions += item.commissions;
      dailyTotals.set(item.day, current);
    });

    const ensureSpace = () => {
      if (y < 48) {
        page = pdf.addPage([842, 595]);
        drawPageFrame(page);
        drawHeader(page, fontBold, fontRegular, "Rapport Synthèse", `${range.label} (suite)`);
        drawFooter(page, fontRegular, access.session.user.name ?? access.session.user.email ?? "Utilisateur");
        y = 424;
        page.drawRectangle({
          x: 20,
          y: y - 4,
          width: 804,
          height: 16,
          color: rgb(0.92, 0.92, 0.92),
          borderColor: rgb(0.7, 0.7, 0.7),
          borderWidth: 0.7,
        });
        ["Jour", "Compagnie", "Billets", "Ventes", "Commissions"].forEach((header, index) => {
          page.drawText(header, { x: headerX[index], y, size: 8, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
        });
        y -= 14;
      }
    };

    let currentDay = "";
    grouped.forEach((item, rowIndex) => {
      if (currentDay && currentDay !== item.day) {
        const total = dailyTotals.get(currentDay)!;
        ensureSpace();
        page.drawRectangle({
          x: 20,
          y: y - 2,
          width: 804,
          height: 11,
          color: rgb(0.94, 0.94, 0.94),
        });
        page.drawText(`Sous-total ${currentDay}`, { x: 30, y, size: 7.5, font: fontBold });
        page.drawText(String(total.tickets), { x: 320, y, size: 7.5, font: fontBold });
        page.drawText(formatMoney(total.sales), { x: 410, y, size: 7.5, font: fontBold });
        page.drawText(formatMoney(total.commissions), { x: 540, y, size: 7.5, font: fontBold });
        y -= 12;
      }

      currentDay = item.day;
      ensureSpace();
      page.drawRectangle({
        x: 20,
        y: y - 2,
        width: 804,
        height: 11,
        color: rowIndex % 2 === 0 ? rgb(0.985, 0.985, 0.985) : rgb(1, 1, 1),
      });
      page.drawText(item.day, { x: 30, y, size: 7.5, font: fontRegular });
      page.drawText(item.airline, { x: 160, y, size: 7.5, font: fontRegular });
      page.drawText(String(item.tickets), { x: 320, y, size: 7.5, font: fontRegular });
      page.drawText(formatMoney(item.sales), { x: 410, y, size: 7.5, font: fontRegular });
      page.drawText(formatMoney(item.commissions), { x: 540, y, size: 7.5, font: fontRegular });
      y -= 10;
    });

    if (currentDay) {
      const total = dailyTotals.get(currentDay)!;
      ensureSpace();
      page.drawRectangle({
        x: 20,
        y: y - 2,
        width: 804,
        height: 11,
        color: rgb(0.94, 0.94, 0.94),
      });
      page.drawText(`Sous-total ${currentDay}`, { x: 30, y, size: 7.5, font: fontBold });
      page.drawText(String(total.tickets), { x: 320, y, size: 7.5, font: fontBold });
      page.drawText(formatMoney(total.sales), { x: 410, y, size: 7.5, font: fontBold });
      page.drawText(formatMoney(total.commissions), { x: 540, y, size: 7.5, font: fontBold });
      y -= 14;
    }

    ensureSpace();
    page.drawRectangle({
      x: 20,
      y: y - 6,
      width: 804,
      height: 18,
      color: rgb(0.9, 0.9, 0.9),
      borderColor: rgb(0.65, 0.65, 0.65),
      borderWidth: 0.8,
    });
    page.drawText("TOTAL GÉNÉRAL", { x: 30, y, size: 9.5, font: fontBold });
    page.drawText(String(grandTickets), { x: 320, y, size: 9.5, font: fontBold });
    page.drawText(formatMoney(grandSales), { x: 410, y, size: 9.5, font: fontBold });
    page.drawText(formatMoney(grandCommissions), { x: 540, y, size: 9.5, font: fontBold });

    drawFooter(page, fontRegular, access.session.user.name ?? access.session.user.email ?? "Utilisateur");
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
