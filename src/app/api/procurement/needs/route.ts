import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { needRequestSchema } from "@/lib/validators";
import { quoteFromItems, serializeNeedQuote } from "@/lib/need-lines";

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("procurement", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const status = request.nextUrl.searchParams.get("status");

  const needs = await prisma.needRequest.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
    },
    include: {
      requester: { select: { id: true, name: true, jobTitle: true, role: true } },
      reviewedBy: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ data: needs });
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("procurement", ["ADMIN", "MANAGER", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (access.role === "ADMIN") {
    return NextResponse.json({ error: "Accès lecture seule: l'admin ne peut pas émettre d'état de besoin." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = needRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, role: true, jobTitle: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (me.role === "EMPLOYEE" && me.jobTitle !== "APPROVISIONNEMENT_MARKETING") {
    return NextResponse.json({ error: "Seul le service approvisionnement peut émettre un état de besoin." }, { status: 403 });
  }

  const quote = parsed.data.items?.length
    ? quoteFromItems(parsed.data.items)
    : quoteFromItems([
      {
        designation: parsed.data.title,
        description: parsed.data.details ?? parsed.data.category,
        quantity: parsed.data.quantity ?? 1,
        unitPrice: parsed.data.estimatedAmount ?? 0,
      },
    ]);

  if (quote.items.length === 0) {
    return NextResponse.json({ error: "Ajoutez au moins une ligne valide dans le devis (désignation, quantité, prix unitaire)." }, { status: 400 });
  }

  const need = await prisma.needRequest.create({
    data: {
      title: parsed.data.title,
      category: parsed.data.category,
      details: serializeNeedQuote(quote),
      quantity: quote.items.reduce((sum, item) => sum + item.quantity, 0),
      unit: "LOT",
      estimatedAmount: quote.totalGeneral,
      currency: parsed.data.currency?.toUpperCase() ?? "XAF",
      status: "SUBMITTED",
      requesterId: me.id,
      submittedAt: new Date(),
    },
  });

  const validators = await prisma.user.findMany({
    where: {
      id: { not: me.id },
      role: "ADMIN",
    },
    select: { id: true },
    take: 160,
  });

  if (validators.length > 0) {
    await prisma.userNotification.createMany({
      data: validators.map((user) => ({
        userId: user.id,
        title: "Validation EDB requise",
        message: `Un nouvel état de besoin est soumis: ${need.title}.`,
        type: "PROCUREMENT_APPROVAL",
        metadata: {
          needRequestId: need.id,
          needStatus: need.status,
          needTitle: need.title,
          source: "INBOX_APPROVAL",
        } as Prisma.InputJsonValue,
      })),
    });
  }

  return NextResponse.json({ data: need }, { status: 201 });
}
