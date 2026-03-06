import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

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

export async function GET(_request: Request, { params }: Params) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
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
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  const width = page.getWidth();

  const drawHeader = (isContinuation = false) => {
    page.drawText(`THEBEST SARL - Rapport de travail${isContinuation ? " (suite)" : ""}`, {
      x: 34,
      y: 804,
      size: 14,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText(`Référence interne: ${report.id}`, { x: 34, y: 788, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
    page.drawLine({ start: { x: 34, y: 782 }, end: { x: width - 34, y: 782 }, thickness: 0.8, color: rgb(0.82, 0.82, 0.82) });
  };

  drawHeader();

  page.drawText(`Titre: ${report.title}`, { x: 34, y: 760, size: 10, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
  page.drawText(`Période: ${formatPeriodLabel(report.period)}`, { x: 34, y: 744, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`Auteur: ${report.author.name}`, { x: 34, y: 730, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`Service: ${report.author.team?.name ?? "-"}`, { x: 34, y: 716, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`Statut: ${report.status}`, { x: 34, y: 702, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`Validateur: ${report.reviewer?.name ?? "-"}`, { x: 34, y: 688, size: 9, font, color: rgb(0.2, 0.2, 0.2) });

  page.drawText("Contenu", { x: 34, y: 666, size: 10, font: fontBold, color: rgb(0.12, 0.12, 0.12) });

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

      page.drawText(chunk, { x: 34, y, size: 9, font, color: rgb(0.16, 0.16, 0.16) });
      y -= 14;
    }

    y -= 4;
  }

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
