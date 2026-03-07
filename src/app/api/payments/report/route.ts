import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

type ReportMode = "date" | "month" | "year";

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
    return { start, end, label: `Rapport du ${startRaw} au ${endRaw}` };
  }

  const mode = (["date", "month", "year"].includes(params.get("mode") ?? "")
    ? params.get("mode")
    : "date") as ReportMode;

  if (mode === "year") {
    const year = parseYear(params.get("year")) ?? now.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    return { start, end, label: `Rapport annuel ${year}` };
  }

  if (mode === "month") {
    const rawMonth = params.get("month");
    const monthMatch = rawMonth?.match(/^(\d{4})-(\d{2})$/);
    const year = monthMatch ? Number.parseInt(monthMatch[1], 10) : now.getUTCFullYear();
    const month = monthMatch ? Number.parseInt(monthMatch[2], 10) - 1 : now.getUTCMonth();
    const safeMonth = Math.min(11, Math.max(0, month));
    const start = new Date(Date.UTC(year, safeMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, safeMonth + 1, 1, 0, 0, 0, 0));
    return { start, end, label: `Rapport mensuel ${start.toISOString().slice(0, 7)}` };
  }

  const rawDate = params.get("date");
  const date = rawDate ? new Date(`${rawDate}T00:00:00.000Z`) : now;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0));
  return { start, end, label: `Rapport du ${start.toISOString().slice(0, 10)}` };
}

function short(value: string, max: number) {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

export async function GET(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const range = dateRangeFromParams(request.nextUrl.searchParams);
  const airlineId = request.nextUrl.searchParams.get("airlineId")?.trim() || undefined;

  const [rows, airline] = await Promise.all([
    prisma.payment.findMany({
      where: {
        paidAt: { gte: range.start, lt: range.end },
        ...(airlineId ? { ticket: { airlineId } } : {}),
      },
      include: {
        ticket: {
          include: {
            airline: { select: { code: true, name: true } },
            seller: { select: { name: true } },
          },
        },
      },
      orderBy: { paidAt: "asc" },
      take: 4000,
    }),
    airlineId
      ? prisma.airline.findUnique({ where: { id: airlineId }, select: { code: true, name: true } })
      : Promise.resolve(null),
  ]);

  const totals = rows.reduce(
    (acc, row) => {
      acc.totalPaid += row.amount;
      acc.ticketSet.add(row.ticketId);
      const key = row.method.trim() || "AUTRE";
      acc.byMethod.set(key, (acc.byMethod.get(key) ?? 0) + row.amount);
      return acc;
    },
    {
      totalPaid: 0,
      ticketSet: new Set<string>(),
      byMethod: new Map<string, number>(),
    },
  );

  const topMethods = Array.from(totals.byMethod.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const textBlack = rgb(0, 0, 0);
  const lineGray = rgb(0.84, 0.84, 0.84);
  let page = pdf.addPage([842, 595]);
  const generatedBy = access.session.user.name ?? access.session.user.email ?? "Utilisateur";
  const periodStart = range.start.toISOString().slice(0, 10);
  const periodEnd = new Date(range.end.getTime() - 1).toISOString().slice(0, 10);

  const subtitle = airline
    ? `${range.label} • ${airline.code} - ${airline.name}`
    : `${range.label} • Toutes compagnies`;

  const drawHeader = (continuation = false) => {
    page.drawText(`THEBEST SARL - Rapport des paiements${continuation ? " (suite)" : ""}`, {
      x: 24,
      y: 566,
      size: 13,
      font: fontBold,
      color: textBlack,
    });
    page.drawText(subtitle, { x: 24, y: 550, size: 9, font, color: textBlack });
    page.drawText(`Période exacte: ${periodStart} au ${periodEnd}`, { x: 24, y: 538, size: 8.2, font, color: textBlack });
    page.drawLine({ start: { x: 24, y: 532 }, end: { x: 818, y: 532 }, thickness: 0.8, color: lineGray });
  };

  const drawSummary = () => {
    page.drawText(`Transactions: ${rows.length}`, { x: 24, y: 516, size: 8.6, font: fontBold, color: textBlack });
    page.drawText(`Billets concernés: ${totals.ticketSet.size}`, { x: 180, y: 516, size: 8.6, font: fontBold, color: textBlack });
    page.drawText(`Total encaissé: ${totals.totalPaid.toFixed(2)} USD`, { x: 360, y: 516, size: 8.6, font: fontBold, color: textBlack });

    const methodsLabel = topMethods.length > 0
      ? `Méthodes: ${topMethods.map(([method, amount]) => `${method} ${amount.toFixed(2)} USD`).join(" | ")}`
      : "Méthodes: -";
    page.drawText(short(methodsLabel, 150), { x: 24, y: 503, size: 7.6, font, color: textBlack });
    page.drawLine({ start: { x: 24, y: 498 }, end: { x: 818, y: 498 }, thickness: 0.7, color: lineGray });
  };

  const headers = ["Date", "PNR", "Client", "Compagnie", "Vendeur", "Montant payé", "Méthode", "Référence"];
  const x = [24, 92, 170, 325, 430, 530, 620, 700];

  const drawTableHeader = (topY: number) => {
    headers.forEach((header, index) => {
      page.drawText(header, { x: x[index], y: topY, size: 8, font: fontBold, color: textBlack });
    });
    page.drawLine({ start: { x: 24, y: topY - 4 }, end: { x: 818, y: topY - 4 }, thickness: 0.6, color: lineGray });
  };

  drawHeader();
  drawSummary();
  drawTableHeader(484);
  let y = 468;

  for (const row of rows) {
    if (y < 38) {
      page = pdf.addPage([842, 595]);
      drawHeader(true);
      drawTableHeader(516);
      y = 500;
    }

    const values = [
      new Date(row.paidAt).toISOString().slice(0, 10),
      row.ticket.ticketNumber.slice(0, 10),
      short(row.ticket.customerName, 26),
      row.ticket.airline.code,
      short(row.ticket.seller.name, 14),
      `${row.amount.toFixed(2)} ${row.ticket.currency}`,
      short(row.method, 12),
      short(row.reference ?? "-", 16),
    ];

    values.forEach((value, index) => {
      page.drawText(value, { x: x[index], y, size: 7.7, font, color: textBlack });
    });

    page.drawLine({
      start: { x: 24, y: y - 3 },
      end: { x: 818, y: y - 3 },
      thickness: 0.25,
      color: lineGray,
    });

    y -= 11.5;
  }

  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: 24, y: 20 }, end: { x: 818, y: 20 }, thickness: 0.6, color: lineGray });
    p.drawText(`Page ${index + 1}/${pages.length}`, { x: 24, y: 10, size: 8, font, color: textBlack });
    const rightText = `Par ${generatedBy}`;
    const rightWidth = font.widthOfTextAtSize(rightText, 8);
    p.drawText(rightText, { x: 818 - rightWidth, y: 10, size: 8, font, color: textBlack });
  });

  const bytes = await pdf.save();
  return new NextResponse(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="rapport-paiements-${new Date().toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
