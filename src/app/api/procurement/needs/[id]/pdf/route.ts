
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";

type Params = { params: Promise<{ id: string }> };

// Route PDF EDB minimaliste, compatible Next.js
export async function GET(
  request: NextRequest,
  { params }: Params
) {
  try {
    const { id } = await params;
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    page.drawText(`État de besoin PDF`, {
      x: 50,
      y: 800,
      size: 18,
      color: rgb(0, 0, 0),
    });
    page.drawText(`ID: ${id ?? "-"}`, {
      x: 50,
      y: 770,
      size: 12,
      color: rgb(0.2, 0.2, 0.2),
    });

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
