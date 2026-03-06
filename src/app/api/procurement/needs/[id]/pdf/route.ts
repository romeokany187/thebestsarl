import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFImage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { parseNeedQuote } from "@/lib/need-lines";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

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

function getContainedSize(image: PDFImage, maxWidth: number, maxHeight: number, allowUpscale = false) {
  const base = image.scale(1);
  let ratio = Math.min(maxWidth / base.width, maxHeight / base.height);
  if (!allowUpscale) {
    ratio = Math.min(ratio, 1);
  }

  return {
    width: base.width * ratio,
    height: base.height * ratio,
  };
}

function formatDate(value: Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    if (access.error.status === 401) {
      const signInUrl = new URL("/auth/signin", request.url);
      signInUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(signInUrl);
    }
    return access.error;
  }

  const { id } = await context.params;
  const shouldDownload = request.nextUrl.searchParams.get("download") === "1";

  const need = await prisma.needRequest.findUnique({
    where: { id },
    include: {
      requester: { select: { id: true, name: true, jobTitle: true, email: true } },
      reviewedBy: { select: { id: true, name: true, role: true } },
    },
  });

  if (!need) {
    return NextResponse.json({ error: "État de besoin introuvable." }, { status: 404 });
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

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

  const boldFont = await pdf.embedFont(montserratBold);

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

  const brandBlue = rgb(0.07, 0.2, 0.47);
  const black = rgb(0, 0, 0);
  const quote = parseNeedQuote(need.details);

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
    color: brandBlue,
  });

  page.drawText("ÉTAT DE BESOIN - APPROVISIONNEMENT", {
    x: 220,
    y: 765,
    size: 10.8,
    font: boldFont,
    color: brandBlue,
  });

  page.drawLine({
    start: { x: 38, y: 742 },
    end: { x: 557, y: 742 },
    thickness: 1,
    color: rgb(0.84, 0.87, 0.95),
  });

  page.drawText(`Réf: EDB-${need.id.slice(0, 8).toUpperCase()}`, {
    x: 38,
    y: 712,
    size: 10.5,
    font: boldFont,
    color: black,
  });

  page.drawText(`Statut: ${need.status}`, {
    x: 378,
    y: 712,
    size: 10.5,
    font: boldFont,
    color: need.status === "APPROVED" ? rgb(0.05, 0.38, 0.15) : rgb(0.35, 0.24, 0.02),
  });

  const details = [
    ["Objet", need.title],
    ["Catégorie", need.category],
    ["Quantité", `${need.quantity} ${need.unit}`],
    ["Montant estimatif", typeof need.estimatedAmount === "number" ? `${new Intl.NumberFormat("fr-FR").format(need.estimatedAmount)} ${need.currency ?? "XAF"}` : "-"] ,
    ["Demandeur", `${need.requester.name} (${need.requester.jobTitle})`],
    ["Soumis le", formatDate(need.submittedAt)],
    ["Validé par", need.reviewedBy?.name ?? "-"],
    ["Date validation", formatDate(need.approvedAt ?? need.reviewedAt)],
  ] as const;

  let y = 680;
  for (const [label, value] of details) {
    page.drawText(`${label}:`, {
      x: 38,
      y,
      size: 11,
      font: boldFont,
      color: black,
    });
    page.drawText(value, {
      x: 165,
      y,
      size: 11,
      font: boldFont,
      color: black,
    });
    y -= 20;
  }

  page.drawText("Articles demandés:", {
    x: 38,
    y: 512,
    size: 11,
    font: boldFont,
    color: black,
  });

  const wrapText = (text: string, maxChars = 92) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > maxChars) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  let detailY = 492;

  if (quote?.items?.length) {
    const xCols = [38, 68, 170, 330, 390, 470, 545];
    const headers = ["N°", "Désignation", "Description", "Qté", "PU", "PT"];
    headers.forEach((header, index) => {
      page.drawText(header, {
        x: xCols[index],
        y: detailY,
        size: 10,
        font: boldFont,
        color: black,
      });
    });

    detailY -= 14;
    page.drawLine({
      start: { x: 38, y: detailY + 4 },
      end: { x: 557, y: detailY + 4 },
      thickness: 0.7,
      color: rgb(0.82, 0.82, 0.82),
    });

    for (const [index, item] of quote.items.slice(0, 10).entries()) {
      page.drawText(String(index + 1), { x: xCols[0], y: detailY, size: 10, font: boldFont, color: black });
      page.drawText(item.designation.slice(0, 18), { x: xCols[1], y: detailY, size: 10, font: boldFont, color: black });
      page.drawText((item.description || "-").slice(0, 24), { x: xCols[2], y: detailY, size: 10, font: boldFont, color: black });
      page.drawText(String(item.quantity), { x: xCols[3], y: detailY, size: 10, font: boldFont, color: black });
      page.drawText(item.unitPrice.toFixed(2), { x: xCols[4], y: detailY, size: 10, font: boldFont, color: black });
      page.drawText(item.lineTotal.toFixed(2), { x: xCols[5], y: detailY, size: 10, font: boldFont, color: black });
      detailY -= 14;
    }

    detailY -= 4;
    page.drawText(`Total général: ${quote.totalGeneral.toFixed(2)} ${need.currency ?? "XAF"}`, {
      x: 350,
      y: detailY,
      size: 10.5,
      font: boldFont,
      color: black,
    });
    detailY -= 10;
  } else {
    const rawLines = (need.details || "-").split("\n").map((line) => line.trim()).filter(Boolean);
    const normalized = rawLines.length > 0 ? rawLines.map((line) => (line.startsWith("-") || line.startsWith("•") ? line : `• ${line}`)) : ["• -"];
    const lines = normalized.flatMap((line) => wrapText(line, 90));

    lines.slice(0, 14).forEach((line) => {
      page.drawText(line, {
        x: 38,
        y: detailY,
        size: 11,
        font: boldFont,
        color: black,
      });
      detailY -= 15;
    });
  }

  const validationTop = 132;

  page.drawLine({
    start: { x: 38, y: validationTop },
    end: { x: 557, y: validationTop },
    thickness: 0.8,
    color: rgb(0.8, 0.8, 0.8),
  });

  page.drawText("Validation Direction / Finance", {
    x: 38,
    y: validationTop - 16,
    size: 11,
    font: boldFont,
    color: black,
  });

  const commentText = need.reviewComment?.trim() ? `Commentaire: ${need.reviewComment}` : "Commentaire: -";
  const commentLines = wrapText(commentText, 90).slice(0, 4);
  let commentY = validationTop - 40;
  commentLines.forEach((line) => {
    page.drawText(line, {
      x: 38,
      y: commentY,
      size: 10.8,
      font: boldFont,
      color: black,
    });
    commentY -= 16;
  });

  const sealTextY = Math.max(30, commentY - 22);

  const sealAnchorY = 26;

  if (need.status === "APPROVED" && need.sealedAt) {
    if (stamp) {
      const stampSize = getContainedSize(stamp, 118, 118, true);
      page.drawImage(stamp, {
        x: 404,
        y: sealAnchorY,
        width: stampSize.width,
        height: stampSize.height,
        opacity: 0.95,
      });
    }

    page.drawText(`Document scellé le ${formatDate(need.sealedAt)}`, {
      x: 38,
      y: sealTextY,
      size: 10.8,
      font: boldFont,
      color: black,
    });
  } else {
    page.drawText("Document non scellé (en attente d'approbation).", {
      x: 38,
      y: sealTextY,
      size: 10.8,
      font: boldFont,
      color: black,
    });
  }

  page.drawLine({
    start: { x: 38, y: 22 },
    end: { x: PAGE_WIDTH - 38, y: 22 },
    thickness: 0.6,
    color: rgb(0.83, 0.83, 0.83),
  });

  page.drawText(`Page 1/1 • Imprimé le ${formatDate(new Date())}`, {
    x: 38,
    y: 12,
    size: 8.8,
    font: boldFont,
    color: black,
  });

  const byText = `Par ${access.session.user.name}`;
  const byWidth = boldFont.widthOfTextAtSize(byText, 8.2);
  page.drawText(byText, {
    x: PAGE_WIDTH - 38 - byWidth,
    y: 12,
    size: 8.8,
    font: boldFont,
    color: black,
  });

  const bytes = await pdf.save();
  const body = Buffer.from(bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="etat-besoin-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
