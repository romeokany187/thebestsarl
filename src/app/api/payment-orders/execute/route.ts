import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { paymentOrderExecutionSchema } from "@/lib/validators";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

export async function PATCH(request: NextRequest) {
  const access = await requireApiRoles(["MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, name: true, jobTitle: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (me.jobTitle !== "CAISSIERE") {
    return NextResponse.json(
      { error: "Exécution d'ordre de paiement réservée à la Caissière." },
      { status: 403 },
    );
  }

  const body = await request.json();
  const parsed = paymentOrderExecutionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const paymentOrder = await paymentOrderClient.findUnique({
    where: { id: parsed.data.paymentOrderId },
    include: {
      issuedBy: { select: { id: true, name: true, jobTitle: true } },
      approvedBy: { select: { id: true, name: true, jobTitle: true } },
    },
  });

  if (!paymentOrder) {
    return NextResponse.json({ error: "Ordre de paiement introuvable." }, { status: 404 });
  }

  if (paymentOrder.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Seul un ordre de paiement approuvé peut être exécuté." },
      { status: 400 },
    );
  }

  if ((paymentOrder.reviewComment ?? "").includes("EXECUTION_CAISSE:")) {
    return NextResponse.json(
      { error: "Cet ordre de paiement est déjà exécuté en caisse." },
      { status: 400 },
    );
  }

  const now = new Date();
  const executionMemoParts = [
    `EXECUTION_CAISSE: ${now.toISOString()}`,
    `Référence caisse: ${parsed.data.referenceDoc}`,
    `Exécuté par: ${me.name}`,
    parsed.data.executionComment?.trim() ? `Commentaire caisse: ${parsed.data.executionComment.trim()}` : null,
  ].filter(Boolean);

  const previousComment = paymentOrder.reviewComment?.trim() ?? "";
  const reviewComment = [previousComment, ...executionMemoParts]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join("\n\n");

  const updated = await paymentOrderClient.update({
    where: { id: parsed.data.paymentOrderId },
    data: {
      status: "EXECUTED",
      executedById: me.id,
      reviewComment,
      executedAt: now,
    },
  });

  // Notify accountants about the execution
  const accountants = await prisma.user.findMany({
    where: {
      OR: [{ role: "ACCOUNTANT" }, { jobTitle: "COMPTABLE" }],
    },
    select: { id: true },
    take: 120,
  });

  if (accountants.length > 0) {
    const message = [
      `Ordre de paiement: ${paymentOrder.description}`,
      `Montant: ${paymentOrder.amount} ${paymentOrder.currency}`,
      `Demandeur: ${paymentOrder.issuedBy.name} (${paymentOrder.issuedBy.jobTitle})`,
      `Soumis: ${paymentOrder.submittedAt ? new Date(paymentOrder.submittedAt).toLocaleString("fr-FR") : "-"}`,
      `Validation Admin: ${paymentOrder.approvedBy?.name ?? "-"} (${paymentOrder.approvedAt ? new Date(paymentOrder.approvedAt).toLocaleString("fr-FR") : "-"})`,
      `Commentaire Admin: ${paymentOrder.reviewComment?.trim() || "-"}`,
      `Exécution caisse: ${now.toLocaleString("fr-FR")}`,
      `Caissière: ${me.name}`,
      `Référence caisse: ${parsed.data.referenceDoc}`,
      parsed.data.executionComment?.trim() ? `Commentaire caisse: ${parsed.data.executionComment.trim()}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    await prisma.userNotification.createMany({
      data: accountants.map((accountant) => ({
        userId: accountant.id,
        title: "Ordre de paiement exécuté - notification comptable",
        message,
        type: "PAYMENT_ORDER_EXECUTED_NOTIFICATION",
        metadata: {
          paymentOrderId: updated.id,
          paymentStatus: updated.status,
          amount: paymentOrder.amount,
          currency: paymentOrder.currency,
          source: "INBOX_NOTIFICATION",
        },
      })),
    });
  }

  return NextResponse.json(updated, { status: 200 });
}
