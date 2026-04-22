// L'administrateur et le comptable peuvent modifier ou supprimer une opération proxy banking
export async function PATCH(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canReviewCashOperationApprovals(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Seuls l'administrateur et le comptable peuvent modifier une opération proxy banking." }, { status: 403 });
  }

  const body = await request.json();
  const cashOperationId = typeof body?.cashOperationId === "string" ? body.cashOperationId.trim() : "";
  if (!cashOperationId) {
    return NextResponse.json({ error: "Opération proxy banking introuvable." }, { status: 400 });
  }

  const existing = await prisma.cashOperation.findUnique({ where: { id: cashOperationId } });
  if (!existing || !(existing.description ?? "").startsWith("PROXY_BANKING:")) {
    return NextResponse.json({ error: "Opération proxy banking introuvable." }, { status: 404 });
  }

  const parsedExisting = parseProxyOperationDescription(existing.description);
  if (!parsedExisting) {
    return NextResponse.json({ error: "Métadonnées proxy banking invalides." }, { status: 400 });
  }

  const amount = typeof body?.amount === "number" ? body.amount : existing.amount;
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Montant invalide." }, { status: 400 });
  }

  const currency = typeof body?.currency === "string" ? body.currency.trim().toUpperCase() : normalizeCurrency(existing.currency);
  if (currency !== "USD" && currency !== "CDF") {
    return NextResponse.json({ error: "Devise invalide. Utilisez USD ou CDF." }, { status: 400 });
  }

  const reference = typeof body?.reference === "string" && body.reference.trim()
    ? body.reference.trim()
    : (existing.reference ?? "").trim();
  if (!reference) {
    return NextResponse.json({ error: "La référence justificative est obligatoire." }, { status: 400 });
  }

  const occurredAt = typeof body?.occurredAt === "string" ? new Date(body.occurredAt) : new Date(existing.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: "Date invalide." }, { status: 400 });
  }

  const nextChannel = typeof body?.channel === "string"
    ? body.channel.trim().toUpperCase() as ProxyChannel
    : parsedExisting.channel;
  const nextLabel = typeof body?.description === "string" && body.description.trim()
    ? body.description.trim()
    : parsedExisting.label;

  let updated: unknown;

  if (parsedExisting.operationType === "OTHER") {
    return NextResponse.json({ error: "Les autres opérations proxy banking se modifient depuis le formulaire de caisse dédié." }, { status: 400 });
  }

  if (parsedExisting.operationType === "EXCHANGE") {
    const sibling = await prisma.cashOperation.findFirst({
      where: {
        id: { not: existing.id },
        cashDesk: "PROXY_BANKING",
        occurredAt: existing.occurredAt,
        reference: existing.reference,
        category: "FX_CONVERSION",
        description: { startsWith: "PROXY_BANKING:EXCHANGE:" },
      },
    });

    if (!sibling) {
      return NextResponse.json({ error: "Impossible de retrouver l'opération de change liée à modifier." }, { status: 409 });
    }

    const receivedCurrency = typeof body?.receivedCurrency === "string" ? body.receivedCurrency.trim().toUpperCase() : "";
    if (receivedCurrency !== "USD" && receivedCurrency !== "CDF") {
      return NextResponse.json({ error: "Devise reçue invalide. Utilisez USD ou CDF." }, { status: 400 });
    }

    const receivedAmount = typeof body?.receivedAmount === "number" ? body.receivedAmount : NaN;
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      return NextResponse.json({ error: "Montant reçu invalide." }, { status: 400 });
    }

    const fxRateUsdToCdf = typeof body?.fxRateUsdToCdf === "number" ? body.fxRateUsdToCdf : NaN;
    if (!Number.isFinite(fxRateUsdToCdf) || fxRateUsdToCdf <= 0) {
      return NextResponse.json({ error: "Taux USD/CDF invalide." }, { status: 400 });
    }

    const paidCurrency = receivedCurrency === "USD" ? "CDF" : "USD";
    const paidAmount = receivedCurrency === "USD"
      ? receivedAmount * fxRateUsdToCdf
      : receivedAmount / fxRateUsdToCdf;
    const exchangeLabel = nextLabel.startsWith("PROXY_BANKING:EXCHANGE:")
      ? nextLabel.replace(/^PROXY_BANKING:EXCHANGE:/, "").trim()
      : nextLabel;

    const inflowDescription = `PROXY_BANKING:EXCHANGE:${exchangeLabel} - Crédit ${receivedCurrency}`;
    const outflowDescription = `PROXY_BANKING:EXCHANGE:${exchangeLabel} - Débit ${paidCurrency}`;

    updated = await prisma.$transaction(async (tx) => {
      const inflowId = existing.direction === "INFLOW" ? existing.id : sibling.id;
      const outflowId = existing.direction === "OUTFLOW" ? existing.id : sibling.id;

      const updatedInflow = await tx.cashOperation.update({
        where: { id: inflowId },
        data: {
          occurredAt,
          direction: "INFLOW",
          category: "FX_CONVERSION",
          amount: receivedAmount,
          currency: receivedCurrency,
          fxRateToUsd: 1 / fxRateUsdToCdf,
          fxRateUsdToCdf,
          amountUsd: receivedCurrency === "USD" ? receivedAmount : receivedAmount / fxRateUsdToCdf,
          amountCdf: receivedCurrency === "CDF" ? receivedAmount : receivedAmount * fxRateUsdToCdf,
          method: "CASH",
          reference,
          description: inflowDescription,
        },
      });

      await tx.cashOperation.update({
        where: { id: outflowId },
        data: {
          occurredAt,
          direction: "OUTFLOW",
          category: "FX_CONVERSION",
          amount: paidAmount,
          currency: paidCurrency,
          fxRateToUsd: 1 / fxRateUsdToCdf,
          fxRateUsdToCdf,
          amountUsd: paidCurrency === "USD" ? paidAmount : paidAmount / fxRateUsdToCdf,
          amountCdf: paidCurrency === "CDF" ? paidAmount : paidAmount * fxRateUsdToCdf,
          method: "CASH",
          reference,
          description: outflowDescription,
        },
      });

      return updatedInflow;
    });
  } else if (parsedExisting.operationType === "OPENING_BALANCE") {
    updated = await prisma.cashOperation.update({
      where: { id: existing.id },
      data: {
        occurredAt,
        amount,
        currency,
        reference,
        method: nextChannel,
        description: buildProxyOperationDescription("OPENING_BALANCE", nextChannel, nextLabel || "Solde initial"),
      },
    });
  } else {
    if (nextChannel === "CASH") {
      return NextResponse.json({ error: "Choisissez un canal virtuel pour cette opération proxy banking." }, { status: 400 });
    }

    const operationType = parsedExisting.operationType as "DEPOSIT" | "WITHDRAWAL" | "FLOAT_TO_VIRTUAL" | "FLOAT_TO_CASH";
    const sibling = await prisma.cashOperation.findFirst({
      where: {
        id: { not: existing.id },
        cashDesk: "PROXY_BANKING",
        occurredAt: existing.occurredAt,
        amount: existing.amount,
        currency: existing.currency,
        reference: existing.reference,
        description: { startsWith: proxyDescriptionPrefix(operationType, parsedExisting.channel as ProxyChannel) },
      },
    });

    if (!sibling) {
      return NextResponse.json({ error: "Impossible de retrouver l'opération liée à modifier." }, { status: 409 });
    }

    const parsedSibling = parseProxyOperationDescription(sibling.description);
    if (!parsedExisting.suffix || !parsedSibling?.suffix) {
      return NextResponse.json({ error: "Impossible d'identifier les écritures cash et virtuel de cette opération." }, { status: 409 });
    }

    const primarySuffix = parsedExisting.suffix;
    const siblingSuffix = parsedSibling.suffix;

    const finalLabel = nextLabel || (
      operationType === "DEPOSIT"
        ? "Dépôt client"
        : operationType === "WITHDRAWAL"
          ? "Retrait client"
          : operationType === "FLOAT_TO_VIRTUAL"
            ? "Approvisionnement virtuel"
            : "Retrait vers cash"
    );

    const shapesBySuffix: Record<typeof PROXY_BANKING_ROW_SUFFIXES[number], {
      direction: "INFLOW" | "OUTFLOW";
      category: "OTHER_SALE" | "OTHER_EXPENSE";
      method: string;
      description: string;
    }> = operationType === "DEPOSIT"
      ? {
        CASH_IN: {
          direction: "INFLOW",
          category: "OTHER_SALE",
          method: "CASH",
          description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "CASH_IN"),
        },
        CASH_OUT: {
          direction: "INFLOW",
          category: "OTHER_SALE",
          method: "CASH",
          description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "CASH_IN"),
        },
        VIRTUAL_IN: {
          direction: "OUTFLOW",
          category: "OTHER_EXPENSE",
          method: nextChannel,
          description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "VIRTUAL_OUT"),
        },
        VIRTUAL_OUT: {
          direction: "OUTFLOW",
          category: "OTHER_EXPENSE",
          method: nextChannel,
          description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "VIRTUAL_OUT"),
        },
      }
      : operationType === "WITHDRAWAL"
        ? {
          CASH_IN: {
            direction: "OUTFLOW",
            category: "OTHER_EXPENSE",
            method: "CASH",
            description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "CASH_OUT"),
          },
          CASH_OUT: {
            direction: "OUTFLOW",
            category: "OTHER_EXPENSE",
            method: "CASH",
            description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "CASH_OUT"),
          },
          VIRTUAL_IN: {
            direction: "INFLOW",
            category: "OTHER_SALE",
            method: nextChannel,
            description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "VIRTUAL_IN"),
          },
          VIRTUAL_OUT: {
            direction: "INFLOW",
            category: "OTHER_SALE",
            method: nextChannel,
            description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "VIRTUAL_IN"),
          },
        }
        : operationType === "FLOAT_TO_VIRTUAL"
          ? {
            CASH_IN: {
              direction: "OUTFLOW",
              category: "OTHER_EXPENSE",
              method: "CASH",
              description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "CASH_OUT"),
            },
            CASH_OUT: {
              direction: "OUTFLOW",
              category: "OTHER_EXPENSE",
              method: "CASH",
              description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "CASH_OUT"),
            },
            VIRTUAL_IN: {
              direction: "INFLOW",
              category: "OTHER_SALE",
              method: nextChannel,
              description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "VIRTUAL_IN"),
            },
            VIRTUAL_OUT: {
              direction: "INFLOW",
              category: "OTHER_SALE",
              method: nextChannel,
              description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "VIRTUAL_IN"),
            },
          }
          : {
            CASH_IN: {
              direction: "INFLOW",
              category: "OTHER_SALE",
              method: "CASH",
              description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "CASH_IN"),
            },
            CASH_OUT: {
              direction: "INFLOW",
              category: "OTHER_SALE",
              method: "CASH",
              description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "CASH_IN"),
            },
            VIRTUAL_IN: {
              direction: "OUTFLOW",
              category: "OTHER_EXPENSE",
              method: nextChannel,
              description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "VIRTUAL_OUT"),
            },
            VIRTUAL_OUT: {
              direction: "OUTFLOW",
              category: "OTHER_EXPENSE",
              method: nextChannel,
              description: buildProxyOperationDescription(operationType, nextChannel, finalLabel, "VIRTUAL_OUT"),
            },
          };

    updated = await prisma.$transaction(async (tx) => {
      const updatedPrimary = await tx.cashOperation.update({
        where: { id: existing.id },
        data: {
          occurredAt,
          amount,
          currency,
          reference,
          direction: shapesBySuffix[primarySuffix].direction,
          category: shapesBySuffix[primarySuffix].category,
          method: shapesBySuffix[primarySuffix].method,
          description: shapesBySuffix[primarySuffix].description,
        },
      });

      await tx.cashOperation.update({
        where: { id: sibling.id },
        data: {
          occurredAt,
          amount,
          currency,
          reference,
          direction: shapesBySuffix[siblingSuffix].direction,
          category: shapesBySuffix[siblingSuffix].category,
          method: shapesBySuffix[siblingSuffix].method,
          description: shapesBySuffix[siblingSuffix].description,
        },
      });

      return updatedPrimary;
    });
  }

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "PROXY_BANKING_UPDATED",
    entityType: "CASH_OPERATION",
    entityId: cashOperationId,
    summary: `Opération proxy banking modifiée: ${reference}`,
    payload: { cashOperationId, reference },
  });

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canReviewCashOperationApprovals(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Seuls l'administrateur et le comptable peuvent supprimer une opération proxy banking." }, { status: 403 });
  }

  const cashOperationId = request.nextUrl.searchParams.get("cashOperationId")?.trim() ?? request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!cashOperationId) {
    return NextResponse.json({ error: "Opération proxy banking introuvable." }, { status: 400 });
  }

  const existing = await prisma.cashOperation.findUnique({ where: { id: cashOperationId } });
  if (!existing || !(existing.description ?? "").startsWith("PROXY_BANKING:")) {
    return NextResponse.json({ error: "Opération proxy banking introuvable." }, { status: 404 });
  }

  await prisma.cashOperation.delete({ where: { id: cashOperationId } });

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "PROXY_BANKING_DELETED",
    entityType: "CASH_OPERATION",
    entityId: cashOperationId,
    summary: `Opération proxy banking supprimée: ${existing.amount?.toFixed(2) ?? "-"} ${existing.currency ?? "-"} (${existing.description})`,
    payload: { cashOperationId },
  });

  return NextResponse.json({ success: true });
}
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isCashierJobTitle } from "@/lib/assignment";
import { canReviewCashOperationApprovals } from "@/lib/cash-operation-approvals";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { writeActivityLog } from "@/lib/activity-log";

const proxyBankingSchema = z.object({
  operationType: z.enum(["OPENING_BALANCE", "DEPOSIT", "WITHDRAWAL", "FLOAT_TO_VIRTUAL", "FLOAT_TO_CASH"]),
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

function proxyDescriptionPrefix(operationType: "OPENING_BALANCE" | "DEPOSIT" | "WITHDRAWAL" | "FLOAT_TO_VIRTUAL" | "FLOAT_TO_CASH", channel: ProxyChannel) {
  return `PROXY_BANKING:${operationType}:${channel}`;
}

const PROXY_BANKING_ROW_SUFFIXES = ["CASH_IN", "CASH_OUT", "VIRTUAL_IN", "VIRTUAL_OUT"] as const;

function parseProxyOperationDescription(descriptionRaw: string | null | undefined) {
  const description = (descriptionRaw ?? "").trim();
  if (!description.startsWith("PROXY_BANKING:")) return null;

  const parts = description.split(":");
  const operationType = parts[1] ?? "";
  const channel = (parts[2] ?? "") as ProxyChannel;
  const remainder = parts.slice(3);
  const lastPart = remainder[remainder.length - 1] ?? null;
  const suffix = lastPart && PROXY_BANKING_ROW_SUFFIXES.includes(lastPart as typeof PROXY_BANKING_ROW_SUFFIXES[number])
    ? lastPart as typeof PROXY_BANKING_ROW_SUFFIXES[number]
    : null;
  const label = (suffix ? remainder.slice(0, -1) : remainder).join(":").trim();

  return {
    operationType,
    channel,
    suffix,
    label,
  };
}

function buildProxyOperationDescription(
  operationType: "OPENING_BALANCE" | "DEPOSIT" | "WITHDRAWAL" | "FLOAT_TO_VIRTUAL" | "FLOAT_TO_CASH",
  channel: ProxyChannel,
  label: string,
  suffix?: typeof PROXY_BANKING_ROW_SUFFIXES[number] | null,
) {
  const base = `${proxyDescriptionPrefix(operationType, channel)}:${label.trim()}`;
  return suffix ? `${base}:${suffix}` : base;
}

function standardProxyOperationShape(operationType: "DEPOSIT" | "WITHDRAWAL", channel: ProxyChannel, label: string) {
  if (operationType === "DEPOSIT") {
    return {
      CASH_IN: {
        direction: "INFLOW" as const,
        category: "OTHER_SALE" as const,
        method: "CASH",
        description: buildProxyOperationDescription(operationType, channel, label, "CASH_IN"),
      },
      VIRTUAL_OUT: {
        direction: "OUTFLOW" as const,
        category: "OTHER_EXPENSE" as const,
        method: channel,
        description: buildProxyOperationDescription(operationType, channel, label, "VIRTUAL_OUT"),
      },
    };
  }

  return {
    VIRTUAL_IN: {
      direction: "INFLOW" as const,
      category: "OTHER_SALE" as const,
      method: channel,
      description: buildProxyOperationDescription(operationType, channel, label, "VIRTUAL_IN"),
    },
    CASH_OUT: {
      direction: "OUTFLOW" as const,
      category: "OTHER_EXPENSE" as const,
      method: "CASH",
      description: buildProxyOperationDescription(operationType, channel, label, "CASH_OUT"),
    },
  };
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
        cashDesk: "PROXY_BANKING",
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
          cashDesk: "PROXY_BANKING",
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
          cashDesk: "PROXY_BANKING",
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
        cashDesk: "PROXY_BANKING",
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
        cashDesk: "PROXY_BANKING",
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

// ─── FLOAT: Cash → Virtuel ──────────────────────────────────────────────────
// La caissière dépose du cash pour approvisionner un compte virtuel
// (va à la banque / super-agent avec du cash, le virtuel est crédité)

export async function PUT(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canWriteProxyBanking(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Seuls les profils caisse autorisés peuvent enregistrer un transfert float." }, { status: 403 });
  }

  const body = await request.json();
  const floatSchema = z.object({
    direction: z.enum(["FLOAT_TO_VIRTUAL", "FLOAT_TO_CASH"]),
    channel: z.enum(["AIRTEL_MONEY", "ORANGE_MONEY", "MPESA", "EQUITY", "RAWBANK_ILLICOCASH"]),
    amount: z.number().positive(),
    currency: z.enum(["USD", "CDF"]),
    reference: z.string().trim().min(2).max(180),
    description: z.string().trim().max(500).optional(),
    occurredAt: z.coerce.date().optional(),
  });

  const parsed = floatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const occurredAt = data.occurredAt ?? new Date();

  const existingOps = await prisma.cashOperation.findMany({
    where: {
      occurredAt: { lte: occurredAt },
      description: { startsWith: "PROXY_BANKING:" },
    },
    select: { direction: true, amount: true, currency: true, method: true },
    orderBy: { occurredAt: "asc" },
    take: 100000,
  });

  const balances = computeProxyBalances(existingOps);
  const label = data.description?.trim() || (data.direction === "FLOAT_TO_VIRTUAL" ? "Approvisionnement virtuel" : "Retrait vers cash");

  if (data.direction === "FLOAT_TO_VIRTUAL") {
    // Cash sort → virtuel entre
    const availableCash = balances.CASH[data.currency];
    if (data.amount > availableCash + 0.0001) {
      return NextResponse.json(
        { error: `Solde cash insuffisant : disponible ${availableCash.toFixed(2)} ${data.currency}.` },
        { status: 400 },
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const cashOut = await tx.cashOperation.create({
        data: {
          occurredAt,
          direction: "OUTFLOW",
          category: "OTHER_EXPENSE",
          amount: data.amount,
          currency: data.currency,
          method: "CASH",
          reference: data.reference,
          description: `${proxyDescriptionPrefix("FLOAT_TO_VIRTUAL", data.channel)}:${label}:CASH_OUT`,
          cashDesk: "PROXY_BANKING",
          createdById: access.session.user.id,
        },
        select: { id: true },
      });

      const virtualIn = await tx.cashOperation.create({
        data: {
          occurredAt,
          direction: "INFLOW",
          category: "OTHER_SALE",
          amount: data.amount,
          currency: data.currency,
          method: data.channel,
          reference: data.reference,
          description: `${proxyDescriptionPrefix("FLOAT_TO_VIRTUAL", data.channel)}:${label}:VIRTUAL_IN`,
          cashDesk: "PROXY_BANKING",
          createdById: access.session.user.id,
        },
        select: { id: true },
      });

      return { cashOutId: cashOut.id, virtualInId: virtualIn.id };
    });

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "PROXY_BANKING_FLOAT_RECORDED",
      entityType: "CASH_OPERATION",
      entityId: created.virtualInId,
      summary: `Float Cash→${data.channel} : ${data.amount.toFixed(2)} ${data.currency} transféré du cash vers le virtuel.`,
      payload: { direction: data.direction, channel: data.channel, amount: data.amount, currency: data.currency, reference: data.reference },
    });

    return NextResponse.json({ success: true }, { status: 201 });
  }

  // FLOAT_TO_CASH : virtuel sort → cash entre
  const availableVirtual = balances[data.channel][data.currency];
  if (data.amount > availableVirtual + 0.0001) {
    return NextResponse.json(
      { error: `Solde ${data.channel} insuffisant : disponible ${availableVirtual.toFixed(2)} ${data.currency}.` },
      { status: 400 },
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const virtualOut = await tx.cashOperation.create({
      data: {
        occurredAt,
        direction: "OUTFLOW",
        category: "OTHER_EXPENSE",
        amount: data.amount,
        currency: data.currency,
        method: data.channel,
        reference: data.reference,
        description: `${proxyDescriptionPrefix("FLOAT_TO_CASH", data.channel)}:${label}:VIRTUAL_OUT`,
        cashDesk: "PROXY_BANKING",
        createdById: access.session.user.id,
      },
      select: { id: true },
    });

    const cashIn = await tx.cashOperation.create({
      data: {
        occurredAt,
        direction: "INFLOW",
        category: "OTHER_SALE",
        amount: data.amount,
        currency: data.currency,
        method: "CASH",
        reference: data.reference,
        description: `${proxyDescriptionPrefix("FLOAT_TO_CASH", data.channel)}:${label}:CASH_IN`,
        cashDesk: "PROXY_BANKING",
        createdById: access.session.user.id,
      },
      select: { id: true },
    });

    return { virtualOutId: virtualOut.id, cashInId: cashIn.id };
  });

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "PROXY_BANKING_FLOAT_RECORDED",
    entityType: "CASH_OPERATION",
    entityId: created.cashInId,
    summary: `Float ${data.channel}→Cash : ${data.amount.toFixed(2)} ${data.currency} transféré du virtuel vers le cash.`,
    payload: { direction: data.direction, channel: data.channel, amount: data.amount, currency: data.currency, reference: data.reference },
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
