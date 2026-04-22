import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import {
  canReviewCashOperationApprovals,
  cashOperationApprovalRequestClient,
  ensureCashOperationApprovalRequestTable,
} from "@/lib/cash-operation-approvals";
import { writeActivityLog } from "@/lib/activity-log";

type Params = { params: Promise<{ id: string }> };

function amountToUsd(amount: number, currency: string, fxRateUsdToCdf: number) {
  if (currency === "USD") return amount;
  return amount / fxRateUsdToCdf;
}

async function assertAvailableBalance(tx: any, approvalRequest: any) {
  const occurredAt = new Date(approvalRequest.occurredAt);
  const ticketInflows = await tx.payment.aggregate({
    where: { paidAt: { lte: occurredAt } },
    _sum: { amount: true },
  });

  const previousCashOperations = await (tx as unknown as { cashOperation: any }).cashOperation.findMany({
    where: { occurredAt: { lte: occurredAt } },
    select: {
      direction: true,
      amount: true,
      currency: true,
      amountUsd: true,
      fxRateUsdToCdf: true,
    },
    take: 100000,
  });

  const availableBalance = previousCashOperations.reduce((sum: number, op: any) => {
    const opCurrency = (op.currency ?? "USD").toUpperCase();
    const opAmountUsd = typeof op.amountUsd === "number"
      ? op.amountUsd
      : amountToUsd(op.amount, opCurrency, op.fxRateUsdToCdf ?? approvalRequest.fxRateUsdToCdf);
    return sum + (op.direction === "INFLOW" ? opAmountUsd : -opAmountUsd);
  }, ticketInflows._sum.amount ?? 0);

  const availableCurrencyBalance = previousCashOperations.reduce((sum: number, op: any) => {
    const opCurrency = (op.currency ?? "USD").toUpperCase();
    if (opCurrency !== approvalRequest.currency) return sum;
    return sum + (op.direction === "INFLOW" ? op.amount : -op.amount);
  }, approvalRequest.currency === "USD" ? (ticketInflows._sum.amount ?? 0) : 0);

  if (approvalRequest.amountUsd > availableBalance + 0.0001) {
    throw new Error(`INSUFFICIENT_CASH:${availableBalance.toFixed(2)}`);
  }

  if (approvalRequest.amount > availableCurrencyBalance + 0.0001) {
    throw new Error(`INSUFFICIENT_CURRENCY:${approvalRequest.currency}:${availableCurrencyBalance.toFixed(2)}`);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canReviewCashOperationApprovals(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Seuls l'administrateur et le comptable peuvent traiter ces demandes." }, { status: 403 });
  }

  const { id } = await params;
  await ensureCashOperationApprovalRequestTable();

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim().toUpperCase() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (action !== "APPROVE" && action !== "REJECT") {
    return NextResponse.json({ error: "Action invalide." }, { status: 400 });
  }

  const existingRequest = await cashOperationApprovalRequestClient.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      requestedById: true,
      occurredAt: true,
      direction: true,
      category: true,
      amount: true,
      currency: true,
      fxRateUsdToCdf: true,
      amountUsd: true,
      amountCdf: true,
      method: true,
      reference: true,
      description: true,
      cashDesk: true,
    },
  });

  if (!existingRequest) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  if (existingRequest.status !== "PENDING") {
    return NextResponse.json({ error: "Cette demande a déjà été traitée." }, { status: 409 });
  }

  if (action === "REJECT") {
    const rejected = await cashOperationApprovalRequestClient.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedById: access.session.user.id,
        reason: reason || "Demande rejetée par la comptabilité.",
        rejectedAt: new Date(),
      },
      select: { id: true, requestedById: true, reason: true },
    });

    await prisma.userNotification.create({
      data: {
        userId: rejected.requestedById,
        title: "Décaissement refusé",
        message: `Votre demande ${rejected.id} a été rejetée. Motif: ${rejected.reason}`,
        type: "CASH_OPERATION_APPROVAL_REJECTED",
        metadata: {
          approvalRequestId: rejected.id,
          reviewedById: access.session.user.id,
          reviewedByName: access.session.user.name ?? "Comptabilité",
          reason: rejected.reason,
        },
      },
    });

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "CASH_OPERATION_APPROVAL_REJECTED",
      entityType: "CASH_OPERATION_APPROVAL_REQUEST",
      entityId: rejected.id,
      summary: `Décaissement bloqué rejeté: ${rejected.id}.`,
      payload: { reason: rejected.reason },
    });

    return NextResponse.json({ data: rejected });
  }

  try {
    const approved = await prisma.$transaction(async (tx) => {
      const approvalRequest = await (tx as unknown as { cashOperationApprovalRequest: any }).cashOperationApprovalRequest.findUnique({
        where: { id },
      });

      if (!approvalRequest) {
        throw new Error("REQUEST_NOT_FOUND");
      }

      if (approvalRequest.status !== "PENDING") {
        throw new Error("REQUEST_ALREADY_PROCESSED");
      }

      await assertAvailableBalance(tx, approvalRequest);

      const operation = await (tx as unknown as { cashOperation: any }).cashOperation.create({
        data: {
          occurredAt: approvalRequest.occurredAt,
          direction: approvalRequest.direction,
          category: approvalRequest.category,
          amount: approvalRequest.amount,
          currency: approvalRequest.currency,
          fxRateToUsd: 1 / approvalRequest.fxRateUsdToCdf,
          fxRateUsdToCdf: approvalRequest.fxRateUsdToCdf,
          amountUsd: approvalRequest.amountUsd,
          amountCdf: approvalRequest.amountCdf,
          method: approvalRequest.method,
          reference: approvalRequest.reference,
          description: approvalRequest.description,
          cashDesk: approvalRequest.cashDesk,
          createdById: approvalRequest.requestedById,
        },
        select: {
          id: true,
          amount: true,
          currency: true,
          description: true,
        },
      });

      const updatedRequest = await (tx as unknown as { cashOperationApprovalRequest: any }).cashOperationApprovalRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedById: access.session.user.id,
          reason: reason || "Demande approuvée par la comptabilité.",
          approvedAt: new Date(),
          executedAt: new Date(),
          executedCashOperationId: operation.id,
        },
      });

      return { operation, updatedRequest };
    });

    await prisma.userNotification.create({
      data: {
        userId: existingRequest.requestedById,
        title: "Décaissement approuvé",
        message: `Votre demande ${id} a été approuvée et exécutée automatiquement.`,
        type: "CASH_OPERATION_APPROVAL_APPROVED",
        metadata: {
          approvalRequestId: id,
          reviewedById: access.session.user.id,
          reviewedByName: access.session.user.name ?? "Comptabilité",
          executedCashOperationId: approved.operation.id,
        },
      },
    });

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "CASH_OPERATION_APPROVAL_APPROVED",
      entityType: "CASH_OPERATION_APPROVAL_REQUEST",
      entityId: id,
      summary: `Décaissement bloqué approuvé et exécuté: ${approved.operation.amount.toFixed(2)} ${approved.operation.currency}.`,
      payload: {
        executedCashOperationId: approved.operation.id,
        description: approved.operation.description,
      },
    });

    return NextResponse.json({ data: approved.updatedRequest, executedCashOperationId: approved.operation.id });
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_NOT_FOUND") {
      return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "REQUEST_ALREADY_PROCESSED") {
      return NextResponse.json({ error: "Cette demande a déjà été traitée." }, { status: 409 });
    }
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_CASH:")) {
      const available = error.message.replace("INSUFFICIENT_CASH:", "");
      return NextResponse.json({ error: `Impossible d'exécuter la demande: solde disponible ${available} USD.` }, { status: 409 });
    }
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_CURRENCY:")) {
      const [, currency, available] = error.message.split(":");
      return NextResponse.json({ error: `Impossible d'exécuter la demande: solde ${currency} disponible ${available} ${currency}.` }, { status: 409 });
    }

    return NextResponse.json({ error: "Erreur serveur lors du traitement de la demande." }, { status: 500 });
  }
}