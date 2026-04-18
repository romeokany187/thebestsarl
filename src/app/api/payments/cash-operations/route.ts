import { NextRequest, NextResponse } from "next/server";
import { isCashierJobTitle } from "@/lib/assignment";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { cashOperationCreateSchema } from "@/lib/validators";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { inferCashDeskFromDescription } from "@/lib/payments-desk";
import { writeActivityLog } from "@/lib/activity-log";

const cashOperationClient = (prisma as unknown as { cashOperation: any }).cashOperation;
const DEFAULT_SINGLE_OUTFLOW_ALERT_LIMIT_USD = 1000;
const DEFAULT_DAILY_OUTFLOW_CAP_USD = 3000;

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function utcDayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function amountToUsd(amount: number, currency: string, fxRateUsdToCdf: number): number {
  if (currency === "USD") return amount;
  return amount / fxRateUsdToCdf;
}

function amountToCdf(amount: number, currency: string, fxRateUsdToCdf: number): number {
  if (currency === "CDF") return amount;
  return amount * fxRateUsdToCdf;
}

function canWriteCashOperations(role: string, jobTitle: string | null | undefined) {
  return role === "ADMIN" || role === "ACCOUNTANT" || isCashierJobTitle(jobTitle) || jobTitle === "COMPTABLE";
}

function canManageCashOperations(role: string, jobTitle: string | null | undefined) {
  return role === "ADMIN";
}

async function notifyAccountantsAboutBlockedCashOutflow(params: {
  actorId: string;
  actorName: string;
  actorEmail?: string | null;
  occurredAt: Date;
  amount: number;
  currency: string;
  amountUsd: number;
  fxRateUsdToCdf: number;
  category: string;
  method: string;
  reference: string;
  description?: string | null;
  projectedDailyOutflowUsd: number;
  dailyOutflowCap: number;
  cashDesk: string;
}) {
  const accountants = await prisma.user.findMany({
    where: {
      id: { not: params.actorId },
      OR: [{ role: "ACCOUNTANT" }, { jobTitle: "COMPTABLE" }],
    },
    select: { id: true, name: true, email: true },
    take: 200,
  });

  if (accountants.length === 0) {
    return;
  }

  const alertMessage = `Décaissement bloqué sur ${params.cashDesk}: tentative de ${params.amount.toFixed(2)} ${params.currency} (${params.amountUsd.toFixed(2)} USD) le ${params.occurredAt.toLocaleString("fr-FR")}. Cumul journalier projeté ${params.projectedDailyOutflowUsd.toFixed(2)} USD pour un plafond de ${params.dailyOutflowCap.toFixed(2)} USD.`;

  await prisma.userNotification.createMany({
    data: accountants.map((user) => ({
      userId: user.id,
      title: "Alerte plafond de décaissement bloqué",
      message: alertMessage,
      type: "CASH_OPERATION_THRESHOLD_ALERT",
      metadata: {
        blocked: true,
        amount: params.amount,
        currency: params.currency,
        amountUsd: params.amountUsd,
        fxRateUsdToCdf: params.fxRateUsdToCdf,
        category: params.category,
        method: params.method,
        reference: params.reference,
        description: params.description,
        occurredAt: params.occurredAt,
        projectedDailyOutflowUsd: params.projectedDailyOutflowUsd,
        dailyCap: params.dailyOutflowCap,
        actorId: params.actorId,
        actorName: params.actorName,
        cashDesk: params.cashDesk,
        source: "CASH_LEDGER_POLICY",
      },
    })),
  });

  if (isMailConfigured()) {
    try {
      const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
      const paymentsUrl = appUrl ? `${appUrl}/payments` : "/payments";

      await sendMailBatch({
        recipients: accountants.map((user) => ({ email: user.email, name: user.name })),
        subject: `Alerte comptable - Décaissement bloqué ${params.cashDesk}`,
        text: [
          "THEBEST SARL - Alerte plafond de décaissement",
          "",
          `Caisse: ${params.cashDesk}`,
          `Date opération: ${params.occurredAt.toLocaleString("fr-FR")}`,
          `Montant demandé: ${params.amount.toFixed(2)} ${params.currency}`,
          `Équivalent USD: ${params.amountUsd.toFixed(2)} USD`,
          `Taux du jour: 1 USD = ${params.fxRateUsdToCdf.toFixed(2)} CDF`,
          `Catégorie: ${params.category}`,
          `Méthode: ${params.method}`,
          `Référence: ${params.reference}`,
          `Libellé: ${params.description ?? "-"}`,
          `Cumul journalier projeté: ${params.projectedDailyOutflowUsd.toFixed(2)} USD`,
          `Plafond autorisé: ${params.dailyOutflowCap.toFixed(2)} USD`,
          `Saisi par: ${params.actorName}`,
          "",
          `Consulter: ${paymentsUrl}`,
        ].join("\n"),
        html: `
          <p><strong>THEBEST SARL - Alerte plafond de décaissement</strong></p>
          <p><strong>Caisse:</strong> ${params.cashDesk}<br/>
          <strong>Date opération:</strong> ${params.occurredAt.toLocaleString("fr-FR")}<br/>
          <strong>Montant demandé:</strong> ${params.amount.toFixed(2)} ${params.currency}<br/>
          <strong>Équivalent USD:</strong> ${params.amountUsd.toFixed(2)} USD<br/>
          <strong>Taux du jour:</strong> 1 USD = ${params.fxRateUsdToCdf.toFixed(2)} CDF<br/>
          <strong>Catégorie:</strong> ${params.category}<br/>
          <strong>Méthode:</strong> ${params.method}<br/>
          <strong>Référence:</strong> ${params.reference}<br/>
          <strong>Libellé:</strong> ${params.description ?? "-"}<br/>
          <strong>Cumul journalier projeté:</strong> ${params.projectedDailyOutflowUsd.toFixed(2)} USD<br/>
          <strong>Plafond autorisé:</strong> ${params.dailyOutflowCap.toFixed(2)} USD<br/>
          <strong>Saisi par:</strong> ${params.actorName}</p>
          <p><a href="${paymentsUrl}">Ouvrir le module paiements</a></p>
        `,
        replyTo: params.actorEmail ?? undefined,
      });
    } catch (mailError) {
      console.error("[cash-operations.blocked-outflow] Echec envoi email comptable", {
        reference: params.reference,
        error: mailError instanceof Error ? mailError.message : "Erreur inconnue",
      });
    }
  }
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canWriteCashOperations(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Seuls l'administrateur, le comptable et les profils caisse autorisés peuvent enregistrer les opérations de caisse." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = cashOperationCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const occurredAt = data.occurredAt ?? new Date();
  const currency = (data.currency ?? "USD").toUpperCase();
  if (currency !== "USD" && currency !== "CDF") {
    return NextResponse.json({ error: "Devise non supportée. Utilisez USD ou CDF." }, { status: 400 });
  }

  if (data.category === "OPENING_BALANCE" && data.direction !== "INFLOW") {
    return NextResponse.json({ error: "Le report à nouveau initial (solde d'ouverture) doit être enregistré comme une entrée de fonds." }, { status: 400 });
  }

  const normalizedMethod = data.method.trim();

  if (data.category === "OPENING_BALANCE") {
    const existingOpeningForBucket = await cashOperationClient.findFirst({
      where: {
        category: "OPENING_BALANCE",
        method: normalizedMethod,
        currency,
      },
      select: { id: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    });

    if (existingOpeningForBucket) {
      return NextResponse.json(
        {
          error: `Un report à nouveau initial existe déjà pour ${normalizedMethod} en ${currency}. Ensuite, le dernier solde du jour devient automatiquement le report à nouveau du lendemain.`,
        },
        { status: 400 },
      );
    }
  }

  const latestRateOperation = await cashOperationClient.findFirst({
    where: {
      occurredAt: { lte: occurredAt },
      fxRateUsdToCdf: { not: null },
    },
    select: {
      fxRateUsdToCdf: true,
      fxRateToUsd: true,
      occurredAt: true,
    },
    orderBy: { occurredAt: "desc" },
  });

  const fxRateUsdToCdf = latestRateOperation?.fxRateUsdToCdf
    ?? (latestRateOperation?.fxRateToUsd && latestRateOperation.fxRateToUsd > 0 ? 1 / latestRateOperation.fxRateToUsd : undefined)
    ?? parsePositiveNumber(process.env.CASH_DEFAULT_USD_TO_CDF_RATE, 2800);

  if (!fxRateUsdToCdf || fxRateUsdToCdf <= 0) {
    return NextResponse.json(
      { error: "Le taux du jour (1 USD = X CDF) est obligatoire et doit être positif." },
      { status: 400 },
    );
  }

  const normalizedAmountUsd = amountToUsd(data.amount, currency, fxRateUsdToCdf);
  const normalizedAmountCdf = amountToCdf(data.amount, currency, fxRateUsdToCdf);
  const initialOpeningExists = await cashOperationClient.findFirst({
    where: {
      occurredAt: { lte: occurredAt },
      category: "OPENING_BALANCE",
    },
    select: { id: true },
    orderBy: { occurredAt: "desc" },
  });

  if (data.category !== "OPENING_BALANCE" && !initialOpeningExists) {
    return NextResponse.json(
      { error: "Le tout premier encodage de caisse doit être le report à nouveau initial (solde d'ouverture). Ensuite, le dernier solde du jour devient automatiquement le report à nouveau du lendemain." },
      { status: 400 },
    );
  }

  const singleOutflowAlertLimit = parsePositiveNumber(process.env.CASH_SINGLE_OUTFLOW_ALERT_LIMIT_USD, DEFAULT_SINGLE_OUTFLOW_ALERT_LIMIT_USD);
  const dailyOutflowCap = parsePositiveNumber(process.env.CASH_DAILY_OUTFLOW_CAP_USD, DEFAULT_DAILY_OUTFLOW_CAP_USD);
  const { start: dayStart, end: dayEnd } = utcDayBounds(occurredAt);
  let projectedDailyOutflowUsd = 0;
  let thresholdAlertMessage: string | null = null;
  let blockedCashDesk = "THE_BEST";

  let operation;

  try {
    operation = await prisma.$transaction(async (tx) => {
      if (data.direction === "OUTFLOW") {
        const ticketInflows = await tx.payment.aggregate({
          where: {
            paidAt: { lte: occurredAt },
          },
          _sum: {
            amount: true,
          },
        });

        const previousCashOperations = await (tx as unknown as { cashOperation: any }).cashOperation.findMany({
          where: {
            occurredAt: { lte: occurredAt },
          },
          select: {
            direction: true,
            amount: true,
            currency: true,
            amountUsd: true,
            fxRateUsdToCdf: true,
          },
          take: 100000,
        });

        const cashSigned = previousCashOperations.reduce(
          (sum: number, op: { direction: string; amount: number; currency?: string; amountUsd?: number | null; fxRateUsdToCdf?: number | null }) => {
            const opCurrency = (op.currency ?? "USD").toUpperCase();
            const opAmountUsd = typeof op.amountUsd === "number"
              ? op.amountUsd
              : amountToUsd(op.amount, opCurrency, op.fxRateUsdToCdf ?? fxRateUsdToCdf);
            return sum + (op.direction === "INFLOW" ? opAmountUsd : -opAmountUsd);
          },
          0,
        );

        const signedUsdFromOps = previousCashOperations.reduce(
          (sum: number, op: { direction: string; amount: number; currency?: string }) => {
            const opCurrency = (op.currency ?? "USD").toUpperCase();
            if (opCurrency !== "USD") return sum;
            return sum + (op.direction === "INFLOW" ? op.amount : -op.amount);
          },
          0,
        );

        const signedCdfFromOps = previousCashOperations.reduce(
          (sum: number, op: { direction: string; amount: number; currency?: string }) => {
            const opCurrency = (op.currency ?? "USD").toUpperCase();
            if (opCurrency !== "CDF") return sum;
            return sum + (op.direction === "INFLOW" ? op.amount : -op.amount);
          },
          0,
        );

        const availableBalance = (ticketInflows._sum.amount ?? 0) + cashSigned;
        const availableUsd = (ticketInflows._sum.amount ?? 0) + signedUsdFromOps;
        const availableCdf = signedCdfFromOps;

        if (normalizedAmountUsd > availableBalance + 0.0001) {
          throw new Error(`INSUFFICIENT_CASH:${availableBalance.toFixed(2)}`);
        }

        if (currency === "USD" && data.amount > availableUsd + 0.0001) {
          throw new Error(`INSUFFICIENT_CURRENCY:USD:${availableUsd.toFixed(2)}`);
        }

        if (currency === "CDF" && data.amount > availableCdf + 0.0001) {
          throw new Error(`INSUFFICIENT_CURRENCY:CDF:${availableCdf.toFixed(2)}`);
        }

        if (data.category === "FX_CONVERSION") {
          throw new Error("CONVERSION_NOT_ALLOWED_HERE");
        }

        const sameDayOutflowOperations = await (tx as unknown as { cashOperation: any }).cashOperation.findMany({
          where: {
            direction: "OUTFLOW",
            category: { not: "FX_CONVERSION" },
            occurredAt: { gte: dayStart, lt: dayEnd },
          },
          select: {
            amount: true,
            currency: true,
            amountUsd: true,
            fxRateUsdToCdf: true,
          },
          take: 100000,
        });

        const existingDailyOutflowUsd = sameDayOutflowOperations.reduce(
          (sum: number, op: { amount: number; currency?: string; amountUsd?: number | null; fxRateUsdToCdf?: number | null }) => {
            const opCurrency = (op.currency ?? "USD").toUpperCase();
            const opAmountUsd = typeof op.amountUsd === "number"
              ? op.amountUsd
              : amountToUsd(op.amount, opCurrency, op.fxRateUsdToCdf ?? fxRateUsdToCdf);
            return sum + opAmountUsd;
          },
          0,
        );

        projectedDailyOutflowUsd = existingDailyOutflowUsd + normalizedAmountUsd;

        const desc = (data.description ?? "").trim();
        blockedCashDesk = inferCashDeskFromDescription(desc);

        if (projectedDailyOutflowUsd > dailyOutflowCap + 0.0001) {
          throw new Error(`DAILY_CAP_EXCEEDED:${projectedDailyOutflowUsd.toFixed(2)}:${dailyOutflowCap.toFixed(2)}`);
        }

        if (normalizedAmountUsd >= singleOutflowAlertLimit) {
          thresholdAlertMessage = `Alerte seuil décaissement: sortie ${data.amount.toFixed(2)} ${currency} (taux 1 USD = ${fxRateUsdToCdf.toFixed(2)} CDF, eq ${normalizedAmountUsd.toFixed(2)} USD), seuil ${singleOutflowAlertLimit.toFixed(2)} USD.`;
        }
      }

      const desc = (data.description ?? "").trim();
      const cashDeskForOp = inferCashDeskFromDescription(desc);

      return (tx as unknown as { cashOperation: any }).cashOperation.create({
        data: {
          occurredAt,
          direction: data.direction,
          category: data.category,
          amount: data.amount,
          currency,
          fxRateToUsd: 1 / fxRateUsdToCdf,
          fxRateUsdToCdf,
          amountUsd: normalizedAmountUsd,
          amountCdf: normalizedAmountCdf,
          method: normalizedMethod,
          reference: data.reference,
          description: data.description,
          cashDesk: cashDeskForOp,
          createdById: access.session.user.id,
        },
        select: {
          id: true,
          occurredAt: true,
          direction: true,
          category: true,
          amount: true,
          currency: true,
          fxRateToUsd: true,
          fxRateUsdToCdf: true,
          amountUsd: true,
          amountCdf: true,
          method: true,
          reference: true,
          description: true,
          createdById: true,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_CASH:")) {
      const available = error.message.replace("INSUFFICIENT_CASH:", "");
      return NextResponse.json(
        {
          error: `Solde insuffisant: disponible ${available} USD, sortie demandée ${data.amount.toFixed(2)} ${currency} (${normalizedAmountUsd.toFixed(2)} USD).`,
        },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message.startsWith("DAILY_CAP_EXCEEDED:")) {
      const [, projected, cap] = error.message.split(":");
      await notifyAccountantsAboutBlockedCashOutflow({
        actorId: access.session.user.id,
        actorName: access.session.user.name ?? "Agent financier",
        actorEmail: access.session.user.email ?? undefined,
        occurredAt,
        amount: data.amount,
        currency,
        amountUsd: normalizedAmountUsd,
        fxRateUsdToCdf,
        category: data.category,
        method: normalizedMethod,
        reference: data.reference,
        description: data.description,
        projectedDailyOutflowUsd: Number(projected),
        dailyOutflowCap: Number(cap),
        cashDesk: blockedCashDesk,
      });
      return NextResponse.json(
        {
          error: `Plafond journalier dépassé: cumul ${projected} USD pour un plafond autorisé de ${cap} USD. Alertez le comptable avant tout nouveau décaissement.`,
        },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_CURRENCY:")) {
      const [, missingCurrency, available] = error.message.split(":");
      return NextResponse.json(
        {
          error: `Solde ${missingCurrency} insuffisant: disponible ${available} ${missingCurrency}, sortie demandée ${data.amount.toFixed(2)} ${currency}. Passez d'abord une écriture de conversion si nécessaire.`,
        },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "CONVERSION_NOT_ALLOWED_HERE") {
      return NextResponse.json(
        { error: "Utilisez l'opération dédiée de conversion USD/CDF pour les écritures de conversion." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Erreur serveur lors de l'enregistrement de l'opération de caisse." }, { status: 500 });
  }

  const accountants = await prisma.user.findMany({
    where: {
      id: { not: access.session.user.id },
      OR: [{ role: "ACCOUNTANT" }, { jobTitle: "COMPTABLE" }],
    },
    select: { id: true, name: true, email: true },
    take: 200,
  });

  if (accountants.length > 0) {
    await prisma.userNotification.createMany({
      data: accountants.map((user) => ({
        userId: user.id,
        title: `Nouvelle opération de caisse ${operation.direction === "INFLOW" ? "(entrée)" : "(sortie)"}`,
        message: `${operation.amount.toFixed(2)} ${operation.currency} • ${operation.category} • ${operation.description}`,
        type: "CASH_OPERATION_ENTRY",
        metadata: {
          cashOperationId: operation.id,
          direction: operation.direction,
          category: operation.category,
          amount: operation.amount,
          currency: operation.currency,
          fxRateToUsd: operation.fxRateToUsd,
          amountUsd: operation.amountUsd,
          method: operation.method,
          reference: operation.reference,
          description: operation.description,
          actorId: access.session.user.id,
          actorName: access.session.user.name ?? "Agent financier",
          source: "CASH_LEDGER",
        },
      })),
    });

    if (isMailConfigured()) {
      try {
        const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
        const paymentsUrl = appUrl ? `${appUrl}/payments` : "/payments";

        await sendMailBatch({
          recipients: accountants.map((user) => ({ email: user.email, name: user.name })),
          subject: `Notification comptable - Opération de caisse ${operation.direction === "INFLOW" ? "Entrée" : "Sortie"}`,
          text: [
            "THEBEST SARL - Ecriture de caisse",
            "",
            `Date opération: ${new Date(operation.occurredAt).toLocaleString("fr-FR")}`,
            `Type: ${operation.direction}`,
            `Catégorie: ${operation.category}`,
            `Montant: ${operation.amount.toFixed(2)} ${operation.currency}`,
            `Équivalent USD: ${(operation.amountUsd ?? operation.amount).toFixed(2)} USD`,
            `Équivalent CDF: ${(operation.amountCdf ?? operation.amount).toFixed(2)} CDF`,
            `Taux du jour: 1 USD = ${(operation.fxRateUsdToCdf ?? fxRateUsdToCdf).toFixed(2)} CDF`,
            `Méthode: ${operation.method}`,
            `Référence: ${operation.reference ?? "-"}`,
            `Libellé: ${operation.description}`,
            `Saisi par: ${access.session.user.name ?? "Agent financier"}`,
            "",
            `Consulter: ${paymentsUrl}`,
          ].join("\n"),
          html: `
            <p><strong>THEBEST SARL - Ecriture de caisse</strong></p>
            <p><strong>Date opération:</strong> ${new Date(operation.occurredAt).toLocaleString("fr-FR")}<br/>
            <strong>Type:</strong> ${operation.direction}<br/>
            <strong>Catégorie:</strong> ${operation.category}<br/>
            <strong>Montant:</strong> ${operation.amount.toFixed(2)} ${operation.currency}<br/>
            <strong>Équivalent USD:</strong> ${(operation.amountUsd ?? operation.amount).toFixed(2)} USD<br/>
            <strong>Équivalent CDF:</strong> ${(operation.amountCdf ?? operation.amount).toFixed(2)} CDF<br/>
            <strong>Taux du jour:</strong> 1 USD = ${(operation.fxRateUsdToCdf ?? fxRateUsdToCdf).toFixed(2)} CDF<br/>
            <strong>Méthode:</strong> ${operation.method}<br/>
            <strong>Référence:</strong> ${operation.reference ?? "-"}<br/>
            <strong>Libellé:</strong> ${operation.description}<br/>
            <strong>Saisi par:</strong> ${access.session.user.name ?? "Agent financier"}</p>
            <p><a href="${paymentsUrl}">Ouvrir le module comptabilité caisse</a></p>
          `,
          replyTo: access.session.user.email ?? undefined,
        });
      } catch (mailError) {
        console.error("[cash-operations.create] Echec envoi email comptable", {
          cashOperationId: operation.id,
          error: mailError instanceof Error ? mailError.message : "Erreur inconnue",
        });
      }
    }

    if (thresholdAlertMessage) {
      const alertMessage = thresholdAlertMessage;
      await prisma.userNotification.createMany({
        data: accountants.map((user) => ({
          userId: user.id,
          title: "Alerte seuil de décaissement",
          message: alertMessage,
          type: "CASH_OPERATION_THRESHOLD_ALERT",
          metadata: {
            cashOperationId: operation.id,
            amount: operation.amount,
            currency: operation.currency,
            fxRateToUsd: operation.fxRateToUsd,
            fxRateUsdToCdf: operation.fxRateUsdToCdf,
            amountUsd: operation.amountUsd,
            amountCdf: operation.amountCdf,
            threshold: singleOutflowAlertLimit,
            projectedDailyOutflowUsd,
            dailyCap: dailyOutflowCap,
            occurredAt: operation.occurredAt,
            source: "CASH_LEDGER_POLICY",
          },
        })),
      });
    }
  }

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "CASH_OPERATION_RECORDED",
    entityType: "CASH_OPERATION",
    entityId: operation.id,
    summary: `${operation.direction === "INFLOW" ? "Entrée" : "Sortie"} caisse enregistrée: ${operation.amount.toFixed(2)} ${operation.currency} (${operation.description}).`,
    payload: {
      direction: operation.direction,
      category: operation.category,
      amount: operation.amount,
      currency: operation.currency,
      method: operation.method,
      reference: operation.reference,
      description: operation.description,
    },
  });

  return NextResponse.json({ data: operation, thresholdAlert: thresholdAlertMessage }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManageCashOperations(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Seuls l'administrateur et le comptable peuvent modifier une écriture de caisse." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const cashOperationId = typeof body?.cashOperationId === "string" ? body.cashOperationId.trim() : "";

    if (!cashOperationId) {
      return NextResponse.json({ error: "Écriture de caisse introuvable." }, { status: 400 });
    }

    const existing = await cashOperationClient.findUnique({
      where: { id: cashOperationId },
      select: {
        id: true,
        occurredAt: true,
        direction: true,
        category: true,
        amount: true,
        currency: true,
        method: true,
        reference: true,
        description: true,
        fxRateUsdToCdf: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Écriture de caisse introuvable." }, { status: 404 });
    }

    const nextAmount = body?.amount !== undefined ? Number(body.amount) : existing.amount;
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      return NextResponse.json({ error: "Montant invalide pour la modification de l'écriture." }, { status: 400 });
    }

    const nextCurrency = ((typeof body?.currency === "string" ? body.currency : existing.currency) ?? "USD").trim().toUpperCase();
    if (nextCurrency !== "USD" && nextCurrency !== "CDF") {
      return NextResponse.json({ error: "Devise non supportée. Utilisez USD ou CDF." }, { status: 400 });
    }

    const allowedCategories = [
      "OPENING_BALANCE",
      "OTHER_SALE",
      "COMMISSION_INCOME",
      "SERVICE_INCOME",
      "LOAN_INFLOW",
      "ADVANCE_RECOVERY",
      "SUPPLIER_PAYMENT",
      "SALARY_PAYMENT",
      "RENT_PAYMENT",
      "TAX_PAYMENT",
      "UTILITY_PAYMENT",
      "TRANSPORT_PAYMENT",
      "OTHER_EXPENSE",
      "FX_CONVERSION",
    ] as const;

    const nextDirection = body?.direction === "OUTFLOW" ? "OUTFLOW" : body?.direction === "INFLOW" ? "INFLOW" : existing.direction;
    const nextCategory = typeof body?.category === "string" && allowedCategories.includes(body.category as (typeof allowedCategories)[number])
      ? body.category
      : existing.category;

    if (nextCategory === "OPENING_BALANCE" && nextDirection !== "INFLOW") {
      return NextResponse.json({ error: "Le report à nouveau initial (solde d'ouverture) doit être enregistré comme une entrée de fonds." }, { status: 400 });
    }

    const nextMethod = typeof body?.method === "string" && body.method.trim().length >= 2
      ? body.method.trim()
      : existing.method;

    if (nextCategory === "OPENING_BALANCE") {
      const otherOpeningForBucket = await cashOperationClient.findFirst({
        where: {
          category: "OPENING_BALANCE",
          method: nextMethod,
          currency: nextCurrency,
          id: { not: cashOperationId },
        },
        select: { id: true },
      });

      if (otherOpeningForBucket) {
        return NextResponse.json(
          {
            error: `Un report à nouveau initial existe déjà pour ${nextMethod} en ${nextCurrency}. Le report à nouveau suivant est automatique.`,
          },
          { status: 400 },
        );
      }
    }
    const nextReference = typeof body?.reference === "string" && body.reference.trim().length >= 2
      ? body.reference.trim()
      : existing.reference;
    const nextDescription = typeof body?.description === "string" && body.description.trim().length >= 2
      ? body.description.trim()
      : existing.description;

    const occurredAtRaw = typeof body?.occurredAt === "string" ? body.occurredAt : null;
    const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date(existing.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      return NextResponse.json({ error: "Date d'opération invalide." }, { status: 400 });
    }

    const latestRateOperation = await cashOperationClient.findFirst({
      where: {
        occurredAt: { lte: occurredAt },
        fxRateUsdToCdf: { not: null },
      },
      select: { fxRateUsdToCdf: true, fxRateToUsd: true },
      orderBy: { occurredAt: "desc" },
    });

    const fxRateUsdToCdf = latestRateOperation?.fxRateUsdToCdf
      ?? (latestRateOperation?.fxRateToUsd && latestRateOperation.fxRateToUsd > 0 ? 1 / latestRateOperation.fxRateToUsd : undefined)
      ?? existing.fxRateUsdToCdf
      ?? parsePositiveNumber(process.env.CASH_DEFAULT_USD_TO_CDF_RATE, 2800);

    const updated = await cashOperationClient.update({
      where: { id: cashOperationId },
      data: {
        occurredAt,
        direction: nextDirection,
        category: nextCategory,
        amount: nextAmount,
        currency: nextCurrency,
        fxRateToUsd: 1 / fxRateUsdToCdf,
        fxRateUsdToCdf,
        amountUsd: amountToUsd(nextAmount, nextCurrency, fxRateUsdToCdf),
        amountCdf: amountToCdf(nextAmount, nextCurrency, fxRateUsdToCdf),
        method: nextMethod,
        reference: nextReference,
        description: nextDescription,
      },
    });

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "CASH_OPERATION_UPDATED",
      entityType: "CASH_OPERATION",
      entityId: updated.id,
      summary: `Écriture de caisse modifiée: ${updated.amount.toFixed(2)} ${updated.currency} (${updated.description}).`,
      payload: {
        direction: updated.direction,
        category: updated.category,
        amount: updated.amount,
        currency: updated.currency,
        method: updated.method,
        reference: updated.reference,
        description: updated.description,
      },
    });

    return NextResponse.json({ data: updated }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Erreur serveur lors de la modification de l'écriture de caisse." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManageCashOperations(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Seuls l'administrateur et le comptable peuvent supprimer une écriture de caisse." }, { status: 403 });
  }

  const cashOperationId = request.nextUrl.searchParams.get("cashOperationId")?.trim() ?? request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!cashOperationId) {
    return NextResponse.json({ error: "Écriture de caisse introuvable." }, { status: 400 });
  }

  try {
    const existing = await cashOperationClient.findUnique({
      where: { id: cashOperationId },
      select: {
        id: true,
        direction: true,
        category: true,
        amount: true,
        currency: true,
        method: true,
        reference: true,
        description: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Écriture de caisse introuvable." }, { status: 404 });
    }

    await cashOperationClient.delete({ where: { id: cashOperationId } });

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "CASH_OPERATION_DELETED",
      entityType: "CASH_OPERATION",
      entityId: existing.id,
      summary: `Écriture de caisse supprimée: ${existing.amount.toFixed(2)} ${existing.currency} (${existing.description}).`,
      payload: {
        direction: existing.direction,
        category: existing.category,
        amount: existing.amount,
        currency: existing.currency,
        method: existing.method,
        reference: existing.reference,
        description: existing.description,
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Erreur serveur lors de la suppression de l'écriture de caisse." }, { status: 500 });
  }
}
