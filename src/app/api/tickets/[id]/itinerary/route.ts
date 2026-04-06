import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { defaultTravelMessage, extractTicketItinerary, itineraryFileName } from "@/lib/ticket-itinerary";

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

function formatDateTime(value?: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("fr-FR");
}

function drawLine(page: any, regular: any, bold: any, label: string, value: string, y: number) {
  page.drawText(`${label} :`, { x: 42, y, size: 11, font: bold, color: rgb(0, 0, 0) });
  page.drawText(value || "-", { x: 190, y, size: 11, font: regular, color: rgb(0, 0, 0) });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await requireApiModuleAccess("invoices", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const { id } = await context.params;

  const ticket = await prisma.ticketSale.findUnique({
    where: { id },
    include: {
      airline: { select: { code: true, name: true } },
      seller: { select: { name: true } },
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Billet introuvable." }, { status: 404 });
  }

  const itinerary = extractTicketItinerary(ticket.notes);
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

  if (logo) {
    const scaled = logo.scale(0.26);
    page.drawImage(logo, {
      x: 38,
      y: 745,
      width: Math.min(145, scaled.width),
      height: Math.min(70, scaled.height),
    });
  }

  page.drawText("FICHE D'ITINÉRANCE", { x: 190, y: 770, size: 20, font: bold, color: rgb(0, 0, 0) });
  page.drawText("THEBEST SARL • Informations pratiques de voyage", { x: 190, y: 748, size: 10, font: regular, color: rgb(0.2, 0.2, 0.2) });

  page.drawRectangle({ x: 36, y: 705, width: 523, height: 1, color: rgb(0.85, 0.85, 0.85) });

  drawLine(page, regular, bold, "Client", ticket.customerName, 680);
  drawLine(page, regular, bold, "PNR / Billet", ticket.ticketNumber, 658);
  drawLine(page, regular, bold, "Compagnie", `${ticket.airline.code} - ${ticket.airline.name}`, 636);
  drawLine(page, regular, bold, "Vendeur", ticket.seller?.name ?? ticket.sellerName ?? "-", 614);
  drawLine(page, regular, bold, "Itinéraire global", ticket.route, 592);

  page.drawText("Détails de voyage", { x: 42, y: 548, size: 14, font: bold, color: rgb(0, 0, 0) });
  page.drawRectangle({ x: 36, y: 535, width: 523, height: 1, color: rgb(0.85, 0.85, 0.85) });

  drawLine(page, regular, bold, "Aéroport de départ", itinerary?.departureAirport ?? "À renseigner", 510);
  drawLine(page, regular, bold, "Aéroport d'arrivée", itinerary?.arrivalAirport ?? "À renseigner", 488);
  drawLine(page, regular, bold, "Départ", formatDateTime(itinerary?.departureAt), 466);
  drawLine(page, regular, bold, "Arrivée", formatDateTime(itinerary?.arrivalAt), 444);
  drawLine(page, regular, bold, "Durée d'escale", itinerary?.layoverHours != null ? `${itinerary.layoverHours} heure(s)` : "Aucune ou non renseignée", 422);
  drawLine(page, regular, bold, "Présence check-in", formatDateTime(itinerary?.checkInAt), 400);

  page.drawText("Message au voyageur", { x: 42, y: 350, size: 14, font: bold, color: rgb(0, 0, 0) });
  page.drawRectangle({ x: 36, y: 210, width: 523, height: 122, borderColor: rgb(0.82, 0.82, 0.82), borderWidth: 1 });

  const message = itinerary?.travelMessage ?? defaultTravelMessage(ticket.customerName);
  const words = message.split(/\s+/).filter(Boolean);
  let line = "";
  let y = 310;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (regular.widthOfTextAtSize(next, 11) > 480) {
      page.drawText(line, { x: 48, y, size: 11, font: regular, color: rgb(0, 0, 0) });
      line = word;
      y -= 16;
    } else {
      line = next;
    }
  }
  if (line) {
    page.drawText(line, { x: 48, y, size: 11, font: regular, color: rgb(0, 0, 0) });
  }

  if (!itinerary) {
    page.drawText("NB : l'itinérance n'a pas encore été renseignée pour ce billet.", {
      x: 42,
      y: 170,
      size: 10,
      font: bold,
      color: rgb(0.75, 0.15, 0.15),
    });
  }

  page.drawText(`Document généré le ${new Date().toLocaleString("fr-FR")}`, {
    x: 42,
    y: 74,
    size: 8,
    font: regular,
    color: rgb(0.4, 0.4, 0.4),
  });

  const bytes = await pdf.save();
  const download = request.nextUrl.searchParams.get("download") === "1";

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${itineraryFileName(ticket.ticketNumber)}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
