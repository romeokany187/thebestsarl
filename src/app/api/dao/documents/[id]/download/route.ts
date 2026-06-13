import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireApiModuleAccess("dao", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const { id } = await params;

  try {
    const doc = await prisma.bidDocument.findUnique({
      where: { id },
      select: {
        fileData: true,
        mimeType: true,
        originalFileName: true,
      },
    });

    if (!doc || !doc.fileData) {
      return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
    }

    return new NextResponse(doc.fileData, {
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${doc.originalFileName}"`,
        "Content-Length": String(doc.fileData.byteLength),
      },
    });
  } catch (error) {
    console.error("GET /api/dao/documents/[id]/download", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
