import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

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
    const scaled = logo.scale(0.18);
    page.drawImage(logo, {
      x: 48,
      y: height - 92,
      width: Math.min(110, scaled.width),
      height: Math.min(50, scaled.height),
    });
  }

  page.drawText("THE BEST SARL", {
    x: 170,
    y: height - 56,
    size: 16,
    font: titleFont,
    color: rgb(0.1, 0.1, 0.1),
  });

  page.drawText("DIRECTION GÉNÉRALE", {
    x: 170,
    y: height - 76,
    size: 11,
    font: titleFont,
    color: rgb(0.2, 0.2, 0.2),
  });

  page.drawText("COMMUNIQUÉ OFFICIEL", {
    x: 170,
    y: height - 92,
    size: 9,
    font: textFont,
    color: rgb(0.3, 0.3, 0.3),
  });

  page.drawLine({
    start: { x: 48, y: height - 105 },
    end: { x: width - 48, y: height - 105 },
    thickness: 1,
    color: rgb(0.78, 0.78, 0.78),
  });
}

function wrapText(text: string, maxChars = 108) {
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

  const page = pdf.addPage([842, 595]);
  const { width, height } = page.getSize();

  drawHeader(logoImage, page, fontBold, fontRegular);

  page.drawText(post.title, {
    x: 48,
    y: height - 140,
    size: 18,
    font: fontBold,
    color: rgb(0.05, 0.05, 0.05),
  });

  const metaText = `Publié le ${new Date(post.createdAt).toLocaleString()} • ${post.author.name}`;
  page.drawText(metaText, {
    x: 48,
    y: height - 160,
    size: 10,
    font: fontRegular,
    color: rgb(0.35, 0.35, 0.35),
  });

  const lines = wrapText(post.content, 110);
  let y = height - 190;
  for (const line of lines) {
    if (y < 120) break;
    page.drawText(line, {
      x: 48,
      y,
      size: 11,
      font: fontRegular,
      color: rgb(0.12, 0.12, 0.12),
    });
    y -= 16;
  }

  page.drawLine({
    start: { x: width - 280, y: 132 },
    end: { x: width - 56, y: 132 },
    thickness: 0.8,
    color: rgb(0.78, 0.78, 0.78),
  });

  page.drawText("Signé: Direction Générale", {
    x: width - 278,
    y: 142,
    size: 9,
    font: fontRegular,
    color: rgb(0.35, 0.35, 0.35),
  });

  if (signatureImage) {
    const scaled = signatureImage.scale(0.2);
    page.drawImage(signatureImage, {
      x: width - 270,
      y: 92,
      width: Math.min(180, scaled.width),
      height: Math.min(40, scaled.height),
    });
  }

  page.drawText("Document officiel - Direction Générale", {
    x: 48,
    y: 36,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });

  const pdfBytes = await pdf.save();
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="nouvelle-${post.id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
