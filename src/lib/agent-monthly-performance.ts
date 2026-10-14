import { PaymentStatus } from "@prisma/client";
import { monthLabelFromKey, monthRangeFromValue } from "@/lib/month-range";
import { prisma } from "@/lib/prisma";
import { buildTicketReceivableBalance } from "@/lib/ticket-payment-balance";
import { payerRecoveryKey } from "@/lib/ticket-recovery";
import { TICKET_PAYMENT_SELECT } from "@/lib/ticket-recovery-dispatch";
import {
  resolvePerformanceTier,
  type AgentMonthlyPerformance,
} from "@/lib/agent-performance-splash-shared";

export type { AgentMonthlyPerformance, PerformanceTier } from "@/lib/agent-performance-splash-shared";
export {
  PERFORMANCE_SPLASH_PENDING_KEY,
  presentationForPerformance,
  shouldShowPerformanceSplashForRole,
} from "@/lib/agent-performance-splash-shared";

function userMatchesPayer(
  payerName: string | null | undefined,
  user: { name: string; email: string },
) {
  const payerKey = payerRecoveryKey(payerName);
  if (payerKey === "__missing_payer__") return false;
  const nameKey = payerRecoveryKey(user.name);
  const emailKey = user.email.trim().toLowerCase();
  return payerKey === nameKey || payerKey === emailKey;
}

export async function loadAgentMonthlyPayantPerformance(user: {
  name: string;
  email: string;
}): Promise<AgentMonthlyPerformance> {
  const range = monthRangeFromValue();
  const tickets = await prisma.ticketSale.findMany({
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
  });

  const mine = tickets.filter((ticket) => userMatchesPayer(ticket.payerName, user));

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
  const openCount = unpaidCount + partialCount;

  return {
    monthKey: range.monthRaw,
    monthLabel: monthLabelFromKey(range.monthRaw),
    totalTickets,
    paidCount,
    unpaidCount,
    partialCount,
    openCount,
    tier: resolvePerformanceTier(totalTickets),
  };
}
