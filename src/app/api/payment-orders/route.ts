import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { CASH_JOB_TITLES } from "@/lib/assignment";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { paymentOrderCreationSchema } from "@/lib/validators";
import { writeActivityLog } from "@/lib/activity-log";

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

function buildNextPaymentOrderCode(existingCodes: Array<string | null | undefined>, codePrefix: string, year: number) {
  const maxSequence = existingCodes.reduce((max, code) => {
    const match = (code ?? "").match(/-(\d+)-\d{4}$/);
    if (!match) return max;
    const sequence = Number.parseInt(match[1], 10);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);

  const nextSequence = String(maxSequence + 1).padStart(3, "0");
  return `${codePrefix}-${nextSequence}-${year}`;
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["DIRECTEUR_GENERAL", "ADMIN"]);
  if (access.error) return access.error;

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, name: true, jobTitle: true, role: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  const canCreate = access.role === "DIRECTEUR_GENERAL" || access.role === "ADMIN";
  if (!canCreate) {
    return NextResponse.json(
      { error: "Création d'ordre de paiement réservée au Directeur Général ou à l'administrateur." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const parsed = paymentOrderCreationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const now = new Date();
    const isAdminIssuer = access.role === "ADMIN";
    const issuerLabel = isAdminIssuer ? "Admin" : "DG";
    const codePrefix = isAdminIssuer ? "TB-ADM-OP" : "TB-DG-OP";
    const orderCurrency = normalizeMoneyCurrency(parsed.data.currency);
    const orderAssignment = normalizePaymentOrderAssignment(parsed.data.assignment);
    const year = now.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));

    const paymentOrder = await prisma.$transaction(async (tx) => {
      const existingOrders = await (tx as unknown as { paymentOrder: any }).paymentOrder.findMany({
        where: {
          createdAt: { gte: yearStart, lt: yearEnd },
          code: { startsWith: `${codePrefix}-` },
        },
        select: { code: true },
        take: 5000,
      });

      const code = buildNextPaymentOrderCode(existingOrders.map((order: { code?: string | null }) => order.code), codePrefix, year);

      return (tx as unknown as { paymentOrder: any }).paymentOrder.create({
        data: {
          code,
          beneficiary: parsed.data.beneficiary.trim(),
          purpose: parsed.data.purpose.trim(),
          description: parsed.data.description.trim(),
          assignment: orderAssignment,
          amount: parsed.data.amount,
          currency: orderCurrency,
          status: isAdminIssuer ? "APPROVED" : "SUBMITTED",
          issuedById: me.id,
          submittedAt: now,
          approvedById: isAdminIssuer ? me.id : undefined,
          approvedAt: isAdminIssuer ? now : undefined,
        },
      });
    });

    const notifications: Array<{
      userId: string;
      title: string;
      message: string;
      type: string;
      paymentOrderId: string;
      metadata: Prisma.InputJsonValue;
    }> = [];

    if (isAdminIssuer) {
      const financeExecutionUsers = await prisma.user.findMany({
        where: {
          OR: [
            { role: { in: ["ADMIN", "ACCOUNTANT"] } },
            { jobTitle: { in: [...CASH_JOB_TITLES, "COMPTABLE"] } },
          ],
        },
        select: { id: true },
        take: 160,
      });

      financeExecutionUsers.forEach((financeUser) => {
        notifications.push({
          userId: financeUser.id,
          title: "Ordre de paiement admin à exécuter",
          message: `L'ordre de paiement ${paymentOrder.code} pour ${parsed.data.beneficiary} (${parsed.data.amount} ${orderCurrency}) a été émis par l'admin ${me.name}. Exécution directe depuis Paiements.`,
          type: "PAYMENT_ORDER_EXECUTION_REQUIRED",
          paymentOrderId: paymentOrder.id,
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
            issuedByRole: me.role,
            source: "PAYMENTS_EXECUTION",
          },
        });
      });
    } else {
      const admins = await prisma.user.findMany({
        where: {
          role: "ADMIN",
        },
        select: { id: true },
        take: 100,
      });

      admins.forEach((admin) => {
        notifications.push({
          userId: admin.id,
          title: "Nouvel OP à approuver",
          message: `Vous avez un nouvel ordre de paiement à approuver émis par la DG ${me.name} : ${paymentOrder.code} pour ${parsed.data.beneficiary} (${parsed.data.amount} ${orderCurrency}).`,
          type: "PAYMENT_ORDER_APPROVAL_REQUIRED",
          paymentOrderId: paymentOrder.id,
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
            issuedByRole: me.role,
            source: "INBOX_APPROVAL",
          },
        });
      });
    }

    if (notifications.length > 0) {
      const unique = notifications.filter((notification, index, list) => {
        return list.findIndex((item) => item.userId === notification.userId && item.type === notification.type && item.paymentOrderId === notification.paymentOrderId) === index;
      });

      try {
        await prisma.userNotification.createMany({
          data: unique.map(({ paymentOrderId: _paymentOrderId, ...notification }) => notification),
        });
      } catch (notificationError) {
        console.error("[payment-orders.create] Notification error", notificationError);
      }
    }

    try {
      await writeActivityLog({
        actorId: access.session.user.id,
        action: "PAYMENT_ORDER_CREATED",
        entityType: "PAYMENT_ORDER",
        entityId: paymentOrder.id,
        summary: `OP ${paymentOrder.code} émis par ${issuerLabel} pour ${paymentOrder.beneficiary} (${paymentOrder.amount.toFixed(2)} ${paymentOrder.currency}).`,
        payload: {
          code: paymentOrder.code,
          beneficiary: paymentOrder.beneficiary,
          purpose: paymentOrder.purpose,
          assignment: paymentOrder.assignment,
          amount: paymentOrder.amount,
          currency: paymentOrder.currency,
          issuedByRole: issuerLabel,
          status: paymentOrder.status,
        },
      });
    } catch (activityError) {
      console.error("[payment-orders.create] Activity log error", activityError);
    }

    return NextResponse.json({
      data: paymentOrder,
      pdf: {
        url: `/api/payment-orders/${paymentOrder.id}/pdf`,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("[payment-orders.create] Failed", error);

    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "Un numéro d'ordre de paiement identique existe déjà. Réessayez l'opération." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Erreur serveur lors de la création de l'ordre de paiement." },
      { status: 500 },
    );
  }
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

export async function DELETE(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "DIRECTEUR_GENERAL"]);
  if (access.error) return access.error;

  const paymentOrderId = request.nextUrl.searchParams.get("paymentOrderId")?.trim() ?? "";
  if (!paymentOrderId) {
    return NextResponse.json({ error: "Ordre de paiement introuvable." }, { status: 400 });
  }

  const existingOrder = await paymentOrderClient.findUnique({
    where: { id: paymentOrderId },
    select: {
      id: true,
      code: true,
      beneficiary: true,
      amount: true,
      currency: true,
      status: true,
      issuedById: true,
      executedAt: true,
    },
  });

  if (!existingOrder) {
    return NextResponse.json({ error: "Ordre de paiement introuvable." }, { status: 404 });
  }

  if (existingOrder.status === "EXECUTED" || existingOrder.executedAt) {
    return NextResponse.json(
      { error: "Impossible de supprimer un ordre de paiement déjà exécuté." },
      { status: 400 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.userNotification.deleteMany({
      where: {
        OR: [
          { metadata: { path: "$.paymentOrderId", equals: existingOrder.id } },
          ...(existingOrder.code
            ? [{ message: { contains: existingOrder.code } }]
            : []),
        ],
      },
    });

    await (tx as unknown as { paymentOrder: any }).paymentOrder.delete({ where: { id: existingOrder.id } });
  });

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "PAYMENT_ORDER_DELETED",
    entityType: "PAYMENT_ORDER",
    entityId: existingOrder.id,
    summary: `OP ${existingOrder.code ?? existingOrder.id} supprimé pour ${existingOrder.beneficiary}.`,
    payload: {
      code: existingOrder.code,
      beneficiary: existingOrder.beneficiary,
      amount: existingOrder.amount,
      currency: existingOrder.currency,
      status: existingOrder.status,
    },
  });

  return NextResponse.json({ success: true });
}
