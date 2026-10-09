import { NextRequest, NextResponse } from "next/server";
import { isCashierJobTitle } from "@/lib/assignment";
import { isDeskAllowedForUser, resolveExecutionCashDesk } from "@/lib/payments-desk";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { getUserModuleAccessMap } from "@/lib/user-module-access";
import { paymentOrderExecutionSchema } from "@/lib/validators";

const paymentOrderClient = (prisma as unknown as { paymentOrder: typeof prisma.paymentOrder }).paymentOrder;

export async function PATCH(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, name: true, jobTitle: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (access.role !== "ADMIN" && access.role !== "ACCOUNTANT" && !isCashierJobTitle(me.jobTitle) && me.jobTitle !== "COMPTABLE") {
    return NextResponse.json(
      { error: "Exécution d'ordre de paiement réservée à l'administrateur, au comptable ou aux profils caisse autorisés." },
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
      { error: "Cet ordre de paiement est déjà marqué exécuté en caisse." },
      { status: 400 },
    );
  }

  const now = new Date();
  const moduleAccessMap = await getUserModuleAccessMap(access.session.user.id);
  const executionCashDesk = resolveExecutionCashDesk({
    requestedDesk: parsed.data.cashDesk,
    jobTitle: me.jobTitle,
    role: access.role,
    customModuleAccessMap: moduleAccessMap,
  });

  if (!isDeskAllowedForUser({
    desk: executionCashDesk,
    jobTitle: me.jobTitle,
    role: access.role,
    customModuleAccessMap: moduleAccessMap,
  })) {
    return NextResponse.json({ error: "Accès refusé pour cette caisse." }, { status: 403 });
  }

  const executionMemoParts = [
    `EXECUTION_CAISSE: ${now.toISOString()}`,
    "Exécution indicative — aucune écriture caisse ni impact sur le journal.",
    `Caisse (suivi): ${executionCashDesk}`,
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

  const accountants = await prisma.user.findMany({
    where: {
      OR: [{ role: "ACCOUNTANT" }, { jobTitle: "COMPTABLE" }],
    },
    select: { id: true },
    take: 120,
  });

  if (accountants.length > 0) {
    const message = [
      `Ordre de paiement: ${paymentOrder.code ?? paymentOrder.id}`,
      `Bénéficiaire: ${paymentOrder.beneficiary ?? "-"}`,
      `Motif: ${paymentOrder.purpose ?? "-"}`,
      `Description: ${paymentOrder.description}`,
      `Montant: ${paymentOrder.amount} ${paymentOrder.currency}`,
      `Demandeur: ${paymentOrder.issuedBy.name} (${paymentOrder.issuedBy.jobTitle})`,
      `Soumis: ${paymentOrder.submittedAt ? new Date(paymentOrder.submittedAt).toLocaleString("fr-FR") : "-"}`,
      `Validation Admin: ${paymentOrder.approvedBy?.name ?? "-"} (${paymentOrder.approvedAt ? new Date(paymentOrder.approvedAt).toLocaleString("fr-FR") : "-"})`,
      `Marqué exécuté en caisse (indicatif, sans écriture caisse): ${now.toLocaleString("fr-FR")}`,
      `Agent finance: ${me.name}`,
      `Référence caisse: ${parsed.data.referenceDoc}`,
      parsed.data.executionComment?.trim() ? `Commentaire caisse: ${parsed.data.executionComment.trim()}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    await prisma.userNotification.createMany({
      data: accountants.map((accountant) => ({
        userId: accountant.id,
        title: "Ordre de paiement — exécution caisse (indicatif)",
        message: `${message} | Consultez le PDF final de l'OP pour la traçabilité complète.`,
        type: "PAYMENT_ORDER_EXECUTED_NOTIFICATION",
        metadata: {
          paymentOrderId: updated.id,
          paymentStatus: updated.status,
          amount: paymentOrder.amount,
          currency: paymentOrder.currency,
          source: "INBOX_NOTIFICATION",
          cashDesk: executionCashDesk,
          informationalExecution: true,
        },
      })),
    });
  }

  return NextResponse.json(updated, { status: 200 });
}
