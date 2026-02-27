import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ticketSchema } from "@/lib/validators";
import { calculateTicketMetrics } from "@/lib/kpi";
import { requireApiRoles } from "@/lib/rbac";
import { computeCommissionAmount, pickCommissionRule } from "@/lib/commission";
import { CommissionCalculationStatus, CommissionMode } from "@prisma/client";
import { ensureAirlineCatalog } from "@/lib/airline-catalog";
import { Prisma } from "@prisma/client";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function GET() {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const tickets = await prisma.ticketSale.findMany({
    include: {
      airline: true,
      seller: {
        select: { id: true, name: true, email: true },
      },
      payments: true,
    },
    orderBy: { soldAt: "desc" },
    take: 200,
  });

  const metrics = calculateTicketMetrics(tickets);

  return NextResponse.json({ data: tickets, metrics });
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  try {
    const body = await request.json();
    const parsed = ticketSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    await ensureAirlineCatalog(prisma);

    const airline = await prisma.airline.findUnique({
      where: { id: parsed.data.airlineId },
      include: { commissionRules: { where: { isActive: true } } },
    });

    if (!airline) {
      return NextResponse.json({ error: "Compagnie introuvable." }, { status: 400 });
    }

    const rule = pickCommissionRule(airline.commissionRules, parsed.data.route, parsed.data.travelClass);

    if (!rule) {
      return NextResponse.json({
        error: "Aucune règle de commission active trouvée pour cette compagnie, itinéraire et classe.",
      }, { status: 400 });
    }

    const isAirCongo = airline.code === "ACG";
    const isMontGabaon = airline.code === "MGB";
    const isEthiopian = airline.code === "ET";
    const isAirFast = airline.code === "FST";

    if ((isAirCongo || isMontGabaon || isEthiopian) && !parsed.data.baseFareAmount) {
      return NextResponse.json(
        { error: "Pour Air Congo, Mont Gabaon et Ethiopian, le BaseFare est obligatoire pour calculer la commission." },
        { status: 400 },
      );
    }

    const isAfterDepositMode = rule.commissionMode === CommissionMode.AFTER_DEPOSIT;
    const agencyMarkupAmount = parsed.data.agencyMarkupAmount ?? 0;
    let commissionBaseAmount = parsed.data.baseFareAmount ?? 0;
    let commissionCalculationStatus: CommissionCalculationStatus = CommissionCalculationStatus.FINAL;
    let baseFareAmount = parsed.data.baseFareAmount;

    if (!isAfterDepositMode) {
      if (!baseFareAmount) {
        const routeHistory = await prisma.ticketSale.findMany({
          where: {
            airlineId: parsed.data.airlineId,
            route: parsed.data.route,
            baseFareAmount: { not: null },
            amount: { gt: 0 },
            commissionCalculationStatus: CommissionCalculationStatus.FINAL,
          },
          select: { amount: true, baseFareAmount: true },
          orderBy: { soldAt: "desc" },
          take: 60,
        });

        const airlineHistory = routeHistory.length > 0
          ? routeHistory
          : await prisma.ticketSale.findMany({
            where: {
              airlineId: parsed.data.airlineId,
              baseFareAmount: { not: null },
              amount: { gt: 0 },
              commissionCalculationStatus: CommissionCalculationStatus.FINAL,
            },
            select: { amount: true, baseFareAmount: true },
            orderBy: { soldAt: "desc" },
            take: 100,
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

        commissionBaseAmount = parsed.data.amount * ratio;
        baseFareAmount = commissionBaseAmount;
        commissionCalculationStatus = CommissionCalculationStatus.ESTIMATED;
      } else {
        commissionBaseAmount = baseFareAmount;
        commissionCalculationStatus = CommissionCalculationStatus.FINAL;
      }
    } else {
      commissionBaseAmount = parsed.data.amount;
      commissionCalculationStatus = CommissionCalculationStatus.FINAL;
    }

    const commissionInputAmount = isAfterDepositMode ? parsed.data.amount : commissionBaseAmount;
    const nextAirFastSaleNumber = isAirFast
      ? (await prisma.ticketSale.count({ where: { airlineId: parsed.data.airlineId } })) + 1
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
            ? ((commissionBaseAmount * 0.05 + agencyMarkupAmount) / commissionBaseAmount) * 100
            : 0,
          amount: commissionBaseAmount * 0.05 + agencyMarkupAmount,
          modeApplied: CommissionMode.SYSTEM_PLUS_MARKUP,
        }
        : isAirFast
          ? {
            ratePercent: nextAirFastSaleNumber % 13 === 0 ? 100 : 0,
            amount: nextAirFastSaleNumber % 13 === 0 ? parsed.data.amount : 0,
            modeApplied: CommissionMode.IMMEDIATE,
          }
        : computeCommissionAmount(commissionInputAmount, rule, 0);

    const commission = (isAfterDepositMode || isAirCongo || isMontGabaon || isEthiopian || isAirFast)
      ? baseCommission
      : {
        ...baseCommission,
        amount: baseCommission.amount + agencyMarkupAmount,
        ratePercent: commissionBaseAmount > 0
          ? ((baseCommission.amount + agencyMarkupAmount) / commissionBaseAmount) * 100
          : 0,
      };

    const ticket = await prisma.$transaction(async (tx) => {
      if (
        isAfterDepositMode
        && rule.depositStockTargetAmount !== null
        && rule.depositStockTargetAmount !== undefined
      ) {
        await tx.commissionRule.update({
          where: { id: rule.id },
          data: {
            depositStockConsumedAmount: {
              increment: parsed.data.amount,
            },
          },
        });
      }

      return tx.ticketSale.create({
        data: {
          ...parsed.data,
          currency: "USD",
          baseFareAmount,
          agencyMarkupAmount,
          commissionBaseAmount,
          commissionCalculationStatus,
          commissionRateUsed: commission.ratePercent,
          commissionAmount: commission.amount,
          commissionModeApplied: commission.modeApplied,
        },
      });
    });

    return NextResponse.json({ data: ticket }, { status: 201 });
  } catch (error) {
    console.error("POST /api/tickets failed", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "Ce code billet (PNR) existe déjà. Utilisez un autre PNR." },
          { status: 400 },
        );
      }

      if (error.code === "P2022") {
        return NextResponse.json(
          { error: "Base de données non synchronisée. Veuillez relancer le déploiement (Prisma db push)." },
          { status: 500 },
        );
      }
    }

    return NextResponse.json(
      { error: "Erreur serveur lors de l'enregistrement du billet." },
      { status: 500 },
    );
  }
}
