import { NextRequest, NextResponse } from "next/server";
import { CommissionCalculationStatus, CommissionMode, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { ticketUpdateSchema } from "@/lib/validators";
import { computeCommissionAmount, pickCommissionRule } from "@/lib/commission";
import { getAirlineDepositAccountByAirlineCode, recordAirlineDepositMovement } from "@/lib/airline-deposit";
import { ensureAirlineCatalog } from "@/lib/airline-catalog";
import { getTicketDepositDebitAmount } from "@/lib/ticket-pricing";
import { canManageTicketRecord } from "@/lib/assignment";
import { writeActivityLog } from "@/lib/activity-log";

type Params = { params: Promise<{ id: string }> };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTicketDate(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const access = await requireApiModuleAccess("sales", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  if (!canManageTicketRecord(access.role)) {
    return NextResponse.json(
      { error: "Seul l'administrateur peut modifier un billet déjà enregistré." },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = ticketUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    await ensureAirlineCatalog(prisma);

    const existing = await prisma.ticketSale.findUnique({
      where: { id },
      include: {
        airline: {
          include: { commissionRules: { where: { isActive: true } } },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Billet introuvable." }, { status: 404 });
    }

    const nextAirlineId = parsed.data.airlineId ?? existing.airlineId;
    const nextSellerId = parsed.data.sellerId ?? existing.sellerId;
    const normalizedTravelDate = parsed.data.travelDate
      ? normalizeTicketDate(parsed.data.travelDate)
      : existing.travelDate;
    const normalizedSoldAt = access.role === "ADMIN" && parsed.data.soldAt
      ? normalizeTicketDate(parsed.data.soldAt)
      : existing.soldAt;
    const normalizedPatchData = {
      ...parsed.data,
      ...(parsed.data.travelDate ? { travelDate: normalizedTravelDate } : {}),
      ...(access.role === "ADMIN" && parsed.data.soldAt ? { soldAt: normalizedSoldAt } : {}),
    };

    const targetAirline = await prisma.airline.findUnique({
      where: { id: nextAirlineId },
      include: { commissionRules: { where: { isActive: true } } },
    });

    if (!targetAirline) {
      return NextResponse.json({ error: "Compagnie introuvable." }, { status: 400 });
    }

    const previousDepositAccount = getAirlineDepositAccountByAirlineCode(existing.airline.code);
    const nextDepositAccount = getAirlineDepositAccountByAirlineCode(targetAirline.code);

    const nextTicket = {
      ...existing,
      ...parsed.data,
      airlineId: nextAirlineId,
      sellerId: nextSellerId,
      amount: parsed.data.amount ?? existing.amount,
      route: parsed.data.route ?? existing.route,
      travelClass: parsed.data.travelClass ?? existing.travelClass,
      baseFareAmount: parsed.data.baseFareAmount ?? (existing.commissionCalculationStatus === CommissionCalculationStatus.ESTIMATED ? null : existing.baseFareAmount),
      agencyMarkupAmount: parsed.data.agencyMarkupAmount ?? existing.agencyMarkupAmount,
    };

    const agencyMarkupAmount = parsed.data.agencyMarkupAmount ?? existing.agencyMarkupAmount;

    const rule = pickCommissionRule(
      targetAirline.commissionRules,
      nextTicket.route,
      nextTicket.travelClass,
    );

    if (!rule) {
      const history = await prisma.ticketSale.findMany({
        where: {
          airlineId: nextAirlineId,
          id: { not: existing.id },
          commissionAmount: { gt: 0 },
          commissionCalculationStatus: CommissionCalculationStatus.FINAL,
        },
        select: {
          amount: true,
          commissionBaseAmount: true,
          commissionRateUsed: true,
        },
        orderBy: { soldAt: "desc" },
        take: 120,
      });

      const validRates = history
        .map((ticket) => ticket.commissionRateUsed)
        .filter((value) => Number.isFinite(value) && value > 0);
      const inferredRate = validRates.length > 0
        ? validRates.reduce((sum, value) => sum + value, 0) / validRates.length
        : null;

      const validRatios = history
        .filter((ticket) => ticket.amount > 0 && ticket.commissionBaseAmount > 0)
        .map((ticket) => ticket.commissionBaseAmount / ticket.amount)
        .filter((ratio) => Number.isFinite(ratio) && ratio > 0);
      const inferredBaseFareRatio = validRatios.length > 0
        ? clamp(validRatios.reduce((sum, value) => sum + value, 0) / validRatios.length, 0.2, 0.95)
        : 0.6;

      const fallbackBaseFareAmount = nextTicket.baseFareAmount
        ?? nextTicket.amount * inferredBaseFareRatio;
      const fallbackRate = inferredRate ?? (existing.commissionRateUsed > 0 ? existing.commissionRateUsed : 0);
      const fallbackCommissionAmount = fallbackBaseFareAmount > 0
        ? (fallbackBaseFareAmount * fallbackRate) / 100 + agencyMarkupAmount
        : 0;

      const updatedWithoutRule = await prisma.ticketSale.update({
        where: { id },
        data: {
          ...normalizedPatchData,
          currency: "USD",
          airlineId: nextTicket.airlineId,
          sellerId: nextTicket.sellerId,
          agencyMarkupPercent: 0,
          agencyMarkupAmount,
          commissionBaseAmount: fallbackBaseFareAmount,
          commissionCalculationStatus: CommissionCalculationStatus.ESTIMATED,
          commissionRateUsed: fallbackRate,
          commissionAmount: fallbackCommissionAmount,
          commissionModeApplied: CommissionMode.IMMEDIATE,
        },
      });

      await writeActivityLog({
        actorId: access.session.user.id,
        action: "TICKET_UPDATED",
        entityType: "TICKET_SALE",
        entityId: updatedWithoutRule.id,
        summary: `Billet ${updatedWithoutRule.ticketNumber} modifié avec commission estimée via historique.`,
        payload: {
          ticketNumber: updatedWithoutRule.ticketNumber,
          airlineId: nextAirlineId,
          amount: updatedWithoutRule.amount,
          warning: "COMMISSION_ESTIMATED_FROM_HISTORY",
        } as Prisma.InputJsonValue,
      });

      return NextResponse.json({
        data: updatedWithoutRule,
        warning: "Aucune règle active trouvée pour cette compagnie. Commission estimée via historique.",
      });
    }

    const isAirCongo = targetAirline.code === "ACG";
    const isMontGabaon = targetAirline.code === "MGB";
    const isAirFast = targetAirline.code === "FST";
    const isAfterDepositMode = rule?.commissionMode === CommissionMode.AFTER_DEPOSIT;
    const consumedBeforeForAfterDeposit = isAfterDepositMode
      ? (
        await prisma.ticketSale.aggregate({
          where: {
            airlineId: nextAirlineId,
            id: { not: existing.id },
          },
          _sum: { amount: true },
        })
      )._sum.amount ?? 0
      : 0;

    if ((isAirCongo || isMontGabaon) && !nextTicket.baseFareAmount) {
      return NextResponse.json(
        { error: "Pour Air Congo et Mont Gabaon, le BaseFare est obligatoire pour calculer la commission." },
        { status: 400 },
      );
    }

    const defaultBaseFareRatio = rule?.defaultBaseFareRatio && rule.defaultBaseFareRatio > 0
      ? clamp(rule.defaultBaseFareRatio, 0.2, 1)
      : 1;
    let commissionBaseAmount = nextTicket.baseFareAmount ?? 0;
    let commissionCalculationStatus: CommissionCalculationStatus = CommissionCalculationStatus.FINAL;

    if (!isAfterDepositMode && !nextTicket.baseFareAmount) {
      commissionBaseAmount = nextTicket.amount * defaultBaseFareRatio;
      commissionCalculationStatus = CommissionCalculationStatus.ESTIMATED;
    }

    const commissionInputAmount = isAfterDepositMode ? nextTicket.amount : commissionBaseAmount;
    const airFastSaleOrder = isAirFast
      ? await prisma.ticketSale.count({
        where: {
          airlineId: targetAirline.id,
          OR: [
            { soldAt: { lt: existing.soldAt } },
            { soldAt: existing.soldAt, id: { lte: existing.id } },
          ],
        },
      })
      : 0;

    const baseCommission = isAirCongo
      ? {
        ratePercent: 5,
        amount: commissionBaseAmount * 0.05,
        modeApplied: CommissionMode.IMMEDIATE,
      }
      : isMontGabaon
        ? {
          ratePercent: 9,
          amount: commissionBaseAmount * 0.09,
          modeApplied: CommissionMode.IMMEDIATE,
        }
      : isAirFast
          ? {
            ratePercent: airFastSaleOrder % 13 === 0 ? 100 : 0,
            amount: airFastSaleOrder % 13 === 0 ? nextTicket.amount : 0,
            modeApplied: CommissionMode.IMMEDIATE,
          }
        : rule
          ? computeCommissionAmount(
            commissionInputAmount,
            isAfterDepositMode
              ? { ...rule, depositStockConsumedAmount: consumedBeforeForAfterDeposit }
              : rule,
            0,
          )
          : {
            ratePercent: 0,
            amount: 0,
            modeApplied: CommissionMode.IMMEDIATE,
          };

    const commission = {
      ...baseCommission,
      amount: baseCommission.amount + agencyMarkupAmount,
      ratePercent: baseCommission.ratePercent,
    };

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.ticketSale.update({
        where: { id },
        data: {
          ...normalizedPatchData,
          currency: "USD",
          airlineId: nextTicket.airlineId,
          sellerId: nextTicket.sellerId,
          agencyMarkupPercent: 0,
          agencyMarkupAmount,
          commissionBaseAmount,
          commissionCalculationStatus,
          commissionRateUsed: commission.ratePercent,
          commissionAmount: commission.amount,
          commissionModeApplied: commission.modeApplied,
        },
      });

      if (
        isAfterDepositMode
        && rule.depositStockTargetAmount !== null
        && rule.depositStockTargetAmount !== undefined
      ) {
        await tx.commissionRule.update({
          where: { id: rule.id },
          data: {
            depositStockConsumedAmount: consumedBeforeForAfterDeposit + nextTicket.amount,
          },
        });
      }

      const previousDepositAmount = previousDepositAccount
        ? getTicketDepositDebitAmount({
          ...existing,
          airline: { code: existing.airline.code },
        })
        : 0;
      const nextDepositAmount = nextDepositAccount
        ? getTicketDepositDebitAmount({
          ...saved,
          airline: { code: targetAirline.code },
        })
        : 0;

      if (previousDepositAccount && nextDepositAccount && previousDepositAccount.key === nextDepositAccount.key) {
        const deltaAmount = nextDepositAmount - previousDepositAmount;
        if (Math.abs(deltaAmount) > 0.0001) {
          await recordAirlineDepositMovement(tx, {
            accountKey: nextDepositAccount.key,
            movementType: deltaAmount > 0 ? "DEBIT" : "CREDIT",
            amount: Math.abs(deltaAmount),
            reference: `AJUST ${saved.ticketNumber}`,
            description: deltaAmount > 0
              ? `Ajustement débit billet ${saved.ticketNumber} - ${targetAirline.name}`
              : `Ajustement crédit billet ${saved.ticketNumber} - ${targetAirline.name}`,
            airlineId: saved.airlineId,
            ticketSaleId: saved.id,
            createdById: access.session.user.id,
          });
        }
      } else {
        if (previousDepositAccount && previousDepositAmount > 0) {
          await recordAirlineDepositMovement(tx, {
            accountKey: previousDepositAccount.key,
            movementType: "CREDIT",
            amount: previousDepositAmount,
            reference: `TRANSFERT ${existing.ticketNumber}`,
            description: `Restitution ancienne compagnie pour billet ${existing.ticketNumber} - ${existing.airline.name}`,
            airlineId: existing.airlineId,
            ticketSaleId: existing.id,
            createdById: access.session.user.id,
          });
        }

        if (nextDepositAccount && nextDepositAmount > 0) {
          await recordAirlineDepositMovement(tx, {
            accountKey: nextDepositAccount.key,
            movementType: "DEBIT",
            amount: nextDepositAmount,
            reference: `PNR ${saved.ticketNumber}`,
            description: `Débit automatique billet ${saved.ticketNumber} - ${targetAirline.name}`,
            airlineId: saved.airlineId,
            ticketSaleId: saved.id,
            createdById: access.session.user.id,
            createdAt: saved.soldAt,
          });
        }
      }

      return saved;
    });

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "TICKET_UPDATED",
      entityType: "TICKET_SALE",
      entityId: updated.id,
      summary: `Billet ${updated.ticketNumber} modifié sur ${targetAirline.name} (${updated.amount.toFixed(2)} USD).`,
      payload: {
        ticketNumber: updated.ticketNumber,
        airlineName: targetAirline.name,
        airlineCode: targetAirline.code,
        amount: updated.amount,
      } as Prisma.InputJsonValue,
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/tickets/[id] failed", error);

    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_AIRLINE_DEPOSIT:")) {
      const [, label, available, requested] = error.message.split(":");
      return NextResponse.json(
        {
          error: `${label}: solde insuffisant (${available} USD disponibles pour ${requested} USD demandés). Veuillez d'abord créditer le compte dépôt compagnie.`,
        },
        { status: 400 },
      );
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "Conflit de données: vérifiez les champs uniques." },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: "Erreur serveur lors de la modification du billet." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const access = await requireApiModuleAccess("sales", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  if (!canManageTicketRecord(access.role)) {
    return NextResponse.json(
      { error: "Seul l'administrateur peut supprimer un billet déjà enregistré." },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;
    const existing = await prisma.ticketSale.findUnique({
      where: { id },
      select: {
        id: true,
        sellerId: true,
        amount: true,
        agencyMarkupAmount: true,
        commissionAmount: true,
        commissionModeApplied: true,
        commissionCalculationStatus: true,
        commissionBaseAmount: true,
        baseFareAmount: true,
        ticketNumber: true,
        soldAt: true,
        airlineId: true,
        airline: {
          select: {
            code: true,
            name: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Billet introuvable." }, { status: 404 });
    }

    const depositAccount = getAirlineDepositAccountByAirlineCode(existing.airline.code);

    await prisma.$transaction(async (tx) => {
      if (depositAccount) {
        const depositCreditAmount = getTicketDepositDebitAmount({
          ...existing,
          airline: { code: existing.airline.code },
        });

        if (depositCreditAmount > 0) {
          await recordAirlineDepositMovement(tx, {
            accountKey: depositAccount.key,
            movementType: "CREDIT",
            amount: depositCreditAmount,
            reference: `ANNUL ${existing.ticketNumber}`,
            description: `Restitution après suppression billet ${existing.ticketNumber} - ${existing.airline.name}`,
            airlineId: existing.airlineId,
            ticketSaleId: existing.id,
            createdById: access.session.user.id,
          });
        }
      }

      await tx.ticketSale.delete({ where: { id } });
    });

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "TICKET_DELETED",
      entityType: "TICKET_SALE",
      entityId: existing.id,
      summary: `Billet ${existing.ticketNumber} supprimé et dépôt restitué pour ${existing.airline.name}.`,
      payload: {
        ticketNumber: existing.ticketNumber,
        airlineName: existing.airline.name,
        amount: existing.amount,
      } as Prisma.InputJsonValue,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/tickets/[id] failed", error);
    return NextResponse.json({ error: "Suppression impossible pour ce billet." }, { status: 500 });
  }
}
