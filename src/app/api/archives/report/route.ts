import { NextRequest, NextResponse } from "next/server";
import { ArchiveFolder } from "@prisma/client";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { archiveFolderLabel } from "@/lib/archive";

type ReportMode = "date" | "week" | "month" | "year";

function parseFolder(value: string | null): ArchiveFolder | undefined {
  if (
    value === "DGI"
    || value === "CNSS_ONEM"
    || value === "ADMINISTRATIF"
    || value === "NOTES_LETTRES_INTERNES"
    || value === "FACTURES_RECUS"
    || value === "DGRK"
  ) {
    return value;
  }
  return undefined;
}

function parseYear(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return null;
  return parsed;
}

function startOfISOWeek(date: Date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return copy;
}

function dateRangeFromParams(params: URLSearchParams) {
  const now = new Date();
  const mode = (["date", "week", "month", "year"].includes(params.get("mode") ?? "")
    ? params.get("mode")
    : "date") as ReportMode;

  if (mode === "year") {
    const year = parseYear(params.get("year")) ?? now.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    return { start, end, label: `Annuel ${year}` };
  }

  if (mode === "month") {
    const rawMonth = params.get("month");
    const monthMatch = rawMonth?.match(/^(\d{4})-(\d{2})$/);
    const year = monthMatch ? Number.parseInt(monthMatch[1], 10) : now.getUTCFullYear();
    const month = monthMatch ? Number.parseInt(monthMatch[2], 10) - 1 : now.getUTCMonth();
    const safeMonth = Math.min(11, Math.max(0, month));
    const start = new Date(Date.UTC(year, safeMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, safeMonth + 1, 1, 0, 0, 0, 0));
    return { start, end, label: `Mensuel ${start.toISOString().slice(0, 7)}` };
  }

  if (mode === "week") {
    const rawDate = params.get("date");
    const date = rawDate ? new Date(`${rawDate}T00:00:00.000Z`) : now;
    const start = startOfISOWeek(date);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return { start, end, label: `Hebdomadaire ${start.toISOString().slice(0, 10)} -> ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}` };
  }

  const rawDate = params.get("date") ?? now.toISOString().slice(0, 10);
  const start = new Date(`${rawDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, label: `Journalier ${rawDate}` };
}

function typeFromMime(mimeType: string) {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "Image";
  return "Fichier";
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

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("archives", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const folder = parseFolder(request.nextUrl.searchParams.get("folder"));
  const range = dateRangeFromParams(request.nextUrl.searchParams);

  const documents = await prisma.archiveDocument.findMany({
    where: {
      ...(folder ? { folder } : {}),
      createdAt: { gte: range.start, lt: range.end },
    },
    orderBy: { createdAt: "desc" },
    select: {
      reference: true,
      folder: true,
      title: true,
      mimeType: true,
      origin: true,
      createdAt: true,
    },
    take: 3000,
  });

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

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

  const font = await pdf.embedFont(montserratRegular);
  const bold = await pdf.embedFont(montserratBold);
  const textBlack = rgb(0, 0, 0);
  let page = pdf.addPage([842, 595]);

  const drawHeader = (continuation = false) => {
    const title = `THEBEST SARL - Registre Archives PDF${continuation ? " (suite)" : ""}`;
    page.drawText(title, { x: 24, y: 566, size: 13, font: bold, color: textBlack });
    page.drawText(`Période: ${range.label}`, { x: 24, y: 550, size: 9, font, color: textBlack });
    page.drawText(`Catégorie: ${folder ? archiveFolderLabel(folder) : "Toutes"}`, { x: 280, y: 550, size: 9, font, color: textBlack });
    page.drawText(`Documents: ${documents.length}`, { x: 640, y: 550, size: 9, font, color: textBlack });
    page.drawLine({ start: { x: 24, y: 544 }, end: { x: 818, y: 544 }, thickness: 0.8, color: rgb(0.82, 0.82, 0.82) });

    const headers = ["Référence", "Catégorie", "Document", "Type", "Origine", "Date"];
    const x = [24, 140, 270, 560, 620, 705];
    headers.forEach((header, index) => {
      page.drawText(header, { x: x[index], y: 528, size: 8, font: bold, color: textBlack });
    });
    page.drawLine({ start: { x: 24, y: 523 }, end: { x: 818, y: 523 }, thickness: 0.6, color: rgb(0.86, 0.86, 0.86) });
  };

  drawHeader();
  let y = 510;

  for (const row of documents) {
    if (y < 42) {
      page = pdf.addPage([842, 595]);
      drawHeader(true);
      y = 510;
    }

    const values = [
      row.reference.slice(0, 15),
      archiveFolderLabel(row.folder).slice(0, 18),
      row.title.slice(0, 44),
      typeFromMime(row.mimeType),
      row.origin === "SYSTEM" ? "Système" : "Manuel",
      new Date(row.createdAt).toISOString().slice(0, 10),
    ];

    const x = [24, 140, 270, 560, 620, 705];
    values.forEach((value, index) => {
      page.drawText(value, { x: x[index], y, size: 8, font, color: textBlack });
    });

    y -= 12;
  }

  const pages = pdf.getPages();
  const printedBy = access.session.user.name ?? access.session.user.email ?? "Utilisateur";
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: 24, y: 20 }, end: { x: 818, y: 20 }, thickness: 0.6, color: rgb(0.84, 0.84, 0.84) });
    p.drawText(`Page ${index + 1}/${pages.length}`, { x: 24, y: 10, size: 8, font, color: textBlack });
    const rightText = `Par ${printedBy}`;
    const rightWidth = font.widthOfTextAtSize(rightText, 8);
    p.drawText(rightText, { x: 818 - rightWidth, y: 10, size: 8, font, color: textBlack });
  });

  const bytes = await pdf.save();
  return new NextResponse(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="archives-${new Date().toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
