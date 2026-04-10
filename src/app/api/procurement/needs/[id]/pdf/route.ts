
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// Route PDF EDB minimaliste, compatible Next.js
export async function GET(
  request: NextRequest,
  { params }: Params
) {
  try {
    const { id } = await params;
    const need = await prisma.needRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { name: true, jobTitle: true } },
        reviewedBy: { select: { name: true } },
      },
    });
    if (!need) {
      return NextResponse.json({ error: "État de besoin introuvable." }, { status: 404 });
    }

    // Parse les articles demandés (format QUOTE_V1)
    let articles = [];
    try {
      const details = typeof need.details === "string" ? JSON.parse(need.details) : need.details;
      if (details && Array.isArray(details.items)) {
        articles = details.items;
      }
    } catch {}

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    let y = 800;

    // En-tête société
    page.drawText("THE BEST SARL", { x: 220, y, size: 14, font, color: rgb(0,0,0) });
    y -= 18;
    page.drawText("ÉTAT DE BESOIN - APPROVISIONNEMENT", { x: 170, y, size: 11, font, color: rgb(0.3,0.3,0.3) });
    y -= 18;
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.7,0.7,0.7) });
    y -= 18;

    // Infos principales
    page.drawText(`Réf: ${need.code ?? need.id}`, { x: 50, y, size: 10, font, color: rgb(0.2,0.2,0.2) });
    page.drawText(`Statut: ${need.status}`, { x: 400, y, size: 10, font, color: rgb(0.2,0.2,0.2) });
    y -= 14;
    page.drawText(`Objet: ${need.title ?? "-"}`, { x: 50, y, size: 10, font });
    y -= 12;
    page.drawText(`Quantité: ${need.quantity ?? "-"} ${need.unit ?? ""}`, { x: 50, y, size: 10, font });
    page.drawText(`Montant estimatif: ${need.estimatedAmount?.toLocaleString() ?? "-"} ${need.currency ?? ""}`, { x: 220, y, size: 10, font });
    y -= 12;
    page.drawText(`Demandeur: ${need.requester?.name ?? "-"} (${need.requester?.jobTitle ?? "-"})`, { x: 50, y, size: 10, font });
    y -= 12;
    page.drawText(`Soumis le: ${need.submittedAt ? new Date(need.submittedAt).toLocaleString() : "-"}`, { x: 50, y, size: 10, font });
    page.drawText(`Validé par: ${need.reviewedBy?.name ?? "-"}`, { x: 300, y, size: 10, font });
    y -= 12;
    page.drawText(`Date validation: ${need.approvedAt ? new Date(need.approvedAt).toLocaleString() : "-"}`, { x: 50, y, size: 10, font });
    page.drawText(`Exécution: En attente d'exécution`, { x: 300, y, size: 10, font });
    y -= 12;
    page.drawText(`Niveau d'urgence: -`, { x: 50, y, size: 10, font });
    page.drawText(`Équipe bénéficiaire: -`, { x: 300, y, size: 10, font });
    y -= 18;

    // Tableau des articles
    page.drawText("Articles demandés:", { x: 50, y, size: 11, font, color: rgb(0.2,0.2,0.2) });
    y -= 14;
    // En-tête du tableau
    page.drawText("N°", { x: 50, y, size: 10, font });
    page.drawText("Désignation", { x: 80, y, size: 10, font });
    page.drawText("Description", { x: 180, y, size: 10, font });
    page.drawText("Qté", { x: 340, y, size: 10, font });
    page.drawText("P.U", { x: 380, y, size: 10, font });
    page.drawText("P.T", { x: 440, y, size: 10, font });
    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.7,0.7,0.7) });
    y -= 12;
    if (articles.length === 0) {
      page.drawText("Aucun article trouvé.", { x: 80, y, size: 10, font, color: rgb(0.5,0.2,0.2) });
    } else {
      for (let i = 0; i < articles.length; i++) {
        const item = articles[i];
        if (y < 60) break;
        page.drawText(`${i+1}`, { x: 50, y, size: 10, font });
        page.drawText(`${item.designation ?? "-"}`.slice(0,30), { x: 80, y, size: 10, font });
        page.drawText(`${item.description ?? "-"}`.slice(0,40), { x: 180, y, size: 10, font });
        page.drawText(`${item.quantity ?? "-"}`, { x: 340, y, size: 10, font });
        page.drawText(`${item.unitPrice?.toLocaleString() ?? "-"}`, { x: 380, y, size: 10, font });
        page.drawText(`${item.lineTotal?.toLocaleString() ?? "-"}`, { x: 440, y, size: 10, font });
        y -= 12;
      }
    }

    const bytes = await pdf.save();
    const body = Buffer.from(bytes);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=etat-besoin-${id ?? "-"}.pdf`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Erreur génération PDF", details: String(e) },
      { status: 500 }
    );
  }
}
