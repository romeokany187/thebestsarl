import { NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

function formatPeriodLabel(period: string) {
  if (period === "DAILY") return "Journalier";
  if (period === "WEEKLY") return "Hebdomadaire";
  if (period === "MONTHLY") return "Mensuel";
  if (period === "ANNUAL") return "Annuel";
  return period;
}

function splitLines(content: string) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

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

export async function GET(_request: Request, { params }: Params) {
  const access = await requireApiModuleAccess("reports", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const { id } = await params;

  const report = await prisma.workerReport.findUnique({
    where: { id },
    include: {
      author: { include: { team: true } },
      reviewer: { select: { name: true } },
    },
  });

  if (!report) {
    return NextResponse.json({ error: "Rapport introuvable." }, { status: 404 });
  }

  if (access.role === "EMPLOYEE" && report.authorId !== access.session.user.id) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
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

  const font = await pdf.embedFont(montserratRegular.bytes);
  const fontBold = font;
  const textBlack = rgb(0, 0, 0);
  const lineGray = rgb(0.84, 0.84, 0.84);
  const logoImage = report.status === "APPROVED"
    ? await embedOptionalImage(pdf, [
      "public/branding/logo.png",
      "public/branding/logo.jpg",
      "public/branding/logo.jpeg",
      "public/logo.png",
      "public/logo.jpg",
      "public/logo.jpeg",
    ])
    : null;
  let page = pdf.addPage([595, 842]);
  const width = page.getWidth();
  const generatedBy = access.session.user.name ?? access.session.user.email ?? "Utilisateur";

  const drawHeader = (isContinuation = false) => {
    if (logoImage) {
      const scaled = logoImage.scale(0.16);
      page.drawImage(logoImage, {
        x: 34,
        y: 786,
        width: Math.min(110, scaled.width),
        height: Math.min(42, scaled.height),
      });
    }

    page.drawText(`THEBEST SARL - Rapport de travail${isContinuation ? " (suite)" : ""}`, {
      x: logoImage ? 150 : 34,
      y: 804,
      size: 14,
      font: fontBold,
      color: textBlack,
    });
    page.drawText(`Référence interne: ${report.id}`, { x: 34, y: 788, size: 9, font, color: textBlack });
    page.drawLine({ start: { x: 34, y: 782 }, end: { x: width - 34, y: 782 }, thickness: 0.8, color: lineGray });
  };

  drawHeader();

  page.drawText(`Titre: ${report.title}`, { x: 34, y: 760, size: 10, font: fontBold, color: textBlack });
  page.drawText(`Période: ${formatPeriodLabel(report.period)}`, { x: 34, y: 744, size: 9, font, color: textBlack });
  page.drawText(`Auteur: ${report.author.name}`, { x: 34, y: 730, size: 9, font, color: textBlack });
  page.drawText(`Service: ${report.author.team?.name ?? "-"}`, { x: 34, y: 716, size: 9, font, color: textBlack });
  page.drawText(`Statut: ${report.status}`, { x: 34, y: 702, size: 9, font, color: textBlack });
  page.drawText(`Validateur: ${report.reviewer?.name ?? "-"}`, { x: 34, y: 688, size: 9, font, color: textBlack });

  page.drawText("Contenu", { x: 34, y: 666, size: 10, font: fontBold, color: textBlack });

  const lines = splitLines(report.content);
  let y = 648;

  for (const line of lines) {
    const chunks = line.match(/.{1,95}/g) ?? [line];

    for (const chunk of chunks) {
      if (y < 46) {
        page = pdf.addPage([595, 842]);
        drawHeader(true);
        y = 760;
      }

      page.drawText(chunk, { x: 34, y, size: 9, font, color: textBlack });
      y -= 14;
    }

    y -= 4;
  }

  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: 34, y: 20 }, end: { x: width - 34, y: 20 }, thickness: 0.6, color: lineGray });
    p.drawText(`Page ${index + 1}/${pages.length}`, { x: 34, y: 10, size: 8, font, color: textBlack });
    const rightText = `Par ${generatedBy}`;
    const rightWidth = font.widthOfTextAtSize(rightText, 8);
    p.drawText(rightText, { x: width - rightWidth - 34, y: 10, size: 8, font, color: textBlack });
  });

  const bytes = await pdf.save();
  return new NextResponse(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="rapport-${report.id}.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
