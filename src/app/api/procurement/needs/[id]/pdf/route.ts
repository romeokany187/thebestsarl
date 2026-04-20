import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { parseNeedQuote } from "@/lib/need-lines";
import { prisma } from "@/lib/prisma";
import { workflowAssignmentLabel } from "@/lib/workflow-assignment";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 38;
const RIGHT = 557;

const COLORS = {
  ink: rgb(0.12, 0.16, 0.21),
  muted: rgb(0.43, 0.47, 0.54),
  line: rgb(0.84, 0.88, 0.93),
  panel: rgb(0.96, 0.97, 0.99),
  accent: rgb(0.09, 0.23, 0.39),
  accentSoft: rgb(0.89, 0.94, 0.98),
  white: rgb(1, 1, 1),
  zebra: rgb(0.985, 0.989, 0.995),
};

function formatDate(value: Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatAmount(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function urgencyLabel(value?: string) {
  if (value === "CRITIQUE") return "Critique";
  if (value === "ELEVEE") return "Élevée";
  if (value === "NORMALE") return "Normale";
  if (value === "FAIBLE") return "Faible";
  return "-";
}

function beneficiaryLabel(value?: string) {
  if (value === "KINSHASA") return "Kinshasa";
  if (value === "LUBUMBASHI") return "Lubumbashi";
  if (value === "MBUJIMAYI") return "Mbujimayi";
  return "-";
}

function executionLabel(status: string, reviewComment?: string | null) {
  if ((reviewComment ?? "").includes("EXECUTION_CAISSE:")) {
    return "Exécuté (validation caisse enregistrée)";
  }
  if (status === "APPROVED") {
    return "Approuvé en attente d'exécution";
  }
  return "En attente d'exécution";
}

function statusLabel(status: string, reviewComment?: string | null) {
  if (status === "APPROVED" && (reviewComment ?? "").includes("EXECUTION_CAISSE:")) {
    return "APPROUVÉ ET EXÉCUTÉ";
  }
  if (status === "APPROVED") return "APPROUVÉ";
  if (status === "REJECTED") return "REJETÉ";
  if (status === "SUBMITTED") return "SOUMIS";
  return status;
}

function fallbackNeedDescription(details: string | null | undefined) {
  const normalized = (details ?? "").trim();
  if (!normalized) return "-";
  if (parseNeedQuote(normalized)) return "-";
  if ((normalized.startsWith("{") && normalized.endsWith("}")) || (normalized.startsWith("[") && normalized.endsWith("]"))) {
    return "-";
  }
  return normalized;
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

async function embedOptionalImage(pdf: PDFDocument, candidates: string[]): Promise<PDFImage | null> {
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
  const montserratBold = await readFirstExistingFile([
    "public/fonts/Montserrat-Bold.ttf",
    "public/branding/fonts/Montserrat-Bold.ttf",
  ]);
  if (montserratRegular) {
    return {
      regularFont: await pdf.embedFont(montserratRegular),
      boldFont: await pdf.embedFont(montserratBold ?? montserratRegular),
    };
  }

  return {
    regularFont: await pdf.embedFont(StandardFonts.Helvetica),
    boldFont: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const normalized = (text || "-").replace(/\s+/g, " ").trim() || "-";
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
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
      if (font.widthOfTextAtSize(nextPart, size) <= maxWidth) {
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

function drawWrappedText(page: PDFPage, text: string, options: {
  x: number;
  y: number;
  font: PDFFont;
  size: number;
  maxWidth: number;
  color?: ReturnType<typeof rgb>;
  lineHeight?: number;
}) {
  const lines = wrapText(text, options.font, options.size, options.maxWidth);
  const lineHeight = options.lineHeight ?? (options.size + 3);
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: options.x,
      y: options.y - (index * lineHeight),
      size: options.size,
      font: options.font,
      color: options.color ?? COLORS.ink,
    });
  });
  return lines.length * lineHeight;
}

function drawSectionTitle(page: PDFPage, font: PDFFont, title: string, x: number, y: number) {
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

  const lines = wrapText(options.value, options.regularFont, 11.7, options.width - 28);
  lines.slice(0, 2).forEach((line, index) => {
    page.drawText(line, {
      x: options.x + 14,
      y: options.y - 39 - (index * 14),
      size: 11.7,
      font: options.boldFont,
      color: COLORS.ink,
    });
  });
}

function drawInfoPanel(page: PDFPage, options: {
  x: number;
  y: number;
  width: number;
  title: string;
  rows: Array<{ label: string; value: string }>;
  regularFont: PDFFont;
  boldFont: PDFFont;
}) {
  const rowSpacing = 18;
  const height = 18 + 22 + (options.rows.length * rowSpacing) + 12;

  page.drawRectangle({
    x: options.x,
    y: options.y - height,
    width: options.width,
    height,
    color: COLORS.white,
    borderColor: COLORS.line,
    borderWidth: 1,
  });

  drawSectionTitle(page, options.boldFont, options.title, options.x + 16, options.y - 18);
  const labelWidth = 108;
  let cursorY = options.y - 42;

  options.rows.forEach((row) => {
    page.drawText(row.label, {
      x: options.x + 16,
      y: cursorY,
      size: 9,
      font: options.boldFont,
      color: COLORS.muted,
    });

    const textHeight = drawWrappedText(page, row.value, {
      x: options.x + labelWidth,
      y: cursorY,
      font: options.regularFont,
      size: 9.2,
      maxWidth: options.width - labelWidth - 18,
      lineHeight: 10.5,
      color: COLORS.ink,
    });

    cursorY -= Math.max(rowSpacing, textHeight + 4);
  });

  return height;
}

function drawTableHeader(page: PDFPage, y: number, boldFont: PDFFont) {
  const headerHeight = 24;
  page.drawRectangle({
    x: LEFT,
    y: y - headerHeight,
    width: RIGHT - LEFT,
    height: headerHeight,
    color: COLORS.accentSoft,
    borderColor: COLORS.line,
    borderWidth: 1,
  });

  const columns = [
    { label: "N°", x: LEFT + 8 },
    { label: "Désignation", x: LEFT + 34 },
    { label: "Description", x: LEFT + 154 },
    { label: "Qté", x: LEFT + 350 },
    { label: "P.U", x: LEFT + 395 },
    { label: "Total", x: LEFT + 457 },
  ];

  columns.forEach((column) => {
    page.drawText(column.label, {
      x: column.x,
      y: y - 15,
      size: 8.5,
      font: boldFont,
      color: COLORS.accent,
    });
  });

  return y - headerHeight - 10;
}

function drawArticleRow(page: PDFPage, options: {
  y: number;
  index: number;
  designation: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  regularFont: PDFFont;
}) {
  const designationLines = wrapText(options.designation, options.regularFont, 8.8, 110);
  const descriptionLines = wrapText(options.description || "-", options.regularFont, 8.8, 172);
  const rowLines = Math.max(designationLines.length, descriptionLines.length, 1);
  const rowHeight = Math.max(22, 10 + (rowLines * 11));

  if (options.index % 2 === 0) {
    page.drawRectangle({
      x: LEFT,
      y: options.y - rowHeight + 6,
      width: RIGHT - LEFT,
      height: rowHeight,
      color: COLORS.zebra,
    });
  }

  page.drawText(String(options.index + 1), {
    x: LEFT + 8,
    y: options.y - 10,
    size: 8.8,
    font: options.regularFont,
    color: COLORS.ink,
  });

  designationLines.forEach((line, lineIndex) => {
    page.drawText(line, {
      x: LEFT + 34,
      y: options.y - 10 - (lineIndex * 11),
      size: 8.8,
      font: options.regularFont,
      color: COLORS.ink,
    });
  });

  descriptionLines.forEach((line, lineIndex) => {
    page.drawText(line, {
      x: LEFT + 154,
      y: options.y - 10 - (lineIndex * 11),
      size: 8.8,
      font: options.regularFont,
      color: COLORS.ink,
    });
  });

  page.drawText(String(options.quantity), {
    x: LEFT + 350,
    y: options.y - 10,
    size: 8.8,
    font: options.regularFont,
    color: COLORS.ink,
  });
  page.drawText(formatAmount(options.unitPrice), {
    x: LEFT + 395,
    y: options.y - 10,
    size: 8.8,
    font: options.regularFont,
    color: COLORS.ink,
  });
  page.drawText(formatAmount(options.lineTotal), {
    x: LEFT + 457,
    y: options.y - 10,
    size: 8.8,
    font: options.regularFont,
    color: COLORS.ink,
  });

  page.drawLine({
    start: { x: LEFT, y: options.y - rowHeight + 4 },
    end: { x: RIGHT, y: options.y - rowHeight + 4 },
    thickness: 0.6,
    color: COLORS.line,
  });

  return options.y - rowHeight;
}

function drawFooter(page: PDFPage, options: {
  regularFont: PDFFont;
  pageNumber: number;
  totalPages: number;
  printedAt: string;
}) {
  page.drawLine({
    start: { x: LEFT, y: 28 },
    end: { x: RIGHT, y: 28 },
    thickness: 0.8,
    color: COLORS.line,
  });
  page.drawText(`EDB • Imprimé le ${options.printedAt}`, {
    x: LEFT,
    y: 16,
    size: 8,
    font: options.regularFont,
    color: COLORS.muted,
  });

  const pageText = `Page ${options.pageNumber}/${options.totalPages}`;
  const width = options.regularFont.widthOfTextAtSize(pageText, 8);
  page.drawText(pageText, {
    x: RIGHT - width,
    y: 16,
    size: 8,
    font: options.regularFont,
    color: COLORS.muted,
  });
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id: routeId } = await context.params;
    const code = req.nextUrl.searchParams.get("code")?.trim() || undefined;
    const id = routeId?.trim() || req.nextUrl.searchParams.get("id")?.trim() || undefined;

    if (!id && !code) {
      return NextResponse.json({ error: "Identifiant EDB manquant." }, { status: 400 });
    }

    const need = await prisma.needRequest.findUnique({
      where: id ? { id } : { code },
      include: {
        requester: true,
        reviewedBy: true,
      },
    });
    if (!need) {
      return NextResponse.json({ error: "État de besoin introuvable." }, { status: 404 });
    }

    const quote = parseNeedQuote(need.details);
    const articles = quote?.items?.length
      ? quote.items
      : [{
          designation: need.title ?? "-",
          description: fallbackNeedDescription(need.details),
          quantity: need.quantity ?? 1,
          unitPrice: need.estimatedAmount ?? 0,
          lineTotal: need.estimatedAmount ?? 0,
        }];
    const totalGeneral = quote?.totalGeneral ?? need.estimatedAmount ?? articles.reduce((sum, article) => sum + (article.lineTotal ?? 0), 0);
    const reviewComment = (need.reviewComment ?? "-").trim() || "-";
    const printedAt = formatDate(new Date());
    const showApprovalAssets = need.status === "APPROVED";

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
    const signature = await embedOptionalImage(pdf, [
      "public/signature.png",
      "public/branding/signature.png",
    ]);

    const pages: PDFPage[] = [];
    const newPage = () => {
      const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: COLORS.white });
      page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 134, width: PAGE_WIDTH, height: 134, color: COLORS.accent });
      page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 150, width: PAGE_WIDTH, height: 16, color: COLORS.accentSoft });

      if (logo) {
        page.drawCircle({
          x: LEFT + 34,
          y: PAGE_HEIGHT - 60,
          size: 30,
          color: COLORS.white,
          borderColor: COLORS.accentSoft,
          borderWidth: 1.4,
          opacity: 0.98,
        });
        const scaled = logo.scale(0.18);
        page.drawImage(logo, {
          x: LEFT + 8,
          y: PAGE_HEIGHT - 86,
          width: Math.min(52, scaled.width),
          height: Math.min(52, scaled.height),
        });
      }

      page.drawText("THE BEST SARL", {
        x: 194,
        y: PAGE_HEIGHT - 54,
        size: 19,
        font: boldFont,
        color: COLORS.white,
      });
      page.drawText("État de besoin - approvisionnement", {
        x: 194,
        y: PAGE_HEIGHT - 80,
        size: 13,
        font: regularFont,
        color: COLORS.white,
      });
      page.drawText("Document de synthèse pour validation et exécution", {
        x: 194,
        y: PAGE_HEIGHT - 99,
        size: 9.2,
        font: regularFont,
        color: COLORS.accentSoft,
      });

      pages.push(page);
      return page;
    };

    const firstPage = newPage();
    const topCardsY = PAGE_HEIGHT - 176;
    const cardWidth = 161;
    drawCard(firstPage, {
      x: LEFT,
      y: topCardsY,
      width: cardWidth,
      height: 72,
      label: "Référence",
      value: need.code ?? need.id,
      regularFont,
      boldFont,
    });
    drawCard(firstPage, {
      x: LEFT + cardWidth + 12,
      y: topCardsY,
      width: cardWidth,
      height: 72,
      label: "Statut",
      value: statusLabel(need.status, need.reviewComment),
      regularFont,
      boldFont,
    });
    drawCard(firstPage, {
      x: LEFT + ((cardWidth + 12) * 2),
      y: topCardsY,
      width: cardWidth,
      height: 72,
      label: "Montant total",
      value: `${formatAmount(totalGeneral)} ${need.currency ?? "CDF"}`,
      regularFont,
      boldFont,
    });

    const columnGap = 16;
    const columnWidth = (RIGHT - LEFT - columnGap) / 2;
    const infoY = PAGE_HEIGHT - 272;

    drawInfoPanel(firstPage, {
      x: LEFT,
      y: infoY,
      width: columnWidth,
      title: "Résumé de la demande",
      rows: [
        { label: "Objet", value: need.title ?? "-" },
        { label: "Quantité", value: `${need.quantity ?? "-"} ${need.unit ?? ""}`.trim() || "-" },
        { label: "Urgence", value: urgencyLabel(quote?.urgencyLevel) },
        { label: "Affectation", value: workflowAssignmentLabel(quote?.assignment) },
        { label: "Équipe", value: beneficiaryLabel(quote?.beneficiaryTeam) },
      ],
      regularFont,
      boldFont,
    });

    drawInfoPanel(firstPage, {
      x: LEFT + columnWidth + columnGap,
      y: infoY,
      width: columnWidth,
      title: "Suivi de validation",
      rows: [
        { label: "Demandeur", value: `${need.requester?.name ?? "-"} (${need.requester?.jobTitle ?? "-"})` },
        { label: "Soumis le", value: formatDate(need.submittedAt) },
        { label: "Validé par", value: need.reviewedBy?.name ?? "-" },
        { label: "Date validation", value: formatDate(need.approvedAt ?? need.reviewedAt) },
        { label: "Exécution", value: executionLabel(need.status, need.reviewComment) },
      ],
      regularFont,
      boldFont,
    });

    drawSectionTitle(firstPage, boldFont, "Articles demandés", LEFT, PAGE_HEIGHT - 468);
    let currentPage = firstPage;
    let currentY = drawTableHeader(firstPage, PAGE_HEIGHT - 482, boldFont);

    articles.forEach((article, index) => {
      const designationLines = wrapText(article.designation, regularFont, 8.8, 110);
      const descriptionLines = wrapText(article.description || "-", regularFont, 8.8, 172);
      const estimatedHeight = Math.max(22, 10 + (Math.max(designationLines.length, descriptionLines.length, 1) * 11));

      if (currentY - estimatedHeight < 150) {
        currentPage = newPage();
        drawSectionTitle(currentPage, boldFont, "Articles demandés (suite)", LEFT, PAGE_HEIGHT - 176);
        currentY = drawTableHeader(currentPage, PAGE_HEIGHT - 192, boldFont);
      }

      currentY = drawArticleRow(currentPage, {
        y: currentY,
        index,
        designation: article.designation,
        description: article.description,
        quantity: article.quantity,
        unitPrice: article.unitPrice,
        lineTotal: article.lineTotal,
        regularFont,
      });
    });

    if (currentY < 162) {
      currentPage = newPage();
      currentY = PAGE_HEIGHT - 182;
    }

    currentPage.drawRectangle({
      x: LEFT,
      y: currentY - 74,
      width: RIGHT - LEFT,
      height: 74,
      color: COLORS.accentSoft,
      borderColor: COLORS.line,
      borderWidth: 1,
    });
    drawSectionTitle(currentPage, boldFont, "Total général", LEFT + 16, currentY - 18);
    currentPage.drawText(`${formatAmount(totalGeneral)} ${need.currency ?? "CDF"}`, {
      x: LEFT + 16,
      y: currentY - 46,
      size: 15,
      font: boldFont,
      color: COLORS.ink,
    });

    if (currentY - 96 < 92) {
      currentPage = newPage();
      currentY = PAGE_HEIGHT - 182;
    } else {
      currentY -= 96;
    }

    const commentLines = wrapText(`Commentaire de validation: ${reviewComment}`, regularFont, 9.2, RIGHT - LEFT - 32);
    const noteHeight = Math.max(72, 28 + (commentLines.length * 12));
    currentPage.drawRectangle({
      x: LEFT,
      y: currentY - noteHeight,
      width: RIGHT - LEFT,
      height: noteHeight,
      color: COLORS.white,
      borderColor: COLORS.line,
      borderWidth: 1,
    });
    drawSectionTitle(currentPage, boldFont, "Validation finale", LEFT + 16, currentY - 18);
    commentLines.forEach((line, index) => {
      currentPage.drawText(line, {
        x: LEFT + 16,
        y: currentY - 44 - (index * 12),
        size: 9.2,
        font: regularFont,
        color: COLORS.ink,
      });
    });

    currentPage.drawText(`Document scellé le ${need.sealedAt ? formatDate(need.sealedAt) : printedAt}`, {
      x: LEFT + 16,
      y: currentY - noteHeight + 14,
      size: 8.5,
      font: regularFont,
      color: COLORS.muted,
    });

    if (showApprovalAssets && signature) {
      currentPage.drawImage(signature, {
        x: RIGHT - 148,
        y: currentY - noteHeight + 16,
        width: 62,
        height: 24,
      });
    }
    if (showApprovalAssets && stamp) {
      currentPage.drawImage(stamp, {
        x: RIGHT - 94,
        y: currentY - noteHeight + 2,
        width: 70,
        height: 70,
        opacity: 0.92,
      });
    }

    pages.forEach((page, index) => {
      drawFooter(page, {
        regularFont,
        pageNumber: index + 1,
        totalPages: pages.length,
        printedAt,
      });
    });

    const bytes = await pdf.save();
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename=etat-besoin-${need.code ?? id ?? "-"}.pdf`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Erreur génération PDF", details: String(e) },
      { status: 500 },
    );
  }
}
