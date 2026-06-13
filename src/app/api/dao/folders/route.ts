import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireApiModuleAccess("dao", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const folders = await prisma.bidFolder.findMany({
    include: {
      createdBy: { select: { id: true, name: true } },
      requirements: { orderBy: { orderIndex: "asc" } },
      documents: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          label: true,
          originalFileName: true,
          mimeType: true,
          fileSize: true,
          requirementId: true,
          uploadedBy: { select: { id: true, name: true } },
          createdAt: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const serialized = folders.map((f) => ({
    ...f,
    deadline: f.deadline?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    documents: f.documents.map((d) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
    })),
  }));

  return NextResponse.json({ data: serialized });
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("dao", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  try {
    const body = await request.json();
    const { title, clientName, deadline, estimatedAmount, currency, notes, requirements } = body;

    if (!title || typeof title !== "string" || title.trim().length < 3) {
      return NextResponse.json({ error: "Le titre est requis (min 3 caractères)." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const maxRef = await tx.bidFolder.aggregate({ _max: { reference: true } });
      const nextNum = maxRef._max.reference
        ? parseInt(maxRef._max.reference.replace(/^DAO-/, ""), 10) + 1
        : 1;
      const reference = `DAO-${String(nextNum).padStart(5, "0")}`;

      const folder = await tx.bidFolder.create({
        data: {
          reference,
          title: title.trim(),
          clientName: (clientName ?? "").trim(),
          deadline: deadline ? new Date(deadline) : null,
          estimatedAmount: estimatedAmount ? Number(estimatedAmount) : null,
          currency: currency ?? "CDF",
          notes: notes ?? null,
          createdById: access.session.user.id,
        },
      });

      if (Array.isArray(requirements) && requirements.length > 0) {
        await tx.bidRequirement.createMany({
          data: requirements.map((req: Record<string, unknown>, index: number) => ({
            bidFolderId: folder.id,
            label: String(req.label ?? "").trim(),
            description: String(req.description ?? "").trim() || null,
            category: String(req.category ?? "AUTRE"),
            isRequired: req.isRequired !== false,
            orderIndex: index,
          })),
        });
      }

      return folder;
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    console.error("POST /api/dao/folders", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const access = await requireApiModuleAccess("dao", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  try {
    const body = await request.json();
    const { folderId, title, clientName, deadline, estimatedAmount, currency, notes, status, requirements } = body;

    if (!folderId || typeof folderId !== "string") {
      return NextResponse.json({ error: "folderId requis." }, { status: 400 });
    }

    const existing = await prisma.bidFolder.findUnique({
      where: { id: folderId },
      select: { id: true, createdById: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Dossier introuvable." }, { status: 404 });
    }

    const isAdminOrDG = access.role === "ADMIN" || access.role === "DIRECTEUR_GENERAL";
    if (!isAdminOrDG && existing.createdById !== access.session.user.id) {
      return NextResponse.json({ error: "Vous ne pouvez modifier que vos propres dossiers." }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {};
    if (typeof title === "string") updateData.title = title.trim();
    if (typeof clientName === "string") updateData.clientName = clientName.trim();
    if (deadline !== undefined) updateData.deadline = deadline ? new Date(deadline) : null;
    if (estimatedAmount !== undefined) updateData.estimatedAmount = estimatedAmount ? Number(estimatedAmount) : null;
    if (typeof currency === "string") updateData.currency = currency;
    if (notes !== undefined) updateData.notes = notes ?? null;
    if (typeof status === "string") updateData.status = status;

    const result = await prisma.$transaction(async (tx) => {
      const folder = await tx.bidFolder.update({
        where: { id: folderId },
        data: updateData,
      });

      if (Array.isArray(requirements)) {
        await tx.bidRequirement.deleteMany({ where: { bidFolderId: folderId } });

        if (requirements.length > 0) {
          const createData: Array<{
            id?: string;
            bidFolderId: string;
            label: string;
            description: string | null;
            category: string;
            isRequired: boolean;
            orderIndex: number;
          }> = requirements.map((req: Record<string, unknown>, index: number) => {
            const data: {
              id?: string;
              bidFolderId: string;
              label: string;
              description: string | null;
              category: string;
              isRequired: boolean;
              orderIndex: number;
            } = {
              bidFolderId: folderId,
              label: String(req.label ?? "").trim(),
              description: String(req.description ?? "").trim() || null,
              category: String(req.category ?? "AUTRE"),
              isRequired: req.isRequired !== false,
              orderIndex: index,
            };

            if (typeof req.id === "string" && req.id.length >= 20) {
              data.id = req.id;
            }

            return data;
          });

          for (const data of createData) {
            if (data.id) {
              await tx.bidRequirement.upsert({
                where: { id: data.id },
                create: data,
                update: data,
              });
            } else {
              await tx.bidRequirement.create({ data });
            }
          }
        }
      }

      return folder;
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("PATCH /api/dao/folders", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
