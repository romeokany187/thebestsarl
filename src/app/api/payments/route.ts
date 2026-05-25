import { NextRequest, NextResponse } from "next/server";
import { PaymentStatus, Prisma } from "@prisma/client";
import { isCashierJobTitle } from "@/lib/assignment";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { paymentCreateSchema } from "@/lib/validators";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { getTicketTotalAmount } from "@/lib/ticket-pricing";
import { writeActivityLog } from "@/lib/activity-log";
import { hasRequiredModuleAccessLevel, type ModuleAccessLevel } from "@/lib/user-module-access";

const cashOperationClient = (prisma as unknown as { cashOperation: any }).cashOperation;

type AccountingDailyRateRow = {
  id: string;
  rateDate: Date | string;
  exchangeRate: number;
};

function computePaymentStatus(totalDue: number, totalPaid: number): PaymentStatus {
  if (totalPaid <= 0) return PaymentStatus.UNPAID;
  if (totalPaid + 0.0001 >= totalDue) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  return normalized === "CDF" || normalized === "XAF" || normalized === "FC" ? "CDF" : "USD";
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

function toKinshasaDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kinshasa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function toUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function toSqlDateTime(date: Date) {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

async function ensureAccountingDailyRateTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \
    \`AccountingDailyRate\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`rateDate\` DATETIME(3) NOT NULL,
      \`exchangeRate\` DOUBLE NOT NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`AccountingDailyRate_rateDate_key\` (\`rateDate\`),
      INDEX \`AccountingDailyRate_createdById_idx\` (\`createdById\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
}

async function resolveAccountingDailyRate(effectiveAt: Date) {
  await ensureAccountingDailyRateTable();
  const businessDate = toKinshasaDateKey(effectiveAt);
  const rateDate = toUtcDay(new Date(`${businessDate}T00:00:00.000Z`));

  const rows = await prisma.$queryRawUnsafe<AccountingDailyRateRow[]>(`
    SELECT id, rateDate, exchangeRate
    FROM \`AccountingDailyRate\`
    WHERE rateDate = '${toSqlDateTime(rateDate)}'
    LIMIT 1
  `);

  const match = rows[0] ?? null;
  if (!match) {
    throw new Error(`MISSING_ACCOUNTING_DAILY_RATE:${businessDate}`);
  }

  return Number(match.exchangeRate);
}

function canWritePayments(role: string, jobTitle: string | null | undefined, customModuleAccessLevel?: ModuleAccessLevel | null) {
  return hasRequiredModuleAccessLevel(customModuleAccessLevel, "FULL") || role === "ADMIN" || role === "ACCOUNTANT" || isCashierJobTitle(jobTitle) || jobTitle === "COMPTABLE";
}

function canManagePayments(role: string, jobTitle: string | null | undefined, customModuleAccessLevel?: ModuleAccessLevel | null) {
  return hasRequiredModuleAccessLevel(customModuleAccessLevel, "FULL") || role === "ADMIN" || role === "ACCOUNTANT" || jobTitle === "COMPTABLE";
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canWritePayments(access.role, access.session.user.jobTitle, access.customModuleAccess)) {
    return NextResponse.json({ error: "Seuls l'administrateur, le comptable et les profils caisse autorisés peuvent enregistrer des paiements." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = paymentCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const effectivePaidAt = parsed.data.paidAt ?? new Date();
    const fxRateUsdToCdf = await resolveAccountingDailyRate(effectivePaidAt);

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

      const justificativeReference = parsed.data.reference.trim();
      if (!justificativeReference) {
        throw new Error("MISSING_JUSTIFICATIVE_REFERENCE");
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
          reference: justificativeReference,
          paidAt: effectivePaidAt,
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

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "PAYMENT_RECORDED",
      entityType: "PAYMENT",
      entityId: result.payment.id,
      summary: `Paiement encaissé pour le billet ${result.ticket.ticketNumber}: ${result.payment.amount.toFixed(2)} ${result.payment.currency}.`,
      payload: {
        ticketId: result.ticket.id,
        ticketNumber: result.ticket.ticketNumber,
        customerName: result.ticket.customerName,
        amount: result.payment.amount,
        currency: result.payment.currency,
        method: result.payment.method,
        reference: result.payment.reference,
        paymentStatus: result.ticket.paymentStatus,
      } as Prisma.InputJsonValue,
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "BILLET_INTROUVABLE") {
        return NextResponse.json({ error: "Billet introuvable." }, { status: 404 });
      }
      if (error.message === "DEPASSEMENT") {
        return NextResponse.json({ error: "Le paiement dépasse le montant facturé du billet." }, { status: 400 });
      }
      if (error.message === "MISSING_JUSTIFICATIVE_REFERENCE") {
        return NextResponse.json({ error: "Le numéro du bon d'entrée en caisse est obligatoire comme pièce justificative." }, { status: 400 });
      }
      if (error.message.startsWith("MISSING_ACCOUNTING_DAILY_RATE:")) {
        const [, businessDate = "la date demandee"] = error.message.split(":");
        return NextResponse.json({ error: `Aucun taux du jour comptable n'est enregistré pour le ${businessDate}. Le comptable doit d'abord le saisir.` }, { status: 400 });
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

  if (!canManagePayments(access.role, access.session.user.jobTitle, access.customModuleAccess)) {
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
    if (toKinshasaDateKey(nextPaidAt) > toKinshasaDateKey(new Date())) {
      return NextResponse.json({ error: "La date de paiement ne peut pas être dans le futur." }, { status: 400 });
    }

    const fxRateUsdToCdf = await resolveAccountingDailyRate(nextPaidAt);

    const nextReference = typeof body?.reference === "string" && body.reference.trim().length > 0
      ? body.reference.trim()
      : existingPayment.reference ?? "";

    if (!nextReference) {
      return NextResponse.json({ error: "Le numéro du bon d'entrée en caisse est obligatoire comme pièce justificative." }, { status: 400 });
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

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "PAYMENT_UPDATED",
      entityType: "PAYMENT",
      entityId: updated.id,
      summary: `Paiement du billet ${ticket.ticketNumber} modifié à ${updated.amount.toFixed(2)} ${updated.currency}.`,
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        amount: updated.amount,
        currency: updated.currency,
        method: updated.method,
        reference: updated.reference,
      } as Prisma.InputJsonValue,
    });

    return NextResponse.json({ data: updated }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MISSING_ACCOUNTING_DAILY_RATE:")) {
      const [, businessDate = "la date demandee"] = error.message.split(":");
      return NextResponse.json({ error: `Aucun taux du jour comptable n'est enregistré pour le ${businessDate}. Le comptable doit d'abord le saisir.` }, { status: 400 });
    }
    return NextResponse.json({ error: "Erreur serveur lors de la modification du paiement." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManagePayments(access.role, access.session.user.jobTitle, access.customModuleAccess)) {
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

    const latestRateOperation = await cashOperationClient.findFirst({
      where: {
        fxRateUsdToCdf: { not: null },
      },
      orderBy: { occurredAt: "desc" },
      select: { fxRateUsdToCdf: true },
    });

    const fallbackRateUsdToCdf = latestRateOperation?.fxRateUsdToCdf ?? null;
    if (!fallbackRateUsdToCdf || fallbackRateUsdToCdf <= 0) {
      return NextResponse.json({ error: "Taux USD/CDF indisponible. Le comptable doit d'abord enregistrer le taux du jour en caisse." }, { status: 400 });
    }

    const ticket = existingPayment.ticket;
    const ticketCurrency = normalizeMoneyCurrency(ticket.currency);
    const totalDue = getTicketTotalAmount(ticket);
    const remainingPaidTotal = ticket.payments
      .filter((payment) => payment.id !== paymentId)
      .reduce((sum, payment) => {
        const existingCurrency = normalizeMoneyCurrency(payment.currency ?? ticket.currency);
        const existingRate = payment.fxRateUsdToCdf ?? fallbackRateUsdToCdf;
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

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "PAYMENT_DELETED",
      entityType: "PAYMENT",
      entityId: existingPayment.id,
      summary: `Paiement supprimé du billet ${ticket.ticketNumber}: ${existingPayment.amount.toFixed(2)} ${existingPayment.currency ?? ticket.currency}.`,
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        amount: existingPayment.amount,
        currency: existingPayment.currency ?? ticket.currency,
        reference: existingPayment.reference,
      } as Prisma.InputJsonValue,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Erreur serveur lors de la suppression du paiement." }, { status: 500 });
  }
}
