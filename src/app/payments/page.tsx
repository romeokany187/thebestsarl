import { PaymentStatus } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { CashBilletageWorkspace } from "@/components/cash-billetage-workspace";
import { CashOperationForm } from "@/components/cash-operation-form";
import { CashOperationRowActions } from "@/components/cash-operation-row-actions";
import { KpiCard } from "@/components/kpi-card";
import { PaymentEntryForm } from "@/components/payment-entry-form";
import { PaymentOrderCashExecutionActions } from "@/components/payment-order-cash-execution-actions";
import { PaymentRowAdminActions } from "@/components/payment-row-admin-actions";
import { ProxyBankingForm } from "@/components/proxy-banking-form";
import { ProxyBankingDeleteButton } from "@/components/proxy-banking-delete-button";
import { ProxyBankingEditButton } from "@/components/proxy-banking-edit-button";
import { PaymentsWritingWorkspace } from "@/components/payments-writing-workspace";
import { ProcurementCashExecutionActions } from "@/components/procurement-cash-execution-actions";
import { invoiceNumberFromChronology } from "@/lib/invoice";
import { isCashierJobTitle } from "@/lib/assignment";
import { requirePageModuleAccess } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getTicketTotalAmount } from "@/lib/ticket-pricing";

type AirlineRow = { id: string; code: string; name: string };
type TicketPaymentRow = {
  id: string;
  paidAt: Date;
  amount: number;
  currency?: string | null;
  amountUsd?: number | null;
  amountCdf?: number | null;
  fxRateToUsd?: number | null;
  fxRateUsdToCdf?: number | null;
  method?: string | null;
  reference?: string | null;
  ticket: {
    ticketNumber: string;
    customerName: string;
    amount: number;
    paymentStatus: string;
    currency?: string | null;
  };
};

type CashOperationRow = {
  id: string;
  occurredAt: Date;
  description: string;
  reference?: string | null;
  amount: number;
  direction: string;
  category?: string | null;
  method?: string | null;
  currency?: string | null;
  amountUsd?: number | null;
  fxRateToUsd?: number | null;
  fxRateUsdToCdf?: number | null;
};

type TicketSaleRow = {
  id: string;
  soldAt: Date;
  airlineId: string;
  ticketNumber: string;
  customerName: string;
  amount: number;
  commissionAmount?: number | null;
  commissionRateUsed?: number | null;
  agencyMarkupAmount?: number | null;
  currency?: string | null;
  paymentStatus: PaymentStatus;
  seller?: { team?: { name?: string | null } | null } | null;
  payments: Array<{
    amount: number;
    currency?: string | null;
    amountUsd?: number | null;
    amountCdf?: number | null;
    fxRateToUsd?: number | null;
    fxRateUsdToCdf?: number | null;
  }>;
};

type PaymentClient = { findMany(args: unknown): Promise<TicketPaymentRow[]> };
type CashOperationClient = { findMany(args: unknown): Promise<CashOperationRow[]> };
type PaymentOrderOverviewClient = { findMany(args: unknown): Promise<any[]> };

const paymentClient = (prisma as unknown as { payment: PaymentClient }).payment;
const cashOperationClient = (prisma as unknown as { cashOperation: CashOperationClient }).cashOperation;
const paymentOrderClient = (prisma as unknown as { paymentOrder: PaymentOrderOverviewClient }).paymentOrder;

type SearchParams = {
  startDate?: string;
  endDate?: string;
  airlineId?: string;
  cashMonth?: string;
};

function dateRangeFromParams(params: SearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startRaw = params.startDate ?? defaultDay;
  const endRaw = params.endDate ?? startRaw;

  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    start,
    end,
    startRaw,
    endRaw,
    label: `Du ${startRaw} au ${endRaw}`,
  };
}

function monthRangeFromValue(rawMonth?: string) {
  const fallbackMonth = new Date().toISOString().slice(0, 7);
  const monthRaw = rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : fallbackMonth;
  const [yearPart, monthPart] = monthRaw.split("-");
  const year = Number.parseInt(yearPart, 10);
  const monthIndex = Math.max(0, Math.min(11, Number.parseInt(monthPart, 10) - 1));
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));

  return {
    start,
    end,
    monthRaw,
    startRaw: start.toISOString().slice(0, 10),
    endRaw: new Date(end.getTime() - 1).toISOString().slice(0, 10),
    label: `Journal de caisse du ${start.toISOString().slice(0, 10)} au ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`,
  };
}

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  return normalized === "CDF" || normalized === "XAF" || normalized === "FC" ? "CDF" : "USD";
}

function normalizeCashAmountUsd(operation: {
  amount: number;
  currency?: string | null;
  amountUsd?: number | null;
  fxRateToUsd?: number | null;
  fxRateUsdToCdf?: number | null;
}): number {
  if (typeof operation.amountUsd === "number") {
    return operation.amountUsd;
  }
  const currency = normalizeMoneyCurrency(operation.currency);
  if (currency === "USD") {
    return operation.amount;
  }
  const rate = operation.fxRateUsdToCdf ?? (operation.fxRateToUsd && operation.fxRateToUsd > 0 ? 1 / operation.fxRateToUsd : 2800);
  return operation.amount / rate;
}

function normalizeCashAmountCdf(operation: {
  amount: number;
  currency?: string | null;
  amountCdf?: number | null;
  fxRateToUsd?: number | null;
  fxRateUsdToCdf?: number | null;
}): number {
  if (typeof operation.amountCdf === "number") {
    return operation.amountCdf;
  }
  const currency = normalizeMoneyCurrency(operation.currency);
  if (currency === "CDF") {
    return operation.amount;
  }
  const rate = operation.fxRateUsdToCdf ?? (operation.fxRateToUsd && operation.fxRateToUsd > 0 ? 1 / operation.fxRateToUsd : 2800);
  return operation.amount * rate;
}

function normalizePaymentAmountForTicket(payment: {
  amount: number;
  currency?: string | null;
  amountUsd?: number | null;
  amountCdf?: number | null;
  fxRateToUsd?: number | null;
  fxRateUsdToCdf?: number | null;
}, ticketCurrencyRaw: string | null | undefined): number {
  const ticketCurrency = normalizeMoneyCurrency(ticketCurrencyRaw);
  const paymentCurrency = normalizeMoneyCurrency(payment.currency ?? ticketCurrencyRaw);
  if (paymentCurrency === ticketCurrency) {
    return payment.amount;
  }
  return ticketCurrency === "USD" ? normalizeCashAmountUsd(payment) : normalizeCashAmountCdf(payment);
}

type VirtualChannel = "AIRTEL_MONEY" | "ORANGE_MONEY" | "MPESA" | "EQUITY" | "RAWBANK_ILLICOCASH";

const virtualChannels: Array<{ key: VirtualChannel; label: string }> = [
  { key: "AIRTEL_MONEY", label: "Airtel Money" },
  { key: "ORANGE_MONEY", label: "Orange Money" },
  { key: "MPESA", label: "M-Pesa" },
  { key: "EQUITY", label: "Equity" },
  { key: "RAWBANK_ILLICOCASH", label: "Rawbank & Illicocash" },
];

function detectVirtualChannel(methodRaw: string | null | undefined): VirtualChannel | null {
  const method = (methodRaw ?? "").trim().toUpperCase();
  if (!method) return null;
  if (method.includes("AIRTEL")) return "AIRTEL_MONEY";
  if (method.includes("ORANGE")) return "ORANGE_MONEY";
  if (method.includes("M-PESA") || method.includes("MPESA") || method.includes("M PESA")) return "MPESA";
  if (method.includes("EQUITY")) return "EQUITY";
  if (
    method.includes("RAWBANK")
    || method.includes("ROWBANK")
    || method.includes("ROW BANK")
    || method.includes("ILLICOCASH")
    || method.includes("ILLICO CASH")
    || method.includes("ILLICO")
  ) return "RAWBANK_ILLICOCASH";
  return null;
}

function isProxyBankingOperation(operation: { description?: string | null }) {
  return (operation.description ?? "").startsWith("PROXY_BANKING:");
}

function proxyChannelLabel(channel: string) {
  if (channel === "AIRTEL_MONEY") return "Airtel Money";
  if (channel === "ORANGE_MONEY") return "Orange Money";
  if (channel === "MPESA") return "M-Pesa";
  if (channel === "EQUITY") return "Equity";
  if (channel === "RAWBANK_ILLICOCASH") return "Rawbank & Illicocash";
  return "Cash";
}

function proxyOperationLabel(descriptionRaw: string | null | undefined) {
  const description = descriptionRaw ?? "";
  if (description.includes(":DEPOSIT:")) return "Dépôt client";
  if (description.includes(":WITHDRAWAL:")) return "Retrait client";
  if (description.includes(":EXCHANGE:")) return "Change client";
  if (description.includes(":OTHER:")) return "Autre opération cash";
  if (description.includes(":OPENING_BALANCE:")) return "Solde initial";
  return "Opération proxy";
}

type BalanceBucket = "CASH" | VirtualChannel;
type BalanceSnapshot = {
  usd: number;
  cdf: number;
  initializedUsd: boolean;
  initializedCdf: boolean;
};

function buildEmptyOpeningBuckets(): Record<BalanceBucket, BalanceSnapshot> {
  return {
    CASH: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
    AIRTEL_MONEY: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
    ORANGE_MONEY: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
    MPESA: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
    EQUITY: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
    RAWBANK_ILLICOCASH: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
  };
}

function bucketFromMethod(methodRaw: string | null | undefined): BalanceBucket {
  return detectVirtualChannel(methodRaw) ?? "CASH";
}

function computeOpeningBuckets(
  ticketPayments: Array<{ amount: number; currency?: string | null; method?: string | null; paidAt?: Date | string | null }>,
  cashOperations: Array<{ amount: number; currency?: string | null; method?: string | null; direction: string; category?: string | null; occurredAt?: Date | string | null }>,
): Record<BalanceBucket, BalanceSnapshot> {
  const buckets = buildEmptyOpeningBuckets();
  const openingApplied = new Map<BalanceBucket, { usd: boolean; cdf: boolean }>();
  const events = [
    ...ticketPayments.map((payment) => ({
      at: new Date(payment.paidAt ?? new Date(0)),
      kind: "payment" as const,
      bucket: bucketFromMethod(payment.method),
      currency: normalizeMoneyCurrency(payment.currency),
      amount: payment.amount,
      direction: "INFLOW" as const,
      category: null,
    })),
    ...cashOperations.map((operation) => ({
      at: new Date(operation.occurredAt ?? new Date(0)),
      kind: "operation" as const,
      bucket: bucketFromMethod(operation.method),
      currency: normalizeMoneyCurrency(operation.currency),
      amount: operation.amount,
      direction: operation.direction === "OUTFLOW" ? "OUTFLOW" as const : "INFLOW" as const,
      category: operation.category ?? null,
    })),
  ].sort((a, b) => {
    const diff = a.at.getTime() - b.at.getTime();
    if (diff !== 0) return diff;
    if (a.category === "OPENING_BALANCE") return -1;
    if (b.category === "OPENING_BALANCE") return 1;
    return 0;
  });

  for (const event of events) {
    const snapshot = buckets[event.bucket];
    const flags = openingApplied.get(event.bucket) ?? { usd: false, cdf: false };

    if (event.category === "OPENING_BALANCE") {
      if (event.currency === "USD") {
        if (flags.usd) continue;
        snapshot.usd = event.amount;
        snapshot.initializedUsd = true;
        flags.usd = true;
      } else {
        if (flags.cdf) continue;
        snapshot.cdf = event.amount;
        snapshot.initializedCdf = true;
        flags.cdf = true;
      }
      openingApplied.set(event.bucket, flags);
      continue;
    }

    if (event.currency === "USD") {
      snapshot.usd += event.direction === "INFLOW" ? event.amount : -event.amount;
      snapshot.initializedUsd = true;
    } else {
      snapshot.cdf += event.direction === "INFLOW" ? event.amount : -event.amount;
      snapshot.initializedCdf = true;
    }
  }

  return buckets;
}

function applyOpeningFallbackFromCurrentPeriod(
  baseBuckets: Record<BalanceBucket, BalanceSnapshot>,
  cashOperations: Array<{ amount: number; currency?: string | null; method?: string | null; category?: string | null; occurredAt?: Date | string | null }>,
): Record<BalanceBucket, BalanceSnapshot> {
  const buckets = Object.fromEntries(
    Object.entries(baseBuckets).map(([key, value]) => [key, { ...value }]),
  ) as Record<BalanceBucket, BalanceSnapshot>;

  const openingOperations = cashOperations
    .filter((operation) => operation.category === "OPENING_BALANCE")
    .sort((a, b) => new Date(a.occurredAt ?? new Date(0)).getTime() - new Date(b.occurredAt ?? new Date(0)).getTime());

  for (const operation of openingOperations) {
    const bucket = bucketFromMethod(operation.method);
    const snapshot = buckets[bucket];
    const currency = normalizeMoneyCurrency(operation.currency);

    if (currency === "USD" && !snapshot.initializedUsd) {
      snapshot.usd = operation.amount;
      snapshot.initializedUsd = true;
    }

    if (currency === "CDF" && !snapshot.initializedCdf) {
      snapshot.cdf = operation.amount;
      snapshot.initializedCdf = true;
    }
  }

  return buckets;
}

function bucketUsdEquivalent(snapshot: Pick<BalanceSnapshot, "usd" | "cdf">, fxRateUsdToCdf = 2800) {
  return snapshot.usd + (snapshot.cdf / fxRateUsdToCdf);
}

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role, session } = await requirePageModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE", "MANAGER"]);
  const isCashier = isCashierJobTitle(session.user.jobTitle);
  const isComptable = role === "ACCOUNTANT" || session.user.jobTitle === "COMPTABLE";
  const isAdmin = role === "ADMIN";
  const canWrite = isCashier || isAdmin || isComptable;
  const canManageLedger = isAdmin || isComptable;
  const resolvedSearchParams = (await searchParams) ?? {};
  const selectedDeskParam = ((resolvedSearchParams as any).desk ?? "THE_BEST") as string;
  const selectedDeskKey = String(selectedDeskParam).trim().toUpperCase();
  const KNOWN_DESK_PREFIXES = ["PROXY_BANKING:", "THE_BEST:", "CAISSE_SAFETY:", "CAISSE_VISAS:", "CAISSE_TSL:", "CAISSE_AGENCE:"];
  const range = dateRangeFromParams(resolvedSearchParams);
  const cashRange = monthRangeFromValue(resolvedSearchParams.cashMonth);

  const selectedAirlineId = resolvedSearchParams.airlineId && resolvedSearchParams.airlineId !== "ALL"
    ? resolvedSearchParams.airlineId
    : undefined;
  const reportQuery = new URLSearchParams({
    startDate: range.startRaw,
    endDate: range.endRaw,
    ...(selectedAirlineId ? { airlineId: selectedAirlineId } : {}),
  }).toString();
  const cashJournalReportQuery = new URLSearchParams({
    reportType: "cash-journal",
    mode: "month",
    month: cashRange.monthRaw,
  }).toString();
  const cashSummaryReportQuery = new URLSearchParams({
    reportType: "cash-summary",
    mode: "month",
    month: cashRange.monthRaw,
  }).toString();
  const selectedYear = range.start.getUTCFullYear();
  const yearStart = new Date(Date.UTC(selectedYear, 0, 1, 0, 0, 0, 0));
  const yearEnd = new Date(Date.UTC(selectedYear + 1, 0, 1, 0, 0, 0, 0));


  const paymentsData = await Promise.all([
    prisma.airline.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.ticketSale.findMany({
      where: {
        soldAt: { gte: range.start, lt: range.end },
        ...(selectedAirlineId ? { airlineId: selectedAirlineId } : {}),
      },
      include: {
        airline: true,
        payments: true,
        seller: { select: { team: { select: { name: true } } } },
      },
      orderBy: { soldAt: "desc" },
      take: 800,
    }),
    prisma.ticketSale.findMany({
      where: {
        soldAt: { gte: yearStart, lt: yearEnd },
      },
      select: {
        id: true,
        soldAt: true,
      },
      orderBy: [{ soldAt: "asc" }, { id: "asc" }],
      take: 10000,
    }),
    // Ticket payments only belong to THE_BEST desk; for other desks we skip ticket payments
    selectedDeskKey === "THE_BEST"
      ? prisma.payment.findMany({
        where: {
          paidAt: { gte: range.start, lt: range.end },
          ...(selectedAirlineId ? { ticket: { airlineId: selectedAirlineId } } : {}),
        },
        include: {
          ticket: {
            select: {
              ticketNumber: true,
              customerName: true,
              amount: true,
              paymentStatus: true,
              currency: true,
            },
          },
        },
        orderBy: { paidAt: "desc" },
        take: 250,
      })
      : Promise.resolve([]),
    // cashPayments: ticket payments for cash journal (THE_BEST only)
    selectedDeskKey === "THE_BEST"
      ? paymentClient.findMany({
        where: { paidAt: { gte: cashRange.start, lt: cashRange.end } },
        include: {
          ticket: {
            select: {
              ticketNumber: true,
              customerName: true,
              currency: true,
            },
          },
        },
        orderBy: { paidAt: "desc" },
        take: 5000,
      })
      : Promise.resolve([]),
    // cash operations: filter by desk prefixes when possible
    cashOperationClient.findMany({
      where: {
        occurredAt: { gte: cashRange.start, lt: cashRange.end },
        // include operations explicitly tagged with known desk prefixes OR (for THE_BEST) operations not tagged as proxy
        OR: KNOWN_DESK_PREFIXES.map((p) => ({ description: { startsWith: p } })).concat(
          selectedDeskKey === "THE_BEST" ? [{ description: { not: { startsWith: "PROXY_BANKING:" } } }] : [] as any
        ),
      },
      include: {
        createdBy: { select: { name: true, jobTitle: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 250,
    }),
    selectedDeskKey === "THE_BEST"
      ? paymentClient.findMany({
        where: { paidAt: { lt: cashRange.start } },
        select: {
          paidAt: true,
          amount: true,
          currency: true,
          amountUsd: true,
          amountCdf: true,
          fxRateUsdToCdf: true,
          method: true,
        },
        take: 5000,
      })
      : Promise.resolve([]),
    cashOperationClient.findMany({
      where: {
        occurredAt: { lt: cashRange.start },
        OR: KNOWN_DESK_PREFIXES.map((p) => ({ description: { startsWith: p } })),
      },
      select: {
        occurredAt: true,
        category: true,
        amount: true,
        direction: true,
        method: true,
        currency: true,
        amountUsd: true,
        fxRateToUsd: true,
        fxRateUsdToCdf: true,
        description: true,
      },
      take: 5000,
    }),
    canWrite
      ? paymentOrderClient.findMany({
          where: { status: "APPROVED" },
          select: {
            id: true,
            code: true,
            beneficiary: true,
            amount: true,
            currency: true,
            approvedAt: true,
          },
          orderBy: { approvedAt: "desc" },
          take: 12,
        })
      : Promise.resolve([]),
    canWrite
      ? prisma.needRequest.findMany({
          where: { status: "APPROVED" },
          select: {
            id: true,
            code: true,
            title: true,
            estimatedAmount: true,
            currency: true,
            approvedAt: true,
            reviewComment: true,
          },
          orderBy: { approvedAt: "desc" },
          take: 12,
        })
      : Promise.resolve([]),
  ]);

  const [
    airlines,
    tickets,
    yearTickets,
    payments,
    cashPayments,
    cashOperations,
    ticketPaymentsBeforeStart,
    cashOperationsBeforeStart,
    paymentOrdersReadyForExecution,
    needsReadyForExecutionRaw,
  ] = paymentsData as [
    AirlineRow[],
    TicketSaleRow[],
    Array<{ id: string; soldAt: Date }>,
    TicketPaymentRow[],
    TicketPaymentRow[],
    CashOperationRow[],
    Array<{ paidAt?: Date | string | null; amount: number; currency?: string | null; amountUsd?: number | null; amountCdf?: number | null; fxRateUsdToCdf?: number | null; method?: string | null }>,
    Array<{ occurredAt?: Date | string | null; category?: string | null; amount: number; direction: string; method?: string | null; currency?: string | null; amountUsd?: number | null; fxRateToUsd?: number | null; fxRateUsdToCdf?: number | null; description?: string | null }>,
    Array<{ id: string; code?: string | null; beneficiary: string; amount: number; currency?: string | null; approvedAt?: Date | null }>,
    Array<{ id: string; code?: string | null; title: string; estimatedAmount?: number | null; currency?: string | null; approvedAt?: Date | null; reviewComment?: string | null }>,
  ];

  const sequenceByTicketId = new Map<string, number>();
  yearTickets
    .slice()
    .sort((a, b) => {
      const diff = new Date(a.soldAt).getTime() - new Date(b.soldAt).getTime();
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    })
    .forEach((ticket, index) => {
      sequenceByTicketId.set(ticket.id, index + 1);
    });

  const ticketsWithComputedStatus = tickets.map((ticket) => {
    const paidAmount = ticket.payments.reduce(
      (
        sum: number,
        payment: { amount: number; currency?: string | null; amountUsd?: number | null; amountCdf?: number | null; fxRateToUsd?: number | null; fxRateUsdToCdf?: number | null },
      ) => sum + normalizePaymentAmountForTicket(payment, ticket.currency),
      0,
    );
    const paidAmountUsd = ticket.payments.reduce(
      (
        sum: number,
        payment: { amount: number; currency?: string | null; amountUsd?: number | null; amountCdf?: number | null; fxRateToUsd?: number | null; fxRateUsdToCdf?: number | null },
      ) => sum + normalizeCashAmountUsd(payment),
      0,
    );
    const totalTicketAmount = getTicketTotalAmount(ticket);
    const amountUsd = normalizeCashAmountUsd({ amount: totalTicketAmount, currency: ticket.currency });
    const computedStatus = paidAmount <= 0
      ? PaymentStatus.UNPAID
      : paidAmount + 0.0001 >= totalTicketAmount
        ? PaymentStatus.PAID
        : PaymentStatus.PARTIAL;

    const invoiceNumber = invoiceNumberFromChronology({
      soldAt: new Date(ticket.soldAt),
      sellerTeamName: ticket.seller?.team?.name ?? null,
      sequence: sequenceByTicketId.get(ticket.id) ?? 1,
    });

    return {
      ...ticket,
      paidAmount,
      paidAmountUsd,
      amountUsd,
      totalTicketAmount,
      computedStatus,
      invoiceNumber,
    };
  });

  const totalTicketAmount = ticketsWithComputedStatus.reduce((sum, ticket) => sum + ticket.amountUsd, 0);
  const totalPaid = ticketsWithComputedStatus.reduce((sum, ticket) => sum + ticket.paidAmountUsd, 0);
  const receivables = Math.max(0, totalTicketAmount - totalPaid);
  const paidTickets = ticketsWithComputedStatus.filter((ticket) => ticket.computedStatus === PaymentStatus.PAID);
  const unpaidTickets = ticketsWithComputedStatus.filter((ticket) => ticket.computedStatus === PaymentStatus.UNPAID);
  const partialTickets = ticketsWithComputedStatus.filter((ticket) => ticket.computedStatus === PaymentStatus.PARTIAL);

  const collectedTotal = paidTickets.reduce((sum, ticket) => sum + ticket.amountUsd, 0);
  const partialBilled = partialTickets.reduce((sum, ticket) => sum + ticket.amountUsd, 0);
  const partialCollected = partialTickets.reduce((sum, ticket) => sum + ticket.paidAmountUsd, 0);
  const unpaidTotal = unpaidTickets.reduce((sum, ticket) => sum + ticket.amountUsd, 0);
  const collectionRate = totalTicketAmount > 0 ? (totalPaid / totalTicketAmount) * 100 : 0;
  const partialCoverageRate = partialBilled > 0 ? (partialCollected / partialBilled) * 100 : 0;

  const generalCashOperations = cashOperations.filter((operation) => !isProxyBankingOperation(operation));
  const generalCashOperationsBeforeStart = cashOperationsBeforeStart.filter((operation) => !isProxyBankingOperation(operation));
  const proxyCashOperations = cashOperations.filter((operation) => isProxyBankingOperation(operation));
  const proxyCashOperationsBeforeStart = cashOperationsBeforeStart.filter((operation) => isProxyBankingOperation(operation));

  const openingBuckets = computeOpeningBuckets(ticketPaymentsBeforeStart, generalCashOperationsBeforeStart);
  const displayOpeningBuckets = applyOpeningFallbackFromCurrentPeriod(openingBuckets, generalCashOperations);
  const cashOperationsWithoutOpeningBalance = generalCashOperations.filter((operation) => operation.category !== "OPENING_BALANCE");
  const hasInitialOpeningRecorded = [...generalCashOperationsBeforeStart, ...generalCashOperations].some((operation) => operation.category === "OPENING_BALANCE");
  const proxyHasInitialOpeningRecorded = [...proxyCashOperationsBeforeStart, ...proxyCashOperations].some((operation) => operation.category === "OPENING_BALANCE");
  const hasOpeningInsideSelectedRange = generalCashOperations.some((operation) => operation.category === "OPENING_BALANCE");
  const openingBalance = (Object.values(displayOpeningBuckets) as Array<BalanceSnapshot>).reduce(
    (sum, snapshot) => sum + bucketUsdEquivalent(snapshot),
    0,
  );
  const openingUsd = displayOpeningBuckets.CASH.usd;
  const openingCdf = displayOpeningBuckets.CASH.cdf;

  const ticketPaymentInflowsUsd = cashPayments.reduce(
    (
      sum: number,
      payment: { amount: number; currency?: string | null; amountUsd?: number | null; amountCdf?: number | null; fxRateToUsd?: number | null; fxRateUsdToCdf?: number | null },
    ) => sum + normalizeCashAmountUsd(payment),
    0,
  );
  const ticketPaymentInflowUsd = cashPayments
    .filter((payment: { currency?: string | null; ticket?: { currency?: string | null } }) => normalizeMoneyCurrency(payment.currency ?? payment.ticket?.currency) === "USD")
    .reduce((sum: number, payment: { amount: number }) => sum + payment.amount, 0);
  const ticketPaymentInflowCdf = cashPayments
    .filter((payment: { currency?: string | null; ticket?: { currency?: string | null } }) => normalizeMoneyCurrency(payment.currency ?? payment.ticket?.currency) === "CDF")
    .reduce((sum: number, payment: { amount: number }) => sum + payment.amount, 0);

  const otherInflows = cashOperationsWithoutOpeningBalance
    .filter((operation: { direction: string }) => operation.direction === "INFLOW")
    .reduce(
      (sum: number, operation: { amount: number; currency?: string | null; amountUsd?: number | null; fxRateToUsd?: number | null; fxRateUsdToCdf?: number | null }) => sum + normalizeCashAmountUsd(operation),
      0,
    );
  const cashOutflows = cashOperationsWithoutOpeningBalance
    .filter((operation: { direction: string }) => operation.direction === "OUTFLOW")
    .reduce(
      (sum: number, operation: { amount: number; currency?: string | null; amountUsd?: number | null; fxRateToUsd?: number | null; fxRateUsdToCdf?: number | null }) => sum + normalizeCashAmountUsd(operation),
      0,
    );

  const grossInflows = ticketPaymentInflowsUsd + otherInflows;
  const netCashVariation = grossInflows - cashOutflows;
  const closingBalance = openingBalance + netCashVariation;
  const expensePressure = grossInflows > 0 ? (cashOutflows / grossInflows) * 100 : cashOutflows > 0 ? 100 : 0;
  const riskLevel = cashOutflows > grossInflows
    ? "Critique"
    : expensePressure >= 85
      ? "Alerte"
      : expensePressure >= 65
        ? "Sous surveillance"
        : "Sain";
  const riskHint = `Sorties ${cashOutflows.toFixed(2)} / Entrées ${grossInflows.toFixed(2)} (${expensePressure.toFixed(1)}%)`;

  const accountingConsistency = Math.abs((openingBalance + grossInflows - cashOutflows) - closingBalance) <= 0.0001;

  const cashInflowUsd = cashOperationsWithoutOpeningBalance
    .filter((operation: { direction: string; currency?: string | null }) => operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "USD")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);
  const cashOutflowUsd = cashOperationsWithoutOpeningBalance
    .filter((operation: { direction: string; currency?: string | null }) => operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "USD")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);
  const cashInflowCdf = cashOperationsWithoutOpeningBalance
    .filter((operation: { direction: string; currency?: string | null }) => operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);
  const cashOutflowCdf = cashOperationsWithoutOpeningBalance
    .filter((operation: { direction: string; currency?: string | null }) => operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);

  const closingUsd = openingUsd + ticketPaymentInflowUsd + cashInflowUsd - cashOutflowUsd;
  const closingCdf = openingCdf + ticketPaymentInflowCdf + cashInflowCdf - cashOutflowCdf;

  const caisseRows = [
    ...cashPayments.map((payment) => {
      const currency = normalizeMoneyCurrency(payment.currency ?? payment.ticket?.currency);
      return {
        occurredAt: new Date(payment.paidAt),
        typeOperation: "Entrée en caisse",
        libelle: `Paiement billet ${payment.ticket?.ticketNumber ?? "N/A"} - ${payment.ticket?.customerName ?? "Client"}`,
        reference: payment.reference ?? "-",
        usdIn: currency === "USD" ? payment.amount : 0,
        usdOut: 0,
        cdfIn: currency === "CDF" ? payment.amount : 0,
        cdfOut: 0,
        actionType: "payment" as const,
        paymentId: payment.id,
        paymentAmount: payment.amount,
        paymentCurrency: currency,
        paymentMethod: payment.method ?? "CASH",
        paymentPaidAt: new Date(payment.paidAt).toISOString(),
      };
    }),
    ...cashOperationsWithoutOpeningBalance.map((operation) => {
      const currency = (operation.currency ?? "USD").toUpperCase();
      const isInflow = operation.direction === "INFLOW";
      return {
        occurredAt: new Date(operation.occurredAt),
        typeOperation: isInflow ? "Entrée en caisse" : "Sortie en caisse",
        libelle: operation.description,
        reference: operation.reference ?? "-",
        usdIn: isInflow && currency === "USD" ? operation.amount : 0,
        usdOut: !isInflow && currency === "USD" ? operation.amount : 0,
        cdfIn: isInflow && currency === "CDF" ? operation.amount : 0,
        cdfOut: !isInflow && currency === "CDF" ? operation.amount : 0,
        actionType: "cash-operation" as const,
        cashOperationId: operation.id,
        cashAmount: operation.amount,
        cashCurrency: normalizeMoneyCurrency(operation.currency),
        cashMethod: operation.method ?? "CASH",
        cashDescription: operation.description,
        cashOccurredAt: new Date(operation.occurredAt).toISOString(),
      };
    }),
  ].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const caisseLedger = caisseRows.reduce<Array<(typeof caisseRows)[number] & { usdBalance: number; cdfBalance: number }>>((rows, row) => {
    const previous = rows[rows.length - 1];
    const usdBalance = (previous?.usdBalance ?? openingUsd) + row.usdIn - row.usdOut;
    const cdfBalance = (previous?.cdfBalance ?? openingCdf) + row.cdfIn - row.cdfOut;
    rows.push({
      ...row,
      usdBalance,
      cdfBalance,
    });
    return rows;
  }, []);

  const initialVirtualStats = Object.fromEntries(
    virtualChannels.map(({ key }) => [
      key,
      {
        openingUsd: displayOpeningBuckets[key].usd,
        openingCdf: displayOpeningBuckets[key].cdf,
        inUsd: 0,
        outUsd: 0,
        inCdf: 0,
        outCdf: 0,
      },
    ]),
  ) as Record<VirtualChannel, {
    openingUsd: number;
    openingCdf: number;
    inUsd: number;
    outUsd: number;
    inCdf: number;
    outCdf: number;
  }>;

  for (const payment of cashPayments as Array<{ amount: number; method?: string | null; currency?: string | null }>) {
    const channel = detectVirtualChannel(payment.method);
    if (!channel) continue;
    const currency = normalizeMoneyCurrency(payment.currency);
    if (currency === "USD") {
      initialVirtualStats[channel].inUsd += payment.amount;
    } else {
      initialVirtualStats[channel].inCdf += payment.amount;
    }
  }

  for (const operation of cashOperationsWithoutOpeningBalance as Array<{ direction: string; amount: number; method?: string | null; currency?: string | null }>) {
    const channel = detectVirtualChannel(operation.method);
    if (!channel) continue;
    const currency = (operation.currency ?? "USD").toUpperCase();
    if (currency === "USD") {
      if (operation.direction === "INFLOW") {
        initialVirtualStats[channel].inUsd += operation.amount;
      } else {
        initialVirtualStats[channel].outUsd += operation.amount;
      }
    } else if (currency === "CDF") {
      if (operation.direction === "INFLOW") {
        initialVirtualStats[channel].inCdf += operation.amount;
      } else {
        initialVirtualStats[channel].outCdf += operation.amount;
      }
    }
  }

  const virtualRows = virtualChannels.map(({ key, label }) => {
    const stats = initialVirtualStats[key];
    const closingUsd = stats.openingUsd + stats.inUsd - stats.outUsd;
    const closingCdf = stats.openingCdf + stats.inCdf - stats.outCdf;
    return {
      key,
      label,
      ...stats,
      closingUsd,
      closingCdf,
    };
  });

  const virtualTotals = virtualRows.reduce(
    (sum, row) => {
      sum.openingUsd += row.openingUsd;
      sum.openingCdf += row.openingCdf;
      sum.inUsd += row.inUsd;
      sum.outUsd += row.outUsd;
      sum.inCdf += row.inCdf;
      sum.outCdf += row.outCdf;
      sum.closingUsd += row.closingUsd;
      sum.closingCdf += row.closingCdf;
      return sum;
    },
    {
      openingUsd: 0,
      openingCdf: 0,
      inUsd: 0,
      outUsd: 0,
      inCdf: 0,
      outCdf: 0,
      closingUsd: 0,
      closingCdf: 0,
    },
  );

  const proxyOpeningBuckets = computeOpeningBuckets([], proxyCashOperationsBeforeStart);
  const proxyDisplayOpeningBuckets = applyOpeningFallbackFromCurrentPeriod(proxyOpeningBuckets, proxyCashOperations);
  const proxyCashOperationsWithoutOpeningBalance = proxyCashOperations.filter((operation) => operation.category !== "OPENING_BALANCE");
  const proxyCashOpeningUsd = proxyDisplayOpeningBuckets.CASH.usd;
  const proxyCashOpeningCdf = proxyDisplayOpeningBuckets.CASH.cdf;
  const proxyCashInflowUsd = proxyCashOperationsWithoutOpeningBalance
    .filter((operation) => bucketFromMethod(operation.method) === "CASH" && operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "USD")
    .reduce((sum, operation) => sum + operation.amount, 0);
  const proxyCashOutflowUsd = proxyCashOperationsWithoutOpeningBalance
    .filter((operation) => bucketFromMethod(operation.method) === "CASH" && operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "USD")
    .reduce((sum, operation) => sum + operation.amount, 0);
  const proxyCashInflowCdf = proxyCashOperationsWithoutOpeningBalance
    .filter((operation) => bucketFromMethod(operation.method) === "CASH" && operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF")
    .reduce((sum, operation) => sum + operation.amount, 0);
  const proxyCashOutflowCdf = proxyCashOperationsWithoutOpeningBalance
    .filter((operation) => bucketFromMethod(operation.method) === "CASH" && operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF")
    .reduce((sum, operation) => sum + operation.amount, 0);
  const proxyClosingUsd = proxyCashOpeningUsd + proxyCashInflowUsd - proxyCashOutflowUsd;
  const proxyClosingCdf = proxyCashOpeningCdf + proxyCashInflowCdf - proxyCashOutflowCdf;

  const proxyVirtualRows = virtualChannels.map(({ key, label }) => {
    const openingUsd = proxyDisplayOpeningBuckets[key].usd;
    const openingCdf = proxyDisplayOpeningBuckets[key].cdf;
    const inUsd = proxyCashOperationsWithoutOpeningBalance
      .filter((operation) => bucketFromMethod(operation.method) === key && operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "USD")
      .reduce((sum, operation) => sum + operation.amount, 0);
    const outUsd = proxyCashOperationsWithoutOpeningBalance
      .filter((operation) => bucketFromMethod(operation.method) === key && operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "USD")
      .reduce((sum, operation) => sum + operation.amount, 0);
    const inCdf = proxyCashOperationsWithoutOpeningBalance
      .filter((operation) => bucketFromMethod(operation.method) === key && operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF")
      .reduce((sum, operation) => sum + operation.amount, 0);
    const outCdf = proxyCashOperationsWithoutOpeningBalance
      .filter((operation) => bucketFromMethod(operation.method) === key && operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF")
      .reduce((sum, operation) => sum + operation.amount, 0);

    return {
      key,
      label,
      openingUsd,
      openingCdf,
      inUsd,
      outUsd,
      inCdf,
      outCdf,
      closingUsd: openingUsd + inUsd - outUsd,
      closingCdf: openingCdf + inCdf - outCdf,
    };
  });

  const proxyVirtualTotals = proxyVirtualRows.reduce(
    (sum, row) => {
      sum.openingUsd += row.openingUsd;
      sum.openingCdf += row.openingCdf;
      sum.inUsd += row.inUsd;
      sum.outUsd += row.outUsd;
      sum.inCdf += row.inCdf;
      sum.outCdf += row.outCdf;
      sum.closingUsd += row.closingUsd;
      sum.closingCdf += row.closingCdf;
      return sum;
    },
    {
      openingUsd: 0,
      openingCdf: 0,
      inUsd: 0,
      outUsd: 0,
      inCdf: 0,
      outCdf: 0,
      closingUsd: 0,
      closingCdf: 0,
    },
  );

  const proxyHistoryRows = proxyCashOperations
    .slice()
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .map((operation) => ({
      ...operation,
      channelLabel: proxyChannelLabel((bucketFromMethod(operation.method) === "CASH" ? "CASH" : bucketFromMethod(operation.method)) as string),
      operationLabel: proxyOperationLabel(operation.description),
    }));

  const proxyEventCount = new Set(
    proxyCashOperationsWithoutOpeningBalance.map((operation) => `${operation.reference ?? "-"}:${proxyOperationLabel(operation.description)}`),
  ).size;

  const paymentTickets = ticketsWithComputedStatus
    .filter((ticket) => ticket.computedStatus !== PaymentStatus.PAID)
    .map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      customerName: ticket.customerName,
      amount: ticket.totalTicketAmount,
      paidAmount: ticket.paidAmount,
      paymentStatus: ticket.computedStatus,
      currency: ticket.currency ?? "USD",
      invoiceNumber: ticket.invoiceNumber,
    }));

  const needsReadyForExecution = needsReadyForExecutionRaw.filter(
    (need) => !(need.reviewComment ?? "").includes("EXECUTION_CAISSE:"),
  );
  const paymentOrdersExecutionCount = paymentOrdersReadyForExecution.length;
  const needsExecutionCount = needsReadyForExecution.length;

  function separatedDeskSummary(label: string) {
    return (
      <section className="rounded-2xl border border-dashed border-black/20 bg-white px-4 py-5 text-sm text-black/65 dark:border-white/20 dark:bg-zinc-900 dark:text-white/65">
        {label} n&apos;utilise pas les données actuelles de <span className="font-semibold">THE BEST / Caisse 2 siège</span>. Aucun récapitulatif séparé n&apos;est encore enregistré ici.
      </section>
    );
  }

  function separatedDeskWorkspace(label: string) {
    return (
      <section className="rounded-2xl border border-dashed border-black/20 bg-white px-4 py-5 text-sm text-black/65 dark:border-white/20 dark:bg-zinc-900 dark:text-white/65">
        Aucun historique ni aucune opération distincte n&apos;est encore enregistré pour <span className="font-semibold">{label}</span>. Les écritures actuelles restent réservées à <span className="font-semibold">THE BEST / Caisse 2 siège</span>.
      </section>
    );
  }

  const workspaceOverrides = {
    PROXY_BANKING: {
      summary: (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-5">
          <KpiCard label="Cash proxy USD" value={`${proxyClosingUsd.toFixed(2)} USD`} />
          <KpiCard label="Cash proxy CDF" value={`${proxyClosingCdf.toFixed(2)} CDF`} />
          <KpiCard label="Virtuel USD" value={`${proxyVirtualTotals.closingUsd.toFixed(2)} USD`} />
          <KpiCard label="Virtuel CDF" value={`${proxyVirtualTotals.closingCdf.toFixed(2)} CDF`} />
          <KpiCard label="Opérations proxy" value={`${proxyEventCount}`} hint="Dépôts, retraits, changes et soldes initiaux" />
        </div>
      ),
      cash: (
        <div className="space-y-4">
          <ProxyBankingForm />
          <CashOperationForm
            hasInitialOpening={proxyHasInitialOpeningRecorded}
            allowedMethods={["CASH", "AIRTEL_MONEY", "ORANGE_MONEY", "MPESA", "EQUITY", "RAWBANK_ILLICOCASH"]}
            title="Autres opérations cash et virtuel du proxy banking"
            showConversionSection={false}
            descriptionPrefix="PROXY_BANKING:OTHER:"
            categoryInputMode="text"
          />

          <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
              <h2 className="text-sm font-semibold">Historique proxy banking</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-black/5 dark:bg-white/10">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Date</th>
                    <th className="px-4 py-3 text-left font-semibold">Opération</th>
                    <th className="px-4 py-3 text-left font-semibold">Canal</th>
                    <th className="px-4 py-3 text-left font-semibold">Sens</th>
                    <th className="px-4 py-3 text-left font-semibold">Montant</th>
                    <th className="px-4 py-3 text-left font-semibold">Référence</th>
                    {role === "ADMIN" ? <th className="px-4 py-3 text-left font-semibold">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {proxyHistoryRows.map((row) => (
                    <tr key={row.id} className="border-t border-black/5 dark:border-white/10">
                      <td className="px-4 py-3">{new Date(row.occurredAt).toLocaleString("fr-FR")}</td>
                      <td className="px-4 py-3 font-medium">{row.operationLabel}</td>
                      <td className="px-4 py-3">{row.channelLabel}</td>
                      <td className="px-4 py-3">{row.direction === "INFLOW" ? "Entrée" : "Sortie"}</td>
                      <td className="px-4 py-3">{row.amount.toFixed(2)} {normalizeMoneyCurrency(row.currency)}</td>
                      <td className="px-4 py-3">{row.reference ?? "-"}</td>
                      {role === "ADMIN" ? (
                        <td className="px-4 py-3">
                          <div className="flex items-center">
                            <ProxyBankingEditButton
                              id={row.id}
                              amount={row.amount}
                              currency={row.currency}
                              reference={row.reference}
                              description={row.description}
                              occurredAt={row.occurredAt}
                              method={row.method}
                            />
                            <ProxyBankingDeleteButton id={row.id} />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {proxyHistoryRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                        Aucun dépôt, retrait, change ou solde initial proxy banking enregistré pour cette période.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ),
      virtual: (
        <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
            <h2 className="text-sm font-semibold">Soldes proxy banking (cash + virtuel)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 dark:bg-white/10">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Canal</th>
                  <th className="px-4 py-3 text-left font-semibold">Ouverture USD</th>
                  <th className="px-4 py-3 text-left font-semibold">Ouverture CDF</th>
                  <th className="px-4 py-3 text-left font-semibold">Entrées USD</th>
                  <th className="px-4 py-3 text-left font-semibold">Sorties USD</th>
                  <th className="px-4 py-3 text-left font-semibold">Solde USD</th>
                  <th className="px-4 py-3 text-left font-semibold">Entrées CDF</th>
                  <th className="px-4 py-3 text-left font-semibold">Sorties CDF</th>
                  <th className="px-4 py-3 text-left font-semibold">Solde CDF</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-black/5 bg-black/2 dark:border-white/10 dark:bg-white/3">
                  <td className="px-4 py-3 font-semibold">Cash</td>
                  <td className="px-4 py-3">{proxyCashOpeningUsd.toFixed(2)} USD</td>
                  <td className="px-4 py-3">{proxyCashOpeningCdf.toFixed(2)} CDF</td>
                  <td className="px-4 py-3">{proxyCashInflowUsd.toFixed(2)} USD</td>
                  <td className="px-4 py-3">{proxyCashOutflowUsd.toFixed(2)} USD</td>
                  <td className="px-4 py-3 font-semibold">{proxyClosingUsd.toFixed(2)} USD</td>
                  <td className="px-4 py-3">{proxyCashInflowCdf.toFixed(2)} CDF</td>
                  <td className="px-4 py-3">{proxyCashOutflowCdf.toFixed(2)} CDF</td>
                  <td className="px-4 py-3 font-semibold">{proxyClosingCdf.toFixed(2)} CDF</td>
                </tr>
                {proxyVirtualRows.map((row) => (
                  <tr key={row.key} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-4 py-3 font-medium">{row.label}</td>
                    <td className="px-4 py-3">{row.openingUsd.toFixed(2)} USD</td>
                    <td className="px-4 py-3">{row.openingCdf.toFixed(2)} CDF</td>
                    <td className="px-4 py-3">{row.inUsd.toFixed(2)} USD</td>
                    <td className="px-4 py-3">{row.outUsd.toFixed(2)} USD</td>
                    <td className="px-4 py-3 font-semibold">{row.closingUsd.toFixed(2)} USD</td>
                    <td className="px-4 py-3">{row.inCdf.toFixed(2)} CDF</td>
                    <td className="px-4 py-3">{row.outCdf.toFixed(2)} CDF</td>
                    <td className="px-4 py-3 font-semibold">{row.closingCdf.toFixed(2)} CDF</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ),
      billetage: <CashBilletageWorkspace expectedUsd={proxyClosingUsd} expectedCdf={proxyClosingCdf} />,
    },
    CAISSE_SAFETY: {
      summary: separatedDeskSummary("Caisse Safety"),
    },
    CAISSE_VISAS: {
      summary: separatedDeskSummary("Caisse Visas"),
    },
    CAISSE_TSL: {
      summary: separatedDeskSummary("Caisse TSL"),
    },
    CAISSE_AGENCE: {
      summary: separatedDeskSummary("Caisse agence"),
    },
  } as const;

  return (
    <AppShell role={role}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Paiements</h1>
      </section>

      <PaymentsWritingWorkspace
        jobTitle={session.user.jobTitle ?? null}
        role={role}
        workspaceOverrides={workspaceOverrides}
        paymentOrdersWorkspace={canWrite ? (
          <section className="space-y-4 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
            <div>
              <h2 className="text-sm font-semibold">OP à exécuter</h2>
            </div>

            {paymentOrdersReadyForExecution.length === 0 ? (
              <p className="rounded-xl border border-dashed border-black/20 px-4 py-5 text-xs text-black/60 dark:border-white/20 dark:text-white/60">
                Aucun OP en attente d&apos;exécution.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {paymentOrdersReadyForExecution.map((order) => (
                  <article key={order.id} className="rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{order.code ?? `OP-${order.id.slice(0, 8).toUpperCase()}`}</p>
                        <p className="text-xs text-black/60 dark:text-white/60">{order.beneficiary}</p>
                      </div>
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300">
                        À exécuter
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-black/70 dark:text-white/70">
                      Montant: {order.amount.toFixed(2)} {normalizeMoneyCurrency(order.currency)} • Approuvé le {order.approvedAt ? new Date(order.approvedAt).toLocaleString("fr-FR") : "-"}
                    </p>
                    <PaymentOrderCashExecutionActions paymentOrderId={order.id} />
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : undefined}
        paymentOrdersLabel={`OP à exécuter (${paymentOrdersExecutionCount})`}
        needsWorkspace={canWrite ? (
          <section className="space-y-4 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
            <div>
              <h2 className="text-sm font-semibold">EDB à exécuter</h2>
            </div>

            {needsReadyForExecution.length === 0 ? (
              <p className="rounded-xl border border-dashed border-black/20 px-4 py-5 text-xs text-black/60 dark:border-white/20 dark:text-white/60">
                Aucun EDB en attente d&apos;exécution.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {needsReadyForExecution.map((need) => (
                  <article key={need.id} className="rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{need.code ?? `EDB-${need.id.slice(0, 8).toUpperCase()}`}</p>
                        <p className="text-xs text-black/60 dark:text-white/60">{need.title}</p>
                      </div>
                      <span className="rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:border-violet-700/50 dark:bg-violet-950/30 dark:text-violet-300">
                        À exécuter
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-black/70 dark:text-white/70">
                      Montant estimé: {typeof need.estimatedAmount === "number" ? `${need.estimatedAmount.toFixed(2)} ${normalizeMoneyCurrency(need.currency)}` : "-"} • Approuvé le {need.approvedAt ? new Date(need.approvedAt).toLocaleString("fr-FR") : "-"}
                    </p>
                    <ProcurementCashExecutionActions needRequestId={need.id} />
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : undefined}
        needsLabel={`EDB à exécuter (${needsExecutionCount})`}
        closedSummary={(
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-5">
            <KpiCard label="Total encaissé" value={`${grossInflows.toFixed(2)} USD`} hint={`Billets ${ticketPaymentInflowsUsd.toFixed(2)} + autres ${otherInflows.toFixed(2)}`} />
            <KpiCard label="Total dépensé" value={`${cashOutflows.toFixed(2)} USD`} />
            <KpiCard label="Solde caisse USD" value={`${closingUsd.toFixed(2)} USD`} />
            <KpiCard label="Total caisse CDF" value={`${closingCdf.toFixed(2)} CDF`} />
            <KpiCard label="Niveau de risque" value={riskLevel} hint={riskHint} />
          </div>
        )}
        ticketWorkspace={(
          <div className="space-y-4">
            <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <form method="GET" className="grid gap-3 sm:grid-cols-3 sm:items-end">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Du</label>
                  <input type="date" name="startDate" defaultValue={range.startRaw} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Au</label>
                  <input type="date" name="endDate" defaultValue={range.endRaw} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Compagnie</label>
                  <select name="airlineId" defaultValue={resolvedSearchParams.airlineId ?? "ALL"} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
                    <option value="ALL">Toutes compagnies</option>
                    {airlines.map((airline) => (
                      <option key={airline.id} value={airline.id}>{airline.code} - {airline.name}</option>
                    ))}
                  </select>
                </div>

                <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Filtrer</button>
              </form>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <a
                  href={`/api/payments/report?${reportQuery}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-md border border-black/20 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Lire PDF paiements
                </a>
                <a
                  href={`/api/payments/report?${reportQuery}&download=1`}
                  className="inline-flex rounded-md border border-black/20 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Télécharger PDF paiements
                </a>
              </div>
              <p className="mt-3 text-xs text-black/60 dark:text-white/60">
                {range.label}
              </p>
            </section>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Total facturé" value={`${totalTicketAmount.toFixed(2)} USD`} />
              <KpiCard label="Total encaissé" value={`${totalPaid.toFixed(2)} USD`} />
              <KpiCard label="Total créance" value={`${receivables.toFixed(2)} USD`} />
              <KpiCard label="Taux d&apos;encaissement" value={`${collectionRate.toFixed(1)}%`} hint={`Partiels couverts à ${partialCoverageRate.toFixed(1)}%`} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Billets payés" value={`${paidTickets.length}`} hint={`${paidTickets.reduce((sum, t) => sum + t.amountUsd, 0).toFixed(2)} USD`} />
              <KpiCard label="Billets impayés" value={`${unpaidTickets.length}`} hint={`${unpaidTotal.toFixed(2)} USD eq non encaissés`} />
              <KpiCard label="Billets partiels" value={`${partialTickets.length}`} hint={`${partialCollected.toFixed(2)} / ${partialBilled.toFixed(2)} USD eq`} />
              <KpiCard label="Tickets totalement payés" value={`${collectedTotal.toFixed(2)} USD`} />
            </div>

            {canWrite ? (
              <PaymentEntryForm tickets={paymentTickets} />
            ) : (
              <section className="rounded-2xl border border-dashed border-black/20 bg-white/80 p-4 text-xs text-black/65 dark:border-white/20 dark:bg-zinc-900/70 dark:text-white/65">
                Profil en lecture seule sur les écritures billets. Vous pouvez consulter les indicateurs et l&apos;historique.
              </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
                <h2 className="text-sm font-semibold">Historique journalier paiements billets</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/5 dark:bg-white/10">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Date</th>
                      <th className="px-4 py-3 text-left font-semibold">Billet</th>
                      <th className="px-4 py-3 text-left font-semibold">Client</th>
                      <th className="px-4 py-3 text-left font-semibold">Montant</th>
                      <th className="px-4 py-3 text-left font-semibold">Méthode</th>
                      <th className="px-4 py-3 text-left font-semibold">Référence</th>
                      <th className="px-4 py-3 text-left font-semibold">Statut billet</th>
                      {canManageLedger ? <th className="px-4 py-3 text-left font-semibold">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-4 py-3">{new Date(payment.paidAt).toLocaleDateString("fr-FR")}</td>
                        <td className="px-4 py-3 font-medium">{payment.ticket?.ticketNumber ?? "-"}</td>
                        <td className="px-4 py-3">{payment.ticket?.customerName ?? "-"}</td>
                        <td className="px-4 py-3">{payment.amount.toFixed(2)} {normalizeMoneyCurrency(payment.currency ?? payment.ticket?.currency)}</td>
                        <td className="px-4 py-3">{payment.method}</td>
                        <td className="px-4 py-3">{payment.reference ?? "-"}</td>
                        <td className="px-4 py-3">{payment.ticket?.paymentStatus ?? "-"}</td>
                        {canManageLedger ? (
                          <td className="px-4 py-3">
                            <PaymentRowAdminActions
                              paymentId={payment.id}
                              amount={payment.amount}
                              currency={normalizeMoneyCurrency(payment.currency ?? payment.ticket?.currency)}
                              method={payment.method ?? "CASH"}
                              reference={payment.reference ?? null}
                              paidAt={new Date(payment.paidAt).toISOString()}
                            />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    {payments.length === 0 ? (
                      <tr>
                        <td colSpan={canManageLedger ? 8 : 7} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                          Aucun paiement trouvé pour ce filtre.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
        cashWorkspace={(
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Solde ouverture USD" value={`${openingUsd.toFixed(2)} USD`} />
              <KpiCard label="Solde clôture USD" value={`${closingUsd.toFixed(2)} USD`} hint={`Billets USD ${ticketPaymentInflowUsd.toFixed(2)} + autres USD ${cashInflowUsd.toFixed(2)} - sorties USD ${cashOutflowUsd.toFixed(2)}`} />
              <KpiCard label="Solde ouverture CDF" value={`${openingCdf.toFixed(2)} CDF`} />
              <KpiCard label="Solde clôture CDF" value={`${closingCdf.toFixed(2)} CDF`} hint={`Billets CDF ${ticketPaymentInflowCdf.toFixed(2)} + autres CDF ${cashInflowCdf.toFixed(2)} - sorties CDF ${cashOutflowCdf.toFixed(2)}`} />
            </div>

            <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-3xl">
                  <h2 className="text-sm font-semibold">Synthèse caisse</h2>
                  <p className="mt-2 text-xs text-black/60 dark:text-white/60">
                    {cashRange.label}. Solde USD: ouverture {openingUsd.toFixed(2)} USD, clôture {closingUsd.toFixed(2)} USD. Solde CDF: ouverture {openingCdf.toFixed(2)} CDF, clôture {closingCdf.toFixed(2)} CDF.
                    Contrôle global (équivalent USD): ouverture {openingBalance.toFixed(2)} USD, entrées {grossInflows.toFixed(2)} USD, sorties {cashOutflows.toFixed(2)} USD, variation nette {netCashVariation.toFixed(2)} USD, clôture {closingBalance.toFixed(2)} USD ({accountingConsistency ? "OK" : "écart"}).
                  </p>
                </div>

                <form method="GET" className="flex flex-wrap items-end gap-2 text-xs">
                  <input type="hidden" name="startDate" value={range.startRaw} />
                  <input type="hidden" name="endDate" value={range.endRaw} />
                  <input type="hidden" name="airlineId" value={resolvedSearchParams.airlineId ?? "ALL"} />
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Mois du journal</label>
                    <input type="month" name="cashMonth" defaultValue={cashRange.monthRaw} className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
                  </div>
                  <button type="submit" className="rounded-md bg-black px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black">Afficher</button>
                </form>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <a
                  href={`/api/payments/report?${cashJournalReportQuery}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-md border border-black/20 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Voir le journal de caisse
                </a>
                <a
                  href={`/api/payments/report?${cashSummaryReportQuery}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-md border border-black/20 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Voir le récapitulatif caisse
                </a>
              </div>
            </section>

            {canWrite ? (
                    <CashOperationForm hasInitialOpening={hasInitialOpeningRecorded} descriptionPrefix={`${selectedDeskKey}:`} />
            ) : (
              <section className="rounded-2xl border border-dashed border-black/20 bg-white/80 p-4 text-xs text-black/65 dark:border-white/20 dark:bg-zinc-900/70 dark:text-white/65">
                Profil en lecture seule sur les autres écritures de caisse. Les encodages restent réservés aux profils autorisés.
              </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
                <h2 className="text-sm font-semibold">Journal caisse (mois sélectionné - logique feuille CAISSE)</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/5 dark:bg-white/10">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Date</th>
                      <th className="px-4 py-3 text-left font-semibold">Type d&apos;opération</th>
                      <th className="px-4 py-3 text-left font-semibold">Libellé</th>
                      <th className="px-4 py-3 text-left font-semibold">USD Entrées</th>
                      <th className="px-4 py-3 text-left font-semibold">USD Sorties</th>
                      <th className="px-4 py-3 text-left font-semibold">USD Solde</th>
                      <th className="px-4 py-3 text-left font-semibold">CDF Entrées</th>
                      <th className="px-4 py-3 text-left font-semibold">CDF Sorties</th>
                      <th className="px-4 py-3 text-left font-semibold">CDF Solde</th>
                      <th className="px-4 py-3 text-left font-semibold">Référence</th>
                      {canManageLedger ? <th className="px-4 py-3 text-left font-semibold">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-black/5 bg-black/2 dark:border-white/10 dark:bg-white/3">
                      <td className="px-4 py-3 font-semibold">{cashRange.startRaw}</td>
                      <td className="px-4 py-3 font-semibold">Report à nouveau / solde d&apos;ouverture</td>
                      <td className="px-4 py-3 text-black/60 dark:text-white/60">
                        {hasOpeningInsideSelectedRange
                          ? "Ouverture de caisse utilisée comme report à nouveau initial"
                          : "Solde reporté automatiquement depuis la veille / période précédente"}
                      </td>
                      <td className="px-4 py-3">-</td>
                      <td className="px-4 py-3">-</td>
                      <td className="px-4 py-3 font-semibold">{openingUsd.toFixed(2)} USD</td>
                      <td className="px-4 py-3">-</td>
                      <td className="px-4 py-3">-</td>
                      <td className="px-4 py-3 font-semibold">{openingCdf.toFixed(2)} CDF</td>
                      <td className="px-4 py-3">-</td>
                      {canManageLedger ? <td className="px-4 py-3">-</td> : null}
                    </tr>

                    {caisseLedger.map((row, index) => (
                      <tr key={`${row.occurredAt.toISOString()}-${index}`} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-4 py-3">{row.occurredAt.toLocaleDateString("fr-FR")}</td>
                        <td className="px-4 py-3">{row.typeOperation}</td>
                        <td className="px-4 py-3">{row.libelle}</td>
                        <td className="px-4 py-3">{row.usdIn > 0 ? `${row.usdIn.toFixed(2)} USD` : "-"}</td>
                        <td className="px-4 py-3">{row.usdOut > 0 ? `${row.usdOut.toFixed(2)} USD` : "-"}</td>
                        <td className="px-4 py-3">{row.usdBalance.toFixed(2)} USD</td>
                        <td className="px-4 py-3">{row.cdfIn > 0 ? `${row.cdfIn.toFixed(2)} CDF` : "-"}</td>
                        <td className="px-4 py-3">{row.cdfOut > 0 ? `${row.cdfOut.toFixed(2)} CDF` : "-"}</td>
                        <td className="px-4 py-3">{row.cdfBalance.toFixed(2)} CDF</td>
                        <td className="px-4 py-3">{row.reference}</td>
                        {canManageLedger ? (
                          <td className="px-4 py-3">
                            {row.actionType === "payment" ? (
                              <PaymentRowAdminActions
                                paymentId={row.paymentId}
                                amount={row.paymentAmount}
                                currency={row.paymentCurrency}
                                method={row.paymentMethod}
                                reference={row.reference === "-" ? null : row.reference}
                                paidAt={row.paymentPaidAt}
                              />
                            ) : (
                              <CashOperationRowActions
                                cashOperationId={row.cashOperationId}
                                amount={row.cashAmount}
                                currency={row.cashCurrency}
                                method={row.cashMethod}
                                reference={row.reference === "-" ? null : row.reference}
                                description={row.cashDescription}
                                occurredAt={row.cashOccurredAt}
                              />
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    {caisseLedger.length === 0 ? (
                      <tr>
                        <td colSpan={canManageLedger ? 11 : 10} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                          Aucune opération de caisse sur cette période.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

          </div>
        )}
        virtualWorkspace={(
          <div className="space-y-4">
            <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <h2 className="text-sm font-semibold">Comptes virtuels</h2>
              <p className="mt-2 text-xs text-black/60 dark:text-white/60">
                Conformément à la feuille VIRTUEL, suivi des canaux Airtel Money, Orange Money, M-Pesa, Equity, et Rawbank & Illicocash avec soldes par devise.
              </p>
            </section>

            <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/5 dark:bg-white/10">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Comptes virtuels</th>
                      <th className="px-4 py-3 text-left font-semibold">Ouverture USD</th>
                      <th className="px-4 py-3 text-left font-semibold">Ouverture CDF</th>
                      <th className="px-4 py-3 text-left font-semibold">Entrées USD</th>
                      <th className="px-4 py-3 text-left font-semibold">Sorties USD</th>
                      <th className="px-4 py-3 text-left font-semibold">Solde USD</th>
                      <th className="px-4 py-3 text-left font-semibold">Entrées CDF</th>
                      <th className="px-4 py-3 text-left font-semibold">Sorties CDF</th>
                      <th className="px-4 py-3 text-left font-semibold">Solde CDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {virtualRows.map((row) => (
                      <tr key={row.key} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-4 py-3 font-medium">{row.label}</td>
                        <td className="px-4 py-3">{row.openingUsd.toFixed(2)} USD</td>
                        <td className="px-4 py-3">{row.openingCdf.toFixed(2)} CDF</td>
                        <td className="px-4 py-3">{row.inUsd.toFixed(2)} USD</td>
                        <td className="px-4 py-3">{row.outUsd.toFixed(2)} USD</td>
                        <td className="px-4 py-3 font-semibold">{row.closingUsd.toFixed(2)} USD</td>
                        <td className="px-4 py-3">{row.inCdf.toFixed(2)} CDF</td>
                        <td className="px-4 py-3">{row.outCdf.toFixed(2)} CDF</td>
                        <td className="px-4 py-3 font-semibold">{row.closingCdf.toFixed(2)} CDF</td>
                      </tr>
                    ))}

                    <tr className="border-t border-black/10 bg-black/5 font-semibold dark:border-white/10 dark:bg-white/10">
                      <td className="px-4 py-3">TOTAL</td>
                      <td className="px-4 py-3">{virtualTotals.openingUsd.toFixed(2)} USD</td>
                      <td className="px-4 py-3">{virtualTotals.openingCdf.toFixed(2)} CDF</td>
                      <td className="px-4 py-3">{virtualTotals.inUsd.toFixed(2)} USD</td>
                      <td className="px-4 py-3">{virtualTotals.outUsd.toFixed(2)} USD</td>
                      <td className="px-4 py-3">{virtualTotals.closingUsd.toFixed(2)} USD</td>
                      <td className="px-4 py-3">{virtualTotals.inCdf.toFixed(2)} CDF</td>
                      <td className="px-4 py-3">{virtualTotals.outCdf.toFixed(2)} CDF</td>
                      <td className="px-4 py-3">{virtualTotals.closingCdf.toFixed(2)} CDF</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        billetageWorkspace={canWrite ? (
          <CashBilletageWorkspace expectedUsd={closingUsd} expectedCdf={closingCdf} />
        ) : null}
      />
    </AppShell>
  );
}
