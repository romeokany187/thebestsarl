
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
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

    // Parse les articles demandés
    let articles: any[] = [];
    try {
      const details = typeof need.details === "string" ? JSON.parse(need.details) : need.details;
      articles = Array.isArray(details?.items) ? details.items : [];
    } catch {
      articles = [];
    }

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    let y = 800;
    page.drawText(need.title || "État de besoin", { x: 50, y, size: 18, color: rgb(0, 0, 0) });
    y -= 24;
    page.drawText(`Demandeur: ${need.requester?.name ?? "-"} (${need.requester?.jobTitle ?? "-"})`, { x: 50, y, size: 12, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;
    page.drawText(`Montant estimatif: ${need.estimatedAmount?.toLocaleString() ?? "-"} ${need.currency ?? ""}`, { x: 50, y, size: 12, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;
    page.drawText(`Articles demandés :`, { x: 50, y, size: 12, color: rgb(0, 0, 0) });
    y -= 16;
    if (articles.length === 0) {
      page.drawText("Aucun article trouvé.", { x: 60, y, size: 11, color: rgb(0.4, 0.2, 0.2) });
    } else {
      for (const item of articles) {
        if (y < 60) break;
        page.drawText(
          `- ${item.designation ?? "?"} | Qté: ${item.quantity ?? "?"} | PU: ${item.unitPrice?.toLocaleString() ?? "?"} | Total: ${item.lineTotal?.toLocaleString() ?? "?"}`,
          { x: 60, y, size: 11, color: rgb(0.1, 0.1, 0.1) }
        );
        y -= 14;
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
