import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { invoiceFileName, invoiceNumberFromTicket } from "@/lib/invoice";

type RouteContext = {
  params: Promise<{ ticketId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await requireApiModuleAccess("invoices", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const { ticketId } = await context.params;

  const ticket = await prisma.ticketSale.findUnique({
    where: { id: ticketId },
    include: {
      airline: { select: { code: true, name: true } },
      seller: { select: { name: true } },
      payments: { select: { amount: true } },
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Billet introuvable." }, { status: 404 });
  }

  const invoiceNumber = invoiceNumberFromTicket(ticket.ticketNumber, ticket.soldAt);
  const paidAmount = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const balance = Math.max(0, ticket.amount - paidAmount);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0, 0, 0);
  const gray = rgb(0.45, 0.45, 0.45);

  page.drawText("THEBEST SARL", { x: 40, y: 800, size: 18, font: bold, color: black });
  page.drawText("Facture de billet", { x: 40, y: 780, size: 11, font: regular, color: gray });

  page.drawLine({ start: { x: 40, y: 768 }, end: { x: 555, y: 768 }, thickness: 1, color: gray });

  page.drawText(`Facture: ${invoiceNumber}`, { x: 40, y: 740, size: 11, font: bold, color: black });
  page.drawText(`Date d'emission: ${ticket.soldAt.toISOString().slice(0, 10)}`, { x: 40, y: 722, size: 10, font: regular, color: black });
  page.drawText(`PNR: ${ticket.ticketNumber}`, { x: 40, y: 704, size: 10, font: regular, color: black });

  page.drawText(`Client: ${ticket.customerName}`, { x: 40, y: 668, size: 10.5, font: regular, color: black });
  page.drawText(`Compagnie: ${ticket.airline.code} - ${ticket.airline.name}`, { x: 40, y: 650, size: 10.5, font: regular, color: black });
  page.drawText(`Itineraire: ${ticket.route}`, { x: 40, y: 632, size: 10.5, font: regular, color: black });
  page.drawText(`Date de voyage: ${ticket.travelDate.toISOString().slice(0, 10)}`, { x: 40, y: 614, size: 10.5, font: regular, color: black });
  page.drawText(`Vendeur: ${ticket.seller?.name ?? ticket.sellerName ?? "-"}`, { x: 40, y: 596, size: 10.5, font: regular, color: black });

  page.drawLine({ start: { x: 40, y: 568 }, end: { x: 555, y: 568 }, thickness: 0.8, color: gray });

  page.drawText("Montant total", { x: 40, y: 540, size: 10.5, font: regular, color: black });
  page.drawText(`${ticket.amount.toFixed(2)} USD`, { x: 455, y: 540, size: 10.5, font: bold, color: black });

  page.drawText("Montant deja encaisse", { x: 40, y: 520, size: 10.5, font: regular, color: black });
  page.drawText(`${paidAmount.toFixed(2)} USD`, { x: 455, y: 520, size: 10.5, font: bold, color: black });

  page.drawText("Solde restant", { x: 40, y: 500, size: 10.5, font: regular, color: black });
  page.drawText(`${balance.toFixed(2)} USD`, { x: 455, y: 500, size: 10.5, font: bold, color: black });

  page.drawLine({ start: { x: 40, y: 476 }, end: { x: 555, y: 476 }, thickness: 0.8, color: gray });

  page.drawText("Cette facture est emise automatiquement lors de l'encodage du billet.", {
    x: 40,
    y: 450,
    size: 9,
    font: regular,
    color: gray,
  });

  page.drawText("THEBEST SARL - Document interne", { x: 40, y: 80, size: 8.5, font: regular, color: gray });

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
