import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

type SearchParams = {
  startDate?: string;
  endDate?: string;
};

type ReportKind = "DAILY" | "WEEKLY" | "MONTHLY";

function parseSearchParams(url: URL): SearchParams {
  return {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
  };
}

function fmtNumber(value: number) {
  return value.toFixed(2);
}

function normalizeStatus(status: string) {
  if (status === "PAID") return "PAYE";
  if (status === "PARTIAL") return "PARTIEL";
  return "NON PAYE";
}

function dateRangeFromParams(params: SearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);

  const startRaw = params.startDate ?? defaultDay;
  const endRaw = params.endDate ?? startRaw;
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    start,
    end,
    startRaw,
    endRaw,
  };
}

function inferReportKind(start: Date, endExclusive: Date): ReportKind {
  const ms = endExclusive.getTime() - start.getTime();
  const days = Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
  if (days === 1) return "DAILY";
  if (days <= 7) return "WEEKLY";
  return "MONTHLY";
}

function weekLabel(start: Date, endExclusive: Date) {
  const end = new Date(endExclusive.getTime() - 1);
  return `SEMAINE DU ${start.toISOString().slice(0, 10)} AU ${end.toISOString().slice(0, 10)}`;
}

function getWeekStart(baseStart: Date, date: Date) {
  const diffMs = date.getTime() - baseStart.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  const block = Math.floor(diffDays / 7);
  const start = new Date(baseStart);
  start.setUTCDate(baseStart.getUTCDate() + block * 7);
  return start;
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("sales", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const params = parseSearchParams(request.nextUrl);
  const dateRange = dateRangeFromParams(params);
  const reportKind = inferReportKind(dateRange.start, dateRange.end);

  const tickets = await prisma.ticketSale.findMany({
    where: {
      ...(access.role === "EMPLOYEE" ? { sellerId: access.session.user.id } : {}),
      soldAt: {
        gte: dateRange.start,
        lt: dateRange.end,
      },
    },
    include: {
      airline: { select: { id: true, code: true, name: true } },
      seller: { select: { name: true, team: { select: { name: true } } } },
    },
    orderBy: [{ soldAt: "asc" }, { airline: { code: "asc" } }],
  });

  // Common aggregates
  const byAgency = new Map<string, { count: number; amount: number }>();
  const airlineTotals = new Map<string, { count: number; amount: number; commission: number }>();
  const byDateAirline = new Map<string, Map<string, { count: number; amount: number; commission: number }>>();
  const byWeekAirline = new Map<string, Map<string, { count: number; amount: number; commission: number }>>();

  for (const ticket of tickets) {
    const dateStr = new Date(ticket.soldAt).toISOString().slice(0, 10);
    const weekStart = getWeekStart(dateRange.start, new Date(ticket.soldAt));
    const weekEndExclusive = new Date(weekStart);
    weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 7);
    const weekKey = weekLabel(weekStart, weekEndExclusive);
    const airlineCode = ticket.airline.code;
    const agencyKey = ticket.seller?.team?.name ?? "Sans agence";

    // Group by date -> airline
    if (!byDateAirline.has(dateStr)) {
      byDateAirline.set(dateStr, new Map());
    }
    const dateMap = byDateAirline.get(dateStr)!;

    if (!dateMap.has(airlineCode)) {
      dateMap.set(airlineCode, { count: 0, amount: 0, commission: 0 });
    }
    const row = dateMap.get(airlineCode)!;
    row.count += 1;
    row.amount += ticket.amount;
    row.commission += ticket.commissionAmount ?? 0;

    if (!byWeekAirline.has(weekKey)) {
      byWeekAirline.set(weekKey, new Map());
    }
    const weekMap = byWeekAirline.get(weekKey)!;
    if (!weekMap.has(airlineCode)) {
      weekMap.set(airlineCode, { count: 0, amount: 0, commission: 0 });
    }
    const weekRow = weekMap.get(airlineCode)!;
    weekRow.count += 1;
    weekRow.amount += ticket.amount;
    weekRow.commission += ticket.commissionAmount ?? 0;

    // Airline totals
    if (!airlineTotals.has(airlineCode)) {
      airlineTotals.set(airlineCode, { count: 0, amount: 0, commission: 0 });
    }
    const airlineTotal = airlineTotals.get(airlineCode)!;
    airlineTotal.count += 1;
    airlineTotal.amount += ticket.amount;
    airlineTotal.commission += ticket.commissionAmount ?? 0;

    // Agency totals
    if (!byAgency.has(agencyKey)) {
      byAgency.set(agencyKey, { count: 0, amount: 0 });
    }
    const agencyData = byAgency.get(agencyKey)!;
    agencyData.count += 1;
    agencyData.amount += ticket.amount;
  }

  const totalCount = tickets.length;
  const totalAmount = tickets.reduce((sum, t) => sum + t.amount, 0);
  const totalCommission = tickets.reduce((sum, t) => sum + (t.commissionAmount ?? 0), 0);

  // Create PDF
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const fontFile = await readFile(path.join(process.cwd(), "public/fonts/Montserrat-Regular.ttf")).catch(() =>
    readFile(path.join(process.cwd(), "public/branding/fonts/Montserrat-Regular.ttf")),
  );
  const font = await pdf.embedFont(fontFile);

  let page = pdf.addPage([842, 595]);
  const width = page.getWidth();
  const height = page.getHeight();
  const margin = 20;
  let y = height - 28;
  const rowH = 15;

  const ensureSpace = (rows: number) => {
    if (y - rows * rowH < 45) {
      page = pdf.addPage([842, 595]);
      y = height - 28;
    }
  };

  const drawTextAt = (text: string, x: number, yy: number, size = 8) => {
    page.drawText(text, { x, y: yy, size, font, color: rgb(0, 0, 0) });
  };

  const drawRule = (thickness = 0.5) => {
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness,
      color: rgb(0.75, 0.75, 0.75),
    });
  };

  const title = reportKind === "DAILY"
    ? `RAPPORT VENTE BILLETS ${dateRange.startRaw}`
    : reportKind === "WEEKLY"
      ? `RAPPORT DE LA SEMAINE DU ${dateRange.startRaw} AU ${dateRange.endRaw}`
      : `RAPPORT MENSUEL DU ${dateRange.startRaw} AU ${dateRange.endRaw}`;

  drawTextAt(title, margin, y, 16);
  y -= 16;
  drawRule(1);
  y -= 14;

  const preferredAirlines = ["CAA", "AIRCONGO", "ETHIOPIAN", "MG", "KP", "KENYA", "SA", "UR"];
  const allCodes = Array.from(new Set(tickets.map((ticket) => ticket.airline.code.toUpperCase())));
  const extraCodes = allCodes.filter((code) => !preferredAirlines.includes(code)).sort();
  const airlineColumns = [...preferredAirlines.filter((code) => allCodes.includes(code)), ...extraCodes];

  if (reportKind === "DAILY") {
    const headers = ["N°", "EMETEUR", "COMPAGNIE", "BENEFICIAIRE", "PNR", "ITINERAIRE", "MONTANT", "NATURE", "PAYANT", "STATUT", "COM."];
    const widths = [24, 62, 54, 78, 48, 54, 44, 42, 52, 42, 30];
    const xs: number[] = [];
    let cursor = margin;
    widths.forEach((w) => {
      xs.push(cursor);
      cursor += w;
    });

    ensureSpace(2);
    headers.forEach((header, idx) => drawTextAt(header, xs[idx], y, 8));
    y -= rowH;
    drawRule();
    y -= 4;

    tickets.forEach((ticket, index) => {
      ensureSpace(2);
      const values = [
        String(index + 1),
        ticket.sellerName ?? ticket.seller?.name ?? "-",
        ticket.airline.code,
        ticket.customerName,
        ticket.ticketNumber,
        ticket.route,
        fmtNumber(ticket.amount),
        ticket.saleNature,
        ticket.payerName ?? "-",
        normalizeStatus(ticket.paymentStatus),
        fmtNumber(ticket.commissionAmount ?? 0),
      ];
      values.forEach((value, idx) => drawTextAt(value.slice(0, 26), xs[idx], y, 8));
      y -= rowH;
      drawRule(0.25);
      y -= 4;
    });

    ensureSpace(3);
    drawRule(1);
    y -= 10;
    drawTextAt(`Nbr billets: ${totalCount}`, margin + 260, y, 10);
    y -= rowH;
    drawTextAt(`Total Général: ${fmtNumber(totalAmount)} USD`, margin + 260, y, 10);
    y -= rowH;
    drawTextAt(`Commission: ${fmtNumber(totalCommission)} USD`, margin + 260, y, 10);
  } else {
    const headers = ["DATE/PERIODE", "BILLETS", ...airlineColumns, "MONTANTS", "COMMISSION"];
    const columns = headers.length;
    const colW = (width - 2 * margin) / columns;
    const xOf = (i: number) => margin + i * colW;

    ensureSpace(2);
    headers.forEach((header, idx) => drawTextAt(header, xOf(idx), y, 8));
    y -= rowH;
    drawRule();
    y -= 4;

    const lines = reportKind === "WEEKLY"
      ? Array.from(byDateAirline.entries()).sort(([a], [b]) => a.localeCompare(b))
      : Array.from(byWeekAirline.entries()).sort(([a], [b]) => a.localeCompare(b));

    lines.forEach(([label, airlineMap]) => {
      ensureSpace(2);
      const totalBillets = Array.from(airlineMap.values()).reduce((sum, value) => sum + value.count, 0);
      const totalLineAmount = Array.from(airlineMap.values()).reduce((sum, value) => sum + value.amount, 0);
      const totalLineCommission = Array.from(airlineMap.values()).reduce((sum, value) => sum + value.commission, 0);

      drawTextAt(label, xOf(0), y, 8);
      drawTextAt(String(totalBillets), xOf(1), y, 8);
      airlineColumns.forEach((code, codeIdx) => {
        const amount = airlineMap.get(code)?.amount ?? 0;
        drawTextAt(amount > 0 ? fmtNumber(amount) : "-", xOf(2 + codeIdx), y, 8);
      });
      drawTextAt(fmtNumber(totalLineAmount), xOf(2 + airlineColumns.length), y, 8);
      drawTextAt(fmtNumber(totalLineCommission), xOf(3 + airlineColumns.length), y, 8);

      y -= rowH;
      drawRule(0.25);
      y -= 4;
    });

    ensureSpace(4);
    drawRule(1.1);
    y -= 10;
    drawTextAt("TOTAL GENERAL", xOf(0), y, 9);
    drawTextAt(String(totalCount), xOf(1), y, 9);
    airlineColumns.forEach((code, codeIdx) => {
      const amount = airlineTotals.get(code)?.amount ?? 0;
      drawTextAt(amount > 0 ? fmtNumber(amount) : "-", xOf(2 + codeIdx), y, 9);
    });
    drawTextAt(fmtNumber(totalAmount), xOf(2 + airlineColumns.length), y, 9);
    drawTextAt(fmtNumber(totalCommission), xOf(3 + airlineColumns.length), y, 9);
  }

  const bytes = await pdf.save();
  return new NextResponse(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="rapport-vente-${dateRange.startRaw}-${dateRange.endRaw}.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
