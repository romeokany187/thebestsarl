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

  // Group by airline for summary
  const totals = new Map<string, { count: number; amount: number; commission: number }>();
  const byAgency = new Map<string, { count: number; amount: number }>();

  for (const ticket of tickets) {
    const airlineKey = ticket.airline.code;
    const agencyKey = ticket.seller?.team?.name ?? "Sans agence";

    const current = totals.get(airlineKey) ?? { count: 0, amount: 0, commission: 0 };
    current.count += 1;
    current.amount += ticket.amount;
    current.commission += ticket.commissionAmount ?? 0;
    totals.set(airlineKey, current);

    const agencyCurrent = byAgency.get(agencyKey) ?? { count: 0, amount: 0 };
    agencyCurrent.count += 1;
    agencyCurrent.amount += ticket.amount;
    byAgency.set(agencyKey, agencyCurrent);
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
  const margin = 20;
  const colWidth = (width - 2 * margin) / 6;
  let y = 800;

  const drawText = (text: string, x: number, size: number, bold = false) => {
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
  };

  // Title
  drawText(dateRange.label.toUpperCase(), margin, 16, true);
  y -= 30;

  // Table header
  const headers = ["DATE", "COMPAGNIE", "BILLETS", "MONTANTS", "COMMISSION", "AGENT"];
  const headerX = [margin, margin + colWidth, margin + colWidth * 2, margin + colWidth * 3, margin + colWidth * 4, margin + colWidth * 5];

  page.drawLine({
    start: { x: margin, y: y + 5 },
    end: { x: width - margin, y: y + 5 },
    thickness: 1,
    color: rgb(0.2, 0.2, 0.2),
  });

  headers.forEach((header, i) => {
    drawText(header, headerX[i], 9, true);
  });

  y -= 15;

  // Table rows
  for (const ticket of tickets) {
    if (y < 50) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }

    const date = new Date(ticket.soldAt).toISOString().slice(0, 10);
    const values = [
      date,
      ticket.airline.code,
      "1",
      `${ticket.amount.toFixed(2)}`,
      `${(ticket.commissionAmount ?? 0).toFixed(2)}`,
      ticket.seller?.name ?? "-",
    ];

    values.forEach((val, i) => {
      drawText(val, headerX[i], 8);
    });

    page.drawLine({
      start: { x: margin, y: y - 3 },
      end: { x: width - margin, y: y - 3 },
      thickness: 0.3,
      color: rgb(0.9, 0.9, 0.9),
    });

    y -= 12;
  }

  // Subtotals by airline
  y -= 10;
  page.drawLine({
    start: { x: margin, y: y + 3 },
    end: { x: width - margin, y: y + 3 },
    thickness: 1.5,
    color: rgb(0, 0, 0),
  });
  y -= 15;

  drawText("TOTAUX PAR COMPAGNIE", margin, 10, true);
  y -= 12;

  for (const [airline, data] of Array.from(totals.entries()).sort()) {
    if (y < 50) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }

    const values = [
      airline,
      `${data.count}`,
      `${data.amount.toFixed(2)} USD`,
      `${data.commission.toFixed(2)} USD`,
    ];

    drawText(airline, margin, 8);
    drawText(`${data.count}`, margin + colWidth * 2, 8);
    drawText(`${data.amount.toFixed(2)} USD`, margin + colWidth * 3, 8);
    drawText(`${data.commission.toFixed(2)} USD`, margin + colWidth * 4, 8);

    y -= 12;
  }

  // Total general
  y -= 10;
  page.drawLine({
    start: { x: margin, y: y + 3 },
    end: { x: width - margin, y: y + 3 },
    thickness: 1.5,
    color: rgb(0, 0, 0),
  });
  y -= 15;

  drawText("TOTAL GENERAL", margin, 11, true);
  drawText(`${totalCount}`, margin + colWidth * 2, 11, true);
  drawText(`${totalAmount.toFixed(2)} USD`, margin + colWidth * 3, 11, true);
  drawText(`${totalCommission.toFixed(2)} USD`, margin + colWidth * 4, 11, true);

  // Summary by agency
  y -= 20;
  page.drawLine({
    start: { x: margin, y: y + 3 },
    end: { x: width - margin, y: y + 3 },
    thickness: 1,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 15;

  drawText("DONNEES PAR AGENCE", margin, 10, true);
  y -= 12;

  drawText("AGENCE", margin, 9, true);
  drawText("BILLETS", margin + colWidth * 2, 9, true);
  drawText("MONTANTS", margin + colWidth * 3, 9, true);

  y -= 12;
  for (const [agency, data] of Array.from(byAgency.entries()).sort()) {
    if (y < 50) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }

    drawText(agency, margin, 8);
    drawText(`${data.count}`, margin + colWidth * 2, 8);
    drawText(`${data.amount.toFixed(2)} USD`, margin + colWidth * 3, 8);

    y -= 12;
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
