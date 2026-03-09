import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const access = await requireApiModuleAccess("archives", ["ADMIN", "MANAGER"]);
  if (access.error) {
    return access.error;
  }

  const { id } = await params;

  const existing = await prisma.archiveDocument.findUnique({
    where: { id },
    select: {
      id: true,
      folder: true,
      origin: true,
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
  }

  if (existing.origin === "SYSTEM") {
    return NextResponse.json({ error: "Document système non supprimable manuellement." }, { status: 400 });
  }

  await prisma.archiveDocument.delete({ where: { id } });

  return NextResponse.json({
    success: true,
    redirectTo: `/archives?folder=${existing.folder}&deleted=1`,
  });
}
