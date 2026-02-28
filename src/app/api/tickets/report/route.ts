import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
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
  page.drawText(`Imprimé par: ${generatedBy}`, {
    x: 26,
    y: 24,
    size: 9,
    font: fontRegular,
    color: rgb(0.25, 0.25, 0.25),
  });

  const rightTextWidth = fontRegular.widthOfTextAtSize(reportTitle, 9);
  page.drawText(reportTitle, {
    x: width - rightTextWidth - 26,
    y: 24,
    size: 9,
    font: fontRegular,
    color: rgb(0.25, 0.25, 0.25),
  });
}

function drawTopInfo(
  page: PDFPage,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  subtitle: string,
  logoImage: PDFImage | null,
) {
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
    color: rgb(0.08, 0.08, 0.08),
  });

  page.drawText("RAPPORT DE VENTES BILLETS", {
    x: titleX,
    y: 545,
    size: 9,
    font: fontBold,
    color: rgb(0.22, 0.22, 0.22),
  });

  page.drawText(subtitle, {
    x: titleX,
    y: 532,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.32, 0.32, 0.32),
  });

  page.drawLine({
    start: { x: 26, y: 522 },
    end: { x: 816, y: 522 },
    thickness: 0.8,
    color: rgb(0.75, 0.75, 0.75),
  });
}

function drawSignature(page: PDFPage, signatureImage: PDFImage | null, fontRegular: PDFFont) {
  const { width } = page.getSize();
  const baseX = width - 220;
  const baseY = 46;

  page.drawText("Signature", {
    x: baseX,
    y: baseY + 24,
    size: 8,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3),
  });

  page.drawLine({
    start: { x: baseX, y: baseY + 18 },
    end: { x: width - 36, y: baseY + 18 },
    thickness: 0.8,
    color: rgb(0.72, 0.72, 0.72),
  });

  if (signatureImage) {
    const scaled = signatureImage.scale(0.2);
    page.drawImage(signatureImage, {
      x: baseX + 2,
      y: baseY,
      width: Math.min(scaled.width, 170),
      height: Math.min(scaled.height, 34),
    });
  }
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
  pdf.registerFontkit(fontkit);

  let fontRegular: PDFFont;
  let fontBold: PDFFont;

  try {
    const regularBytes = await readFile(path.join(process.cwd(), "public/fonts/Montserrat-Regular.ttf"));
    const boldBytes = await readFile(path.join(process.cwd(), "public/fonts/Montserrat-Bold.ttf"));
    fontRegular = await pdf.embedFont(regularBytes);
    fontBold = await pdf.embedFont(boldBytes);
  } catch {
    return NextResponse.json(
      { error: "Police Montserrat introuvable. Vérifiez public/fonts/Montserrat-Regular.ttf et Montserrat-Bold.ttf." },
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
  const signatureImage = await embedOptionalImage(pdf, [
    "public/branding/signature.png",
    "public/branding/signature.jpg",
    "public/branding/signature.jpeg",
    "public/signature.png",
    "public/signature.jpg",
    "public/signature.jpeg",
  ]);
  const generatedBy = access.session.user.name ?? access.session.user.email ?? "Compte inconnu";
  const generatedByWithRole = `${generatedBy} (${access.role})`;

  if (range.mode === "date") {
    const reportTitle = "Rapport Journalier";
    let page = pdf.addPage([842, 595]);
    drawTopInfo(page, fontBold, fontRegular, periodLabel, logoImage);
    drawFooter(page, fontRegular, reportTitle, generatedByWithRole);
    drawSignature(page, signatureImage, fontRegular);

    const headers = ["Date", "Émetteur", "Compagnie", "PNR", "Itinéraire", "Prix", "BaseFare", "Commission", "Nature", "Statut", "Payant"];
    const headerX = [26, 84, 160, 218, 278, 386, 454, 518, 578, 640, 708];

    let y = 504;
    headers.forEach((header, index) => {
      page.drawText(header, {
        x: headerX[index],
        y,
        size: 7.5,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
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
        drawSignature(page, signatureImage, fontRegular);
        y = 504;
        headers.forEach((header, index) => {
          page.drawText(header, {
            x: headerX[index],
            y,
            size: 7.5,
            font: fontBold,
            color: rgb(0.1, 0.1, 0.1),
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
          size: 8,
          font: fontRegular,
          color: rgb(0.14, 0.14, 0.14),
        });
      });

      y -= 13;
    });

    const totalSales = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
    const totalCommissions = tickets.reduce(
      (sum, ticket) => sum + (ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100)),
      0,
    );

    if (y < 90) {
      page = pdf.addPage([842, 595]);
      drawTopInfo(page, fontBold, fontRegular, `${periodLabel} (totaux)`, logoImage);
      drawFooter(page, fontRegular, reportTitle, generatedByWithRole);
      drawSignature(page, signatureImage, fontRegular);
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
      color: rgb(0.08, 0.08, 0.08),
    });
  } else {
    const reportTitle = "Rapport Synthèse";
    let page = pdf.addPage([842, 595]);
    drawTopInfo(page, fontBold, fontRegular, periodLabel, logoImage);
    drawFooter(page, fontRegular, reportTitle, generatedByWithRole);
    drawSignature(page, signatureImage, fontRegular);

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
        color: rgb(0.1, 0.1, 0.1),
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
        drawSignature(page, signatureImage, fontRegular);
        y = 504;
        headers.forEach((header, index) => {
          page.drawText(header, {
            x: headerX[index],
            y,
            size: 8,
            font: fontBold,
            color: rgb(0.1, 0.1, 0.1),
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
          color: rgb(0.12, 0.12, 0.12),
        });
        page.drawText(String(dayTotal.tickets), { x: 360, y, size: 8, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
        page.drawText(formatMoney(dayTotal.sales), { x: 455, y, size: 8, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
        page.drawText(formatMoney(dayTotal.commissions), { x: 585, y, size: 8, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
        y -= 14;
      }

      currentDay = item.day;
      ensureSpace();
      page.drawText(item.day, { x: 26, y, size: 8.5, font: fontRegular, color: rgb(0.16, 0.16, 0.16) });
      page.drawText(item.airline, { x: 190, y, size: 8.5, font: fontRegular, color: rgb(0.16, 0.16, 0.16) });
      page.drawText(String(item.tickets), { x: 360, y, size: 8.5, font: fontRegular, color: rgb(0.16, 0.16, 0.16) });
      page.drawText(formatMoney(item.sales), { x: 455, y, size: 8.5, font: fontRegular, color: rgb(0.16, 0.16, 0.16) });
      page.drawText(formatMoney(item.commissions), { x: 585, y, size: 8.5, font: fontRegular, color: rgb(0.16, 0.16, 0.16) });
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
        color: rgb(0.12, 0.12, 0.12),
      });
      page.drawText(String(dayTotal.tickets), { x: 360, y, size: 8, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
      page.drawText(formatMoney(dayTotal.sales), { x: 455, y, size: 8, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
      page.drawText(formatMoney(dayTotal.commissions), { x: 585, y, size: 8, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
      y -= 18;
    }

    const grandTickets = grouped.reduce((sum, item) => sum + item.tickets, 0);
    const grandSales = grouped.reduce((sum, item) => sum + item.sales, 0);
    const grandCommissions = grouped.reduce((sum, item) => sum + item.commissions, 0);

    if (y < 95) {
      page = pdf.addPage([842, 595]);
      drawTopInfo(page, fontBold, fontRegular, `${periodLabel} (totaux)`, logoImage);
      drawFooter(page, fontRegular, reportTitle, generatedByWithRole);
      drawSignature(page, signatureImage, fontRegular);
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
      color: rgb(0.08, 0.08, 0.08),
    });
    page.drawText(String(grandTickets), { x: 360, y, size: 10, font: fontBold, color: rgb(0.08, 0.08, 0.08) });
    page.drawText(formatMoney(grandSales), { x: 455, y, size: 10, font: fontBold, color: rgb(0.08, 0.08, 0.08) });
    page.drawText(formatMoney(grandCommissions), { x: 585, y, size: 10, font: fontBold, color: rgb(0.08, 0.08, 0.08) });
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
