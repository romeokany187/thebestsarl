import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

type RouteContext = {
  params: Promise<{ id: string }>;
};

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
  if (lower.endsWith(".png")) return pdf.embedPng(file.bytes);
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return pdf.embedJpg(file.bytes);
  return null;
}

function drawHeader(logo: PDFImage | null, page: PDFPage, titleFont: PDFFont, textFont: PDFFont) {
  const { width, height } = page.getSize();

  if (logo) {
    const scaled = logo.scale(0.14);
    page.drawImage(logo, {
      x: 38,
      y: height - 88,
      width: Math.min(90, scaled.width),
      height: Math.min(44, scaled.height),
    });
  }

  page.drawText("THE BEST SARL", {
    x: 140,
    y: height - 50,
    size: 16,
    font: titleFont,
    color: rgb(0.1, 0.1, 0.1),
  });

  page.drawText("DIRECTION GÉNÉRALE", {
    x: 140,
    y: height - 70,
    size: 11,
    font: titleFont,
    color: rgb(0.2, 0.2, 0.2),
  });

  page.drawText("COMMUNIQUÉ OFFICIEL", {
    x: 140,
    y: height - 86,
    size: 9,
    font: textFont,
    color: rgb(0.3, 0.3, 0.3),
  });

  page.drawLine({
    start: { x: 38, y: height - 100 },
    end: { x: width - 38, y: height - 100 },
    thickness: 1,
    color: rgb(0.78, 0.78, 0.78),
  });
}

function drawFooter(page: PDFPage, fontRegular: PDFFont, printedBy: string) {
  const { width } = page.getSize();

  page.drawText(`Document officiel - Direction Générale`, {
    x: 38,
    y: 26,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });

  const rightText = `Imprimé par: ${printedBy}`;
  const rightWidth = fontRegular.widthOfTextAtSize(rightText, 8.5);
  page.drawText(rightText, {
    x: width - rightWidth - 38,
    y: 26,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });
}

function drawSignature(page: PDFPage, signatureImage: PDFImage | null, fontRegular: PDFFont) {
  const { width } = page.getSize();

  page.drawLine({
    start: { x: width - 230, y: 116 },
    end: { x: width - 40, y: 116 },
    thickness: 0.8,
    color: rgb(0.78, 0.78, 0.78),
  });

  page.drawText("Signé: Direction Générale", {
    x: width - 228,
    y: 126,
    size: 9,
    font: fontRegular,
    color: rgb(0.35, 0.35, 0.35),
  });

  if (signatureImage) {
    const scaled = signatureImage.scale(0.2);
    page.drawImage(signatureImage, {
      x: width - 222,
      y: 76,
      width: Math.min(170, scaled.width),
      height: Math.min(36, scaled.height),
    });
  }
}

function wrapText(text: string, maxChars = 84) {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(" ");
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }

    if (current) lines.push(current);
  }

  return lines;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const { id } = await context.params;

  const post = await prisma.newsPost.findUnique({
    where: { id },
    include: {
      author: {
        select: { name: true, email: true },
      },
    },
  });

  if (!post) {
    return NextResponse.json({ error: "Nouvelle introuvable." }, { status: 404 });
  }

  if (!post.isPublished && access.role !== "ADMIN") {
    return NextResponse.json({ error: "Nouvelle non disponible." }, { status: 403 });
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  let fontRegular;
  let fontBold;
  try {
    const regularBytes = await readFile(path.join(process.cwd(), "public/fonts/Montserrat-Regular.ttf"));
    const boldBytes = await readFile(path.join(process.cwd(), "public/fonts/Montserrat-Bold.ttf"));
    fontRegular = await pdf.embedFont(regularBytes);
    fontBold = await pdf.embedFont(boldBytes);
  } catch {
    fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
    fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  }

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

  const printedBy = access.session.user.name ?? access.session.user.email ?? "Utilisateur";
  const lines = wrapText(post.content);
  const baseMetaText = `Publié le ${new Date(post.createdAt).toLocaleString()} • ${post.author.name}`;

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(logoImage, page, fontBold, fontRegular);
  drawFooter(page, fontRegular, printedBy);

  let y = PAGE_HEIGHT - 136;
  page.drawText(post.title, {
    x: 38,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0.05, 0.05, 0.05),
  });

  y -= 20;
  page.drawText(baseMetaText, {
    x: 38,
    y,
    size: 9.5,
    font: fontRegular,
    color: rgb(0.35, 0.35, 0.35),
  });

  y -= 26;
  for (const line of lines) {
    if (y < 140) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawHeader(logoImage, page, fontBold, fontRegular);
      drawFooter(page, fontRegular, printedBy);

      page.drawText(`Suite du communiqué: ${post.title}`, {
        x: 38,
        y: PAGE_HEIGHT - 136,
        size: 12,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15),
      });

      y = PAGE_HEIGHT - 168;
    }

    page.drawText(line, {
      x: 38,
      y,
      size: 10.5,
      font: fontRegular,
      color: rgb(0.12, 0.12, 0.12),
    });
    y -= line ? 15 : 10;
  }

  drawSignature(page, signatureImage, fontRegular);

  const pdfBytes = await pdf.save();
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="nouvelle-${post.id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
