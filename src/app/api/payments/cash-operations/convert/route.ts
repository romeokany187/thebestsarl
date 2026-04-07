import { NextRequest, NextResponse } from "next/server";
import { isCashierJobTitle } from "@/lib/assignment";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { cashConversionSchema } from "@/lib/validators";
import { writeActivityLog } from "@/lib/activity-log";

function amountToUsd(amount: number, currency: "USD" | "CDF", fxRateUsdToCdf: number): number {
  if (currency === "USD") return amount;
  return amount / fxRateUsdToCdf;
}

function amountToCdf(amount: number, currency: "USD" | "CDF", fxRateUsdToCdf: number): number {
  if (currency === "CDF") return amount;
  return amount * fxRateUsdToCdf;
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (access.role !== "ADMIN" && access.role !== "ACCOUNTANT" && !isCashierJobTitle(access.session.user.jobTitle) && access.session.user.jobTitle !== "COMPTABLE") {
    return NextResponse.json({ error: "Seuls l'administrateur, le comptable et les profils caisse autorisés peuvent enregistrer des conversions de caisse." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = cashConversionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const occurredAt = data.occurredAt ?? new Date();
  const sourceCurrency = data.sourceCurrency;
  const targetCurrency = sourceCurrency === "USD" ? "CDF" : "USD";
  const fxRateUsdToCdf = data.fxRateUsdToCdf;

  const sourceAmount = data.sourceAmount;
  const targetAmount = sourceCurrency === "USD"
    ? sourceAmount * fxRateUsdToCdf
    : sourceAmount / fxRateUsdToCdf;

  const sourceAmountUsd = amountToUsd(sourceAmount, sourceCurrency, fxRateUsdToCdf);
  const sourceAmountCdf = amountToCdf(sourceAmount, sourceCurrency, fxRateUsdToCdf);
  const targetAmountUsd = amountToUsd(targetAmount, targetCurrency, fxRateUsdToCdf);
  const targetAmountCdf = amountToCdf(targetAmount, targetCurrency, fxRateUsdToCdf);

  const openingExists = await (prisma as unknown as { cashOperation: any }).cashOperation.findFirst({
    where: {
      occurredAt: { lte: occurredAt },
      category: "OPENING_BALANCE",
    },
    select: { id: true },
    orderBy: { occurredAt: "desc" },
  });

  if (!openingExists) {
    return NextResponse.json(
      { error: "Le tout premier encodage de caisse doit être le report à nouveau initial (solde d'ouverture). Ensuite, le dernier solde du jour devient automatiquement le report à nouveau du lendemain." },
      { status: 400 },
    );
  }

  const ticketInflows = await prisma.payment.aggregate({
    where: {
      paidAt: { lte: occurredAt },
    },
    _sum: {
      amount: true,
    },
  });

  const previousCashOperations = await (prisma as unknown as { cashOperation: any }).cashOperation.findMany({
    where: {
      occurredAt: { lte: occurredAt },
    },
    select: {
      direction: true,
      amount: true,
      currency: true,
    },
    take: 100000,
  });

  const signedUsdFromOps = previousCashOperations.reduce(
    (sum: number, op: { direction: string; amount: number; currency: string }) => {
      if ((op.currency ?? "USD").toUpperCase() !== "USD") return sum;
      return sum + (op.direction === "INFLOW" ? op.amount : -op.amount);
    },
    0,
  );

  const signedCdfFromOps = previousCashOperations.reduce(
    (sum: number, op: { direction: string; amount: number; currency: string }) => {
      if ((op.currency ?? "USD").toUpperCase() !== "CDF") return sum;
      return sum + (op.direction === "INFLOW" ? op.amount : -op.amount);
    },
    0,
  );

  const availableUsd = (ticketInflows._sum.amount ?? 0) + signedUsdFromOps;
  const availableCdf = signedCdfFromOps;

  if (sourceCurrency === "USD" && sourceAmount > availableUsd + 0.0001) {
    return NextResponse.json(
      { error: `Solde USD insuffisant: disponible ${availableUsd.toFixed(2)} USD, conversion demandée ${sourceAmount.toFixed(2)} USD.` },
      { status: 400 },
    );
  }

  if (sourceCurrency === "CDF" && sourceAmount > availableCdf + 0.0001) {
    return NextResponse.json(
      { error: `Solde CDF insuffisant: disponible ${availableCdf.toFixed(2)} CDF, conversion demandée ${sourceAmount.toFixed(2)} CDF.` },
      { status: 400 },
    );
  }

  const ref = data.reference.trim();
  const label = data.description?.trim() || `Conversion caisse ${sourceCurrency} -> ${targetCurrency}`;

  const created = await prisma.$transaction(async (tx) => {
    const outflow = await (tx as unknown as { cashOperation: any }).cashOperation.create({
      data: {
        occurredAt,
        direction: "OUTFLOW",
        category: "FX_CONVERSION",
        amount: sourceAmount,
        currency: sourceCurrency,
        fxRateToUsd: 1 / fxRateUsdToCdf,
        fxRateUsdToCdf,
        amountUsd: sourceAmountUsd,
        amountCdf: sourceAmountCdf,
        method: "CONVERSION",
        reference: ref,
        description: `${label} - Débit ${sourceCurrency}`,
        createdById: access.session.user.id,
      },
      select: { id: true },
    });

    const inflow = await (tx as unknown as { cashOperation: any }).cashOperation.create({
      data: {
        occurredAt,
        direction: "INFLOW",
        category: "FX_CONVERSION",
        amount: targetAmount,
        currency: targetCurrency,
        fxRateToUsd: 1 / fxRateUsdToCdf,
        fxRateUsdToCdf,
        amountUsd: targetAmountUsd,
        amountCdf: targetAmountCdf,
        method: "CONVERSION",
        reference: ref,
        description: `${label} - Crédit ${targetCurrency}`,
        createdById: access.session.user.id,
      },
      select: { id: true },
    });

    return {
      reference: ref,
      sourceCurrency,
      sourceAmount,
      targetCurrency,
      targetAmount,
      fxRateUsdToCdf,
      outflowId: outflow.id,
      inflowId: inflow.id,
    };
  });

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "CASH_CONVERSION_RECORDED",
    entityType: "CASH_OPERATION",
    entityId: created.outflowId,
    summary: `Conversion caisse ${created.sourceAmount.toFixed(2)} ${created.sourceCurrency} -> ${created.targetAmount.toFixed(2)} ${created.targetCurrency}.`,
    payload: {
      reference: created.reference,
      sourceCurrency: created.sourceCurrency,
      sourceAmount: created.sourceAmount,
      targetCurrency: created.targetCurrency,
      targetAmount: created.targetAmount,
      fxRateUsdToCdf: created.fxRateUsdToCdf,
      outflowId: created.outflowId,
      inflowId: created.inflowId,
    },
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
