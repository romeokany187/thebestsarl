import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { paymentOrderCreationSchema } from "@/lib/validators";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

function normalizePaymentOrderAssignment(value: string | null | undefined) {
  const normalized = (value ?? "A_MON_COMPTE").trim().toUpperCase();
  if (["A_MON_COMPTE", "VISAS", "SAFETY", "BILLETTERIE", "TSL"].includes(normalized)) {
    return normalized;
  }
  return "A_MON_COMPTE";
}

function paymentOrderAssignmentLabel(value: string | null | undefined) {
  const normalized = normalizePaymentOrderAssignment(value);
  if (normalized === "VISAS") return "Visas";
  if (normalized === "SAFETY") return "Safety";
  if (normalized === "BILLETTERIE") return "Billetterie";
  if (normalized === "TSL") return "TSL";
  return "À mon compte";
}

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
      { error: "Création d'ordre de paiement réservée au Directeur Général." },
      { status: 403 },
    );
  }

  const body = await request.json();
  const parsed = paymentOrderCreationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const now = new Date();
  const orderCurrency = normalizeMoneyCurrency(parsed.data.currency);
  const orderAssignment = normalizePaymentOrderAssignment(parsed.data.assignment);
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));

  const paymentOrder = await prisma.$transaction(async (tx) => {
    const count = await (tx as unknown as { paymentOrder: any }).paymentOrder.count({
      where: {
        createdAt: { gte: yearStart, lt: yearEnd },
      },
    });

    const sequence = String(count + 1).padStart(3, "0");
    const code = `TB-DG-OP-${sequence}-${year}`;

    return (tx as unknown as { paymentOrder: any }).paymentOrder.create({
      data: {
        code,
        beneficiary: parsed.data.beneficiary.trim(),
        purpose: parsed.data.purpose.trim(),
        description: parsed.data.description.trim(),
        assignment: orderAssignment,
        amount: parsed.data.amount,
        currency: orderCurrency,
        status: "SUBMITTED",
        issuedById: me.id,
        submittedAt: now,
      },
    });
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
        message: `${me.name} a créé l'OP ${paymentOrder.code} pour ${parsed.data.beneficiary} • Motif: ${parsed.data.purpose} • Affectation: ${paymentOrderAssignmentLabel(orderAssignment)} • Montant: ${parsed.data.amount} ${orderCurrency}. Description: ${parsed.data.description}`,
        type: "PAYMENT_ORDER_APPROVAL_REQUIRED",
        metadata: {
          paymentOrderId: paymentOrder.id,
          code: paymentOrder.code,
          beneficiary: parsed.data.beneficiary,
          purpose: parsed.data.purpose,
          assignment: orderAssignment,
          amount: parsed.data.amount,
          currency: orderCurrency,
          description: parsed.data.description,
          issuedBy: me.name,
          source: "INBOX_APPROVAL",
        },
      })),
    });
  }

  return NextResponse.json({
    data: paymentOrder,
    pdf: {
      url: `/api/payment-orders/${paymentOrder.id}/pdf`,
    },
  }, { status: 201 });
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
