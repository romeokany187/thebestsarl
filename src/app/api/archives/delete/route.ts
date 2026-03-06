import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER"]);
  if (access.error) {
    return access.error;
  }

  const formData = await request.formData();
  const id = typeof formData.get("id") === "string" ? String(formData.get("id")) : "";
  const folder = typeof formData.get("folder") === "string" ? String(formData.get("folder")) : "NOTES_LETTRES_INTERNES";

  if (!id) {
    const fallback = new URL(`/archives?folder=${folder}&deleteError=1`, request.url);
    return NextResponse.redirect(fallback, { status: 303 });
  }

  const existing = await prisma.archiveDocument.findUnique({
    where: { id },
    select: { id: true, origin: true },
  });

  if (!existing || existing.origin === "SYSTEM") {
    const blocked = new URL(`/archives?folder=${folder}&deleteError=1`, request.url);
    return NextResponse.redirect(blocked, { status: 303 });
  }

  await prisma.archiveDocument.delete({ where: { id } });
  const redirectUrl = new URL(`/archives?folder=${folder}&deleted=1`, request.url);
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
