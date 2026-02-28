import { NextRequest, NextResponse } from "next/server";
import { CommissionCalculationStatus, CommissionMode, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { ticketUpdateSchema } from "@/lib/validators";
import { computeCommissionAmount, pickCommissionRule } from "@/lib/commission";
import { ensureAirlineCatalog } from "@/lib/airline-catalog";
import { canSellTickets } from "@/lib/assignment";

type Params = { params: Promise<{ id: string }> };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const access = await requireApiRoles(["ADMIN", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  if (access.role === "EMPLOYEE" && !canSellTickets(access.session.user.jobTitle ?? "")) {
    return NextResponse.json({ error: "Fonction non autorisée pour modifier des billets." }, { status: 403 });
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

    if (access.role === "EMPLOYEE" && existing.sellerId !== access.session.user.id) {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }

    const nextAirlineId = parsed.data.airlineId ?? existing.airlineId;
    const nextSellerId = parsed.data.sellerId ?? existing.sellerId;

    if (access.role === "EMPLOYEE" && nextSellerId !== access.session.user.id) {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }

    const targetAirline = await prisma.airline.findUnique({
      where: { id: nextAirlineId },
      include: { commissionRules: { where: { isActive: true } } },
    });

    if (!targetAirline) {
      return NextResponse.json({ error: "Compagnie introuvable." }, { status: 400 });
    }

    const nextTicket = {
      ...existing,
      ...parsed.data,
      airlineId: nextAirlineId,
      sellerId: nextSellerId,
      amount: parsed.data.amount ?? existing.amount,
      route: parsed.data.route ?? existing.route,
      travelClass: parsed.data.travelClass ?? existing.travelClass,
      baseFareAmount: parsed.data.baseFareAmount ?? existing.baseFareAmount,
      agencyMarkupAmount: parsed.data.agencyMarkupAmount ?? existing.agencyMarkupAmount,
    };

    const rule = pickCommissionRule(
      targetAirline.commissionRules,
      nextTicket.route,
      nextTicket.travelClass,
    );

    if (!rule) {
      return NextResponse.json({
        error: "Aucune règle de commission active trouvée pour cette compagnie, itinéraire et classe.",
      }, { status: 400 });
    }

    const isAirCongo = targetAirline.code === "ACG";
    const isMontGabaon = targetAirline.code === "MGB";
    const isEthiopian = targetAirline.code === "ET";
    const isAirFast = targetAirline.code === "FST";
    const isAfterDepositMode = rule.commissionMode === CommissionMode.AFTER_DEPOSIT;

    if ((isAirCongo || isMontGabaon || isEthiopian) && !nextTicket.baseFareAmount) {
      return NextResponse.json(
        { error: "Pour Air Congo, Mont Gabaon et Ethiopian, le BaseFare est obligatoire pour calculer la commission." },
        { status: 400 },
      );
    }

    let commissionBaseAmount = nextTicket.baseFareAmount ?? 0;
    let commissionCalculationStatus: CommissionCalculationStatus = CommissionCalculationStatus.FINAL;

    if (!isAfterDepositMode && !nextTicket.baseFareAmount) {
      const airlineHistory = await prisma.ticketSale.findMany({
        where: {
          airlineId: nextAirlineId,
          baseFareAmount: { not: null },
          amount: { gt: 0 },
          commissionCalculationStatus: CommissionCalculationStatus.FINAL,
          id: { not: existing.id },
        },
        select: { amount: true, baseFareAmount: true },
        orderBy: { soldAt: "desc" },
        take: 80,
      });

      const ratio = airlineHistory.length > 0
        ? clamp(
          airlineHistory.reduce((acc, ticket) => {
            const baseFare = ticket.baseFareAmount ?? 0;
            return acc + (ticket.amount > 0 ? baseFare / ticket.amount : 0);
          }, 0) / airlineHistory.length,
          0.2,
          0.95,
        )
        : clamp(rule.defaultBaseFareRatio ?? 0.6, 0.2, 0.95);

      commissionBaseAmount = nextTicket.amount * ratio;
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
      : isEthiopian
        ? {
          ratePercent: commissionBaseAmount > 0
            ? ((commissionBaseAmount * 0.05 + nextTicket.agencyMarkupAmount) / commissionBaseAmount) * 100
            : 0,
          amount: commissionBaseAmount * 0.05 + nextTicket.agencyMarkupAmount,
          modeApplied: CommissionMode.SYSTEM_PLUS_MARKUP,
        }
        : isAirFast
          ? {
            ratePercent: airFastSaleOrder % 13 === 0 ? 100 : 0,
            amount: airFastSaleOrder % 13 === 0 ? nextTicket.amount : 0,
            modeApplied: CommissionMode.IMMEDIATE,
          }
        : computeCommissionAmount(commissionInputAmount, rule, 0);

    const commission = (isAfterDepositMode || isAirCongo || isMontGabaon || isEthiopian || isAirFast)
      ? baseCommission
      : {
        ...baseCommission,
        amount: baseCommission.amount + nextTicket.agencyMarkupAmount,
        ratePercent: commissionBaseAmount > 0
          ? ((baseCommission.amount + nextTicket.agencyMarkupAmount) / commissionBaseAmount) * 100
          : 0,
      };

    const updated = await prisma.ticketSale.update({
      where: { id },
      data: {
        ...parsed.data,
        currency: "USD",
        airlineId: nextTicket.airlineId,
        sellerId: nextTicket.sellerId,
        commissionBaseAmount,
        commissionCalculationStatus,
        commissionRateUsed: commission.ratePercent,
        commissionAmount: commission.amount,
        commissionModeApplied: commission.modeApplied,
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/tickets/[id] failed", error);

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
  const access = await requireApiRoles(["ADMIN", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  if (access.role === "EMPLOYEE" && !canSellTickets(access.session.user.jobTitle ?? "")) {
    return NextResponse.json({ error: "Fonction non autorisée pour supprimer des billets." }, { status: 403 });
  }

  try {
    const { id } = await params;
    const existing = await prisma.ticketSale.findUnique({
      where: { id },
      select: { id: true, sellerId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Billet introuvable." }, { status: 404 });
    }

    if (access.role === "EMPLOYEE" && existing.sellerId !== access.session.user.id) {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }

    await prisma.ticketSale.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/tickets/[id] failed", error);
    return NextResponse.json({ error: "Suppression impossible pour ce billet." }, { status: 500 });
  }
}
