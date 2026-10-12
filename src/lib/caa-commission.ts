import type { PrismaClient } from "@prisma/client";
import { getTicketCommissionAmount, isCaaTicketExcludedFromAutomaticCommission } from "@/lib/ticket-pricing";

export type CaaTicketInput = {
  id: string;
  amount: number;
  soldAt: Date;
};

export type CaaCommissionTicket = {
  id: string;
  airline?: { code?: string | null } | null;
  amount: number;
  soldAt?: Date;
  commissionAmount?: number | null;
  commissionRateUsed?: number | null;
  agencyMarkupAmount?: number | null;
  commissionModeApplied?: string | null;
  commissionCalculationStatus?: string | null;
  baseFareAmount?: number | null;
  commissionBaseAmount?: number | null;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeCaaCommissionMap(params: {
  periodTicketIds: string[];
  orderedCaaTicketsUntilPeriodEnd: CaaTicketInput[];
  targetAmount: number;
  batchCommissionAmount: number;
}) {
  const map = new Map<string, number>();
  const periodIds = new Set(params.periodTicketIds);

  if (params.targetAmount <= 0 || params.batchCommissionAmount <= 0 || periodIds.size === 0) {
    return map;
  }

  let consumed = 0;
  const ordered = [...params.orderedCaaTicketsUntilPeriodEnd].sort((a, b) => {
    const soldAtDiff = a.soldAt.getTime() - b.soldAt.getTime();
    if (soldAtDiff !== 0) return soldAtDiff;
    return a.id.localeCompare(b.id);
  });

  for (const ticket of ordered) {
    const before = consumed;
    consumed += ticket.amount;

    if (!periodIds.has(ticket.id)) {
      continue;
    }

    const batchesBefore = Math.floor(before / params.targetAmount);
    const batchesAfter = Math.floor(consumed / params.targetAmount);
    const newBatches = Math.max(0, batchesAfter - batchesBefore);
    map.set(ticket.id, round2(newBatches * params.batchCommissionAmount));
  }

  return map;
}

/** @deprecated Les totaux passent par getTicketCommissionAmount (CAA = 0). */
export function resolveTicketCommissionAmount(
  ticket: CaaCommissionTicket,
  _caaCommissionMap?: Map<string, number>,
) {
  if (isCaaTicketExcludedFromAutomaticCommission(ticket)) {
    return 0;
  }
  return getTicketCommissionAmount(ticket);
}

/** Recalcule les commissions CAA depuis l'historique chronologique (lots dépôt). */
export async function loadCaaCommissionMap(
  prisma: PrismaClient,
  params: {
    periodTicketIds: string[];
    periodEndExclusive: Date;
  },
) {
  const caaAirline = await prisma.airline.findFirst({
    where: { code: "CAA" },
    select: {
      id: true,
      commissionRules: {
        where: { isActive: true, commissionMode: "AFTER_DEPOSIT" },
        select: {
          depositStockTargetAmount: true,
          batchCommissionAmount: true,
          startsAt: true,
        },
      },
    },
  });

  if (!caaAirline) {
    return new Map<string, number>();
  }

  const rule = [...caaAirline.commissionRules].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  const targetAmount = rule?.depositStockTargetAmount ?? 0;
  const batchCommissionAmount = rule?.batchCommissionAmount ?? 0;

  if (targetAmount <= 0 || batchCommissionAmount <= 0) {
    return new Map<string, number>();
  }

  const orderedCaaTicketsUntilPeriodEnd = await prisma.ticketSale.findMany({
    where: {
      airlineId: caaAirline.id,
      soldAt: { lt: params.periodEndExclusive },
    },
    select: { id: true, soldAt: true, amount: true },
    orderBy: [{ soldAt: "asc" }, { id: "asc" }],
  });

  return computeCaaCommissionMap({
    periodTicketIds: params.periodTicketIds,
    orderedCaaTicketsUntilPeriodEnd,
    targetAmount,
    batchCommissionAmount,
  });
}

/** Aligne les montants en base sur le calcul chronologique (après import ou correction). */
export async function syncCaaStoredTicketCommissions(prisma: PrismaClient) {
  const caaAirline = await prisma.airline.findFirst({
    where: { code: "CAA" },
    include: {
      commissionRules: {
        where: { isActive: true, commissionMode: "AFTER_DEPOSIT" },
      },
    },
  });

  if (!caaAirline) {
    return { updated: 0 };
  }

  const rule = [...caaAirline.commissionRules].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  const targetAmount = rule?.depositStockTargetAmount ?? 0;
  const batchCommissionAmount = rule?.batchCommissionAmount ?? 0;

  if (!rule || targetAmount <= 0 || batchCommissionAmount <= 0) {
    return { updated: 0 };
  }

  const ordered = await prisma.ticketSale.findMany({
    where: { airlineId: caaAirline.id },
    select: {
      id: true,
      soldAt: true,
      amount: true,
      agencyMarkupAmount: true,
      commissionAmount: true,
    },
    orderBy: [{ soldAt: "asc" }, { id: "asc" }],
  });

  if (ordered.length === 0) {
    return { updated: 0 };
  }

  const batchByTicketId = computeCaaCommissionMap({
    periodTicketIds: ordered.map((ticket) => ticket.id),
    orderedCaaTicketsUntilPeriodEnd: ordered,
    targetAmount,
    batchCommissionAmount,
  });

  const consumedTotal = round2(ordered.reduce((sum, ticket) => sum + ticket.amount, 0));
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    for (const ticket of ordered) {
      const batchPart = batchByTicketId.get(ticket.id) ?? 0;
      const markup = ticket.agencyMarkupAmount ?? 0;
      const nextCommissionAmount = round2(batchPart + markup);
      const nextRate = ticket.amount > 0 ? round2((batchPart / ticket.amount) * 100) : 0;

      if (Math.abs((ticket.commissionAmount ?? 0) - nextCommissionAmount) > 0.009) {
        await tx.ticketSale.update({
          where: { id: ticket.id },
          data: {
            commissionAmount: nextCommissionAmount,
            commissionRateUsed: nextRate,
            commissionModeApplied: "AFTER_DEPOSIT",
          },
        });
        updated += 1;
      }
    }

    await tx.commissionRule.update({
      where: { id: rule.id },
      data: { depositStockConsumedAmount: consumedTotal },
    });
  });

  return { updated };
}
