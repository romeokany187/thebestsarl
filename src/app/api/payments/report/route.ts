import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

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

  if (params.get("mode") === "week") {
    const nowDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayIndex = nowDay.getUTCDay();
    const diffToMonday = (dayIndex + 6) % 7;
    const defaultMonday = new Date(nowDay);
    defaultMonday.setUTCDate(defaultMonday.getUTCDate() - diffToMonday);
    const rawWeekStart = params.get("weekStart");
    const monday = rawWeekStart
      ? new Date(`${rawWeekStart}T00:00:00.000Z`)
      : defaultMonday;
    const start = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return {
      start,
      end,
      label: `Rapport hebdomadaire du ${start.toISOString().slice(0, 10)} au ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`,
    };
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

async function readFirstExistingFile(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      return await readFile(path.join(process.cwd(), candidate));
    } catch {
      continue;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const range = dateRangeFromParams(request.nextUrl.searchParams);
  const airlineId = request.nextUrl.searchParams.get("airlineId")?.trim() || undefined;

  const [rows, tickets, airline] = await Promise.all([
    prisma.payment.findMany({
      where: {
        ticket: {
          soldAt: { gte: range.start, lt: range.end },
          ...(airlineId ? { airlineId } : {}),
        },
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
    prisma.ticketSale.findMany({
      where: {
        soldAt: { gte: range.start, lt: range.end },
        ...(airlineId ? { airlineId } : {}),
      },
      include: { payments: true },
      orderBy: { soldAt: "asc" },
      take: 4000,
    }),
    airlineId
      ? prisma.airline.findUnique({ where: { id: airlineId }, select: { code: true, name: true } })
      : Promise.resolve(null),
  ]);

  const ticketsWithStatus = tickets.map((ticket) => {
    const paidAmount = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const computedStatus = paidAmount <= 0
      ? "UNPAID"
      : paidAmount + 0.0001 >= ticket.amount
        ? "PAID"
        : "PARTIAL";
    return {
      ...ticket,
      paidAmount,
      computedStatus,
    };
  });

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

  const paidTickets = ticketsWithStatus.filter((ticket) => ticket.computedStatus === "PAID");
  const unpaidTickets = ticketsWithStatus.filter((ticket) => ticket.computedStatus === "UNPAID");
  const partialTickets = ticketsWithStatus.filter((ticket) => ticket.computedStatus === "PARTIAL");
  const totalBilled = ticketsWithStatus.reduce((sum, ticket) => sum + ticket.amount, 0);
  const totalPaidOnTickets = ticketsWithStatus.reduce((sum, ticket) => sum + ticket.paidAmount, 0);
  const totalOutstanding = Math.max(0, totalBilled - totalPaidOnTickets);
  const partialBilled = partialTickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const partialPaid = partialTickets.reduce((sum, ticket) => sum + ticket.paidAmount, 0);
  const partialCoverage = partialBilled > 0 ? (partialPaid / partialBilled) * 100 : 0;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const montserratRegular = await readFirstExistingFile([
    "public/fonts/Montserrat-Regular.ttf",
    "public/branding/fonts/Montserrat-Regular.ttf",
  ]);
  const montserratBold = await readFirstExistingFile([
    "public/fonts/Montserrat-Bold.ttf",
    "public/branding/fonts/Montserrat-Bold.ttf",
  ]);

  if (!montserratRegular || !montserratBold) {
    return NextResponse.json({ error: "Polices Montserrat introuvables sur le serveur." }, { status: 500 });
  }

  const font = await pdf.embedFont(montserratRegular);
  const fontBold = await pdf.embedFont(montserratBold);
  const textBlack = rgb(0, 0, 0);
  const lineGray = rgb(0.84, 0.84, 0.84);
  let page = pdf.addPage([842, 595]);
  const generatedBy = access.session.user.name ?? access.session.user.email ?? "Utilisateur";
  const periodStart = range.start.toISOString().slice(0, 10);
  const periodEnd = new Date(range.end.getTime() - 1).toISOString().slice(0, 10);

  const subtitle = airline
    ? `${range.label} • ${airline.code} - ${airline.name}`
    : `${range.label} • Toutes compagnies`;

  const mode = request.nextUrl.searchParams.get("mode") ?? "date";
  const detailLabel = mode === "month"
    ? "Synthèse mensuelle"
    : mode === "week"
      ? "Synthèse hebdomadaire"
      : "Synthèse journalière";

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
    page.drawText(`${detailLabel}`, { x: 24, y: 518, size: 8.8, font: fontBold, color: textBlack });
    page.drawText(`Billets: ${ticketsWithStatus.length} • Transactions: ${rows.length}`, { x: 180, y: 518, size: 8.4, font, color: textBlack });
    page.drawText(`Facturé: ${totalBilled.toFixed(2)} USD`, { x: 24, y: 505, size: 8.4, font: fontBold, color: textBlack });
    page.drawText(`Encaissé: ${totalPaidOnTickets.toFixed(2)} USD`, { x: 190, y: 505, size: 8.4, font: fontBold, color: textBlack });
    page.drawText(`Créance: ${totalOutstanding.toFixed(2)} USD`, { x: 350, y: 505, size: 8.4, font: fontBold, color: textBlack });
    page.drawText(`Payés: ${paidTickets.length} • Impayés: ${unpaidTickets.length} • Partiels: ${partialTickets.length}`, { x: 24, y: 492, size: 8.2, font, color: textBlack });
    page.drawText(`Partiels encaissés: ${partialPaid.toFixed(2)} / ${partialBilled.toFixed(2)} USD (${partialCoverage.toFixed(1)}%)`, { x: 350, y: 492, size: 8.2, font, color: textBlack });

    const methodsLabel = topMethods.length > 0
      ? `Méthodes: ${topMethods.map(([method, amount]) => `${method} ${amount.toFixed(2)} USD`).join(" | ")}`
      : "Méthodes: -";
    page.drawText(short(methodsLabel, 150), { x: 24, y: 480, size: 7.6, font, color: textBlack });
    page.drawLine({ start: { x: 24, y: 475 }, end: { x: 818, y: 475 }, thickness: 0.7, color: lineGray });
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
  drawTableHeader(460);
  let y = 444;

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
      short(row.ticket.sellerName ?? row.ticket.seller?.name ?? "-", 14),
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
