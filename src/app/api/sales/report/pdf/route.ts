import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFPage, rgb, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

type SearchParams = {
  startDate?: string;
  endDate?: string;
  mode?: "week" | "month";
};

function parseSearchParams(url: URL): SearchParams {
  return {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    mode: (url.searchParams.get("mode") as "week" | "month") ?? "month",
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

  return {
    start,
    end,
    startRaw,
    endRaw,
    label:
      params.mode === "week"
        ? `Rapport hebdomadaire du ${startRaw} au ${endRaw}`
        : `Rapport mensuel du ${startRaw} au ${endRaw}`,
  };
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("sales", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const params = parseSearchParams(request.nextUrl);
  const dateRange = dateRangeFromParams(params);

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

  // Group by date and airline for summary rows
  const byDateAirline = new Map<string, Map<string, { count: number; amount: number; commission: number }>>();
  const byAgency = new Map<string, { count: number; amount: number }>();
  const airlineTotals = new Map<string, { count: number; amount: number; commission: number }>();

  for (const ticket of tickets) {
    const dateStr = new Date(ticket.soldAt).toISOString().slice(0, 10);
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

  let page = pdf.addPage([595, 842]);
  const width = page.getWidth();
  const margin = 15;
  let y = 800;

  const drawText = (text: string, x: number, size: number, bold = false) => {
    if (y < 40) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
    y -= size * 1.5;
  };

  const drawLine = () => {
    if (y < 40) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 8;
  };

  const drawBoldLine = () => {
    if (y < 40) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 1.2,
      color: rgb(0, 0, 0),
    });
    y -= 10;
  };

  // Title
  drawText(dateRange.label.toUpperCase(), margin, 14, true);
  y -= 5;
  drawBoldLine();

  // Get all airlines
  const allAirlines = Array.from(new Set(tickets.map((t) => t.airline.code))).sort();

  // Table: Daily summary header
  const colWidth = (width - 2 * margin) / (2 + allAirlines.length);
  const dateCol = margin;
  const billetCol = margin + colWidth;
  const airlineStartCol = margin + colWidth * 2;

  drawText("DATE", dateCol, 8, true);
  drawText("BILLETS", billetCol, 8, true);
  allAirlines.forEach((airline, i) => {
    drawText(airline, airlineStartCol + i * colWidth, 8, true);
  });

  drawLine();

  // Daily summary rows
  for (const [dateStr, airlineMap] of Array.from(byDateAirline.entries()).sort()) {
    if (y < 50) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }

    let totalDayBillets = 0;
    const values: number[] = []; // per airline

    allAirlines.forEach((airline) => {
      const data = airlineMap.get(airline);
      const count = data?.count ?? 0;
      values.push(count);
      totalDayBillets += count;
    });

    drawText(dateStr, dateCol, 8);
    drawText(`${totalDayBillets}`, billetCol, 8);
    values.forEach((val, i) => {
      drawText(`${val}`, airlineStartCol + i * colWidth, 8);
    });
    drawLine();
  }

  drawBoldLine();

  // Airline totals
  drawText("TOTAUX PAR COMPAGNIE", margin, 10, true);
  y -= 5;
  drawLine();

  for (const airline of allAirlines) {
    const data = airlineTotals.get(airline);
    if (!data) continue;

    if (y < 50) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }

    drawText(`${airline}`, margin, 8);
    drawText(`${data.count}`, billetCol, 8);
    drawText(`${data.amount.toFixed(2)} USD`, airlineStartCol, 8);
    drawText(`${data.commission.toFixed(2)} USD`, airlineStartCol + colWidth, 8);
    drawLine();
  }

  drawBoldLine();

  // Total general
  drawText("TOTAL GENERAL", margin, 11, true);
  drawText(`${totalCount}`, billetCol, 11, true);
  drawText(`${totalAmount.toFixed(2)} USD`, airlineStartCol, 11, true);
  drawText(`${totalCommission.toFixed(2)} USD`, airlineStartCol + colWidth, 11, true);

  y -= 15;
  drawBoldLine();

  // Agency summary
  drawText("DONNEES PAR AGENCE", margin, 10, true);
  y -= 5;
  drawLine();

  drawText("AGENCE", margin, 8, true);
  drawText("BILLETS", billetCol, 8, true);
  drawText("MONTANTS", airlineStartCol, 8, true);
  drawLine();

  for (const [agency, data] of Array.from(byAgency.entries()).sort()) {
    if (y < 50) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }

    drawText(agency, margin, 8);
    drawText(`${data.count}`, billetCol, 8);
    drawText(`${data.amount.toFixed(2)} USD`, airlineStartCol, 8);
    drawLine();
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
