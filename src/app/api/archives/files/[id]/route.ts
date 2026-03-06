import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const { id } = await params;

  const document = await prisma.archiveDocument.findUnique({
    where: { id },
    select: {
      originalFileName: true,
      mimeType: true,
      fileData: true,
      externalUrl: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
  }

  if (!document.fileData) {
    if (document.externalUrl) {
      return NextResponse.redirect(new URL(document.externalUrl, process.env.NEXTAUTH_URL ?? "http://localhost:3000"), 302);
    }
    return NextResponse.json({ error: "Fichier indisponible." }, { status: 404 });
  }

  const normalizedBytes = Uint8Array.from(document.fileData);

  return new NextResponse(normalizedBytes, {
    status: 200,
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(document.originalFileName)}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
