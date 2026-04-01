import { NextRequest, NextResponse } from "next/server";
import { PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { paymentCreateSchema } from "@/lib/validators";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";

function computePaymentStatus(totalDue: number, totalPaid: number): PaymentStatus {
  if (totalPaid <= 0) return PaymentStatus.UNPAID;
  if (totalPaid + 0.0001 >= totalDue) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (access.session.user.jobTitle !== "CAISSIERE") {
    return NextResponse.json({ error: "Seule la caissière est autorisée à enregistrer des paiements." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = paymentCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticketSale.findUnique({
        where: { id: parsed.data.ticketId },
        include: { payments: true },
      });

      if (!ticket) {
        throw new Error("BILLET_INTROUVABLE");
      }

      const alreadyPaid = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const nextPaidTotal = alreadyPaid + parsed.data.amount;

      if (nextPaidTotal > ticket.amount + 0.0001) {
        throw new Error("DEPASSEMENT");
      }

      const payment = await tx.payment.create({
        data: {
          ticketId: ticket.id,
          amount: parsed.data.amount,
          method: parsed.data.method,
          reference: parsed.data.reference,
          paidAt: parsed.data.paidAt,
        },
      });

      const nextStatus = computePaymentStatus(ticket.amount, nextPaidTotal);

      const updatedTicket = await tx.ticketSale.update({
        where: { id: ticket.id },
        data: {
          paymentStatus: nextStatus,
          currency: "USD",
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
          message: `Encaissement de ${result.payment.amount.toFixed(2)} USD enregistré par la caissière. Total encaissé: ${result.paidTotal.toFixed(2)} USD.`,
          type: "PAYMENT_ENTRY",
          metadata: {
            ticketId: result.ticket.id,
            ticketNumber: result.ticket.ticketNumber,
            customerName: result.ticket.customerName,
            paymentId: result.payment.id,
            paymentAmount: result.payment.amount,
            paidTotal: result.paidTotal,
            ticketAmount: result.ticket.amount,
            paymentMethod: result.payment.method,
            paymentReference: result.payment.reference,
            paymentStatus: result.ticket.paymentStatus,
            actorId: access.session.user.id,
            actorName: access.session.user.name ?? "Caissiere",
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
              `Montant encaisse: ${result.payment.amount.toFixed(2)} USD`,
              `Total encaisse billet: ${result.paidTotal.toFixed(2)} USD`,
              `Montant billet: ${result.ticket.amount.toFixed(2)} USD`,
              `Statut billet: ${result.ticket.paymentStatus}`,
              `Methode: ${result.payment.method}`,
              `Reference: ${result.payment.reference ?? "-"}`,
              `Saisi par: ${access.session.user.name ?? "Caissiere"}`,
              "",
              `Consulter: ${paymentsUrl}`,
            ].join("\n"),
            html: `
              <p><strong>THEBEST SARL - Ecriture de paiement billet</strong></p>
              <p><strong>Billet:</strong> ${result.ticket.ticketNumber}<br/>
              <strong>Client:</strong> ${result.ticket.customerName}<br/>
              <strong>Montant encaissé:</strong> ${result.payment.amount.toFixed(2)} USD<br/>
              <strong>Total encaissé billet:</strong> ${result.paidTotal.toFixed(2)} USD<br/>
              <strong>Montant billet:</strong> ${result.ticket.amount.toFixed(2)} USD<br/>
              <strong>Statut billet:</strong> ${result.ticket.paymentStatus}<br/>
              <strong>Méthode:</strong> ${result.payment.method}<br/>
              <strong>Référence:</strong> ${result.payment.reference ?? "-"}<br/>
              <strong>Saisi par:</strong> ${access.session.user.name ?? "Caissière"}</p>
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
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json({ error: "Erreur base de données lors de l'encaissement." }, { status: 500 });
    }

    return NextResponse.json({ error: "Erreur serveur lors de l'enregistrement du paiement." }, { status: 500 });
  }
}
