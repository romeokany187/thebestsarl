import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { paymentOrderApprovalSchema } from "@/lib/validators";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

export async function PATCH(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN"]);
  if (access.error) return access.error;

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, role: true, jobTitle: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  const canApprove = access.role === "ADMIN";
  if (!canApprove) {
    return NextResponse.json(
      { error: "Approbation d'ordre de paiement réservée à l'Administrateur." },
      { status: 403 },
    );
  }

  const body = await request.json();
  const parsed = paymentOrderApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const paymentOrder = await paymentOrderClient.findUnique({
    where: { id: parsed.data.paymentOrderId },
    select: { id: true, code: true, status: true, beneficiary: true, purpose: true, assignment: true, description: true, amount: true, currency: true },
  });

  if (!paymentOrder) {
    return NextResponse.json({ error: "Ordre de paiement introuvable." }, { status: 404 });
  }

  if (paymentOrder.status !== "SUBMITTED") {
    return NextResponse.json(
      { error: "Cet ordre de paiement a déjà été traité. Une décision admin ne peut être faite qu'une seule fois." },
      { status: 400 },
    );
  }

  const now = new Date();
  const nextStatus = parsed.data.status;

  const updated = await paymentOrderClient.update({
    where: { id: parsed.data.paymentOrderId },
    data: {
      status: nextStatus === "APPROVED" ? "APPROVED" : "REJECTED",
      approvedById: me.id,
      reviewComment: parsed.data.reviewComment,
      approvedAt: now,
    },
  });

  const notifications: Array<{
    userId: string;
    title: string;
    message: string;
    type: string;
    metadata: { paymentOrderId: string; paymentStatus: string; source: string };
  }> = [];

  // Notify the issuer about the decision
  const issuer = await paymentOrderClient.findUnique({
    where: { id: parsed.data.paymentOrderId },
    include: { issuedBy: { select: { id: true } } },
  });

  if (issuer?.issuedBy?.id) {
    notifications.push({
      userId: issuer.issuedBy.id,
      title: "Décision sur votre ordre de paiement",
      message: `Votre ordre de paiement ${paymentOrder.code ?? ""} pour ${paymentOrder.beneficiary} (${paymentOrder.amount} ${paymentOrder.currency}) a été ${nextStatus === "APPROVED" ? "approuvé" : "rejeté"}. Le PDF OP reflète maintenant cette décision.`,
      type: "PAYMENT_ORDER_DECISION",
      metadata: {
        paymentOrderId: updated.id,
        paymentStatus: updated.status,
        source: "INBOX_DECISION",
      },
    });
  }

  // If approved, notify all authorized finance executors
  if (nextStatus === "APPROVED") {
    const financeExecutionUsers = await prisma.user.findMany({
      where: {
        OR: [
          { role: { in: ["ADMIN", "ACCOUNTANT"] } },
          { jobTitle: { in: ["CAISSIER", "COMPTABLE"] } },
        ],
      },
      select: { id: true },
      take: 160,
    });

    financeExecutionUsers.forEach((financeUser) => {
      notifications.push({
        userId: financeUser.id,
        title: "Ordre de paiement approuvé à exécuter",
        message: `L'ordre de paiement ${paymentOrder.code ?? ""} pour ${paymentOrder.beneficiary} (${paymentOrder.amount} ${paymentOrder.currency}) est approuvé. ${paymentOrder.description}. Lisez le PDF OP puis exécutez depuis votre inbox.`,
        type: "PAYMENT_ORDER_EXECUTION_REQUIRED",
        metadata: {
          paymentOrderId: updated.id,
          paymentStatus: updated.status,
          source: "INBOX_EXECUTION",
        },
      });
    });
  }

  if (notifications.length > 0) {
    const unique = notifications.filter((notification, index, list) => {
      return list.findIndex((item) => item.userId === notification.userId && item.type === notification.type && item.metadata.paymentOrderId === notification.metadata.paymentOrderId) === index;
    });

    await prisma.userNotification.createMany({
      data: unique,
    });
  }

  return NextResponse.json(updated, { status: 200 });
}
