import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { invoiceFileName, invoiceNumberFromChronology } from "@/lib/invoice";

type RouteContext = {
  params: Promise<{ ticketId: string }>;
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

function formatDate(value: Date) {
  return value.toLocaleDateString("fr-FR", { timeZone: "UTC" });
}

function drawLabelValueRow(page: PDFPage, font: any, bold: any, y: number, label: string, value: string) {
  page.drawText(`${label} :`, { x: 38, y, size: 12, font: bold, color: rgb(0, 0, 0) });
  page.drawText(value || "-", { x: 130, y, size: 12, font, color: rgb(0, 0, 0) });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await requireApiModuleAccess("invoices", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const { ticketId } = await context.params;

  const ticket = await prisma.ticketSale.findUnique({
    where: { id: ticketId },
    include: {
      airline: { select: { code: true, name: true } },
      seller: { select: { name: true, team: { select: { name: true } } } },
      payments: { select: { amount: true } },
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Billet introuvable." }, { status: 404 });
  }

  const year = ticket.soldAt.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
  const sequence = await prisma.ticketSale.count({
    where: {
      soldAt: { gte: yearStart, lt: yearEnd },
      OR: [
        { soldAt: { lt: ticket.soldAt } },
        { soldAt: ticket.soldAt, id: { lte: ticket.id } },
      ],
    },
  });
  const invoiceNumber = invoiceNumberFromChronology({
    soldAt: ticket.soldAt,
    sellerTeamName: ticket.seller?.team?.name ?? null,
    sequence,
  });
  const paidAmount = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const balance = Math.max(0, ticket.amount - paidAmount);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([595, 842]);

  const montserratRegular = await readFirstExistingFile([
    "public/fonts/Montserrat-Regular.ttf",
    "public/branding/fonts/Montserrat-Regular.ttf",
  ]);
  const montserratBold = await readFirstExistingFile([
    "public/fonts/Montserrat-Bold.ttf",
    "public/branding/fonts/Montserrat-Bold.ttf",
    "public/fonts/Montserrat-Regular.ttf",
  ]);

  if (!montserratRegular || !montserratBold) {
    return NextResponse.json({ error: "Police Montserrat introuvable sur le serveur." }, { status: 500 });
  }

  const regular = await pdf.embedFont(montserratRegular.bytes);
  const bold = await pdf.embedFont(montserratBold.bytes);

  const logo = await embedOptionalImage(pdf, [
    "public/logo thebest.png",
    "public/branding/logo.png",
    "public/logo.png",
  ]);
  const stamp = await embedOptionalImage(pdf, [
    "public/cachet.png",
    "public/branding/cachet.png",
  ]);
  const signature = await embedOptionalImage(pdf, [
    "public/signature.png",
    "public/branding/signature.png",
  ]);

  const black = rgb(0, 0, 0);
  const gray = rgb(0.45, 0.45, 0.45);
  const line = rgb(0.2, 0.2, 0.2);

  if (logo) {
    const scaled = logo.scale(0.3);
    page.drawImage(logo, {
      x: 32,
      y: 760,
      width: Math.min(170, scaled.width),
      height: Math.min(70, scaled.height),
    });
  }

  page.drawText("Societe de prestation des services, fourniture des Biens et Agence de voyage.", {
    x: 210,
    y: 806,
    size: 10,
    font: bold,
    color: black,
  });
  page.drawText("Adresse : Boulevard du 30 Juin / Immeuble du 30 Juin / 2eme niveau / Local 03", {
    x: 210,
    y: 790,
    size: 9,
    font: regular,
    color: black,
  });
  page.drawText("/ Av. du Port n1, C. Revolution, C. Gombe.", {
    x: 210,
    y: 777,
    size: 9,
    font: regular,
    color: black,
  });
  page.drawText("Telephone : +243 816927972      +243 988076118", {
    x: 210,
    y: 761,
    size: 9,
    font: regular,
    color: black,
  });
  page.drawText("E-mail : thebestsarl2@gmail.com", {
    x: 210,
    y: 744,
    size: 9,
    font: regular,
    color: black,
  });
  page.drawText("www.thebest-bsc.com", {
    x: 210,
    y: 731,
    size: 9,
    font: regular,
    color: rgb(0.02, 0.32, 0.67),
  });

  page.drawText(`Kinshasa, le ${formatDate(ticket.soldAt)}`, { x: 395, y: 703, size: 11, font: regular, color: black });
  page.drawText(`FACTURE N° ${invoiceNumber}`, { x: 170, y: 668, size: 31 / 2, font: bold, color: black });

  drawLabelValueRow(page as any, regular, bold, 626, "Client", ticket.customerName);
  drawLabelValueRow(page as any, regular, bold, 607, "Adresse du client", "-");
  drawLabelValueRow(page as any, regular, bold, 588, "Telephone", "-");
  drawLabelValueRow(page as any, regular, bold, 569, "Type service", "Billet de voyage");
  drawLabelValueRow(page as any, regular, bold, 550, "Compagnie(s)", `${ticket.airline.code}/${ticket.airline.name}`);

  const tableLeft = 34;
  const tableRight = 560;
  const tableTop = 528;
  const rowHeight = 24;
  const colX = [34, 56, 192, 302, 388, 444, 500, 560];

  page.drawRectangle({ x: tableLeft, y: tableTop - rowHeight, width: tableRight - tableLeft, height: rowHeight, borderColor: line, borderWidth: 1 });
  for (let i = 1; i < colX.length - 1; i += 1) {
    page.drawLine({ start: { x: colX[i], y: tableTop }, end: { x: colX[i], y: tableTop - rowHeight }, thickness: 1, color: line });
  }

  const headers = ["#", "Beneficiaire", "Itineraire", "Dates", "Quantite", "PU $", "Total $"];
  const headerX = [40, 60, 196, 306, 393, 452, 506];
  headers.forEach((h, idx) => {
    page.drawText(h, { x: headerX[idx], y: tableTop - 15, size: 10, font: bold, color: black });
  });

  const rowBottom = tableTop - rowHeight - 84;
  page.drawRectangle({ x: tableLeft, y: rowBottom, width: tableRight - tableLeft, height: 84, borderColor: line, borderWidth: 1 });
  for (let i = 1; i < colX.length - 1; i += 1) {
    page.drawLine({ start: { x: colX[i], y: tableTop - rowHeight }, end: { x: colX[i], y: rowBottom }, thickness: 1, color: line });
  }

  page.drawText("1", { x: 42, y: tableTop - rowHeight - 18, size: 11, font: regular, color: black });
  page.drawText(ticket.customerName, { x: 60, y: tableTop - rowHeight - 18, size: 11, font: regular, color: black });
  page.drawText(`${ticket.route}`, { x: 196, y: tableTop - rowHeight - 18, size: 11, font: regular, color: black });
  page.drawText(`Depart : ${formatDate(ticket.travelDate)}`, { x: 306, y: tableTop - rowHeight - 18, size: 10, font: regular, color: black });
  page.drawText(`Retour : -`, { x: 306, y: tableTop - rowHeight - 36, size: 10, font: regular, color: black });
  page.drawText("1", { x: 398, y: tableTop - rowHeight - 18, size: 11, font: regular, color: black });
  page.drawText(`${ticket.amount.toFixed(2)} $`, { x: 448, y: tableTop - rowHeight - 18, size: 11, font: regular, color: black });
  page.drawText(`${ticket.amount.toFixed(2)} $`, { x: 505, y: tableTop - rowHeight - 18, size: 11, font: regular, color: black });

  const summaryTop = rowBottom - 36;
  page.drawRectangle({ x: tableLeft, y: summaryTop, width: tableRight - tableLeft, height: 18, borderColor: line, borderWidth: 1 });
  page.drawText(`Grand Total : ${ticket.amount.toFixed(2)} USD`, { x: 38, y: summaryTop + 5, size: 12, font: bold, color: black });

  page.drawRectangle({ x: tableLeft, y: summaryTop - 18, width: tableRight - tableLeft, height: 18, borderColor: line, borderWidth: 1 });
  page.drawText("Les paiements", { x: 38, y: summaryTop - 13, size: 12, font: bold, color: black });

  page.drawRectangle({ x: tableLeft, y: summaryTop - 36, width: tableRight - tableLeft, height: 18, borderColor: line, borderWidth: 1 });
  page.drawLine({ start: { x: 297, y: summaryTop - 36 }, end: { x: 297, y: summaryTop - 18 }, thickness: 1, color: line });
  page.drawText(`Total paye : ${paidAmount.toFixed(2)} USD`, { x: 38, y: summaryTop - 31, size: 11, font: bold, color: black });
  page.drawText(`Solde : ${balance.toFixed(2)} USD`, { x: 304, y: summaryTop - 31, size: 11, font: bold, color: black });

  page.drawText("Sceau", { x: 190, y: 92, size: 12, font: bold, color: black });
  page.drawText("Signature", { x: 435, y: 92, size: 12, font: bold, color: black });

  if (stamp) {
    const scaled = stamp.scale(0.22);
    page.drawImage(stamp, { x: 120, y: 8, width: Math.min(130, scaled.width), height: Math.min(130, scaled.height), opacity: 0.9 });
  }

  if (signature) {
    const scaled = signature.scale(0.33);
    page.drawImage(signature, { x: 360, y: 18, width: Math.min(160, scaled.width), height: Math.min(80, scaled.height), opacity: 0.9 });
  }

  page.drawText(`Print at ${new Date().toISOString().replace("T", " ").slice(0, 16)}`, {
    x: 240,
    y: 42,
    size: 8,
    font: regular,
    color: gray,
  });
  page.drawText("Page 1/1", { x: 280, y: 28, size: 8, font: regular, color: gray });

  const bytes = await pdf.save();
  const download = request.nextUrl.searchParams.get("download") === "1";

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${invoiceFileName(invoiceNumber)}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
