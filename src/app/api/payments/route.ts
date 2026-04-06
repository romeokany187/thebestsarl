import { NextRequest, NextResponse } from "next/server";
import { PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { paymentCreateSchema } from "@/lib/validators";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { invoiceNumberFromChronology } from "@/lib/invoice";
import { getTicketTotalAmount } from "@/lib/ticket-pricing";

const cashOperationClient = (prisma as unknown as { cashOperation: any }).cashOperation;

function computePaymentStatus(totalDue: number, totalPaid: number): PaymentStatus {
  if (totalPaid <= 0) return PaymentStatus.UNPAID;
  if (totalPaid + 0.0001 >= totalDue) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  return normalized === "CDF" || normalized === "XAF" || normalized === "FC" ? "CDF" : "USD";
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function amountToUsd(amount: number, currency: "USD" | "CDF", fxRateUsdToCdf: number): number {
  return currency === "USD" ? amount : amount / fxRateUsdToCdf;
}

function amountToCdf(amount: number, currency: "USD" | "CDF", fxRateUsdToCdf: number): number {
  return currency === "CDF" ? amount : amount * fxRateUsdToCdf;
}

function amountToTicketCurrency(
  amount: number,
  paymentCurrency: "USD" | "CDF",
  ticketCurrency: "USD" | "CDF",
  fxRateUsdToCdf: number,
): number {
  if (paymentCurrency === ticketCurrency) return amount;
  return ticketCurrency === "USD"
    ? amountToUsd(amount, paymentCurrency, fxRateUsdToCdf)
    : amountToCdf(amount, paymentCurrency, fxRateUsdToCdf);
}

function canWritePayments(role: string, jobTitle: string | null | undefined) {
  return role === "ADMIN" || role === "ACCOUNTANT" || jobTitle === "CAISSIER" || jobTitle === "COMPTABLE";
}

function canManagePayments(role: string, jobTitle: string | null | undefined) {
  return role === "ADMIN" || role === "ACCOUNTANT" || jobTitle === "COMPTABLE";
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canWritePayments(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Seuls l'administrateur, le comptable et le caissier sont autorisés à enregistrer des paiements." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = paymentCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const latestRateOperation = await cashOperationClient.findFirst({
      where: {
        fxRateUsdToCdf: { not: null },
      },
      orderBy: { occurredAt: "desc" },
      select: { fxRateUsdToCdf: true },
    });

    const fxRateUsdToCdf = latestRateOperation?.fxRateUsdToCdf
      ?? parsePositiveNumber(process.env.CASH_DEFAULT_USD_TO_CDF_RATE, 2800);

    if (!fxRateUsdToCdf || fxRateUsdToCdf <= 0) {
      return NextResponse.json({ error: "Taux USD/CDF indisponible pour enregistrer le paiement." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticketSale.findUnique({
        where: { id: parsed.data.ticketId },
        include: {
          payments: true,
          seller: { select: { team: { select: { name: true } } } },
        },
      });

      if (!ticket) {
        throw new Error("BILLET_INTROUVABLE");
      }

      const year = ticket.soldAt.getUTCFullYear();
      const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
      const yearEnd = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
      const sequence = await tx.ticketSale.count({
        where: {
          soldAt: { gte: yearStart, lt: yearEnd },
          OR: [
            { soldAt: { lt: ticket.soldAt } },
            { soldAt: ticket.soldAt, id: { lte: ticket.id } },
          ],
        },
      });
      const expectedInvoiceNumber = invoiceNumberFromChronology({
        soldAt: ticket.soldAt,
        sellerTeamName: ticket.seller?.team?.name ?? null,
        sequence,
      });

      if (parsed.data.reference.trim() !== expectedInvoiceNumber) {
        throw new Error("REFERENCE_FACTURE_INVALIDE");
      }

      const ticketCurrency = normalizeMoneyCurrency(ticket.currency);
      const paymentCurrency = normalizeMoneyCurrency(parsed.data.currency ?? ticket.currency);
      const totalDue = getTicketTotalAmount(ticket);
      const alreadyPaid = ticket.payments.reduce((sum, payment) => {
        const existingPaymentCurrency = normalizeMoneyCurrency((payment as { currency?: string | null }).currency ?? ticket.currency);
        const existingRate = (payment as { fxRateUsdToCdf?: number | null }).fxRateUsdToCdf ?? fxRateUsdToCdf;
        return sum + amountToTicketCurrency(payment.amount, existingPaymentCurrency, ticketCurrency, existingRate);
      }, 0);
      const paymentEquivalentInTicketCurrency = amountToTicketCurrency(
        parsed.data.amount,
        paymentCurrency,
        ticketCurrency,
        fxRateUsdToCdf,
      );
      const nextPaidTotal = alreadyPaid + paymentEquivalentInTicketCurrency;

      if (nextPaidTotal > totalDue + 0.0001) {
        throw new Error("DEPASSEMENT");
      }

      const payment = await tx.payment.create({
        data: {
          ticketId: ticket.id,
          amount: parsed.data.amount,
          currency: paymentCurrency,
          fxRateUsdToCdf,
          amountUsd: amountToUsd(parsed.data.amount, paymentCurrency, fxRateUsdToCdf),
          amountCdf: amountToCdf(parsed.data.amount, paymentCurrency, fxRateUsdToCdf),
          method: parsed.data.method,
          reference: expectedInvoiceNumber,
          paidAt: parsed.data.paidAt,
        },
      });

      const nextStatus = computePaymentStatus(totalDue, nextPaidTotal);

      const updatedTicket = await tx.ticketSale.update({
        where: { id: ticket.id },
        data: {
          paymentStatus: nextStatus,
        },
        select: {
          id: true,
          ticketNumber: true,
          customerName: true,
          amount: true,
          paymentStatus: true,
          currency: true,
        },
      });

      return {
        payment,
        ticket: updatedTicket,
        paidTotal: nextPaidTotal,
        ticketEquivalentAmount: paymentEquivalentInTicketCurrency,
        fxRateUsdToCdf,
        totalDue,
      };
    });

    const accountants = await prisma.user.findMany({
      where: {
        id: { not: access.session.user.id },
        OR: [
          { role: "ACCOUNTANT" },
          { jobTitle: "COMPTABLE" },
        ],
      },
      select: { id: true, name: true, email: true },
      take: 200,
    });

    if (accountants.length > 0) {
      await prisma.userNotification.createMany({
        data: accountants.map((user) => ({
          userId: user.id,
          title: `Nouveau paiement billet ${result.ticket.ticketNumber}`,
          message: `Encaissement de ${result.payment.amount.toFixed(2)} ${result.payment.currency} enregistré par l'agent finance. Total encaissé billet: ${result.paidTotal.toFixed(2)} ${result.ticket.currency}.`,
          type: "PAYMENT_ENTRY",
          metadata: {
            ticketId: result.ticket.id,
            ticketNumber: result.ticket.ticketNumber,
            customerName: result.ticket.customerName,
            paymentId: result.payment.id,
            paymentAmount: result.payment.amount,
            paymentCurrency: result.payment.currency,
            paymentEquivalentTicketCurrency: result.ticketEquivalentAmount,
            paidTotal: result.paidTotal,
            ticketAmount: result.totalDue,
            ticketCurrency: result.ticket.currency,
            paymentMethod: result.payment.method,
            paymentReference: result.payment.reference,
            paymentStatus: result.ticket.paymentStatus,
            fxRateUsdToCdf: result.fxRateUsdToCdf,
            actorId: access.session.user.id,
            actorName: access.session.user.name ?? "Agent financier",
            source: "PAYMENTS_MODULE",
          },
        })),
      });

      if (isMailConfigured()) {
        try {
          const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
          const paymentsUrl = appUrl ? `${appUrl}/payments` : "/payments";

          await sendMailBatch({
            recipients: accountants.map((user) => ({ email: user.email, name: user.name })),
            subject: `Notification comptable - Paiement billet ${result.ticket.ticketNumber}`,
            text: [
              "THEBEST SARL - Ecriture de paiement billet",
              "",
              `Billet: ${result.ticket.ticketNumber}`,
              `Client: ${result.ticket.customerName}`,
              `Montant encaisse: ${result.payment.amount.toFixed(2)} ${result.payment.currency}`,
              `Equivalent billet: ${result.ticketEquivalentAmount.toFixed(2)} ${result.ticket.currency}`,
              `Total encaisse billet: ${result.paidTotal.toFixed(2)} ${result.ticket.currency}`,
              `Montant billet: ${result.totalDue.toFixed(2)} ${result.ticket.currency}`,
              `Statut billet: ${result.ticket.paymentStatus}`,
              `Methode: ${result.payment.method}`,
              `Reference: ${result.payment.reference ?? "-"}`,
              `Taux du jour: 1 USD = ${result.fxRateUsdToCdf.toFixed(2)} CDF`,
              `Saisi par: ${access.session.user.name ?? "Agent financier"}`,
              "",
              `Consulter: ${paymentsUrl}`,
            ].join("\n"),
            html: `
              <p><strong>THEBEST SARL - Ecriture de paiement billet</strong></p>
              <p><strong>Billet:</strong> ${result.ticket.ticketNumber}<br/>
              <strong>Client:</strong> ${result.ticket.customerName}<br/>
              <strong>Montant encaissé:</strong> ${result.payment.amount.toFixed(2)} ${result.payment.currency}<br/>
              <strong>Equivalent billet:</strong> ${result.ticketEquivalentAmount.toFixed(2)} ${result.ticket.currency}<br/>
              <strong>Total encaissé billet:</strong> ${result.paidTotal.toFixed(2)} ${result.ticket.currency}<br/>
              <strong>Montant billet:</strong> ${result.totalDue.toFixed(2)} ${result.ticket.currency}<br/>
              <strong>Statut billet:</strong> ${result.ticket.paymentStatus}<br/>
              <strong>Méthode:</strong> ${result.payment.method}<br/>
              <strong>Référence:</strong> ${result.payment.reference ?? "-"}<br/>
              <strong>Taux du jour:</strong> 1 USD = ${result.fxRateUsdToCdf.toFixed(2)} CDF<br/>
              <strong>Saisi par:</strong> ${access.session.user.name ?? "Agent financier"}</p>
              <p><a href="${paymentsUrl}">Ouvrir le module paiements</a></p>
            `,
            replyTo: access.session.user.email ?? undefined,
          });
        } catch (mailError) {
          console.error("[payments.create] Echec envoi email comptable", {
            paymentId: result.payment.id,
            error: mailError instanceof Error ? mailError.message : "Erreur inconnue",
          });
        }
      }
    }

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "BILLET_INTROUVABLE") {
        return NextResponse.json({ error: "Billet introuvable." }, { status: 404 });
      }
      if (error.message === "DEPASSEMENT") {
        return NextResponse.json({ error: "Le paiement dépasse le montant facturé du billet." }, { status: 400 });
      }
      if (error.message === "REFERENCE_FACTURE_INVALIDE") {
        return NextResponse.json({ error: "La référence du paiement doit être exactement le numéro de facture du billet." }, { status: 400 });
      }
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json({ error: "Erreur base de données lors de l'encaissement." }, { status: 500 });
    }

    return NextResponse.json({ error: "Erreur serveur lors de l'enregistrement du paiement." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManagePayments(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Seuls l'administrateur et le comptable peuvent modifier un paiement." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const paymentId = typeof body?.paymentId === "string" ? body.paymentId.trim() : "";

    if (!paymentId) {
      return NextResponse.json({ error: "Paiement introuvable." }, { status: 400 });
    }

    const existingPayment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        ticket: {
          include: {
            payments: true,
            seller: { select: { team: { select: { name: true } } } },
          },
        },
      },
    });

    if (!existingPayment) {
      return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });
    }

    const ticket = existingPayment.ticket;
    const ticketCurrency = normalizeMoneyCurrency(ticket.currency);
    const nextAmount = body?.amount !== undefined ? Number(body.amount) : existingPayment.amount;
    const nextCurrency = normalizeMoneyCurrency(typeof body?.currency === "string" ? body.currency : existingPayment.currency ?? ticket.currency);
    const nextMethod = typeof body?.method === "string" && body.method.trim().length >= 2
      ? body.method.trim()
      : existingPayment.method;

    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      return NextResponse.json({ error: "Montant invalide pour la modification du paiement." }, { status: 400 });
    }

    const paidAtRaw = typeof body?.paidAt === "string" ? body.paidAt : null;
    const nextPaidAt = paidAtRaw ? new Date(paidAtRaw) : new Date(existingPayment.paidAt);
    if (Number.isNaN(nextPaidAt.getTime())) {
      return NextResponse.json({ error: "Date de paiement invalide." }, { status: 400 });
    }

    const latestRateOperation = await cashOperationClient.findFirst({
      where: {
        fxRateUsdToCdf: { not: null },
      },
      orderBy: { occurredAt: "desc" },
      select: { fxRateUsdToCdf: true },
    });

    const fxRateUsdToCdf = latestRateOperation?.fxRateUsdToCdf
      ?? parsePositiveNumber(process.env.CASH_DEFAULT_USD_TO_CDF_RATE, 2800);

    const year = ticket.soldAt.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    const sequence = await prisma.ticketSale.count({
      where: {
        soldAt: { gte: yearStart, lt: yearEnd },
        OR: [
          { soldAt: { lt: ticket.soldAt } },
          { soldAt: ticket.soldAt, id: { lte: ticket.id } },
        ],
      },
    });
    const expectedInvoiceNumber = invoiceNumberFromChronology({
      soldAt: ticket.soldAt,
      sellerTeamName: ticket.seller?.team?.name ?? null,
      sequence,
    });

    const nextReference = typeof body?.reference === "string" && body.reference.trim().length > 0
      ? body.reference.trim()
      : existingPayment.reference ?? expectedInvoiceNumber;

    if (nextReference !== expectedInvoiceNumber) {
      return NextResponse.json({ error: "La référence du paiement doit être exactement le numéro de facture du billet." }, { status: 400 });
    }

    const otherPaidTotal = ticket.payments
      .filter((payment) => payment.id !== existingPayment.id)
      .reduce((sum, payment) => {
        const existingCurrency = normalizeMoneyCurrency(payment.currency ?? ticket.currency);
        const existingRate = payment.fxRateUsdToCdf ?? fxRateUsdToCdf;
        return sum + amountToTicketCurrency(payment.amount, existingCurrency, ticketCurrency, existingRate);
      }, 0);

    const nextEquivalentAmount = amountToTicketCurrency(nextAmount, nextCurrency, ticketCurrency, fxRateUsdToCdf);
    const totalDue = getTicketTotalAmount(ticket);
    const nextPaidTotal = otherPaidTotal + nextEquivalentAmount;

    if (nextPaidTotal > totalDue + 0.0001) {
      return NextResponse.json({ error: "Le paiement dépasse le montant facturé du billet." }, { status: 400 });
    }

    const nextStatus = computePaymentStatus(totalDue, nextPaidTotal);

    const updated = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          amount: nextAmount,
          currency: nextCurrency,
          fxRateUsdToCdf,
          amountUsd: amountToUsd(nextAmount, nextCurrency, fxRateUsdToCdf),
          amountCdf: amountToCdf(nextAmount, nextCurrency, fxRateUsdToCdf),
          method: nextMethod,
          reference: nextReference,
          paidAt: nextPaidAt,
        },
      });

      await tx.ticketSale.update({
        where: { id: ticket.id },
        data: { paymentStatus: nextStatus },
      });

      return payment;
    });

    return NextResponse.json({ data: updated }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Erreur serveur lors de la modification du paiement." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManagePayments(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Seuls l'administrateur et le comptable peuvent supprimer un paiement." }, { status: 403 });
  }

  const paymentId = request.nextUrl.searchParams.get("paymentId")?.trim() ?? "";
  if (!paymentId) {
    return NextResponse.json({ error: "Paiement introuvable." }, { status: 400 });
  }

  try {
    const existingPayment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        ticket: {
          include: {
            payments: true,
          },
        },
      },
    });

    if (!existingPayment) {
      return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });
    }

    const ticket = existingPayment.ticket;
    const ticketCurrency = normalizeMoneyCurrency(ticket.currency);
    const totalDue = getTicketTotalAmount(ticket);
    const remainingPaidTotal = ticket.payments
      .filter((payment) => payment.id !== paymentId)
      .reduce((sum, payment) => {
        const existingCurrency = normalizeMoneyCurrency(payment.currency ?? ticket.currency);
        const existingRate = payment.fxRateUsdToCdf ?? parsePositiveNumber(process.env.CASH_DEFAULT_USD_TO_CDF_RATE, 2800);
        return sum + amountToTicketCurrency(payment.amount, existingCurrency, ticketCurrency, existingRate);
      }, 0);

    const nextStatus = computePaymentStatus(totalDue, remainingPaidTotal);

    await prisma.$transaction(async (tx) => {
      await tx.payment.delete({ where: { id: paymentId } });
      await tx.ticketSale.update({
        where: { id: ticket.id },
        data: { paymentStatus: nextStatus },
      });
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Erreur serveur lors de la suppression du paiement." }, { status: 500 });
  }
}
