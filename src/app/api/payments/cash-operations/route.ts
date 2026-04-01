import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { cashOperationCreateSchema } from "@/lib/validators";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";

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

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (access.role === "ADMIN" || access.role === "DIRECTEUR_GENERAL") {
    return NextResponse.json({ error: "Admin et Direction Générale ont un accès lecture seule sur les écritures de caisse." }, { status: 403 });
  }

  if (access.session.user.jobTitle !== "CAISSIERE") {
    return NextResponse.json({ error: "Seule la caissière est autorisée à enregistrer les opérations de caisse." }, { status: 403 });
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

  const fxRateUsdToCdf = data.fxRateUsdToCdf
    ?? (data.fxRateToUsd && data.fxRateToUsd > 0 ? 1 / data.fxRateToUsd : undefined)
    ?? parsePositiveNumber(process.env.CASH_DEFAULT_USD_TO_CDF_RATE, 2800);

  if (!fxRateUsdToCdf || fxRateUsdToCdf <= 0) {
    return NextResponse.json(
      { error: "Le taux du jour (1 USD = X CDF) est obligatoire et doit être positif." },
      { status: 400 },
    );
  }

  const normalizedAmountUsd = amountToUsd(data.amount, currency, fxRateUsdToCdf);
  const normalizedAmountCdf = amountToCdf(data.amount, currency, fxRateUsdToCdf);
  const singleOutflowAlertLimit = parsePositiveNumber(process.env.CASH_SINGLE_OUTFLOW_ALERT_LIMIT_USD, DEFAULT_SINGLE_OUTFLOW_ALERT_LIMIT_USD);
  const dailyOutflowCap = parsePositiveNumber(process.env.CASH_DAILY_OUTFLOW_CAP_USD, DEFAULT_DAILY_OUTFLOW_CAP_USD);
  const { start: dayStart, end: dayEnd } = utcDayBounds(occurredAt);
  let projectedDailyOutflowUsd = 0;
  let thresholdAlertMessage: string | null = null;

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

        if (projectedDailyOutflowUsd > dailyOutflowCap + 0.0001) {
          throw new Error(`DAILY_CAP_EXCEEDED:${projectedDailyOutflowUsd.toFixed(2)}:${dailyOutflowCap.toFixed(2)}`);
        }

        if (normalizedAmountUsd >= singleOutflowAlertLimit) {
          thresholdAlertMessage = `Alerte seuil décaissement: sortie ${data.amount.toFixed(2)} ${currency} (taux 1 USD = ${fxRateUsdToCdf.toFixed(2)} CDF, eq ${normalizedAmountUsd.toFixed(2)} USD), seuil ${singleOutflowAlertLimit.toFixed(2)} USD.`;
        }
      }

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
          method: data.method,
          reference: data.reference,
          description: data.description,
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
          actorName: access.session.user.name ?? "Caissiere",
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
            `Saisi par: ${access.session.user.name ?? "Caissiere"}`,
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
            <strong>Saisi par:</strong> ${access.session.user.name ?? "Caissière"}</p>
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

  return NextResponse.json({ data: operation, thresholdAlert: thresholdAlertMessage }, { status: 201 });
}
