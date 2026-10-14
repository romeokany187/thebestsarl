import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";

export const THEBEST_PDF_COLORS = {
  textBlack: rgb(0, 0, 0),
  lineGray: rgb(0.84, 0.84, 0.84),
  headerBg: rgb(0.09, 0.1, 0.14),
  headerText: rgb(1, 1, 1),
  headerSub: rgb(0.87, 0.89, 0.93),
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

/** Police Maiandra GD (MAIAN.TTF), comme les rapports paiements / OP. */
export async function loadTheBestDocumentFonts(pdf: PDFDocument) {
  pdf.registerFontkit(fontkit);
  const bodyBytes = await readFirstExistingFile([
    "public/fonts/MAIAN.TTF",
    "public/branding/fonts/MAIAN.TTF",
    "public/fonts/Montserrat-Regular.ttf",
    "public/branding/fonts/Montserrat-Regular.ttf",
  ]);

  const body = bodyBytes ? await pdf.embedFont(bodyBytes) : await pdf.embedFont(StandardFonts.Helvetica);
  const bold = bodyBytes ? body : await pdf.embedFont(StandardFonts.HelveticaBold);
  return { body, bold };
}

export function drawTheBestDocumentFooter(pdf: PDFDocument, font: PDFFont, generatedBy: string) {
  const { textBlack, lineGray } = THEBEST_PDF_COLORS;
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    const pageWidth = page.getWidth();
    page.drawLine({ start: { x: 24, y: 20 }, end: { x: pageWidth - 24, y: 20 }, thickness: 0.6, color: lineGray });
    page.drawText(`Page ${index + 1}/${pages.length}`, { x: 24, y: 10, size: 8, font, color: textBlack });
    const rightText = `Par ${generatedBy}`;
    const rightWidth = font.widthOfTextAtSize(rightText, 8);
    page.drawText(rightText, { x: pageWidth - 24 - rightWidth, y: 10, size: 8, font, color: textBlack });
  });
}

export function shortPdfLabel(value: string | null | undefined, max: number) {
  const trimmed = (value ?? "").trim() || "-";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(1, max - 1))}…`;
}
