import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFImage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const CONTENT_LEFT = 38;
const CONTENT_RIGHT = 557;
const FOOTER_Y = 14;

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
  const bytes = await readFirstExistingFile(candidates);
  if (!bytes) return null;

  const lower = candidates[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return pdf.embedJpg(bytes);
  return pdf.embedPng(bytes);
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

function paymentOrderAssignmentLabel(value: string | null | undefined) {
  const normalized = (value ?? "A_MON_COMPTE").trim().toUpperCase();
  if (normalized === "VISAS") return "Visas";
  if (normalized === "SAFETY") return "Safety";
  if (normalized === "BILLETTERIE") return "THE BEST";
  if (normalized === "TSL") return "TSL";
  return "À mon compte";
}

function wrapTextByWidth(text: string, maxWidth: number, font: import("pdf-lib").PDFFont, fontSize: number) {
  const normalized = (text || "-").trim() || "-";
  const words = normalized.split(/\s+/);
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

  const montserratRegular = await readFirstExistingFile([
    "public/fonts/Montserrat-Regular.ttf",
    "public/branding/fonts/Montserrat-Regular.ttf",
  ]);

  if (!montserratRegular) {
    return NextResponse.json({ error: "Police Montserrat Regular introuvable sur le serveur." }, { status: 500 });
  }

  const regularFont = await pdf.embedFont(montserratRegular);
  const boldFont = regularFont;
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
  const black = rgb(0, 0, 0);
  const grid = rgb(0.82, 0.82, 0.82);

  if (logo) {
    const logoScaled = logo.scale(0.26);
    page.drawImage(logo, {
      x: 38,
      y: 744,
      width: Math.min(170, logoScaled.width),
      height: Math.min(70, logoScaled.height),
    });
  }

  page.drawText("THE BEST SARL", {
    x: 220,
    y: 785,
    size: 16,
    font: boldFont,
    color: black,
  });

  page.drawText("ORDRE DE PAIEMENT", {
    x: 220,
    y: 765,
    size: 11,
    font: boldFont,
    color: black,
  });

  page.drawLine({
    start: { x: CONTENT_LEFT, y: 742 },
    end: { x: CONTENT_RIGHT, y: 742 },
    thickness: 1,
    color: rgb(0.84, 0.87, 0.95),
  });

  let y = 712;

  const drawLine = (label: string, value: string) => {
    const wrapped = wrapTextByWidth(value, CONTENT_RIGHT - 170, regularFont, 10.2);
    page.drawText(`${label}:`, {
      x: CONTENT_LEFT,
      y,
      size: 10.2,
      font: boldFont,
      color: black,
    });
    wrapped.forEach((line, index) => {
      page.drawText(line, {
        x: 170,
        y: y - (index * 12),
        size: 10.2,
        font: regularFont,
        color: black,
      });
    });
    y -= Math.max(16, wrapped.length * 12 + 4);
  };

  page.drawText(`Réf: ${paymentOrder.code ?? `TB-OP-${paymentOrder.id.slice(0, 8).toUpperCase()}`}`, {
    x: CONTENT_LEFT,
    y,
    size: 10.5,
    font: boldFont,
    color: black,
  });
  page.drawText(`Statut: ${paymentOrder.status}`, {
    x: 360,
    y,
    size: 10.5,
    font: boldFont,
    color: black,
  });
  y -= 18;

  page.drawLine({
    start: { x: CONTENT_LEFT, y: y + 6 },
    end: { x: CONTENT_RIGHT, y: y + 6 },
    thickness: 0.7,
    color: grid,
  });
  y -= 4;

  drawLine("Bénéficiaire", paymentOrder.beneficiary || "-");
  drawLine("Motif", paymentOrder.purpose || "-");
  drawLine("Affectation", paymentOrderAssignmentLabel(paymentOrder.assignment));
  drawLine("Montant", `${Number(paymentOrder.amount ?? 0).toFixed(2)} ${normalizeMoneyCurrency(paymentOrder.currency)}`);
  drawLine("Émis par", paymentOrder.issuedBy?.name ? `${paymentOrder.issuedBy.name} (${paymentOrder.issuedBy.jobTitle})` : "-");
  drawLine("Soumis le", formatDate(paymentOrder.submittedAt));
  drawLine("Validé par", paymentOrder.approvedBy?.name ? `${paymentOrder.approvedBy.name} (${paymentOrder.approvedBy.jobTitle})` : "-");
  drawLine("Date validation", formatDate(paymentOrder.approvedAt));
  drawLine("Exécuté par", paymentOrder.executedBy?.name ? `${paymentOrder.executedBy.name} (${paymentOrder.executedBy.jobTitle})` : "-");
  drawLine("Date exécution", formatDate(paymentOrder.executedAt));

  y -= 4;
  page.drawText("Description détaillée:", {
    x: CONTENT_LEFT,
    y,
    size: 10.8,
    font: boldFont,
    color: black,
  });
  y -= 16;

  const descriptionLines = wrapTextByWidth(paymentOrder.description || "-", CONTENT_RIGHT - CONTENT_LEFT, regularFont, 10);
  descriptionLines.forEach((line) => {
    page.drawText(line, {
      x: CONTENT_LEFT,
      y,
      size: 10,
      font: regularFont,
      color: black,
    });
    y -= 12;
  });

  y -= 8;
  page.drawText("Circuit / commentaires:", {
    x: CONTENT_LEFT,
    y,
    size: 10.8,
    font: boldFont,
    color: black,
  });
  y -= 16;

  const commentLines = wrapTextByWidth(paymentOrder.reviewComment || "-", CONTENT_RIGHT - CONTENT_LEFT, regularFont, 9.6);
  commentLines.forEach((line) => {
    page.drawText(line, {
      x: CONTENT_LEFT,
      y,
      size: 9.6,
      font: regularFont,
      color: black,
    });
    y -= 11;
  });

  if ((paymentOrder.status === "APPROVED" || paymentOrder.status === "EXECUTED") && stamp) {
    page.drawImage(stamp, {
      x: 450,
      y: 45,
      width: 85,
      height: 85,
      opacity: 0.95,
    });
  }

  page.drawLine({
    start: { x: CONTENT_LEFT, y: 22 },
    end: { x: CONTENT_RIGHT, y: 22 },
    thickness: 0.6,
    color: rgb(0.83, 0.83, 0.83),
  });

  page.drawText(`Document OP • Imprimé le ${formatDate(new Date())}`, {
    x: CONTENT_LEFT,
    y: FOOTER_Y,
    size: 8.2,
    font: boldFont,
    color: black,
  });

  const byText = `Par ${access.session.user.name}`;
  const byWidth = boldFont.widthOfTextAtSize(byText, 8.2);
  page.drawText(byText, {
    x: CONTENT_RIGHT - byWidth,
    y: FOOTER_Y,
    size: 8.2,
    font: boldFont,
    color: black,
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
