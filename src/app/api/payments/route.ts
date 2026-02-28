import { NextRequest, NextResponse } from "next/server";
import { PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { paymentCreateSchema } from "@/lib/validators";
import { canProcessPayments } from "@/lib/assignment";

function computePaymentStatus(totalDue: number, totalPaid: number): PaymentStatus {
  if (totalPaid <= 0) return PaymentStatus.UNPAID;
  if (totalPaid + 0.0001 >= totalDue) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (
    access.role !== "ADMIN"
    && access.role !== "MANAGER"
    && !canProcessPayments(access.session.user.jobTitle ?? "")
  ) {
    return NextResponse.json({ error: "Fonction non autorisée pour enregistrer des paiements." }, { status: 403 });
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
