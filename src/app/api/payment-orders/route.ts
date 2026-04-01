import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { paymentOrderCreationSchema } from "@/lib/validators";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["DIRECTEUR_GENERAL"]);
  if (access.error) return access.error;

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, name: true, jobTitle: true, role: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  const canCreate = access.role === "DIRECTEUR_GENERAL";
  if (!canCreate) {
    return NextResponse.json(
      { error: "Création d'ordre de paiement réservée à la Direction Générale." },
      { status: 403 },
    );
  }

  const body = await request.json();
  const parsed = paymentOrderCreationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const now = new Date();
  const paymentOrder = await paymentOrderClient.create({
    data: {
      description: parsed.data.description,
      amount: parsed.data.amount,
      currency: parsed.data.currency || "XAF",
      status: "SUBMITTED",
      issuedById: me.id,
      submittedAt: now,
    },
  });

  // Notify all admins about the new payment order
  const admins = await prisma.user.findMany({
    where: {
      role: "ADMIN",
    },
    select: { id: true },
    take: 100,
  });

  if (admins.length > 0) {
    await prisma.userNotification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        title: "Nouvel ordre de paiement à approuver",
        message: `${me.name} a créé un ordre de paiement de ${parsed.data.amount} ${parsed.data.currency || "XAF"}. Description: ${parsed.data.description}`,
        type: "PAYMENT_ORDER_APPROVAL_REQUIRED",
        metadata: {
          paymentOrderId: paymentOrder.id,
          amount: parsed.data.amount,
          currency: parsed.data.currency || "XAF",
          description: parsed.data.description,
          issuedBy: me.name,
          source: "INBOX_APPROVAL",
        },
      })),
    });
  }

  return NextResponse.json(paymentOrder, { status: 201 });
}

export async function GET(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "MANAGER", "EMPLOYEE"]);
  if (access.error) return access.error;

  const orders = await paymentOrderClient.findMany({
    include: {
      issuedBy: { select: { id: true, name: true, jobTitle: true } },
      approvedBy: { select: { id: true, name: true, jobTitle: true } },
      executedBy: { select: { id: true, name: true, jobTitle: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json(orders);
}
