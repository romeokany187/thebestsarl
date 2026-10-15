import { PaymentStatus } from "@prisma/client";
import { monthLabelFromKey, monthRangeFromValue } from "@/lib/month-range";
import { kinshasaDateKey } from "@/lib/kinshasa-time";
import { prisma } from "@/lib/prisma";
import { buildTicketReceivableBalance } from "@/lib/ticket-payment-balance";
import { ticketPayerMatchesUser } from "@/lib/ticket-payer-user-match";
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

export async function loadAgentMonthlyPayantPerformance(user: {
  name: string;
  email: string;
  teamName?: string | null;
}): Promise<AgentMonthlyPerformance> {
  const monthKey = kinshasaDateKey().slice(0, 7);
  const range = monthRangeFromValue(monthKey);
  const profile = {
    name: user.name.trim(),
    email: user.email.trim().toLowerCase(),
    teamName: user.teamName ?? null,
  };

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

  const mine = tickets.filter((ticket) => ticketPayerMatchesUser(ticket.payerName, profile));

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

export async function loadAgentMonthlyPayantPerformanceByEmail(email: string): Promise<AgentMonthlyPerformance> {
  const monthKey = kinshasaDateKey().slice(0, 7);
  const normalizedEmail = email.trim().toLowerCase();
  const dbUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      name: true,
      email: true,
      team: { select: { name: true } },
    },
  });

  if (!dbUser) {
    return emptyPerformance(monthKey);
  }

  return loadAgentMonthlyPayantPerformance({
    name: dbUser.name,
    email: dbUser.email,
    teamName: dbUser.team?.name ?? null,
  });
}
