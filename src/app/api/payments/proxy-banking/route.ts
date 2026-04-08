import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isCashierJobTitle } from "@/lib/assignment";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { writeActivityLog } from "@/lib/activity-log";

const proxyBankingSchema = z.object({
  operationType: z.enum(["OPENING_BALANCE", "DEPOSIT", "WITHDRAWAL"]),
  channel: z.enum(["CASH", "AIRTEL_MONEY", "ORANGE_MONEY", "MPESA", "EQUITY", "RAWBANK_ILLICOCASH"]),
  amount: z.number().positive(),
  currency: z.enum(["USD", "CDF"]),
  reference: z.string().trim().min(2).max(180),
  description: z.string().trim().max(500).optional(),
  occurredAt: z.coerce.date().optional(),
});

type ProxyChannel = "CASH" | "AIRTEL_MONEY" | "ORANGE_MONEY" | "MPESA" | "EQUITY" | "RAWBANK_ILLICOCASH";

function canWriteProxyBanking(role: string, jobTitle: string | null | undefined) {
  return role === "ADMIN" || role === "ACCOUNTANT" || isCashierJobTitle(jobTitle) || jobTitle === "COMPTABLE";
}

function proxyDescriptionPrefix(operationType: "OPENING_BALANCE" | "DEPOSIT" | "WITHDRAWAL", channel: ProxyChannel) {
  return `PROXY_BANKING:${operationType}:${channel}`;
}

function normalizeCurrency(value: string | null | undefined): "USD" | "CDF" {
  return (value ?? "USD").trim().toUpperCase() === "CDF" ? "CDF" : "USD";
}

function computeProxyBalances(operations: Array<{ direction: string; amount: number; currency?: string | null; method?: string | null }>) {
  const balances: Record<ProxyChannel, { USD: number; CDF: number }> = {
    CASH: { USD: 0, CDF: 0 },
    AIRTEL_MONEY: { USD: 0, CDF: 0 },
    ORANGE_MONEY: { USD: 0, CDF: 0 },
    MPESA: { USD: 0, CDF: 0 },
    EQUITY: { USD: 0, CDF: 0 },
    RAWBANK_ILLICOCASH: { USD: 0, CDF: 0 },
  };

  for (const operation of operations) {
    const channel = ((operation.method ?? "CASH").trim().toUpperCase() || "CASH") as ProxyChannel;
    if (!balances[channel]) continue;
    const currency = normalizeCurrency(operation.currency);
    balances[channel][currency] += operation.direction === "OUTFLOW" ? -operation.amount : operation.amount;
  }

  return balances;
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canWriteProxyBanking(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Seuls les profils caisse autorisés peuvent enregistrer du proxy banking." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = proxyBankingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const occurredAt = data.occurredAt ?? new Date();
  const existingProxyOperations = await prisma.cashOperation.findMany({
    where: {
      occurredAt: { lte: occurredAt },
      description: { startsWith: "PROXY_BANKING:" },
    },
    select: {
      direction: true,
      amount: true,
      currency: true,
      method: true,
    },
    orderBy: { occurredAt: "asc" },
    take: 100000,
  });

  const balances = computeProxyBalances(existingProxyOperations);

  if (data.operationType === "OPENING_BALANCE") {
    const existingOpening = await prisma.cashOperation.findFirst({
      where: {
        category: "OPENING_BALANCE",
        method: data.channel,
        currency: data.currency,
        description: { startsWith: "PROXY_BANKING:" },
      },
      select: { id: true },
    });

    if (existingOpening) {
      return NextResponse.json(
        { error: `Un solde initial proxy banking existe déjà pour ${data.channel} en ${data.currency}.` },
        { status: 400 },
      );
    }

    const opening = await prisma.cashOperation.create({
      data: {
        occurredAt,
        direction: "INFLOW",
        category: "OPENING_BALANCE",
        amount: data.amount,
        currency: data.currency,
        method: data.channel,
        reference: data.reference,
        description: `${proxyDescriptionPrefix("OPENING_BALANCE", data.channel)}:${data.description?.trim() || "Solde initial"}`,
        createdById: access.session.user.id,
      },
      select: { id: true },
    });

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "PROXY_BANKING_OPENING_RECORDED",
      entityType: "CASH_OPERATION",
      entityId: opening.id,
      summary: `Solde initial proxy banking ${data.channel} enregistré (${data.amount.toFixed(2)} ${data.currency}).`,
      payload: {
        operationType: data.operationType,
        channel: data.channel,
        amount: data.amount,
        currency: data.currency,
        reference: data.reference,
      },
    });

    return NextResponse.json({ success: true }, { status: 201 });
  }

  if (data.channel === "CASH") {
    return NextResponse.json({ error: "Sélectionnez un canal virtuel pour un dépôt ou un retrait client." }, { status: 400 });
  }

  if (data.operationType === "DEPOSIT") {
    const availableVirtual = balances[data.channel][data.currency];
    if (data.amount > availableVirtual + 0.0001) {
      return NextResponse.json(
        { error: `Solde ${data.channel} insuffisant: disponible ${availableVirtual.toFixed(2)} ${data.currency}.` },
        { status: 400 },
      );
    }
  }

  if (data.operationType === "WITHDRAWAL") {
    const availableCash = balances.CASH[data.currency];
    if (data.amount > availableCash + 0.0001) {
      return NextResponse.json(
        { error: `Solde cash insuffisant: disponible ${availableCash.toFixed(2)} ${data.currency}.` },
        { status: 400 },
      );
    }
  }

  const label = data.description?.trim() || (data.operationType === "DEPOSIT" ? "Dépôt client" : "Retrait client");

  const created = await prisma.$transaction(async (tx) => {
    if (data.operationType === "DEPOSIT") {
      const cashIn = await tx.cashOperation.create({
        data: {
          occurredAt,
          direction: "INFLOW",
          category: "OTHER_SALE",
          amount: data.amount,
          currency: data.currency,
          method: "CASH",
          reference: data.reference,
          description: `${proxyDescriptionPrefix("DEPOSIT", data.channel)}:${label}:CASH_IN`,
          createdById: access.session.user.id,
        },
        select: { id: true },
      });

      const virtualOut = await tx.cashOperation.create({
        data: {
          occurredAt,
          direction: "OUTFLOW",
          category: "OTHER_EXPENSE",
          amount: data.amount,
          currency: data.currency,
          method: data.channel,
          reference: data.reference,
          description: `${proxyDescriptionPrefix("DEPOSIT", data.channel)}:${label}:VIRTUAL_OUT`,
          createdById: access.session.user.id,
        },
        select: { id: true },
      });

      return { cashInId: cashIn.id, virtualId: virtualOut.id };
    }

    const virtualIn = await tx.cashOperation.create({
      data: {
        occurredAt,
        direction: "INFLOW",
        category: "OTHER_SALE",
        amount: data.amount,
        currency: data.currency,
        method: data.channel,
        reference: data.reference,
        description: `${proxyDescriptionPrefix("WITHDRAWAL", data.channel)}:${label}:VIRTUAL_IN`,
        createdById: access.session.user.id,
      },
      select: { id: true },
    });

    const cashOut = await tx.cashOperation.create({
      data: {
        occurredAt,
        direction: "OUTFLOW",
        category: "OTHER_EXPENSE",
        amount: data.amount,
        currency: data.currency,
        method: "CASH",
        reference: data.reference,
        description: `${proxyDescriptionPrefix("WITHDRAWAL", data.channel)}:${label}:CASH_OUT`,
        createdById: access.session.user.id,
      },
      select: { id: true },
    });

    return { cashOutId: cashOut.id, virtualId: virtualIn.id };
  });

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "PROXY_BANKING_RECORDED",
    entityType: "CASH_OPERATION",
    entityId: created.virtualId ?? created.cashInId ?? created.cashOutId,
    summary: `${data.operationType === "DEPOSIT" ? "Dépôt" : "Retrait"} proxy banking ${data.channel} enregistré (${data.amount.toFixed(2)} ${data.currency}).`,
    payload: {
      operationType: data.operationType,
      channel: data.channel,
      amount: data.amount,
      currency: data.currency,
      reference: data.reference,
      description: label,
    },
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
