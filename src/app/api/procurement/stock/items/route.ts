import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { stockItemCreateSchema } from "@/lib/validators";
import { writeActivityLog } from "@/lib/activity-log";

export async function GET() {
  const access = await requireApiModuleAccess("procurement", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const items = await prisma.stockItem.findMany({
    include: {
      movements: {
        include: {
          performedBy: { select: { id: true, name: true } },
          needRequest: { select: { id: true, title: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 25,
      },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: 300,
  });

  return NextResponse.json({ data: items });
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("procurement", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const body = await request.json();
  const parsed = stockItemCreateSchema.safeParse(body);
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

  if (me.role === "EMPLOYEE" && me.jobTitle !== "APPROVISIONNEMENT") {
    return NextResponse.json({ error: "Seul le service approvisionnement peut enrichir la fiche stock." }, { status: 403 });
  }

  try {
    const existing = await prisma.stockItem.findUnique({
      where: {
        name_category_unit: {
          name: parsed.data.itemName,
          category: parsed.data.category,
          unit: parsed.data.unit,
        },
      },
    });

    if (existing) {
      return NextResponse.json({ error: "Cet article existe déjà dans la fiche stock." }, { status: 409 });
    }

    const item = await prisma.stockItem.create({
      data: {
        name: parsed.data.itemName,
        category: parsed.data.category,
        unit: parsed.data.unit,
        currentQuantity: 0,
      },
    });

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "STOCK_ITEM_CREATED",
      entityType: "STOCK_ITEM",
      entityId: item.id,
      summary: `Article ajouté à la fiche stock: ${item.name}.`,
      payload: {
        name: item.name,
        category: item.category,
        unit: item.unit,
      },
    });

    return NextResponse.json({ data: item }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur lors de l'ajout de l'article.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
