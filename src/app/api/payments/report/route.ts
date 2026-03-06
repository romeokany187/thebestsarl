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

export async function GET(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const range = dateRangeFromParams(request.nextUrl.searchParams);

  const rows = await prisma.payment.findMany({
    where: {
      paidAt: { gte: range.start, lt: range.end },
    },
    include: {
      ticket: {
        include: {
          airline: { select: { code: true } },
          seller: { select: { name: true } },
        },
      },
    },
    orderBy: { paidAt: "asc" },
    take: 1500,
  });

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([842, 595]);

  const drawHeader = () => {
    page.drawText("THEBEST SARL - Rapport des paiements", { x: 24, y: 566, size: 13, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(range.label, { x: 24, y: 550, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
    page.drawLine({ start: { x: 24, y: 544 }, end: { x: 818, y: 544 }, thickness: 0.8, color: rgb(0.8, 0.8, 0.8) });
    const headers = ["Date", "PNR", "Client", "Compagnie", "Vendeur", "Montant payé", "Méthode", "Référence"];
    const x = [24, 92, 170, 315, 390, 470, 565, 650];
    headers.forEach((header, index) => {
      page.drawText(header, { x: x[index], y: 528, size: 8, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
    });
    page.drawLine({ start: { x: 24, y: 523 }, end: { x: 818, y: 523 }, thickness: 0.6, color: rgb(0.86, 0.86, 0.86) });
  };

  drawHeader();
  let y = 510;

  for (const row of rows) {
    if (y < 42) {
      page = pdf.addPage([842, 595]);
      drawHeader();
      y = 510;
    }

    const values = [
      new Date(row.paidAt).toISOString().slice(0, 10),
      row.ticket.ticketNumber.slice(0, 10),
      row.ticket.customerName.slice(0, 22),
      row.ticket.airline.code,
      row.ticket.seller.name.slice(0, 14),
      `${row.amount.toFixed(2)} ${row.ticket.currency}`,
      row.method.slice(0, 12),
      (row.reference ?? "-").slice(0, 20),
    ];
    const x = [24, 92, 170, 315, 390, 470, 565, 650];

    values.forEach((value, index) => {
      page.drawText(value, { x: x[index], y, size: 8, font, color: rgb(0.2, 0.2, 0.2) });
    });

    y -= 12;
  }

  const bytes = await pdf.save();
  return new NextResponse(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="rapport-paiements-${new Date().toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
