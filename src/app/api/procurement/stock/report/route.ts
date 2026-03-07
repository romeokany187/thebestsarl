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
    return { start, end, label: `Période du ${startRaw} au ${endRaw}` };
  }

  const mode = (["date", "month", "year"].includes(params.get("mode") ?? "")
    ? params.get("mode")
    : "month") as ReportMode;

  if (mode === "year") {
    const year = parseYear(params.get("year")) ?? now.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    return { start, end, label: `Exercice ${year}` };
  }

  if (mode === "month") {
    const rawMonth = params.get("month");
    const monthMatch = rawMonth?.match(/^(\d{4})-(\d{2})$/);
    const year = monthMatch ? Number.parseInt(monthMatch[1], 10) : now.getUTCFullYear();
    const month = monthMatch ? Number.parseInt(monthMatch[2], 10) - 1 : now.getUTCMonth();
    const safeMonth = Math.min(11, Math.max(0, month));
    const start = new Date(Date.UTC(year, safeMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, safeMonth + 1, 1, 0, 0, 0, 0));
    return { start, end, label: `Mois ${start.toISOString().slice(0, 7)}` };
  }

  const rawDate = params.get("date");
  const date = rawDate ? new Date(`${rawDate}T00:00:00.000Z`) : now;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0));
  return { start, end, label: `Jour ${start.toISOString().slice(0, 10)}` };
}

function toMap(
  rows: Array<{ stockItemId: string; movementType: "IN" | "OUT"; _sum: { quantity: number | null } }>,
) {
  const result = new Map<string, { inQty: number; outQty: number }>();

  for (const row of rows) {
    const current = result.get(row.stockItemId) ?? { inQty: 0, outQty: 0 };
    const quantity = row._sum.quantity ?? 0;
    if (row.movementType === "IN") {
      current.inQty += quantity;
    } else {
      current.outQty += quantity;
    }
    result.set(row.stockItemId, current);
  }

  return result;
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export async function GET(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const shouldDownload = request.nextUrl.searchParams.get("download") === "1";
  const range = dateRangeFromParams(request.nextUrl.searchParams);

  const [items, rangeAggRows, afterStartAggRows, movements] = await Promise.all([
    prisma.stockItem.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: 1500,
    }),
    prisma.stockMovement.groupBy({
      by: ["stockItemId", "movementType"],
      where: {
        createdAt: { gte: range.start, lt: range.end },
      },
      _sum: { quantity: true },
    }),
    prisma.stockMovement.groupBy({
      by: ["stockItemId", "movementType"],
      where: {
        createdAt: { gte: range.start },
      },
      _sum: { quantity: true },
    }),
    prisma.stockMovement.findMany({
      where: {
        createdAt: { gte: range.start, lt: range.end },
      },
      include: {
        stockItem: { select: { name: true, category: true, unit: true } },
        performedBy: { select: { name: true } },
      },
      orderBy: [{ createdAt: "asc" }, { stockItem: { name: "asc" } }],
      take: 4000,
    }),
  ]);

  const rangeMap = toMap(rangeAggRows as Array<{ stockItemId: string; movementType: "IN" | "OUT"; _sum: { quantity: number | null } }>);
  const afterStartMap = toMap(afterStartAggRows as Array<{ stockItemId: string; movementType: "IN" | "OUT"; _sum: { quantity: number | null } }>);

  const summary = items.map((item) => {
    const inRange = rangeMap.get(item.id) ?? { inQty: 0, outQty: 0 };
    const afterStart = afterStartMap.get(item.id) ?? { inQty: 0, outQty: 0 };
    const netAfterStart = afterStart.inQty - afterStart.outQty;
    const openingStock = item.currentQuantity - netAfterStart;
    const closingStock = openingStock + inRange.inQty - inRange.outQty;
    const reorderLevel = item.reorderLevel ?? 0;
    const recommended = reorderLevel > 0 ? Math.max(0, reorderLevel - item.currentQuantity) : 0;

    return {
      ...item,
      openingStock,
      inQty: inRange.inQty,
      outQty: inRange.outQty,
      closingStock,
      recommended,
    };
  });

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const textBlack = rgb(0, 0, 0);
  const lineGray = rgb(0.84, 0.84, 0.84);

  const pageWidth = 842;
  const pageHeight = 595;

  let page = pdf.addPage([pageWidth, pageHeight]);

  const drawTop = (subtitle: string, continuation = false) => {
    page.drawText(`THEBEST SARL - Fiche de stock${continuation ? " (suite)" : ""}`, {
      x: 24,
      y: 566,
      size: 13,
      font: fontBold,
      color: textBlack,
    });
    page.drawText(subtitle, {
      x: 24,
      y: 550,
      size: 9,
      font,
      color: textBlack,
    });
    page.drawText(`Imprimé le ${new Date().toLocaleString("fr-FR")}`, {
      x: 640,
      y: 550,
      size: 8,
      font,
      color: textBlack,
    });
    page.drawLine({
      start: { x: 24, y: 544 },
      end: { x: 818, y: 544 },
      thickness: 0.8,
      color: lineGray,
    });
  };

  drawTop(`${range.label} • Données exactes de stock et mouvements`);

  const summaryHeaders = [
    "Produit",
    "Catégorie",
    "Stock début",
    "Entrées",
    "Sorties",
    "Stock fin",
    "Stock actuel",
    "Seuil",
    "Qté recommandée",
  ];
  const sx = [24, 170, 286, 362, 430, 496, 572, 650, 715];

  let y = 528;

  const drawSummaryHeader = () => {
    summaryHeaders.forEach((header, index) => {
      page.drawText(header, {
        x: sx[index],
        y,
        size: 7.5,
        font: fontBold,
        color: textBlack,
      });
    });
    page.drawLine({
      start: { x: 24, y: y - 4 },
      end: { x: 818, y: y - 4 },
      thickness: 0.7,
      color: lineGray,
    });
    y -= 16;
  };

  drawSummaryHeader();

  for (const row of summary) {
    if (y < 208) {
      page = pdf.addPage([pageWidth, pageHeight]);
      drawTop(`${range.label} • Données exactes de stock et mouvements`, true);
      y = 528;
      drawSummaryHeader();
    }

    const values = [
      row.name.slice(0, 22),
      row.category.slice(0, 16),
      `${formatQty(row.openingStock)} ${row.unit}`,
      formatQty(row.inQty),
      formatQty(row.outQty),
      formatQty(row.closingStock),
      `${formatQty(row.currentQuantity)} ${row.unit}`,
      row.reorderLevel != null ? formatQty(row.reorderLevel) : "-",
      row.recommended > 0 ? formatQty(row.recommended) : "-",
    ];

    values.forEach((value, index) => {
      page.drawText(value, {
        x: sx[index],
        y,
        size: 7.6,
        font,
        color: textBlack,
      });
    });

    page.drawLine({
      start: { x: 24, y: y - 3 },
      end: { x: 818, y: y - 3 },
      thickness: 0.25,
      color: lineGray,
    });
    y -= 13;
  }

  if (y < 145) {
    page = pdf.addPage([pageWidth, pageHeight]);
    drawTop(`${range.label} • Mouvements détaillés`, true);
    y = 528;
  }

  y -= 8;
  page.drawText("Mouvements détaillés (période)", {
    x: 24,
    y,
    size: 10,
    font: fontBold,
    color: textBlack,
  });
  y -= 14;

  const mx = [24, 90, 258, 328, 370, 448, 548, 660];
  const movementHeaders = ["Date", "Produit", "Type", "Qté", "Unité", "Référence", "Agent", "Justification"];

  const drawMovementHeader = () => {
    movementHeaders.forEach((header, index) => {
      page.drawText(header, {
        x: mx[index],
        y,
        size: 7.5,
        font: fontBold,
        color: textBlack,
      });
    });
    page.drawLine({
      start: { x: 24, y: y - 3 },
      end: { x: 818, y: y - 3 },
      thickness: 0.7,
      color: lineGray,
    });
    y -= 14;
  };

  drawMovementHeader();

  for (const movement of movements) {
    if (y < 40) {
      page = pdf.addPage([pageWidth, pageHeight]);
      drawTop(`${range.label} • Mouvements détaillés`, true);
      y = 528;
      drawMovementHeader();
    }

    const row = [
      new Date(movement.createdAt).toISOString().slice(0, 10),
      movement.stockItem.name.slice(0, 24),
      movement.movementType === "IN" ? "Entrée" : "Sortie",
      formatQty(movement.quantity),
      movement.stockItem.unit.slice(0, 8),
      movement.referenceDoc.slice(0, 16),
      movement.performedBy.name.slice(0, 14),
      movement.justification.replace(/\s+/g, " ").slice(0, 28),
    ];

    row.forEach((value, index) => {
      page.drawText(value, {
        x: mx[index],
        y,
        size: 7.4,
        font,
        color: textBlack,
      });
    });

    y -= 11.5;
  }

  const allPages = pdf.getPages();
  allPages.forEach((p, index) => {
    p.drawLine({
      start: { x: 24, y: 20 },
      end: { x: 818, y: 20 },
      thickness: 0.6,
      color: lineGray,
    });
    p.drawText(`Page ${index + 1}/${allPages.length}`, {
      x: 24,
      y: 10,
      size: 8,
      font,
      color: textBlack,
    });
    const printedBy = access.session.user.name ?? access.session.user.email ?? "Utilisateur";
    const byText = `Par ${printedBy}`;
    const byWidth = font.widthOfTextAtSize(byText, 8);
    p.drawText(byText, {
      x: 818 - byWidth,
      y: 10,
      size: 8,
      font,
      color: textBlack,
    });
  });

  const bytes = await pdf.save();
  const filename = `fiche-stock-${range.start.toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
