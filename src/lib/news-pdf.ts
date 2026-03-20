import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const TEXT_BLACK = rgb(0.06, 0.06, 0.06);

type NewsPostForPdf = {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  isPublished: boolean;
  author: {
    name: string | null;
    email: string;
  };
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

function drawHeader(logo: PDFImage | null, page: PDFPage, titleFont: PDFFont) {
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
    size: 11.5,
    font: titleFont,
    color: TEXT_BLACK,
  });

  page.drawText("Direction Générale", {
    x: 220,
    y: height - 92,
    size: 10.5,
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

function drawFooter(page: PDFPage, fontBold: PDFFont, printedBy: string) {
  const { width } = page.getSize();

  page.drawText("Document officiel - Direction Générale", {
    x: 38,
    y: 26,
    size: 8.2,
    font: fontBold,
    color: TEXT_BLACK,
  });

  const rightText = `Imprimé par: ${printedBy}`;
  const rightWidth = fontBold.widthOfTextAtSize(rightText, 8.2);
  page.drawText(rightText, {
    x: width - rightWidth - 38,
    y: 26,
    size: 8.2,
    font: fontBold,
    color: TEXT_BLACK,
  });
}

function drawPageNumber(page: PDFPage, fontBold: PDFFont, index: number, total: number) {
  const { width } = page.getSize();
  const text = `Page ${index}/${total}`;
  const textWidth = fontBold.widthOfTextAtSize(text, 8.2);

  page.drawText(text, {
    x: (width - textWidth) / 2,
    y: 26,
    size: 8.2,
    font: fontBold,
    color: TEXT_BLACK,
  });
}

function drawStamp(page: PDFPage, stampImage: PDFImage | null) {
  if (!stampImage) return;
  const fitted = getContainedSize(stampImage, 126, 126, true);

  const { width } = page.getSize();
  page.drawImage(stampImage, {
    x: (width - fitted.width) / 2,
    y: 44,
    width: fitted.width,
    height: fitted.height,
    opacity: 1,
  });
}

function drawReferenceBox(page: PDFPage, fontBold: PDFFont, postId: string, publishedAt: Date) {
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
    font: fontBold,
    color: TEXT_BLACK,
  });

  page.drawText(`Date: ${publishedAt.toLocaleDateString()}`, {
    x,
    y: y - 24,
    size: 8.5,
    font: fontBold,
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

export async function buildNewsPdf(post: NewsPostForPdf, printedBy: string) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  let fontRegular: PDFFont;
  let fontBold: PDFFont;
  try {
    const regularBytes = await readFile(path.join(process.cwd(), "public/fonts/Montserrat-Regular.ttf"));
    fontRegular = await pdf.embedFont(regularBytes);
    fontBold = fontRegular;
  } catch {
    throw new Error("Police Montserrat Regular introuvable. Vérifiez public/fonts/Montserrat-Regular.ttf.");
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

  const stampImage = await embedOptionalImage(pdf, [
    "public/cachet.png",
    "public/cachet.jpg",
    "public/cachet.jpeg",
    "public/branding/cachet.png",
    "public/branding/cachet.jpg",
    "public/branding/cachet.jpeg",
  ]);

  const lines = wrapText(post.content, fontRegular, 10.5, PAGE_WIDTH - 76);
  const baseMetaText = `Publié le ${new Date(post.createdAt).toLocaleString()} • ${post.author.name ?? post.author.email}`;
  const subjectText = `Objet: ${post.title}`;

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(logoImage, page, fontBold);
  drawFooter(page, fontBold, printedBy);
  drawReferenceBox(page, fontBold, post.id, post.createdAt);

  let y = PAGE_HEIGHT - 138;
  const titleWidth = fontBold.widthOfTextAtSize(post.title, 16);
  page.drawText(post.title, {
    x: Math.max(38, (PAGE_WIDTH - titleWidth) / 2),
    y,
    size: 18,
    font: fontBold,
    color: TEXT_BLACK,
  });

  y -= 22;
  page.drawText(baseMetaText, {
    x: 38,
    y,
    size: 11,
    font: fontBold,
    color: TEXT_BLACK,
  });

  y -= 18;
  page.drawText(subjectText, {
    x: 38,
    y,
    size: 11.5,
    font: fontBold,
    color: TEXT_BLACK,
  });

  y -= 22;
  for (const line of lines) {
    if (y < 140) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawHeader(logoImage, page, fontBold);
      drawFooter(page, fontBold, printedBy);

      page.drawText(`Suite du communiqué: ${post.title}`, {
        x: 38,
        y: PAGE_HEIGHT - 132,
        size: 13.5,
        font: fontBold,
        color: TEXT_BLACK,
      });

      y = PAGE_HEIGHT - 160;
    }

    page.drawText(line, {
      x: 38,
      y,
      size: 12.2,
      font: fontBold,
      color: TEXT_BLACK,
    });
    y -= line ? 17 : 11;
  }

  const pages = pdf.getPages();
  const lastPage = pages[pages.length - 1];
  if (post.isPublished) {
    drawStamp(lastPage, stampImage);
  }

  pages.forEach((pdfPage, index) => {
    drawPageNumber(pdfPage, fontBold, index + 1, pages.length);
  });

  return pdf.save();
}
