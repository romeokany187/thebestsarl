import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFFont, StandardFonts, rgb, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { workflowAssignmentLabel } from "@/lib/workflow-assignment";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const CONTENT_LEFT = 38;
const CONTENT_RIGHT = 557;
const FOOTER_Y = 16;

const COLORS = {
  ink: rgb(0.11, 0.15, 0.2),
  muted: rgb(0.42, 0.47, 0.55),
  line: rgb(0.84, 0.87, 0.92),
  panel: rgb(0.96, 0.97, 0.99),
  accent: rgb(0.08, 0.22, 0.38),
  accentSoft: rgb(0.89, 0.94, 0.98),
  white: rgb(1, 1, 1),
};

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

async function embedOptionalImage(pdf: PDFDocument, candidates: string[]) {
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(path.join(process.cwd(), candidate));
      const lower = candidate.toLowerCase();
      if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
        return await pdf.embedJpg(bytes);
      }
      return await pdf.embedPng(bytes);
    } catch {
      continue;
    }
  }
  return null;
}

async function loadFonts(pdf: PDFDocument) {
  const maiandra = await readFirstExistingFile([
    "public/fonts/MAIAN.TTF",
    "public/branding/fonts/MAIAN.TTF",
  ]);
  if (maiandra) {
    const font = await pdf.embedFont(maiandra);
    return { regularFont: font, boldFont: font };
  }

  const montserratRegular = await readFirstExistingFile([
    "public/fonts/Montserrat-Regular.ttf",
    "public/branding/fonts/Montserrat-Regular.ttf",
  ]);
  if (montserratRegular) {
    const font = await pdf.embedFont(montserratRegular);
    return { regularFont: font, boldFont: font };
  }

  return {
    regularFont: await pdf.embedFont(StandardFonts.Helvetica),
    boldFont: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
}

function formatDate(value: Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

function formatAmount(value: number | null | undefined, currency: string | null | undefined) {
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))} ${normalizeMoneyCurrency(currency)}`;
}

function statusLabel(value: string | null | undefined) {
  const normalized = (value ?? "DRAFT").trim().toUpperCase();
  if (normalized === "EXECUTED") return "Exécuté";
  if (normalized === "APPROVED") return "Approuvé";
  if (normalized === "REJECTED") return "Rejeté";
  if (normalized === "SUBMITTED") return "Soumis";
  return normalized || "-";
}

function wrapTextByWidth(text: string, maxWidth: number, font: PDFFont, fontSize: number) {
  const normalized = (text || "-").replace(/\s+/g, " ").trim() || "-";
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
      continue;
    }

    let part = "";
    for (const char of word) {
      const nextPart = `${part}${char}`;
      if (font.widthOfTextAtSize(nextPart, fontSize) <= maxWidth) {
        part = nextPart;
      } else {
        if (part) lines.push(part);
        part = char;
      }
    }
    current = part;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : ["-"];
}

function drawBlockTitle(page: PDFPage, font: PDFFont, title: string, x: number, y: number) {
  page.drawText(title, {
    x,
    y,
    size: 10.5,
    font,
    color: COLORS.accent,
  });
}

function drawCard(page: PDFPage, options: {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  value: string;
  regularFont: PDFFont;
  boldFont: PDFFont;
}) {
  page.drawRectangle({
    x: options.x,
    y: options.y - options.height,
    width: options.width,
    height: options.height,
    color: COLORS.panel,
    borderColor: COLORS.line,
    borderWidth: 1,
  });

  page.drawText(options.label.toUpperCase(), {
    x: options.x + 14,
    y: options.y - 18,
    size: 7.8,
    font: options.boldFont,
    color: COLORS.muted,
  });

  const lines = wrapTextByWidth(options.value, options.width - 28, options.regularFont, 12.2);
  lines.slice(0, 2).forEach((line, index) => {
    page.drawText(line, {
      x: options.x + 14,
      y: options.y - 40 - (index * 14),
      size: 12.2,
      font: options.boldFont,
      color: COLORS.ink,
    });
  });
}

function drawInfoGrid(page: PDFPage, options: {
  x: number;
  y: number;
  width: number;
  title: string;
  rows: Array<{ label: string; value: string }>;
  regularFont: PDFFont;
  boldFont: PDFFont;
}) {
  const rowGap = 18;
  const titleGap = 18;
  const height = 18 + titleGap + (options.rows.length * rowGap) + 14;

  page.drawRectangle({
    x: options.x,
    y: options.y - height,
    width: options.width,
    height,
    color: COLORS.white,
    borderColor: COLORS.line,
    borderWidth: 1,
  });

  drawBlockTitle(page, options.boldFont, options.title, options.x + 16, options.y - 18);

  let cursorY = options.y - 42;
  const labelWidth = 102;
  options.rows.forEach((row) => {
    page.drawText(row.label, {
      x: options.x + 16,
      y: cursorY,
      size: 9,
      font: options.boldFont,
      color: COLORS.muted,
    });

    const lines = wrapTextByWidth(row.value, options.width - labelWidth - 30, options.regularFont, 9.4);
    lines.slice(0, 2).forEach((line, index) => {
      page.drawText(line, {
        x: options.x + labelWidth,
        y: cursorY - (index * 11),
        size: 9.4,
        font: options.regularFont,
        color: COLORS.ink,
      });
    });

    cursorY -= rowGap;
  });

  return height;
}

function drawTextPanel(page: PDFPage, options: {
  x: number;
  y: number;
  width: number;
  title: string;
  text: string;
  regularFont: PDFFont;
  boldFont: PDFFont;
}) {
  const lines = wrapTextByWidth(options.text, options.width - 32, options.regularFont, 9.6);
  const bodyHeight = Math.max(58, (lines.length * 13) + 18);
  const totalHeight = bodyHeight + 28;

  page.drawRectangle({
    x: options.x,
    y: options.y - totalHeight,
    width: options.width,
    height: totalHeight,
    color: COLORS.white,
    borderColor: COLORS.line,
    borderWidth: 1,
  });

  drawBlockTitle(page, options.boldFont, options.title, options.x + 16, options.y - 18);

  lines.forEach((line, index) => {
    page.drawText(line, {
      x: options.x + 16,
      y: options.y - 42 - (index * 13),
      size: 9.6,
      font: options.regularFont,
      color: COLORS.ink,
    });
  });

  return totalHeight;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "MANAGER", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  const { id } = await context.params;
  const shouldDownload = request.nextUrl.searchParams.get("download") === "1";

  const paymentOrder = await (prisma as unknown as { paymentOrder: any }).paymentOrder.findUnique({
    where: { id },
    include: {
      issuedBy: { select: { name: true, jobTitle: true, email: true } },
      approvedBy: { select: { name: true, jobTitle: true } },
      executedBy: { select: { name: true, jobTitle: true } },
    },
  });

  if (!paymentOrder) {
    return NextResponse.json({ error: "Ordre de paiement introuvable." }, { status: 404 });
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const { regularFont, boldFont } = await loadFonts(pdf);
  const logo = await embedOptionalImage(pdf, [
    "public/logo thebest.png",
    "public/branding/logo thebest.png",
    "public/logo.png",
    "public/branding/logo.png",
  ]);
  const stamp = await embedOptionalImage(pdf, [
    "public/cachet.png",
    "public/branding/cachet.png",
  ]);

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: COLORS.white });
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 134, width: PAGE_WIDTH, height: 134, color: COLORS.accent });
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 150, width: PAGE_WIDTH, height: 16, color: COLORS.accentSoft });

  if (logo) {
    const scaled = (logo as PDFImage).scale(0.24);
    page.drawImage(logo, {
      x: CONTENT_LEFT,
      y: PAGE_HEIGHT - 88,
      width: Math.min(138, scaled.width),
      height: Math.min(58, scaled.height),
    });
  }

  page.drawText("THE BEST SARL", {
    x: 210,
    y: PAGE_HEIGHT - 54,
    size: 19,
    font: boldFont,
    color: COLORS.white,
  });
  page.drawText("Ordre de paiement", {
    x: 210,
    y: PAGE_HEIGHT - 80,
    size: 13,
    font: regularFont,
    color: COLORS.white,
  });
  page.drawText("Document de suivi financier et d'exécution", {
    x: 210,
    y: PAGE_HEIGHT - 99,
    size: 9.2,
    font: regularFont,
    color: COLORS.accentSoft,
  });

  const topCardsY = PAGE_HEIGHT - 176;
  const cardWidth = 161;
  drawCard(page, {
    x: CONTENT_LEFT,
    y: topCardsY,
    width: cardWidth,
    height: 72,
    label: "Référence",
    value: paymentOrder.code ?? `TB-OP-${paymentOrder.id.slice(0, 8).toUpperCase()}`,
    regularFont,
    boldFont,
  });
  drawCard(page, {
    x: CONTENT_LEFT + cardWidth + 12,
    y: topCardsY,
    width: cardWidth,
    height: 72,
    label: "Statut",
    value: statusLabel(paymentOrder.status),
    regularFont,
    boldFont,
  });
  drawCard(page, {
    x: CONTENT_LEFT + ((cardWidth + 12) * 2),
    y: topCardsY,
    width: cardWidth,
    height: 72,
    label: "Montant",
    value: formatAmount(paymentOrder.amount, paymentOrder.currency),
    regularFont,
    boldFont,
  });

  const columnGap = 16;
  const columnWidth = (CONTENT_RIGHT - CONTENT_LEFT - columnGap) / 2;
  const panelY = PAGE_HEIGHT - 272;

  drawInfoGrid(page, {
    x: CONTENT_LEFT,
    y: panelY,
    width: columnWidth,
    title: "Bénéficiaire et motif",
    rows: [
      { label: "Bénéficiaire", value: paymentOrder.beneficiary || "-" },
      { label: "Motif", value: paymentOrder.purpose || "-" },
      { label: "Affectation", value: workflowAssignmentLabel(paymentOrder.assignment) },
      { label: "Monnaie", value: normalizeMoneyCurrency(paymentOrder.currency) },
    ],
    regularFont,
    boldFont,
  });

  drawInfoGrid(page, {
    x: CONTENT_LEFT + columnWidth + columnGap,
    y: panelY,
    width: columnWidth,
    title: "Circuit de validation",
    rows: [
      {
        label: "Émis par",
        value: paymentOrder.issuedBy?.name ? `${paymentOrder.issuedBy.name} (${paymentOrder.issuedBy.jobTitle})` : "-",
      },
      { label: "Soumis le", value: formatDate(paymentOrder.submittedAt) },
      {
        label: "Validé par",
        value: paymentOrder.approvedBy?.name ? `${paymentOrder.approvedBy.name} (${paymentOrder.approvedBy.jobTitle})` : "-",
      },
      {
        label: "Exécuté par",
        value: paymentOrder.executedBy?.name ? `${paymentOrder.executedBy.name} (${paymentOrder.executedBy.jobTitle})` : "-",
      },
    ],
    regularFont,
    boldFont,
  });

  let y = PAGE_HEIGHT - 446;
  const detailsHeight = drawTextPanel(page, {
    x: CONTENT_LEFT,
    y,
    width: CONTENT_RIGHT - CONTENT_LEFT,
    title: "Description détaillée",
    text: paymentOrder.description || "-",
    regularFont,
    boldFont,
  });

  y -= detailsHeight + 16;
  const reviewText = [
    paymentOrder.reviewComment?.trim() || "Aucun commentaire enregistré.",
    `Approuvé le: ${formatDate(paymentOrder.approvedAt)}`,
    `Exécuté le: ${formatDate(paymentOrder.executedAt)}`,
  ].join(". ");

  const commentsHeight = drawTextPanel(page, {
    x: CONTENT_LEFT,
    y,
    width: CONTENT_RIGHT - CONTENT_LEFT,
    title: "Commentaires et traçabilité",
    text: reviewText,
    regularFont,
    boldFont,
  });

  const approvalBandY = y - commentsHeight - 18;
  page.drawRectangle({
    x: CONTENT_LEFT,
    y: approvalBandY - 74,
    width: CONTENT_RIGHT - CONTENT_LEFT,
    height: 74,
    color: COLORS.accentSoft,
    borderColor: COLORS.line,
    borderWidth: 1,
  });
  drawBlockTitle(page, boldFont, "Visa interne", CONTENT_LEFT + 16, approvalBandY - 18);
  page.drawText(`Date d'impression: ${formatDate(new Date())}`, {
    x: CONTENT_LEFT + 16,
    y: approvalBandY - 42,
    size: 9.2,
    font: regularFont,
    color: COLORS.ink,
  });
  page.drawText(`Généré par: ${access.session.user.name}`, {
    x: CONTENT_LEFT + 16,
    y: approvalBandY - 56,
    size: 9.2,
    font: regularFont,
    color: COLORS.ink,
  });

  if ((paymentOrder.status === "APPROVED" || paymentOrder.status === "EXECUTED") && stamp) {
    page.drawImage(stamp, {
      x: CONTENT_RIGHT - 108,
      y: approvalBandY - 72,
      width: 82,
      height: 82,
      opacity: 0.92,
    });
  }

  page.drawLine({
    start: { x: CONTENT_LEFT, y: 28 },
    end: { x: CONTENT_RIGHT, y: 28 },
    thickness: 0.8,
    color: COLORS.line,
  });
  page.drawText(`Document OP • ${paymentOrder.code ?? id}`, {
    x: CONTENT_LEFT,
    y: FOOTER_Y,
    size: 8.2,
    font: regularFont,
    color: COLORS.muted,
  });

  const pageText = `Page 1/1 • ${statusLabel(paymentOrder.status)}`;
  const pageTextWidth = regularFont.widthOfTextAtSize(pageText, 8.2);
  page.drawText(pageText, {
    x: CONTENT_RIGHT - pageTextWidth,
    y: FOOTER_Y,
    size: 8.2,
    font: regularFont,
    color: COLORS.muted,
  });

  const bytes = await pdf.save();
  const body = Buffer.from(bytes);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="ordre-paiement-${paymentOrder.code ?? id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
