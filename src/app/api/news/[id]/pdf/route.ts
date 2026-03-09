import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const TEXT_BLACK = rgb(0, 0, 0);

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

function drawHeader(logo: PDFImage | null, page: PDFPage, titleFont: PDFFont, textFont: PDFFont) {
  const { width, height } = page.getSize();

  if (logo) {
    const scaled = logo.scale(0.28);
    page.drawImage(logo, {
      x: 38,
      y: height - 108,
      width: Math.min(165, scaled.width),
      height: Math.min(68, scaled.height),
    });
  }

  page.drawText("THE BEST SARL", {
    x: 220,
    y: height - 54,
    size: 17,
    font: titleFont,
    color: TEXT_BLACK,
  });

  page.drawText("COMMUNIQUÉ OFFICIEL", {
    x: 220,
    y: height - 74,
    size: 11,
    font: textFont,
    color: TEXT_BLACK,
  });

  page.drawText("Direction Générale", {
    x: 220,
    y: height - 92,
    size: 10,
    font: titleFont,
    color: TEXT_BLACK,
  });

  page.drawLine({
    start: { x: 220, y: height - 94 },
    end: { x: 312, y: height - 94 },
    thickness: 0.7,
    color: rgb(0.35, 0.35, 0.35),
  });

  page.drawLine({
    start: { x: 38, y: height - 104 },
    end: { x: width - 38, y: height - 104 },
    thickness: 0.8,
    color: rgb(0.82, 0.82, 0.82),
  });
}

function drawFooter(page: PDFPage, fontRegular: PDFFont, printedBy: string) {
  const { width } = page.getSize();

  page.drawText(`Document officiel - Direction Générale`, {
    x: 38,
    y: 26,
    size: 8.5,
    font: fontRegular,
    color: TEXT_BLACK,
  });

  const rightText = `Imprimé par: ${printedBy}`;
  const rightWidth = fontRegular.widthOfTextAtSize(rightText, 8.5);
  page.drawText(rightText, {
    x: width - rightWidth - 38,
    y: 26,
    size: 8.5,
    font: fontRegular,
    color: TEXT_BLACK,
  });
}

function drawPageNumber(page: PDFPage, fontRegular: PDFFont, index: number, total: number) {
  const { width } = page.getSize();
  const text = `Page ${index}/${total}`;
  const textWidth = fontRegular.widthOfTextAtSize(text, 8.5);

  page.drawText(text, {
    x: (width - textWidth) / 2,
    y: 26,
    size: 8.5,
    font: fontRegular,
    color: TEXT_BLACK,
  });
}

function drawReferenceBox(page: PDFPage, fontBold: PDFFont, fontRegular: PDFFont, postId: string, publishedAt: Date) {
  const { width, height } = page.getSize();
  const x = width - 206;
  const y = height - 141;

  page.drawText("Référence", {
    x,
    y,
    size: 8,
    font: fontBold,
    color: TEXT_BLACK,
  });

  page.drawText(`DG-${postId.slice(0, 8).toUpperCase()}`, {
    x,
    y: y - 12,
    size: 8.5,
    font: fontRegular,
    color: TEXT_BLACK,
  });

  page.drawText(`Date: ${publishedAt.toLocaleDateString()}`, {
    x,
    y: y - 24,
    size: 8.5,
    font: fontRegular,
    color: TEXT_BLACK,
  });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
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
      const candidateWidth = font.widthOfTextAtSize(candidate, size);
      if (candidateWidth <= maxWidth) {
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

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await requireApiModuleAccess("news", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    if (access.error.status === 401) {
      const signInUrl = new URL("/auth/signin", request.url);
      signInUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(signInUrl);
    }
    return access.error;
  }

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

  const logoImage = await embedOptionalImage(pdf, [
    "public/logo thebest.png",
    "public/logo.png",
    "public/logo.jpg",
    "public/logo.jpeg",
    "public/branding/logo.png",
    "public/branding/logo thebest.png",
    "public/branding/logo.jpg",
    "public/branding/logo.jpeg",
  ]);

  const printedBy = access.session.user.name ?? access.session.user.email ?? "Utilisateur";
  const lines = wrapText(post.content, fontRegular, 10.5, PAGE_WIDTH - 76);
  const baseMetaText = `Publié le ${new Date(post.createdAt).toLocaleString()} • ${post.author.name}`;
  const subjectText = `Objet: ${post.title}`;

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(logoImage, page, fontBold, fontRegular);
  drawFooter(page, fontRegular, printedBy);
  drawReferenceBox(page, fontBold, fontRegular, post.id, post.createdAt);

  let y = PAGE_HEIGHT - 138;
  const titleWidth = fontBold.widthOfTextAtSize(post.title, 16);
  page.drawText(post.title, {
    x: Math.max(38, (PAGE_WIDTH - titleWidth) / 2),
    y,
    size: 15,
    font: fontBold,
    color: TEXT_BLACK,
  });

  y -= 22;
  page.drawText(baseMetaText, {
    x: 38,
    y,
    size: 9.5,
    font: fontRegular,
    color: TEXT_BLACK,
  });

  y -= 18;
  page.drawText(subjectText, {
    x: 38,
    y,
    size: 10,
    font: fontBold,
    color: TEXT_BLACK,
  });

  y -= 22;
  for (const line of lines) {
    if (y < 140) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawHeader(logoImage, page, fontBold, fontRegular);
      drawFooter(page, fontRegular, printedBy);

      page.drawText(`Suite du communiqué: ${post.title}`, {
        x: 38,
        y: PAGE_HEIGHT - 132,
        size: 12,
        font: fontBold,
        color: TEXT_BLACK,
      });

      y = PAGE_HEIGHT - 160;
    }

    page.drawText(line, {
      x: 38,
      y,
      size: 10.5,
      font: fontRegular,
      color: TEXT_BLACK,
    });
    y -= line ? 15 : 10;
  }

  const pages = pdf.getPages();
  const lastPage = pages[pages.length - 1];

  pages.forEach((pdfPage, index) => {
    drawPageNumber(pdfPage, fontRegular, index + 1, pages.length);
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
