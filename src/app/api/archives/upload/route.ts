import { NextRequest, NextResponse } from "next/server";
import { ArchiveFolder } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { canWriteArchiveFolder, createArchiveDocumentWithGlobalReference, parseArchiveFolder } from "@/lib/archive";

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function parseFolder(value: FormDataEntryValue | null) {
  return typeof value === "string" ? parseArchiveFolder(value) : null;
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("archives", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  try {
    const formData = await request.formData();
    const folder = parseFolder(formData.get("folder"));
    const titleValue = formData.get("title");
    const file = formData.get("file");

    if (!folder) {
      return NextResponse.json({ error: "Dossier invalide." }, { status: 400 });
    }

    if (!canWriteArchiveFolder(access.role, access.session.user.jobTitle ?? null, folder)) {
      return NextResponse.json({ error: "Archivage interdit pour cette catégorie." }, { status: 403 });
    }

    const title = typeof titleValue === "string" ? titleValue.trim() : "";
    if (title.length < 3) {
      return NextResponse.json({ error: "Le titre du document est requis." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Le fichier est requis." }, { status: 400 });
    }

    if (!allowedMimeTypes.has(file.type)) {
      return NextResponse.json({ error: "Formats autorisés: PDF, PNG, JPG, WEBP, GIF." }, { status: 400 });
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "Fichier vide non autorisé." }, { status: 400 });
    }

    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "Taille max: 15 MB." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    await createArchiveDocumentWithGlobalReference(prisma, {
      folder,
      title,
      originalFileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      fileData: bytes,
      origin: "MANUAL",
      createdById: access.session.user.id,
    });

    const redirectUrl = new URL(`/archives?folder=${folder}&uploaded=1`, request.url);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    console.error("POST /api/archives/upload failed", error);
    return NextResponse.json({ error: "Erreur serveur lors de l'archivage." }, { status: 500 });
  }
}
