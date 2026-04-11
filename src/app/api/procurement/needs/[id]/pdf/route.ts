import { NextResponse, NextRequest } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, context: { params: any }) {
  const { params } = context;
  try {
    const { id } = params;
    const need = await prisma.needRequest.findUnique({
      where: { id: id },
      include: {
        requester: true,
        reviewedBy: true,
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
    pdf.registerFontkit(fontkit);
    const page = pdf.addPage([595, 842]);
    const montserratRegular = fs.readFileSync("public/fonts/Montserrat-Regular.ttf");
    const montserratBold = fs.readFileSync("public/fonts/Montserrat-Bold.ttf");
    const font = await pdf.embedFont(montserratRegular);
    const fontBold = await pdf.embedFont(montserratBold);
    let y = 800;

    // Logo
    try {
      const logoBytes = fs.readFileSync("public/logo thebest.png");
      const logoImg = await pdf.embedPng(logoBytes);
      page.drawImage(logoImg, { x: 40, y: 780, width: 90, height: 45 });
    } catch {}

    // Titre centré
    page.drawText("THE BEST SARL", { x: 220, y: 810, size: 14, font: fontBold, color: rgb(0,0,0) });
    page.drawText("ÉTAT DE BESOIN - APPROVISIONNEMENT", { x: 170, y: 790, size: 11, font, color: rgb(0.3,0.3,0.3) });
    y = 770;
    page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.7, color: rgb(0.7,0.7,0.7) });
    y -= 20;

    // Bloc infos principales
    page.drawText(`Réf: ${need.code ?? need.id}`, { x: 50, y, size: 10, font });
    page.drawText(`Statut: ${need.status}`, { x: 400, y, size: 10, font });
    y -= 14;
    page.drawText(`Objet: ${need.title ?? "-"}`, { x: 50, y, size: 10, font });
    page.drawText(`Quantité: ${need.quantity ?? "-"} ${need.unit ?? ""}`, { x: 400, y, size: 10, font });
    y -= 14;
    page.drawText(`Montant estimatif: ${need.estimatedAmount?.toLocaleString() ?? "-"} ${need.currency ?? ""}`, { x: 50, y, size: 10, font });
    y -= 14;
    page.drawText(`Demandeur: ${need.requester?.name ?? "-"} (${need.requester?.jobTitle ?? "-"})`, { x: 50, y, size: 10, font });
    page.drawText(`Soumis le: ${need.submittedAt ? new Date(need.submittedAt).toLocaleString() : "-"}`, { x: 320, y, size: 10, font });
    y -= 14;
    page.drawText(`Validé par: ${need.reviewedBy?.name ?? "-"}`, { x: 50, y, size: 10, font });
    page.drawText(`Date validation: ${need.approvedAt ? new Date(need.approvedAt).toLocaleString() : "-"}`, { x: 320, y, size: 10, font });
    y -= 14;
    page.drawText(`Exécution: ${need.status === "APPROVED" ? "Exécuté (validation caisse enregistrée)" : "En attente d'exécution"}`, { x: 50, y, size: 10, font });
    page.drawText(`Niveau d'urgence: -`, { x: 320, y, size: 10, font });
    y -= 14;
    page.drawText(`Équipe bénéficiaire: -`, { x: 50, y, size: 10, font });
    y -= 18;

    // Tableau des articles
    page.drawText("Articles demandés:", { x: 50, y, size: 11, font: fontBold, color: rgb(0.2,0.2,0.2) });
    y -= 14;
    // En-tête du tableau

    page.drawText("Validation Direction / Finance", { x: 50, y, size: 9, font: fontBold });
    y -= 12;
    page.drawText(`Commentaire: ${need.reviewComment ?? "-"}`, { x: 50, y, size: 9, font });
    y -= 12;
    page.drawText(`Document scellé le ${new Date().toLocaleString("fr-FR")} `, { x: 50, y, size: 8, font });
    y -= 10;
    page.drawText(`Mention finale: ${need.status} (${new Date().toLocaleString("fr-FR")})`, { x: 50, y, size: 8, font });
    page.drawText(`Page 1/1 - Imprimé le ${new Date().toLocaleString("fr-FR")}`, { x: 340, y, size: 8, font });

    // Signature et cachet
    try {
      const cachetBytes = fs.readFileSync("public/cachet.png");
      const cachetImg = await pdf.embedPng(cachetBytes);
      page.drawImage(cachetImg, { x: 420, y: 60, width: 90, height: 60 });
    } catch {}
    try {
      const signBytes = fs.readFileSync("public/signature.png");
      const signImg = await pdf.embedPng(signBytes);
      page.drawImage(signImg, { x: 340, y: 60, width: 70, height: 30 });
    } catch {}
    page.drawText(`Par ${need.reviewedBy?.name ?? "-"}`, { x: 420, y: 50, size: 9, font });

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
