import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { stockMovementSchema } from "@/lib/validators";

export async function GET() {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const movements = await prisma.stockMovement.findMany({
    include: {
      stockItem: true,
      performedBy: { select: { id: true, name: true } },
      needRequest: { select: { id: true, title: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 400,
  });

  return NextResponse.json({ data: movements });
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const body = await request.json();
  const parsed = stockMovementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { role: true, jobTitle: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (me.role === "EMPLOYEE" && me.jobTitle !== "APPROVISIONNEMENT_MARKETING") {
    return NextResponse.json({ error: "Seul le service approvisionnement peut gérer la fiche stock." }, { status: 403 });
  }

  if (parsed.data.needRequestId) {
    const need = await prisma.needRequest.findUnique({
      where: { id: parsed.data.needRequestId },
      select: { id: true, status: true },
    });

    if (!need) {
      return NextResponse.json({ error: "État de besoin lié introuvable." }, { status: 404 });
    }

    if (need.status !== "APPROVED") {
      return NextResponse.json({ error: "L'état de besoin doit être approuvé avant mouvement de stock." }, { status: 400 });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let item = await tx.stockItem.findUnique({
        where: {
          name_category_unit: {
            name: parsed.data.itemName,
            category: parsed.data.category,
            unit: parsed.data.unit,
          },
        },
      });

      if (!item) {
        if (parsed.data.movementType === "OUT") {
          throw new Error("Impossible de sortir un produit absent de la fiche stock.");
        }

        item = await tx.stockItem.create({
          data: {
            name: parsed.data.itemName,
            category: parsed.data.category,
            unit: parsed.data.unit,
            currentQuantity: 0,
          },
        });
      }

      const delta = parsed.data.movementType === "IN" ? parsed.data.quantity : -parsed.data.quantity;
      const nextQty = item.currentQuantity + delta;

      if (nextQty < 0) {
        throw new Error("Stock insuffisant pour cette sortie.");
      }

      const updatedItem = await tx.stockItem.update({
        where: { id: item.id },
        data: { currentQuantity: nextQty },
      });

      const movement = await tx.stockMovement.create({
        data: {
          stockItemId: item.id,
          movementType: parsed.data.movementType,
          quantity: parsed.data.quantity,
          justification: parsed.data.justification,
          referenceDoc: parsed.data.referenceDoc,
          performedById: access.session.user.id,
          needRequestId: parsed.data.needRequestId,
        },
      });

      return { updatedItem, movement };
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur de mouvement de stock.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
