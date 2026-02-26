import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ticketSchema } from "@/lib/validators";
import { calculateTicketMetrics } from "@/lib/kpi";
import { requireApiRoles } from "@/lib/rbac";
import { computeCommissionAmount, pickCommissionRule } from "@/lib/commission";
import { CommissionMode } from "@prisma/client";

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

  const body = await request.json();
  const parsed = ticketSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

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

  const commission = computeCommissionAmount(parsed.data.amount, rule);

  const ticket = await prisma.$transaction(async (tx) => {
    if (
      rule.commissionMode === CommissionMode.AFTER_DEPOSIT
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
        commissionRateUsed: commission.ratePercent,
        commissionAmount: commission.amount,
        commissionModeApplied: commission.modeApplied,
      },
    });
  });

  return NextResponse.json({ data: ticket }, { status: 201 });
}
