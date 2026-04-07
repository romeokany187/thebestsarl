import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { canWriteArchiveFolder } from "@/lib/archive";
import { writeActivityLog } from "@/lib/activity-log";

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
    select: { id: true, origin: true, folder: true, title: true, reference: true },
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
  await writeActivityLog({
    actorId: access.session.user.id,
    action: "ARCHIVE_DOCUMENT_DELETED",
    entityType: "ARCHIVE_DOCUMENT",
    entityId: existing.id,
    summary: `Document archivé supprimé: ${existing.title}.`,
    payload: {
      reference: existing.reference,
      folder: existing.folder,
      title: existing.title,
    },
  });
  const redirectUrl = new URL(`/archives?folder=${folder}&deleted=1`, request.url);
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
