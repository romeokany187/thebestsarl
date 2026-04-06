import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ticketSchema } from "@/lib/validators";
import { calculateTicketMetrics } from "@/lib/kpi";
import { requireApiModuleAccess } from "@/lib/rbac";
import { computeCommissionAmount, pickCommissionRule } from "@/lib/commission";
import { recordAirlineDepositMovement, getAirlineDepositAccountByAirlineCode } from "@/lib/airline-deposit";
import { CommissionCalculationStatus, CommissionMode } from "@prisma/client";
import { ensureAirlineCatalog } from "@/lib/airline-catalog";
import { Prisma } from "@prisma/client";
import { invoiceNumberFromChronology } from "@/lib/invoice";
import { canSellTickets } from "@/lib/assignment";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function GET() {
  const access = await requireApiModuleAccess("tickets", ["DIRECTEUR_GENERAL"]);
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
  const access = await requireApiModuleAccess("sales", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  if (!canSellTickets(access.session.user.jobTitle ?? "")) {
    return NextResponse.json(
      { error: "Le billetage est en lecture seule pour ce profil. Seul le caissier peut enregistrer un billet." },
      { status: 403 },
    );
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
    const depositAccount = getAirlineDepositAccountByAirlineCode(airline.code);

    const isAirCongo = airline.code === "ACG";
    const isMontGabaon = airline.code === "MGB";
    const isAirFast = airline.code === "FST";

    if ((isAirCongo || isMontGabaon) && !parsed.data.baseFareAmount) {
      return NextResponse.json(
        { error: "Pour Air Congo et Mont Gabaon, le BaseFare est obligatoire pour calculer la commission." },
        { status: 400 },
      );
    }

    const isAfterDepositMode = rule?.commissionMode === CommissionMode.AFTER_DEPOSIT;
    const todayRaw = new Date().toISOString().slice(0, 10);
    const enforcedTravelDate = new Date(`${todayRaw}T00:00:00.000Z`);
    const consumedBeforeForAfterDeposit = isAfterDepositMode
      ? (
        await prisma.ticketSale.aggregate({
          where: { airlineId: parsed.data.airlineId },
          _sum: { amount: true },
        })
      )._sum.amount ?? 0
      : 0;
    const requestedAgencyMarkupAmount = parsed.data.agencyMarkupAmount ?? 0;
    let commissionBaseAmount = parsed.data.baseFareAmount ?? 0;
    let commissionCalculationStatus: CommissionCalculationStatus = CommissionCalculationStatus.FINAL;
    let baseFareAmount = parsed.data.baseFareAmount;

    if (!isAfterDepositMode) {
      if (baseFareAmount && baseFareAmount > 0) {
        commissionBaseAmount = baseFareAmount;
        commissionCalculationStatus = CommissionCalculationStatus.FINAL;
      } else {
        baseFareAmount = undefined;
        commissionBaseAmount = 0;
        commissionCalculationStatus = CommissionCalculationStatus.FINAL;
      }
    } else {
      commissionBaseAmount = parsed.data.amount;
      commissionCalculationStatus = CommissionCalculationStatus.FINAL;
    }

    const commissionInputAmount = isAfterDepositMode ? parsed.data.amount : commissionBaseAmount;
    const agencyMarkupAmount = requestedAgencyMarkupAmount;
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
      : isAirFast
          ? {
            ratePercent: nextAirFastSaleNumber % 13 === 0 ? 100 : 0,
            amount: nextAirFastSaleNumber % 13 === 0 ? parsed.data.amount : 0,
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

    const commission = (isAfterDepositMode || isAirCongo || isMontGabaon || isAirFast)
      ? baseCommission
      : {
        ...baseCommission,
        amount: baseCommission.amount + agencyMarkupAmount,
        ratePercent: commissionBaseAmount > 0
          ? ((baseCommission.amount + agencyMarkupAmount) / commissionBaseAmount) * 100
          : 0,
      };

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.ticketSale.create({
        data: {
          ...parsed.data,
          travelDate: enforcedTravelDate,
          currency: "USD",
          baseFareAmount,
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
            depositStockConsumedAmount: consumedBeforeForAfterDeposit + parsed.data.amount,
          },
        });
      }

      if (depositAccount) {
        await recordAirlineDepositMovement(tx, {
          accountKey: depositAccount.key,
          movementType: "DEBIT",
          amount: created.amount,
          reference: `PNR ${created.ticketNumber}`,
          description: `Débit automatique billet ${created.ticketNumber} - ${airline.name}`,
          airlineId: airline.id,
          ticketSaleId: created.id,
          createdById: access.session.user.id,
          createdAt: created.soldAt,
        });
      }

      return created;
    });

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
    const invoiceNumber = invoiceNumberFromChronology({
      soldAt: ticket.soldAt,
      sellerTeamName: access.session.user.teamName ?? null,
      sequence,
    });

    return NextResponse.json({
      data: ticket,
      invoice: {
        number: invoiceNumber,
        pdfUrl: `/api/invoices/${ticket.id}/pdf`,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/tickets failed", error);

    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_AIRLINE_DEPOSIT:")) {
      const [, label, available, requested] = error.message.split(":");
      return NextResponse.json(
        {
          error: `${label}: solde insuffisant (${available} USD disponibles pour ${requested} USD demandés). Veuillez d'abord créditer le compte dépôt compagnie.`,
        },
        { status: 400 },
      );
    }

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
