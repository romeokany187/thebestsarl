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

function drawTextRow(page: PDFPage, font: PDFFont, text: string, y: number, size = 9) {
  page.drawText(text, {
    x: 28,
    y,
    size,
    font,
    color: rgb(0.08, 0.08, 0.08),
  });
}

function formatMoney(value: number) {
  return `${value.toFixed(2)} USD`;
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
    let y = 560;

    drawTextRow(page, fontBold, "Rapport vente billets - Journalier", y, 14);
    y -= 18;
    drawTextRow(page, fontRegular, `${range.label} • Période ${range.start.toISOString().slice(0, 10)}`, y, 10);
    y -= 20;

    const headerX = [20, 70, 145, 205, 270, 380, 445, 505, 570, 635, 700];
    headers.forEach((header, index) => {
      page.drawText(header, { x: headerX[index], y, size: 8, font: fontBold });
    });
    y -= 12;

    const ensureSpace = () => {
      if (y < 40) {
        page = pdf.addPage([842, 595]);
        y = 560;
      }
    };

    tickets.forEach((ticket) => {
      ensureSpace();
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
          size: 7,
          font: fontRegular,
        });
      });
      y -= 10;
    });

    y -= 12;
    const totalSales = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
    const totalCommissions = tickets.reduce(
      (sum, ticket) => sum + (ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100)),
      0,
    );

    drawTextRow(page, fontBold, `Total billets: ${tickets.length}`, y, 10);
    y -= 14;
    drawTextRow(page, fontBold, `Total ventes: ${formatMoney(totalSales)} • Total commissions: ${formatMoney(totalCommissions)}`, y, 10);
  } else {
    let page = pdf.addPage([842, 595]);
    let y = 560;

    drawTextRow(page, fontBold, "Rapport vente billets - Synthèse par jour et compagnie", y, 14);
    y -= 18;
    drawTextRow(page, fontRegular, `${range.label} • du ${range.start.toISOString().slice(0, 10)} au ${new Date(range.end.getTime() - 1).toISOString().slice(0, 10)}`, y, 10);
    y -= 20;

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

    const headerX = [30, 150, 300, 390, 510];
    ["Jour", "Compagnie", "Billets", "Ventes", "Commissions"].forEach((header, index) => {
      page.drawText(header, { x: headerX[index], y, size: 9, font: fontBold });
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
      if (y < 40) {
        page = pdf.addPage([842, 595]);
        y = 560;
      }
    };

    let currentDay = "";
    grouped.forEach((item) => {
      if (currentDay && currentDay !== item.day) {
        const total = dailyTotals.get(currentDay)!;
        ensureSpace();
        page.drawText(`Sous-total ${currentDay}`, { x: 30, y, size: 8, font: fontBold });
        page.drawText(String(total.tickets), { x: 300, y, size: 8, font: fontBold });
        page.drawText(formatMoney(total.sales), { x: 390, y, size: 8, font: fontBold });
        page.drawText(formatMoney(total.commissions), { x: 510, y, size: 8, font: fontBold });
        y -= 12;
      }

      currentDay = item.day;
      ensureSpace();
      page.drawText(item.day, { x: 30, y, size: 8, font: fontRegular });
      page.drawText(item.airline, { x: 150, y, size: 8, font: fontRegular });
      page.drawText(String(item.tickets), { x: 300, y, size: 8, font: fontRegular });
      page.drawText(formatMoney(item.sales), { x: 390, y, size: 8, font: fontRegular });
      page.drawText(formatMoney(item.commissions), { x: 510, y, size: 8, font: fontRegular });
      y -= 10;
    });

    if (currentDay) {
      const total = dailyTotals.get(currentDay)!;
      ensureSpace();
      page.drawText(`Sous-total ${currentDay}`, { x: 30, y, size: 8, font: fontBold });
      page.drawText(String(total.tickets), { x: 300, y, size: 8, font: fontBold });
      page.drawText(formatMoney(total.sales), { x: 390, y, size: 8, font: fontBold });
      page.drawText(formatMoney(total.commissions), { x: 510, y, size: 8, font: fontBold });
      y -= 14;
    }

    const grandTickets = grouped.reduce((sum, item) => sum + item.tickets, 0);
    const grandSales = grouped.reduce((sum, item) => sum + item.sales, 0);
    const grandCommissions = grouped.reduce((sum, item) => sum + item.commissions, 0);

    ensureSpace();
    page.drawText("TOTAL GÉNÉRAL", { x: 30, y, size: 10, font: fontBold });
    page.drawText(String(grandTickets), { x: 300, y, size: 10, font: fontBold });
    page.drawText(formatMoney(grandSales), { x: 390, y, size: 10, font: fontBold });
    page.drawText(formatMoney(grandCommissions), { x: 510, y, size: 10, font: fontBold });
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
