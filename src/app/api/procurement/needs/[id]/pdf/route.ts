import path from "node:path";
import { NextResponse, NextRequest } from "next/server";
import { PDFDocument, PDFFont, PDFImage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import { parseNeedQuote } from "@/lib/need-lines";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 42;
const RIGHT = 553;
const LABEL_WIDTH = 102;
const VALUE_X = LEFT + LABEL_WIDTH;
const RIGHT_COLUMN_X = 392;
const LIGHT = rgb(0.82, 0.85, 0.9);
const TEXT = rgb(0.18, 0.2, 0.23);
const MUTED = rgb(0.45, 0.48, 0.53);

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

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const content = (text || "-").replace(/\s+/g, " ").trim() || "-";
  const words = content.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : ["-"];
}

function drawWrappedText(page: import("pdf-lib").PDFPage, text: string, options: {
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
      color: options.color ?? TEXT,
    });
  });
  return lines.length * lineHeight;
}

function drawInfoRow(page: import("pdf-lib").PDFPage, label: string, value: string, y: number, font: PDFFont, maxWidth = 230) {
  page.drawText(label, { x: LEFT, y, size: 8.8, font, color: MUTED });
  const consumed = drawWrappedText(page, value, {
    x: VALUE_X,
    y,
    font,
    size: 8.8,
    maxWidth,
    color: TEXT,
    lineHeight: 10.5,
  });
  return Math.max(12, consumed);
}

function embedOptionalImage(pdf: PDFDocument, relativePath: string, type: "png" | "jpg" = "png") {
  try {
    const bytes = fs.readFileSync(path.join(process.cwd(), relativePath));
    return type === "jpg" ? pdf.embedJpg(bytes) : pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

async function drawOptionalImage(page: import("pdf-lib").PDFPage, imagePromise: Promise<PDFImage | null> | null, options: { x: number; y: number; width: number; height: number }) {
  if (!imagePromise) return;
  const image = await imagePromise;
  if (!image) return;
  page.drawImage(image, options);
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id: routeId } = await context.params;
    const code = req.nextUrl.searchParams.get("code")?.trim() || undefined;
    const id = routeId?.trim() || req.nextUrl.searchParams.get("id")?.trim() || undefined;

    if (!id && !code) {
      return NextResponse.json(
        { error: "Identifiant EDB manquant." },
        { status: 400 },
      );
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
      : [{ designation: need.title ?? "-", description: need.details ?? "-", quantity: need.quantity ?? 1, unitPrice: need.estimatedAmount ?? 0, lineTotal: need.estimatedAmount ?? 0 }];
    const totalGeneral = quote?.totalGeneral ?? need.estimatedAmount ?? articles.reduce((sum, article) => sum + (article.lineTotal ?? 0), 0);
    const reviewComment = (need.reviewComment ?? "-").trim() || "-";
    const printedAt = formatDate(new Date());

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const montserratRegular = fs.readFileSync(path.join(process.cwd(), "public/fonts/Montserrat-Regular.ttf"));
    const montserratBold = fs.readFileSync(path.join(process.cwd(), "public/fonts/Montserrat-Bold.ttf"));
    const font = await pdf.embedFont(montserratRegular);
    const fontBold = await pdf.embedFont(montserratBold);
    const logoPromise = embedOptionalImage(pdf, "public/logo thebest.png");
    const stampPromise = embedOptionalImage(pdf, "public/cachet.png");
    const signaturePromise = embedOptionalImage(pdf, "public/signature.png");

    let y = 786;

    await drawOptionalImage(page, logoPromise, { x: LEFT, y: 770, width: 95, height: 42 });
    page.drawText("THE BEST SARL", { x: 205, y: 792, size: 14, font: fontBold, color: TEXT });
    page.drawText("ETAT DE BESOIN - APPROVISIONNEMENT", { x: 205, y: 772, size: 10.5, font, color: MUTED });
    page.drawLine({ start: { x: LEFT, y: 750 }, end: { x: RIGHT, y: 750 }, thickness: 0.8, color: LIGHT });
    y = 722;

    page.drawText(`Réf: ${need.code ?? need.id}`, { x: LEFT, y, size: 9.5, font, color: MUTED });
    page.drawText(`Statut: ${statusLabel(need.status, need.reviewComment)}`, { x: RIGHT_COLUMN_X, y, size: 9.5, font, color: MUTED });
    page.drawLine({ start: { x: LEFT, y: y - 8 }, end: { x: RIGHT, y: y - 8 }, thickness: 0.7, color: LIGHT });
    y -= 24;

    y -= drawInfoRow(page, "Objet:", need.title ?? "-", y, font, 240) - 2;
    y -= drawInfoRow(page, "Quantité:", `${need.quantity ?? "-"} ${need.unit ?? ""}`.trim(), y, font, 240) - 2;
    y -= drawInfoRow(page, "Montant estimatif:", `${formatAmount(need.estimatedAmount)} ${need.currency ?? ""}`.trim(), y, font, 240) - 2;
    y -= drawInfoRow(page, "Demandeur:", `${need.requester?.name ?? "-"} (${need.requester?.jobTitle ?? "-"})`, y, font, 240) - 2;
    y -= drawInfoRow(page, "Soumis le:", formatDate(need.submittedAt), y, font, 240) - 2;
    y -= drawInfoRow(page, "Validé par:", need.reviewedBy?.name ?? "-", y, font, 240) - 2;
    y -= drawInfoRow(page, "Date validation:", formatDate(need.approvedAt ?? need.reviewedAt), y, font, 240) - 2;
    y -= drawInfoRow(page, "Exécution:", executionLabel(need.status, need.reviewComment), y, font, 240) - 2;
    y -= drawInfoRow(page, "Niveau d'urgence:", urgencyLabel(quote?.urgencyLevel), y, font, 240) - 2;
    y -= drawInfoRow(page, "Équipe bénéficiaire:", beneficiaryLabel(quote?.beneficiaryTeam), y, font, 240) - 2;
    if (quote?.beneficiaryPersonName) {
      y -= drawInfoRow(page, "Bénéficiaire:", quote.beneficiaryPersonName, y, font, 240) - 2;
    }

    y -= 14;
    page.drawText("Articles demandés:", { x: LEFT, y, size: 10.5, font: fontBold, color: TEXT });
    y -= 18;

    const tableTop = y;
    const colNo = LEFT;
    const colDesignation = LEFT + 32;
    const colDescription = LEFT + 155;
    const colQuantity = LEFT + 347;
    const colUnitPrice = LEFT + 402;
    const colTotal = LEFT + 466;

    page.drawText("N°", { x: colNo, y: tableTop, size: 8.5, font, color: MUTED });
    page.drawText("Désignation", { x: colDesignation, y: tableTop, size: 8.5, font, color: MUTED });
    page.drawText("Description", { x: colDescription, y: tableTop, size: 8.5, font, color: MUTED });
    page.drawText("Qté", { x: colQuantity, y: tableTop, size: 8.5, font, color: MUTED });
    page.drawText("P.U", { x: colUnitPrice, y: tableTop, size: 8.5, font, color: MUTED });
    page.drawText("P.T", { x: colTotal, y: tableTop, size: 8.5, font, color: MUTED });
    page.drawLine({ start: { x: LEFT, y: tableTop - 8 }, end: { x: RIGHT, y: tableTop - 8 }, thickness: 0.7, color: LIGHT });

    y = tableTop - 20;
    articles.forEach((article, index) => {
      const designationHeight = drawWrappedText(page, article.designation, {
        x: colDesignation,
        y,
        font,
        size: 8.8,
        maxWidth: 110,
        color: MUTED,
        lineHeight: 10,
      });
      const descriptionHeight = drawWrappedText(page, article.description || "-", {
        x: colDescription,
        y,
        font,
        size: 8.8,
        maxWidth: 155,
        color: MUTED,
        lineHeight: 10,
      });
      const rowHeight = Math.max(18, designationHeight, descriptionHeight);

      page.drawText(String(index + 1), { x: colNo, y, size: 8.8, font, color: MUTED });
      page.drawText(String(article.quantity), { x: colQuantity, y, size: 8.8, font, color: MUTED });
      page.drawText(formatAmount(article.unitPrice), { x: colUnitPrice, y, size: 8.8, font, color: MUTED });
      page.drawText(formatAmount(article.lineTotal), { x: colTotal, y, size: 8.8, font, color: MUTED });
      y -= rowHeight;
    });

    page.drawLine({ start: { x: LEFT, y: y + 6 }, end: { x: RIGHT, y: y + 6 }, thickness: 0.7, color: LIGHT });
    page.drawText(`Total général: ${formatAmount(totalGeneral)} ${need.currency ?? "CDF"}`, {
      x: 340,
      y: y - 10,
      size: 10,
      font,
      color: MUTED,
    });

    const footerLineY = 116;
    page.drawLine({ start: { x: LEFT, y: footerLineY }, end: { x: RIGHT, y: footerLineY }, thickness: 0.7, color: LIGHT });
    page.drawText("Validation Direction / Finance", { x: LEFT, y: footerLineY - 12, size: 9, font, color: MUTED });
    drawWrappedText(page, `Commentaire: ${reviewComment}`, {
      x: LEFT,
      y: footerLineY - 30,
      font,
      size: 8.4,
      maxWidth: 385,
      color: MUTED,
      lineHeight: 10,
    });

    page.drawText(`Document scellé le ${need.sealedAt ? formatDate(need.sealedAt) : printedAt}`, {
      x: LEFT,
      y: 64,
      size: 7.8,
      font,
      color: MUTED,
    });
    page.drawText(`Mention finale: ${statusLabel(need.status, need.reviewComment)} (${printedAt})`, {
      x: LEFT,
      y: 52,
      size: 7.6,
      font,
      color: MUTED,
    });
    page.drawText(`Page 1/1 · Imprimé le ${printedAt}`, {
      x: LEFT,
      y: 40,
      size: 7.6,
      font,
      color: MUTED,
    });

    await drawOptionalImage(page, signaturePromise, { x: 405, y: 56, width: 64, height: 26 });
    await drawOptionalImage(page, stampPromise, { x: 438, y: 20, width: 70, height: 70 });
    page.drawText(`Par ${need.reviewedBy?.name ?? "-"}`, {
      x: 470,
      y: 34,
      size: 8,
      font,
      color: MUTED,
    });

    const bytes = await pdf.save();
    const body = Buffer.from(bytes);
    return new NextResponse(body, {
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
      { status: 500 }
    );
  }
}
