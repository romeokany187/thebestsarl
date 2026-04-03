import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { needExecutionSchema } from "@/lib/validators";

const cashOperationClient = (prisma as unknown as { cashOperation: any }).cashOperation;

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

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, name: true, jobTitle: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (me.jobTitle !== "CAISSIER") {
    return NextResponse.json({ error: "Exécution réservée au caissier." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = needExecutionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const need = await prisma.needRequest.findUnique({
    where: { id: parsed.data.needRequestId },
    include: {
      requester: { select: { id: true, name: true, jobTitle: true } },
      reviewedBy: { select: { id: true, name: true, jobTitle: true } },
    },
  });

  if (!need) {
    return NextResponse.json({ error: "État de besoin introuvable." }, { status: 404 });
  }

  if (need.status !== "APPROVED") {
    return NextResponse.json({ error: "Seul un EDB approuvé peut être exécuté." }, { status: 400 });
  }

  if ((need.reviewComment ?? "").includes("EXECUTION_CAISSE:")) {
    return NextResponse.json({ error: "Cet état de besoin est déjà exécuté en caisse." }, { status: 400 });
  }

  if (!need.estimatedAmount || need.estimatedAmount <= 0) {
    return NextResponse.json(
      { error: "Montant estimé invalide. Impossible d'exécuter automatiquement la sortie caisse." },
      { status: 400 },
    );
  }
  const executionAmount = need.estimatedAmount;

  const now = new Date();
  const needCurrency = normalizeCashCurrency(need.currency);
  const fxRateUsdToCdf = parsePositiveNumber(process.env.CASH_DEFAULT_USD_TO_CDF_RATE, 2800);

  const ticketInflows = await prisma.payment.aggregate({
    where: {
      paidAt: { lte: now },
    },
    _sum: {
      amount: true,
    },
  });

  const previousCashOperations = await cashOperationClient.findMany({
    where: {
      occurredAt: { lte: now },
    },
    select: {
      direction: true,
      amount: true,
      currency: true,
    },
    take: 100000,
  });

  const availableUsd = (ticketInflows._sum.amount ?? 0) + previousCashOperations.reduce(
    (sum: number, op: { direction: string; amount: number; currency?: string }) => {
      if (normalizeCashCurrency(op.currency) !== "USD") return sum;
      return sum + (op.direction === "INFLOW" ? op.amount : -op.amount);
    },
    0,
  );

  const availableCdf = previousCashOperations.reduce(
    (sum: number, op: { direction: string; amount: number; currency?: string }) => {
      if (normalizeCashCurrency(op.currency) !== "CDF") return sum;
      return sum + (op.direction === "INFLOW" ? op.amount : -op.amount);
    },
    0,
  );

  if (needCurrency === "USD" && executionAmount > availableUsd + 0.0001) {
    return NextResponse.json(
      {
        error: `Solde USD insuffisant pour exécuter l'EDB: disponible ${availableUsd.toFixed(2)} USD, requis ${executionAmount.toFixed(2)} USD.`,
      },
      { status: 400 },
    );
  }

  if (needCurrency === "CDF" && executionAmount > availableCdf + 0.0001) {
    return NextResponse.json(
      {
        error: `Solde CDF insuffisant pour exécuter l'EDB: disponible ${availableCdf.toFixed(2)} CDF, requis ${executionAmount.toFixed(2)} CDF.`,
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

  const previousComment = need.reviewComment?.trim() ?? "";
  const reviewComment = [previousComment, ...executionMemoParts]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join("\n\n");

  const updated = await prisma.$transaction(async (tx) => {
    const operation = await (tx as unknown as { cashOperation: any }).cashOperation.create({
      data: {
        occurredAt: now,
        direction: "OUTFLOW",
        category: "SUPPLIER_PAYMENT",
        amount: executionAmount,
        currency: needCurrency,
        fxRateToUsd: 1 / fxRateUsdToCdf,
        fxRateUsdToCdf,
        amountUsd: needCurrency === "USD" ? executionAmount : executionAmount / fxRateUsdToCdf,
        amountCdf: needCurrency === "CDF" ? executionAmount : executionAmount * fxRateUsdToCdf,
        method: "CASH",
        reference: parsed.data.referenceDoc,
        description: `Exécution EDB ${need.code ?? need.id} - ${need.title}`,
        createdById: me.id,
      },
      select: { id: true },
    });

    const updatedNeed = await (tx as unknown as { needRequest: any }).needRequest.update({
      where: { id: need.id },
      data: {
        status: "APPROVED",
        reviewComment,
        sealedAt: now,
      },
    });

    return { ...updatedNeed, cashOperationId: operation.id };
  });

  const accountants = await prisma.user.findMany({
    where: {
      OR: [
        { role: "ACCOUNTANT" },
        { jobTitle: "COMPTABLE" },
      ],
    },
    select: { id: true },
    take: 120,
  });

  if (accountants.length > 0) {
    const message = [
      `EDB: ${need.code ?? need.title} - ${need.title}`,
      `Demandeur: ${need.requester.name} (${need.requester.jobTitle})`,
      `Soumis: ${need.submittedAt ? new Date(need.submittedAt).toLocaleString("fr-FR") : "-"}`,
      `Validation DG: ${need.reviewedBy?.name ?? "-"} (${need.approvedAt ? new Date(need.approvedAt).toLocaleString("fr-FR") : "-"})`,
      `Commentaire DG: ${need.reviewComment?.trim() || "-"}`,
      `Exécution caisse: ${now.toLocaleString("fr-FR")}`,
      `Caissier: ${me.name}`,
      `Référence caisse: ${parsed.data.referenceDoc}`,
      `Écriture sortie caisse: ${updated.cashOperationId}`,
      parsed.data.executionComment?.trim() ? `Commentaire caisse: ${parsed.data.executionComment.trim()}` : null,
    ].filter(Boolean).join(" | ");

    await prisma.userNotification.createMany({
      data: accountants.map((accountant) => ({
        userId: accountant.id,
        title: "EDB exécuté - validation comptable requise",
        message,
        type: "PROCUREMENT_ACCOUNTING_APPROVAL",
        metadata: {
          needRequestId: updated.id,
          needStatus: updated.status,
          needTitle: updated.title,
          source: "INBOX_ACCOUNTING_APPROVAL",
          executedAt: now.toISOString(),
          executedByUserId: me.id,
          cashOperationId: updated.cashOperationId,
          referenceDoc: parsed.data.referenceDoc,
        } as Prisma.InputJsonValue,
      })),
    });
  }

  return NextResponse.json({ data: updated });
}
