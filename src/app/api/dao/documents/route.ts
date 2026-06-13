import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const ALLOWED_EXTENSIONS = /\.(pdf|doc|docx|xls|xlsx|png|jpg|jpeg|webp)$/i;

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("dao", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  try {
    const formData = await request.formData();
    const bidFolderId = String(formData.get("bidFolderId") ?? "");
    const requirementId = formData.get("requirementId") ? String(formData.get("requirementId")) : null;
    const label = String(formData.get("label") ?? "").trim();
    const file = formData.get("file");

    if (!bidFolderId) {
      return NextResponse.json({ error: "bidFolderId requis." }, { status: 400 });
    }

    const folder = await prisma.bidFolder.findUnique({
      where: { id: bidFolderId },
      select: { id: true },
    });

    if (!folder) {
      return NextResponse.json({ error: "Dossier introuvable." }, { status: 404 });
    }

    if (!label || label.length < 2) {
      return NextResponse.json({ error: "Le libellé du document est requis." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Fichier requis." }, { status: 400 });
    }

    if (!ALLOWED_EXTENSIONS.test(file.name)) {
      return NextResponse.json({
        error: "Formats autorisés: PDF, Word (.doc/.docx), Excel (.xls/.xlsx), PNG, JPG, WEBP.",
      }, { status: 400 });
    }

    if (!allowedMimeTypes.has(file.type) && file.type !== "") {
      // Accept empty mime type for some Word/Excel files
      return NextResponse.json({ error: "Type de fichier non supporté." }, { status: 400 });
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "Fichier vide non autorisé." }, { status: 400 });
    }

    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Taille max: 20 MB." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    const document = await prisma.bidDocument.create({
      data: {
        bidFolderId,
        requirementId,
        label,
        originalFileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        fileData: bytes,
        uploadedById: access.session.user.id,
      },
    });

    const redirectUrl = new URL("/relation-publique", request.url);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    console.error("POST /api/dao/documents", error);
    return NextResponse.json({ error: "Erreur serveur lors de l'upload." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const access = await requireApiModuleAccess("dao", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id requis." }, { status: 400 });
    }

    const doc = await prisma.bidDocument.findUnique({
      where: { id },
      select: { id: true, bidFolderId: true, uploadedById: true },
    });

    if (!doc) {
      return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
    }

    const isAdminOrDG = access.role === "ADMIN" || access.role === "DIRECTEUR_GENERAL";
    if (!isAdminOrDG && doc.uploadedById !== access.session.user.id) {
      return NextResponse.json({ error: "Vous ne pouvez supprimer que vos propres documents." }, { status: 403 });
    }

    await prisma.bidDocument.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/dao/documents", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
