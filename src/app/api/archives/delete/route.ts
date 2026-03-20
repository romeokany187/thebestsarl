import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { canWriteArchiveFolder } from "@/lib/archive";

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("archives", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
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
    select: { id: true, origin: true, folder: true },
  });

  if (!existing || existing.origin === "SYSTEM") {
    const blocked = new URL(`/archives?folder=${folder}&deleteError=1`, request.url);
    return NextResponse.redirect(blocked, { status: 303 });
  }

  if (!canWriteArchiveFolder(access.role, access.session.user.jobTitle ?? null, existing.folder)) {
    const blocked = new URL(`/archives?folder=${existing.folder}&deleteError=1`, request.url);
    return NextResponse.redirect(blocked, { status: 303 });
  }

  await prisma.archiveDocument.delete({ where: { id } });
  const redirectUrl = new URL(`/archives?folder=${folder}&deleted=1`, request.url);
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
