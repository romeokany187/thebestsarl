import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { needRequestSchema, needRequestUpdateSchema } from "@/lib/validators";
import { quoteFromItems, serializeNeedQuote } from "@/lib/need-lines";

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

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

  const quoteOptions = {
    urgencyLevel: parsed.data.urgencyLevel,
    beneficiaryTeam: parsed.data.beneficiaryTeam,
    beneficiaryPersonId: parsed.data.beneficiaryPersonId,
    beneficiaryPersonName: parsed.data.beneficiaryPersonName,
  };

  const quote = parsed.data.items?.length
    ? quoteFromItems(parsed.data.items, quoteOptions)
    : quoteFromItems([
      {
        designation: parsed.data.title,
        description: parsed.data.details ?? parsed.data.title,
        quantity: parsed.data.quantity ?? 1,
        unitPrice: parsed.data.estimatedAmount ?? 0,
      },
    ], quoteOptions);

  const requestCurrency = normalizeMoneyCurrency(parsed.data.currency);

  if (quote.items.length === 0) {
    return NextResponse.json({ error: "Ajoutez au moins une ligne valide dans le devis (désignation, quantité, prix unitaire)." }, { status: 400 });
  }

  // Generate codification: TB-{TEAM3}-EB-{YEAR}-{SEQ}
  const teamMap: Record<string, string> = { KINSHASA: "KIN", LUBUMBASHI: "LUB", MBUJIMAYI: "MBU" };
  const team3 = teamMap[parsed.data.beneficiaryTeam] ?? parsed.data.beneficiaryTeam.slice(0, 3).toUpperCase();
  const year = new Date().getFullYear();
  const prefix = `TB-${team3}-EB-${year}-`;

  const need = await prisma.$transaction(async (tx) => {
    const count = await tx.needRequest.count({ where: { code: { startsWith: prefix } } });
    const seq = String(count + 1).padStart(3, "0");
    const code = `${prefix}${seq}`;

    return tx.needRequest.create({
      data: {
        code,
        title: parsed.data.title,
        category: parsed.data.category?.trim() || "GENERAL",
        details: serializeNeedQuote(quote),
        quantity: quote.items.reduce((sum, item) => sum + item.quantity, 0),
        unit: "LOT",
        estimatedAmount: quote.totalGeneral,
        currency: requestCurrency,
        status: "SUBMITTED",
        requesterId: me.id,
        submittedAt: new Date(),
      },
    });
  });

  const validators = await prisma.user.findMany({
    where: {
      id: { not: me.id },
      role: "ADMIN",
      jobTitle: "DIRECTION_GENERALE",
    },
    select: { id: true },
    take: 160,
  });

  if (validators.length > 0) {
    await prisma.userNotification.createMany({
      data: validators.map((user) => ({
        userId: user.id,
        title: "Validation EDB requise",
        message: `Un nouvel état de besoin est soumis: ${need.code ?? need.title} — ${need.title}.`,
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

export async function PATCH(request: NextRequest) {
  const access = await requireApiModuleAccess("procurement", ["ADMIN", "MANAGER", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (access.role === "ADMIN") {
    return NextResponse.json({ error: "Accès lecture seule: l'admin ne peut pas modifier un état de besoin." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = needRequestUpdateSchema.safeParse(body);
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
    return NextResponse.json({ error: "Seul le service approvisionnement peut modifier un état de besoin." }, { status: 403 });
  }

  const existing = await prisma.needRequest.findUnique({
    where: { id: parsed.data.needRequestId },
    select: {
      id: true,
      title: true,
      status: true,
      requesterId: true,
      reviewedAt: true,
      approvedAt: true,
      reviewComment: true,
      stockMovements: {
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "État de besoin introuvable." }, { status: 404 });
  }

  if (me.role !== "MANAGER" && existing.requesterId !== me.id) {
    return NextResponse.json(
      { error: "Seul le demandeur ou un manager peut modifier cet état de besoin." },
      { status: 403 },
    );
  }

  const alreadyHandled = existing.status === "APPROVED"
    || existing.status === "REJECTED"
    || Boolean(existing.reviewedAt)
    || Boolean(existing.approvedAt)
    || Boolean(existing.reviewComment?.includes("EXECUTION_CAISSE:"))
    || existing.stockMovements.length > 0;

  if (alreadyHandled) {
    return NextResponse.json(
      { error: "Modification impossible: une décision ou une exécution a déjà été prise sur cet état de besoin." },
      { status: 400 },
    );
  }

  const quoteOptions = {
    urgencyLevel: parsed.data.urgencyLevel,
    beneficiaryTeam: parsed.data.beneficiaryTeam,
    beneficiaryPersonId: parsed.data.beneficiaryPersonId,
    beneficiaryPersonName: parsed.data.beneficiaryPersonName,
  };

  const quote = parsed.data.items?.length
    ? quoteFromItems(parsed.data.items, quoteOptions)
    : quoteFromItems([
      {
        designation: parsed.data.title,
        description: parsed.data.details ?? parsed.data.title,
        quantity: parsed.data.quantity ?? 1,
        unitPrice: parsed.data.estimatedAmount ?? 0,
      },
    ], quoteOptions);

  const requestCurrency = normalizeMoneyCurrency(parsed.data.currency);

  if (quote.items.length === 0) {
    return NextResponse.json({ error: "Ajoutez au moins une ligne valide dans le devis (désignation, quantité, prix unitaire)." }, { status: 400 });
  }

  const updated = await prisma.needRequest.update({
    where: { id: existing.id },
    data: {
      title: parsed.data.title,
      category: parsed.data.category?.trim() || "GENERAL",
      details: serializeNeedQuote(quote),
      quantity: quote.items.reduce((sum, item) => sum + item.quantity, 0),
      unit: "LOT",
      estimatedAmount: quote.totalGeneral,
      currency: requestCurrency,
    },
  });

  return NextResponse.json({ data: updated });
}
