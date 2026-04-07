import { NextRequest, NextResponse } from "next/server";
import {
  CommissionCalculationStatus,
  CommissionMode,
  PaymentStatus,
  Prisma,
  SaleNature,
  TravelClass,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { writeActivityLog } from "@/lib/activity-log";

export const runtime = "nodejs";

function normalizeLookup(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseIsoDay(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("Date invalide. Format attendu: AAAA-MM-JJ.");
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error("Date invalide. Format attendu: AAAA-MM-JJ.");
  }

  return date;
}

function parsePositiveNumber(value: unknown, fallback: number) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeMoneyCurrency(value: unknown) {
  const normalized = String(value ?? "USD").trim().toUpperCase();
  return normalized === "CDF" ? "CDF" : "USD";
}

function amountToUsd(amount: number, currency: string, fxRateUsdToCdf: number) {
  return currency === "CDF" ? amount / fxRateUsdToCdf : amount;
}

function amountToCdf(amount: number, currency: string, fxRateUsdToCdf: number) {
  return currency === "CDF" ? amount : amount * fxRateUsdToCdf;
}

function amountToTicketCurrency(amount: number, fromCurrency: string, ticketCurrency: string, fxRateUsdToCdf: number) {
  if (fromCurrency === ticketCurrency) {
    return amount;
  }

  if (ticketCurrency === "USD") {
    return amountToUsd(amount, fromCurrency, fxRateUsdToCdf);
  }

  return amountToCdf(amount, fromCurrency, fxRateUsdToCdf);
}

function computePaymentStatus(totalDue: number, paidTotal: number) {
  if (paidTotal <= 0.0001) return PaymentStatus.UNPAID;
  if (paidTotal + 0.0001 < totalDue) return PaymentStatus.PARTIAL;
  return PaymentStatus.PAID;
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("sales", ["ADMIN"]);
  if (access.error) {
    return access.error;
  }

  try {
    const body = await request.json().catch(() => ({}));
    const rawDate = typeof body?.date === "string" && body.date.trim()
      ? body.date.trim()
      : new Date().toISOString().slice(0, 10);
    const dryRun = body?.dryRun === true;

    const dayStart = parseIsoDay(rawDate);
    const dayEnd = new Date(Date.UTC(
      dayStart.getUTCFullYear(),
      dayStart.getUTCMonth(),
      dayStart.getUTCDate(),
      23,
      59,
      59,
      999,
    ));

    const [logs, paymentLogs] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          action: "TICKET_CREATED",
          entityType: "TICKET_SALE",
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          createdAt: true,
          actorId: true,
          actor: { select: { id: true, name: true, email: true } },
          payload: true,
        },
      }),
      prisma.auditLog.findMany({
        where: {
          action: "PAYMENT_RECORDED",
          entityType: "PAYMENT",
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          createdAt: true,
          actorId: true,
          actor: { select: { id: true, name: true, email: true } },
          payload: true,
        },
      }),
    ]);

    if (!logs.length && !paymentLogs.length) {
      return NextResponse.json({
        data: {
          date: rawDate,
          dryRun,
          restored: 0,
          restoredPayments: 0,
          skipped: 0,
          skippedPayments: 0,
          tickets: [],
          payments: [],
          message: "Aucun billet ni paiement créé ce jour n'a été trouvé dans l'historique.",
        },
      });
    }

    const airlines = await prisma.airline.findMany({
      select: { id: true, code: true, name: true },
    });
    const airlineByCode = new Map(airlines.map((airline) => [airline.code.trim().toUpperCase(), airline]));
    const airlineByName = new Map(airlines.map((airline) => [normalizeLookup(airline.name), airline]));

    const ticketNumbersFromLogs = logs
      .map((log) => {
        const payload = (log.payload && typeof log.payload === "object" && !Array.isArray(log.payload)
          ? log.payload
          : {}) as Record<string, unknown>;
        const details = (payload.details && typeof payload.details === "object" && !Array.isArray(payload.details)
          ? payload.details
          : {}) as Record<string, unknown>;
        return typeof details.ticketNumber === "string" ? details.ticketNumber.trim() : "";
      })
      .filter(Boolean);

    const ticketNumbersFromPayments = paymentLogs
      .map((log) => {
        const payload = (log.payload && typeof log.payload === "object" && !Array.isArray(log.payload)
          ? log.payload
          : {}) as Record<string, unknown>;
        const details = (payload.details && typeof payload.details === "object" && !Array.isArray(payload.details)
          ? payload.details
          : {}) as Record<string, unknown>;
        return typeof details.ticketNumber === "string" ? details.ticketNumber.trim() : "";
      })
      .filter(Boolean);

    const requestedTicketNumbers = Array.from(new Set([...ticketNumbersFromLogs, ...ticketNumbersFromPayments]));

    const existingTickets = requestedTicketNumbers.length > 0
      ? await prisma.ticketSale.findMany({
          where: { ticketNumber: { in: requestedTicketNumbers } },
          include: { payments: true },
        })
      : [];

    const ticketByNumber = new Map(existingTickets.map((ticket) => [ticket.ticketNumber, ticket]));
    const existingTicketNumbers = new Set(existingTickets.map((ticket) => ticket.ticketNumber));
    const restoredTickets: Array<{ ticketNumber: string; customerName: string; airlineName: string; amount: number }> = [];
    const skippedTickets: Array<{ ticketNumber: string; reason: string }> = [];
    const restoredPayments: Array<{ ticketNumber: string; amount: number; currency: string; method: string | null }> = [];
    const skippedPayments: Array<{ ticketNumber: string; reason: string }> = [];

    for (const log of logs) {
      const payload = (log.payload && typeof log.payload === "object" && !Array.isArray(log.payload)
        ? log.payload
        : {}) as Record<string, unknown>;
      const details = (payload.details && typeof payload.details === "object" && !Array.isArray(payload.details)
        ? payload.details
        : {}) as Record<string, unknown>;

      const ticketNumber = typeof details.ticketNumber === "string" ? details.ticketNumber.trim() : "";
      if (!ticketNumber) {
        skippedTickets.push({ ticketNumber: `audit:${log.id}`, reason: "Numéro de billet introuvable dans l'historique." });
        continue;
      }

      if (existingTicketNumbers.has(ticketNumber)) {
        skippedTickets.push({ ticketNumber, reason: "Billet déjà présent en base." });
        continue;
      }

      const amount = typeof details.amount === "number"
        ? details.amount
        : Number.parseFloat(String(details.amount ?? ""));
      if (!Number.isFinite(amount) || amount <= 0) {
        skippedTickets.push({ ticketNumber, reason: "Montant invalide dans l'historique." });
        continue;
      }

      const airlineCode = typeof details.airlineCode === "string" ? details.airlineCode.trim().toUpperCase() : "";
      const airlineNameFromLog = typeof details.airlineName === "string" ? details.airlineName.trim() : "";
      const airline = airlineByCode.get(airlineCode) ?? airlineByName.get(normalizeLookup(airlineNameFromLog));
      if (!airline) {
        skippedTickets.push({ ticketNumber, reason: `Compagnie introuvable pour ${airlineNameFromLog || airlineCode || "N/A"}.` });
        continue;
      }

      const customerName = typeof details.customerName === "string" && details.customerName.trim()
        ? details.customerName.trim()
        : "Client à compléter";
      const currency = typeof details.currency === "string" && details.currency.trim()
        ? details.currency.trim().toUpperCase()
        : "USD";
      const sellerName = log.actor?.name?.trim() || log.actor?.email?.trim() || "Utilisateur à confirmer";

      const data: Prisma.TicketSaleUncheckedCreateInput = {
        ticketNumber,
        customerName,
        route: "A COMPLETER",
        travelClass: TravelClass.ECONOMY,
        travelDate: dayStart,
        soldAt: log.createdAt,
        amount,
        currency,
        airlineId: airline.id,
        sellerId: log.actorId ?? undefined,
        sellerName,
        saleNature: SaleNature.CASH,
        paymentStatus: PaymentStatus.UNPAID,
        payerName: null,
        agencyMarkupPercent: 0,
        agencyMarkupAmount: 0,
        commissionBaseAmount: 0,
        commissionCalculationStatus: CommissionCalculationStatus.FINAL,
        commissionRateUsed: 0,
        commissionAmount: 0,
        commissionModeApplied: CommissionMode.IMMEDIATE,
        notes: `Restauration d'urgence depuis l'historique d'activité (${rawDate}). Vérifier l'itinéraire, le payant, le statut et la commission si nécessaire.`,
      };

      if (!dryRun) {
        const createdTicket = await prisma.ticketSale.create({ data });
        existingTicketNumbers.add(ticketNumber);
        ticketByNumber.set(ticketNumber, { ...createdTicket, payments: [] });
      }

      restoredTickets.push({
        ticketNumber,
        customerName,
        airlineName: airline.name,
        amount,
      });
    }

    const fxRateUsdToCdf = parsePositiveNumber(process.env.CASH_DEFAULT_USD_TO_CDF_RATE, 2800);
    const paymentFingerprints = new Set(
      existingTickets.flatMap((ticket) =>
        ticket.payments.map((payment) => `${ticket.ticketNumber}|${payment.amount.toFixed(2)}|${(payment.currency ?? ticket.currency).toUpperCase()}|${payment.reference ?? ""}`),
      ),
    );

    for (const log of paymentLogs) {
      const payload = (log.payload && typeof log.payload === "object" && !Array.isArray(log.payload)
        ? log.payload
        : {}) as Record<string, unknown>;
      const details = (payload.details && typeof payload.details === "object" && !Array.isArray(payload.details)
        ? payload.details
        : {}) as Record<string, unknown>;

      const ticketNumber = typeof details.ticketNumber === "string" ? details.ticketNumber.trim() : "";
      if (!ticketNumber) {
        skippedPayments.push({ ticketNumber: `audit:${log.id}`, reason: "Billet du paiement introuvable dans l'historique." });
        continue;
      }

      const ticket = ticketByNumber.get(ticketNumber) ?? await prisma.ticketSale.findUnique({
        where: { ticketNumber },
        include: { payments: true },
      });

      if (!ticket) {
        skippedPayments.push({ ticketNumber, reason: "Billet absent: paiement non restauré." });
        continue;
      }

      ticketByNumber.set(ticketNumber, ticket);

      const amount = typeof details.amount === "number"
        ? details.amount
        : Number.parseFloat(String(details.amount ?? ""));
      if (!Number.isFinite(amount) || amount <= 0) {
        skippedPayments.push({ ticketNumber, reason: "Montant de paiement invalide dans l'historique." });
        continue;
      }

      const currency = normalizeMoneyCurrency(details.currency);
      const method = typeof details.method === "string" && details.method.trim() ? details.method.trim() : "Paiement restauré";
      const reference = typeof details.reference === "string" && details.reference.trim() ? details.reference.trim() : null;
      const fingerprint = `${ticketNumber}|${amount.toFixed(2)}|${currency}|${reference ?? ""}`;
      if (paymentFingerprints.has(fingerprint)) {
        skippedPayments.push({ ticketNumber, reason: "Paiement déjà présent." });
        continue;
      }

      if (!dryRun) {
        await prisma.$transaction(async (tx) => {
          await tx.payment.create({
            data: {
              ticketId: ticket.id,
              amount,
              currency,
              fxRateUsdToCdf,
              amountUsd: amountToUsd(amount, currency, fxRateUsdToCdf),
              amountCdf: amountToCdf(amount, currency, fxRateUsdToCdf),
              paidAt: log.createdAt,
              method,
              reference,
            },
          });

          const refreshed = await tx.ticketSale.findUnique({
            where: { id: ticket.id },
            include: { payments: true },
          });

          if (refreshed) {
            const paidTotal = refreshed.payments.reduce((sum, payment) => (
              sum + amountToTicketCurrency(
                payment.amount,
                normalizeMoneyCurrency(payment.currency ?? refreshed.currency),
                normalizeMoneyCurrency(refreshed.currency),
                payment.fxRateUsdToCdf ?? fxRateUsdToCdf,
              )
            ), 0);

            await tx.ticketSale.update({
              where: { id: ticket.id },
              data: { paymentStatus: computePaymentStatus(refreshed.amount, paidTotal) },
            });
          }
        });
      }

      paymentFingerprints.add(fingerprint);
      restoredPayments.push({ ticketNumber, amount, currency, method });
    }

    if (!dryRun && (restoredTickets.length > 0 || restoredPayments.length > 0)) {
      await writeActivityLog({
        actorId: access.session.user.id,
        action: "TICKET_RESTORED_FROM_AUDIT",
        entityType: "TICKET_SALE",
        entityId: "GLOBAL",
        summary: `${restoredTickets.length} billet(s) et ${restoredPayments.length} paiement(s) du ${rawDate} restauré(s) depuis l'historique d'activité.`,
        payload: {
          date: rawDate,
          restoredTickets,
          skippedTickets,
          restoredPayments,
          skippedPayments,
          note: "Restauration d'urgence sans ajustement rétroactif du dépôt.",
        } as Prisma.InputJsonValue,
      });
    }

    return NextResponse.json({
      data: {
        date: rawDate,
        dryRun,
        restored: restoredTickets.length,
        restoredPayments: restoredPayments.length,
        skipped: skippedTickets.length,
        skippedPayments: skippedPayments.length,
        tickets: restoredTickets,
        payments: restoredPayments,
        skippedTickets,
        message: (restoredTickets.length > 0 || restoredPayments.length > 0)
          ? `${restoredTickets.length} billet(s) et ${restoredPayments.length} paiement(s) restauré(s) depuis l'historique.`
          : "Aucune donnée manquante à restaurer pour cette date.",
      },
    });
  } catch (error) {
    console.error("POST /api/tickets/restore-from-audit failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de restaurer les billets depuis l'historique." },
      { status: 500 },
    );
  }
}
