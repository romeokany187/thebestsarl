import { NextRequest, NextResponse } from "next/server";
import { isCashierJobTitle } from "@/lib/assignment";
import { resolveExecutionCashDesk } from "@/lib/payments-desk";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { paymentOrderExecutionSchema } from "@/lib/validators";
import { writeActivityLog } from "@/lib/activity-log";
import { getCashDeskAvailableBalances } from "@/lib/cash-balance";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

function normalizeCashCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  if (normalized === "USD") return "USD";
  if (normalized === "CDF" || normalized === "XAF" || normalized === "FC") return "CDF";
  return "USD";
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
      { error: "Cet ordre de paiement est déjà exécuté en caisse." },
      { status: 400 },
    );
  }

  const now = new Date();
  const paymentCurrency = normalizeCashCurrency(paymentOrder.currency);
  const fxRateUsdToCdf = parsePositiveNumber(process.env.CASH_DEFAULT_USD_TO_CDF_RATE, 2800);
  const executionCashDesk = resolveExecutionCashDesk({
    requestedDesk: parsed.data.cashDesk,
    jobTitle: me.jobTitle,
    role: access.role,
  });

  const deskBalances = await getCashDeskAvailableBalances({
    client: prisma,
    occurredAt: now,
    cashDesk: executionCashDesk,
    fxRateUsdToCdf,
  });

  const availableUsd = deskBalances.availableUsd;
  const availableCdf = deskBalances.availableCdf;

  if (paymentCurrency === "USD" && paymentOrder.amount > availableUsd + 0.0001) {
    return NextResponse.json(
      {
        error: `Solde USD insuffisant pour exécuter l'ordre: disponible ${availableUsd.toFixed(2)} USD, requis ${paymentOrder.amount.toFixed(2)} USD.`,
      },
      { status: 400 },
    );
  }

  if (paymentCurrency === "CDF" && paymentOrder.amount > availableCdf + 0.0001) {
    return NextResponse.json(
      {
        error: `Solde CDF insuffisant pour exécuter l'ordre: disponible ${availableCdf.toFixed(2)} CDF, requis ${paymentOrder.amount.toFixed(2)} CDF.`,
      },
      { status: 400 },
    );
  }

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
  const updated = await prisma.$transaction(async (tx) => {
    const operation = await (tx as unknown as { cashOperation: any }).cashOperation.create({
      data: {
        occurredAt: now,
        direction: "OUTFLOW",
        category: "OTHER_EXPENSE",
        amount: paymentOrder.amount,
        currency: paymentCurrency,
        fxRateToUsd: 1 / fxRateUsdToCdf,
        fxRateUsdToCdf,
        amountUsd: paymentCurrency === "USD" ? paymentOrder.amount : paymentOrder.amount / fxRateUsdToCdf,
        amountCdf: paymentCurrency === "CDF" ? paymentOrder.amount : paymentOrder.amount * fxRateUsdToCdf,
        method: "CASH",
        reference: parsed.data.referenceDoc,
        description: `Exécution OP ${paymentOrder.code ?? paymentOrder.id} - ${paymentOrder.beneficiary} - ${paymentOrder.description}`,
        createdById: me.id,
        cashDesk: executionCashDesk,
      },
      select: { id: true },
    });

    const order = await (tx as unknown as { paymentOrder: any }).paymentOrder.update({
      where: { id: parsed.data.paymentOrderId },
      data: {
        status: "EXECUTED",
        executedById: me.id,
        reviewComment,
        executedAt: now,
      },
    });

    return { ...order, cashOperationId: operation.id };
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
      `Ordre de paiement: ${paymentOrder.code ?? paymentOrder.id}`,
      `Bénéficiaire: ${paymentOrder.beneficiary ?? "-"}`,
      `Motif: ${paymentOrder.purpose ?? "-"}`,
      `Description: ${paymentOrder.description}`,
      `Montant: ${paymentOrder.amount} ${paymentOrder.currency}`,
      `Demandeur: ${paymentOrder.issuedBy.name} (${paymentOrder.issuedBy.jobTitle})`,
      `Soumis: ${paymentOrder.submittedAt ? new Date(paymentOrder.submittedAt).toLocaleString("fr-FR") : "-"}`,
      `Validation Admin: ${paymentOrder.approvedBy?.name ?? "-"} (${paymentOrder.approvedAt ? new Date(paymentOrder.approvedAt).toLocaleString("fr-FR") : "-"})`,
      `Commentaire Admin: ${paymentOrder.reviewComment?.trim() || "-"}`,
      `Exécution caisse: ${now.toLocaleString("fr-FR")}`,
      `Agent finance: ${me.name}`,
      `Référence caisse: ${parsed.data.referenceDoc}`,
      `Écriture sortie caisse: ${updated.cashOperationId}`,
      parsed.data.executionComment?.trim() ? `Commentaire caisse: ${parsed.data.executionComment.trim()}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    await prisma.userNotification.createMany({
      data: accountants.map((accountant) => ({
        userId: accountant.id,
        title: "Ordre de paiement exécuté - notification comptable",
        message: `${message} | Consultez le PDF final de l'OP pour la traçabilité complète.`,
        type: "PAYMENT_ORDER_EXECUTED_NOTIFICATION",
        metadata: {
          paymentOrderId: updated.id,
          paymentStatus: updated.status,
          amount: paymentOrder.amount,
          currency: paymentOrder.currency,
          source: "INBOX_NOTIFICATION",
          cashDesk: executionCashDesk,
        },
      })),
    });
  }

  return NextResponse.json(updated, { status: 200 });
}
