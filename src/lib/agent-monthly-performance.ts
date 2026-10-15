import { PaymentStatus } from "@prisma/client";
import { monthLabelFromKey, monthRangeFromValue } from "@/lib/month-range";
import { kinshasaDateKey } from "@/lib/kinshasa-time";
import { prisma } from "@/lib/prisma";
import { buildTicketReceivableBalance } from "@/lib/ticket-payment-balance";
import { loadPayerRecoveryTargetUsers, matchPayerToWorkspaceUsers } from "@/lib/ticket-payer-recovery-targets";
import { TICKET_PAYMENT_SELECT } from "@/lib/ticket-recovery-dispatch";
import {
  resolvePerformanceTier,
  type AgentMonthlyPerformance,
} from "@/lib/agent-performance-splash-shared";

export type { AgentMonthlyPerformance, PerformanceTier } from "@/lib/agent-performance-splash-shared";
export { PERFORMANCE_SPLASH_PENDING_KEY, presentationForPerformance } from "@/lib/agent-performance-splash-shared";

function emptyPerformance(monthKey: string): AgentMonthlyPerformance {
  return {
    monthKey,
    monthLabel: monthLabelFromKey(monthKey),
    totalTickets: 0,
    paidCount: 0,
    unpaidCount: 0,
    partialCount: 0,
    openCount: 0,
    tier: "low",
  };
}

function ticketCountsForUser(
  tickets: Array<{
    payerName: string | null;
    id: string;
    ticketNumber: string;
    customerName: string;
    soldAt: Date;
    currency: string;
    amount: number;
    baseFareAmount: number | null;
    commissionAmount: number | null;
    commissionRateUsed: number | null;
    agencyMarkupAmount: number | null;
    commissionBaseAmount: number | null;
    commissionCalculationStatus: string | null;
    commissionModeApplied: string | null;
    payments: Array<{
      amount: number;
      currency: string | null;
      amountUsd: number | null;
      amountCdf: number | null;
      fxRateUsdToCdf: number | null;
    }>;
  }>,
  userId: string,
  workspaceUsers: Awaited<ReturnType<typeof loadPayerRecoveryTargetUsers>>,
) {
  const mine = tickets.filter((ticket) => {
    const payerLabel = ticket.payerName?.trim() ?? "";
    if (!payerLabel) return false;
    return matchPayerToWorkspaceUsers(payerLabel, workspaceUsers).some((user) => user.id === userId);
  });

  let paidCount = 0;
  let unpaidCount = 0;
  let partialCount = 0;

  for (const ticket of mine) {
    const status = buildTicketReceivableBalance(ticket).computedStatus;
    if (status === PaymentStatus.PAID) paidCount += 1;
    else if (status === PaymentStatus.PARTIAL) partialCount += 1;
    else unpaidCount += 1;
  }

  const totalTickets = mine.length;
  return {
    totalTickets,
    paidCount,
    unpaidCount,
    partialCount,
    openCount: unpaidCount + partialCount,
    tier: resolvePerformanceTier(totalTickets),
  };
}

export async function loadAgentMonthlyPayantPerformanceByEmail(email: string): Promise<AgentMonthlyPerformance> {
  const monthKey = kinshasaDateKey().slice(0, 7);
  const normalizedEmail = email.trim().toLowerCase();
  const range = monthRangeFromValue(monthKey);

  const [dbUser, workspaceUsers, tickets] = await Promise.all([
    prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    }),
    loadPayerRecoveryTargetUsers(),
    prisma.ticketSale.findMany({
      where: { soldAt: { gte: range.start, lt: range.end } },
      select: {
        id: true,
        ticketNumber: true,
        customerName: true,
        soldAt: true,
        payerName: true,
        currency: true,
        amount: true,
        baseFareAmount: true,
        commissionAmount: true,
        commissionRateUsed: true,
        agencyMarkupAmount: true,
        commissionBaseAmount: true,
        commissionCalculationStatus: true,
        commissionModeApplied: true,
        payments: { select: TICKET_PAYMENT_SELECT },
      },
    }),
  ]);

  if (!dbUser) {
    return emptyPerformance(monthKey);
  }

  const counts = ticketCountsForUser(tickets, dbUser.id, workspaceUsers);

  return {
    monthKey: range.monthRaw,
    monthLabel: monthLabelFromKey(range.monthRaw),
    ...counts,
  };
}
