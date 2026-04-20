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
  accent: rgb(0.09, 0.23, 0.39),
  accentSoft: rgb(0.89, 0.94, 0.98),
  white: rgb(1, 1, 1),
  zebra: rgb(0.985, 0.989, 0.995),
};

function formatDate(value: Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function formatAmount(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function statusLabel(status: string, reviewComment?: string | null) {
  if (status === "APPROVED" && (reviewComment ?? "").includes("EXECUTION_CAISSE:")) return "APPROUVÉ ET EXÉCUTÉ";
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

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = (text || "-").replace(/\s+/g, " ").trim().split(" ");
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
      if (candidate.toLowerCase().endsWith(".jpg") || candidate.toLowerCase().endsWith(".jpeg")) {
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
  const maiandra = await readFirstExistingFile(["public/fonts/MAIAN.TTF", "public/branding/fonts/MAIAN.TTF"]);
  if (maiandra) {
    const f = await pdf.embedFont(maiandra);
    return { regular: f, bold: f };
  }
  return {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
}

function drawHeader(page: PDFPage, bold: PDFFont, regular: PDFFont, logo: PDFImage | null) {
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

  page.drawText("THE BEST SARL", { x: 194, y: PAGE_HEIGHT - 54, size: 19, font: bold, color: COLORS.white });
  page.drawText("État de besoin - approvisionnement", { x: 194, y: PAGE_HEIGHT - 80, size: 13, font: regular, color: COLORS.white });
  page.drawText("Document de synthèse pour validation et exécution", { x: 194, y: PAGE_HEIGHT - 99, size: 9.2, font: regular, color: COLORS.accentSoft });
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id: routeId } = await context.params;
    const id = routeId?.trim() || req.nextUrl.searchParams.get("id")?.trim() || undefined;
    const code = req.nextUrl.searchParams.get("code")?.trim() || undefined;

    if (!id && !code) {
      return NextResponse.json({ error: "Identifiant EDB manquant." }, { status: 400 });
    }

    const need = await prisma.needRequest.findUnique({
      where: id ? { id } : { code },
      include: { requester: true, reviewedBy: true },
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
    const totalGeneral = quote?.totalGeneral ?? need.estimatedAmount ?? articles.reduce((s, a) => s + (a.lineTotal ?? 0), 0);

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const fonts = await loadFonts(pdf);
    const logo = await embedOptionalImage(pdf, ["public/logo thebest.png", "public/branding/logo thebest.png", "public/logo.png", "public/branding/logo.png"]);
    const stamp = await embedOptionalImage(pdf, ["public/cachet.png", "public/branding/cachet.png"]);
    const signature = await embedOptionalImage(pdf, ["public/signature.png", "public/branding/signature.png"]);
    const showApprovalAssets = need.status === "APPROVED";

    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page, fonts.bold, fonts.regular, logo);

    page.drawText(`Référence: ${need.code ?? need.id}`, { x: LEFT, y: PAGE_HEIGHT - 178, size: 10, font: fonts.bold, color: COLORS.ink });
    page.drawText(`Statut: ${statusLabel(need.status, need.reviewComment)}`, { x: LEFT + 190, y: PAGE_HEIGHT - 178, size: 10, font: fonts.bold, color: COLORS.ink });
    page.drawText(`Montant: ${formatAmount(totalGeneral)} ${need.currency ?? "CDF"}`, { x: LEFT + 360, y: PAGE_HEIGHT - 178, size: 10, font: fonts.bold, color: COLORS.ink });

    page.drawText("Articles demandés", { x: LEFT, y: PAGE_HEIGHT - 210, size: 12, font: fonts.bold, color: COLORS.accent });
    page.drawRectangle({ x: LEFT, y: PAGE_HEIGHT - 232, width: RIGHT - LEFT, height: 20, color: COLORS.accentSoft });
    page.drawText("Désignation", { x: LEFT + 8, y: PAGE_HEIGHT - 225, size: 8.5, font: fonts.bold, color: COLORS.accent });
    page.drawText("Description", { x: LEFT + 170, y: PAGE_HEIGHT - 225, size: 8.5, font: fonts.bold, color: COLORS.accent });
    page.drawText("Qté", { x: LEFT + 370, y: PAGE_HEIGHT - 225, size: 8.5, font: fonts.bold, color: COLORS.accent });
    page.drawText("P.U", { x: LEFT + 410, y: PAGE_HEIGHT - 225, size: 8.5, font: fonts.bold, color: COLORS.accent });
    page.drawText("Total", { x: LEFT + 468, y: PAGE_HEIGHT - 225, size: 8.5, font: fonts.bold, color: COLORS.accent });

    let y = PAGE_HEIGHT - 246;
    for (let i = 0; i < articles.length && y > 170; i += 1) {
      const a = articles[i];
      if (i % 2 === 0) {
        page.drawRectangle({ x: LEFT, y: y - 18, width: RIGHT - LEFT, height: 18, color: COLORS.zebra });
      }
      const designationLines = wrapText(a.designation, fonts.regular, 8.6, 150);
      const descriptionLines = wrapText(a.description || "-", fonts.regular, 8.6, 190);
      page.drawText(designationLines[0] ?? "-", { x: LEFT + 8, y: y - 12, size: 8.6, font: fonts.regular, color: COLORS.ink });
      page.drawText(descriptionLines[0] ?? "-", { x: LEFT + 170, y: y - 12, size: 8.6, font: fonts.regular, color: COLORS.ink });
      page.drawText(String(a.quantity), { x: LEFT + 370, y: y - 12, size: 8.6, font: fonts.regular, color: COLORS.ink });
      page.drawText(formatAmount(a.unitPrice), { x: LEFT + 410, y: y - 12, size: 8.6, font: fonts.regular, color: COLORS.ink });
      page.drawText(formatAmount(a.lineTotal), { x: LEFT + 468, y: y - 12, size: 8.6, font: fonts.regular, color: COLORS.ink });
      y -= 18;
    }

    page.drawRectangle({ x: LEFT, y: 132, width: RIGHT - LEFT, height: 42, color: COLORS.accentSoft });
    page.drawText(`Total général: ${formatAmount(totalGeneral)} ${need.currency ?? "CDF"}`, { x: LEFT + 10, y: 148, size: 12, font: fonts.bold, color: COLORS.ink });

    const reviewComment = (need.reviewComment ?? "-").trim() || "-";
    const assignment = workflowAssignmentLabel(quote?.assignment);
    page.drawText(`Affectation: ${assignment}`, { x: LEFT, y: 112, size: 9, font: fonts.regular, color: COLORS.muted });
    page.drawText(`Demandeur: ${need.requester?.name ?? "-"}`, { x: LEFT, y: 98, size: 9, font: fonts.regular, color: COLORS.muted });
    page.drawText(`Validation: ${need.reviewedBy?.name ?? "-"} (${formatDate(need.approvedAt ?? need.reviewedAt)})`, { x: LEFT, y: 84, size: 9, font: fonts.regular, color: COLORS.muted });
    page.drawText(`Commentaire: ${reviewComment}`, { x: LEFT, y: 70, size: 9, font: fonts.regular, color: COLORS.muted });

    if (showApprovalAssets && signature) {
      page.drawImage(signature, { x: RIGHT - 150, y: 84, width: 62, height: 24 });
    }
    if (showApprovalAssets && stamp) {
      page.drawImage(stamp, { x: RIGHT - 96, y: 64, width: 72, height: 72, opacity: 0.92 });
    }

    page.drawLine({ start: { x: LEFT, y: 28 }, end: { x: RIGHT, y: 28 }, thickness: 0.8, color: COLORS.line });
    page.drawText(`EDB • Imprimé le ${formatDate(new Date())}`, { x: LEFT, y: 16, size: 8, font: fonts.regular, color: COLORS.muted });

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
    return NextResponse.json({ error: "Erreur génération PDF", details: String(e) }, { status: 500 });
  }
}
