import { NeedRequestStatus, PaymentStatus } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { CashBilletageWorkspace } from "@/components/cash-billetage-workspace";
import { CashOperationForm } from "@/components/cash-operation-form";
import { KpiCard } from "@/components/kpi-card";
import { PaymentEntryForm } from "@/components/payment-entry-form";
import { PaymentsWritingWorkspace } from "@/components/payments-writing-workspace";
import { invoiceNumberFromChronology } from "@/lib/invoice";
import { requirePageModuleAccess } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;
const paymentClient = (prisma as unknown as { payment: any }).payment;
const cashOperationClient = (prisma as unknown as { cashOperation: any }).cashOperation;

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

type VirtualChannel = "AIRTEL_MONEY" | "ORANGE_MONEY" | "MPESA" | "EQUITY";

const virtualChannels: Array<{ key: VirtualChannel; label: string }> = [
  { key: "AIRTEL_MONEY", label: "Airtel Money" },
  { key: "ORANGE_MONEY", label: "Orange Money" },
  { key: "MPESA", label: "M-Pesa" },
  { key: "EQUITY", label: "Equity" },
];

function detectVirtualChannel(methodRaw: string | null | undefined): VirtualChannel | null {
  const method = (methodRaw ?? "").trim().toUpperCase();
  if (!method) return null;
  if (method.includes("AIRTEL")) return "AIRTEL_MONEY";
  if (method.includes("ORANGE")) return "ORANGE_MONEY";
  if (method.includes("M-PESA") || method.includes("MPESA") || method.includes("M PESA")) return "MPESA";
  if (method.includes("EQUITY")) return "EQUITY";
  return null;
}

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role, session } = await requirePageModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  const canWrite = session.user.jobTitle === "CAISSIERE" && role !== "ADMIN" && role !== "DIRECTEUR_GENERAL";
  const resolvedSearchParams = (await searchParams) ?? {};
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
    prisma.payment.findMany({
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
    }),
    paymentClient.findMany({
      where: {
        paidAt: { gte: cashRange.start, lt: cashRange.end },
      },
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
    }),
    paymentOrderClient.findMany({
      where: {
        status: "SUBMITTED",
      },
      include: {
        issuedBy: { select: { name: true, jobTitle: true } },
        approvedBy: { select: { name: true, jobTitle: true } },
        executedBy: { select: { name: true, jobTitle: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    prisma.needRequest.findMany({
      where: {
        status: NeedRequestStatus.SUBMITTED,
      },
      include: {
        requester: { select: { name: true, jobTitle: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 120,
    }),
    cashOperationClient.findMany({
      where: {
        occurredAt: { gte: cashRange.start, lt: cashRange.end },
      },
      include: {
        createdBy: { select: { name: true, jobTitle: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 250,
    }),
    paymentClient.findMany({
      where: {
        paidAt: { lt: cashRange.start },
      },
      select: {
        amount: true,
        currency: true,
        amountUsd: true,
        amountCdf: true,
        fxRateUsdToCdf: true,
        method: true,
      },
      take: 5000,
    }),
    cashOperationClient.findMany({
      where: {
        occurredAt: { lt: cashRange.start },
      },
      select: {
        amount: true,
        direction: true,
        method: true,
        currency: true,
        amountUsd: true,
        fxRateToUsd: true,
        fxRateUsdToCdf: true,
      },
      take: 5000,
    }),
  ]);

  const [
    airlines,
    tickets,
    payments,
    cashPayments,
    paymentOrders,
    pendingNeeds,
    cashOperations,
    ticketPaymentsBeforeStart,
    cashOperationsBeforeStart,
  ] = paymentsData as [any[], any[], any[], any[], any[], any[], any[], any[], any[]];

  const sequenceByTicketId = new Map<string, number>();
  tickets
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
    const amountUsd = normalizeCashAmountUsd({ amount: ticket.amount, currency: ticket.currency });
    const computedStatus = paidAmount <= 0
      ? PaymentStatus.UNPAID
      : paidAmount + 0.0001 >= ticket.amount
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
  const partialOutstanding = Math.max(0, partialBilled - partialCollected);
  const unpaidTotal = unpaidTickets.reduce((sum, ticket) => sum + ticket.amountUsd, 0);
  const collectionRate = totalTicketAmount > 0 ? (totalPaid / totalTicketAmount) * 100 : 0;
  const partialCoverageRate = partialBilled > 0 ? (partialCollected / partialBilled) * 100 : 0;

  const ticketInflowsBefore = ticketPaymentsBeforeStart.reduce(
    (sum: number, payment: { amount: number; currency?: string; amountUsd?: number; amountCdf?: number; fxRateUsdToCdf?: number }) => sum + normalizeCashAmountUsd(payment),
    0,
  );
  const cashOpsSignedBefore = cashOperationsBeforeStart.reduce(
    (sum: number, operation: { direction: string; amount: number; currency?: string; amountUsd?: number; fxRateToUsd?: number; fxRateUsdToCdf?: number }) => {
      const normalized = normalizeCashAmountUsd(operation);
      return sum + (operation.direction === "INFLOW" ? normalized : -normalized);
    },
    0,
  );
  const openingBalance = ticketInflowsBefore + cashOpsSignedBefore;

  const openingUsdFromTicketPayments = ticketPaymentsBeforeStart
    .filter((payment: { currency?: string | null }) => normalizeMoneyCurrency(payment.currency) === "USD")
    .reduce((sum: number, payment: { amount: number }) => sum + payment.amount, 0);
  const openingCdfFromTicketPayments = ticketPaymentsBeforeStart
    .filter((payment: { currency?: string | null }) => normalizeMoneyCurrency(payment.currency) === "CDF")
    .reduce((sum: number, payment: { amount: number }) => sum + payment.amount, 0);

  const openingUsdFromOps = cashOperationsBeforeStart.reduce(
    (sum: number, operation: { direction: string; amount: number; currency?: string }) => {
      const currency = normalizeMoneyCurrency(operation.currency);
      if (currency !== "USD") return sum;
      return sum + (operation.direction === "INFLOW" ? operation.amount : -operation.amount);
    },
    0,
  );
  const openingCdfFromOps = cashOperationsBeforeStart.reduce(
    (sum: number, operation: { direction: string; amount: number; currency?: string }) => {
      const currency = normalizeMoneyCurrency(operation.currency);
      if (currency !== "CDF") return sum;
      return sum + (operation.direction === "INFLOW" ? operation.amount : -operation.amount);
    },
    0,
  );
  const openingUsd = openingUsdFromTicketPayments + openingUsdFromOps;
  const openingCdf = openingCdfFromTicketPayments + openingCdfFromOps;

  const ticketPaymentInflowsUsd = cashPayments.reduce(
    (sum: number, payment: { amount: number; currency?: string; amountUsd?: number; amountCdf?: number; fxRateToUsd?: number; fxRateUsdToCdf?: number }) => sum + normalizeCashAmountUsd(payment),
    0,
  );
  const ticketPaymentInflowUsd = cashPayments
    .filter((payment: { currency?: string | null; ticket?: { currency?: string | null } }) => normalizeMoneyCurrency(payment.currency ?? payment.ticket?.currency) === "USD")
    .reduce((sum: number, payment: { amount: number }) => sum + payment.amount, 0);
  const ticketPaymentInflowCdf = cashPayments
    .filter((payment: { currency?: string | null; ticket?: { currency?: string | null } }) => normalizeMoneyCurrency(payment.currency ?? payment.ticket?.currency) === "CDF")
    .reduce((sum: number, payment: { amount: number }) => sum + payment.amount, 0);

  const otherInflows = cashOperations
    .filter((operation: { direction: string }) => operation.direction === "INFLOW")
    .reduce((sum: number, operation: { amount: number; currency?: string; amountUsd?: number; fxRateToUsd?: number; fxRateUsdToCdf?: number }) => sum + normalizeCashAmountUsd(operation), 0);
  const cashOutflows = cashOperations
    .filter((operation: { direction: string }) => operation.direction === "OUTFLOW")
    .reduce((sum: number, operation: { amount: number; currency?: string; amountUsd?: number; fxRateToUsd?: number; fxRateUsdToCdf?: number }) => sum + normalizeCashAmountUsd(operation), 0);

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

  const cashInflowUsd = cashOperations
    .filter((operation: { direction: string; currency?: string }) => operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "USD")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);
  const cashOutflowUsd = cashOperations
    .filter((operation: { direction: string; currency?: string }) => operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "USD")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);
  const cashInflowCdf = cashOperations
    .filter((operation: { direction: string; currency?: string }) => operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);
  const cashOutflowCdf = cashOperations
    .filter((operation: { direction: string; currency?: string }) => operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);

  const closingUsd = openingUsd + ticketPaymentInflowUsd + cashInflowUsd - cashOutflowUsd;
  const closingCdf = openingCdf + ticketPaymentInflowCdf + cashInflowCdf - cashOutflowCdf;

  const caisseRows = [
    ...cashPayments.map((payment) => {
      const currency = normalizeMoneyCurrency(payment.currency ?? payment.ticket.currency);
      return {
        occurredAt: new Date(payment.paidAt),
        typeOperation: "Entrée en caisse",
        libelle: `Paiement billet ${payment.ticket.ticketNumber} - ${payment.ticket.customerName}`,
        reference: payment.reference ?? "-",
        usdIn: currency === "USD" ? payment.amount : 0,
        usdOut: 0,
        cdfIn: currency === "CDF" ? payment.amount : 0,
        cdfOut: 0,
      };
    }),
    ...cashOperations.map((operation: any) => {
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
      };
    }),
  ].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  let runningUsd = openingUsd;
  let runningCdf = openingCdf;
  const caisseLedger = caisseRows.map((row) => {
    runningUsd += row.usdIn - row.usdOut;
    runningCdf += row.cdfIn - row.cdfOut;
    return {
      ...row,
      usdBalance: runningUsd,
      cdfBalance: runningCdf,
    };
  });

  const initialVirtualStats = Object.fromEntries(
    virtualChannels.map(({ key }) => [
      key,
      {
        openingUsd: 0,
        openingCdf: 0,
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

  for (const payment of ticketPaymentsBeforeStart as Array<{ amount: number; method?: string; currency?: string }>) {
    const channel = detectVirtualChannel(payment.method);
    if (!channel) continue;
    const currency = normalizeMoneyCurrency(payment.currency);
    if (currency === "USD") {
      initialVirtualStats[channel].openingUsd += payment.amount;
    } else {
      initialVirtualStats[channel].openingCdf += payment.amount;
    }
  }

  for (const operation of cashOperationsBeforeStart as Array<{ direction: string; amount: number; method?: string; currency?: string }>) {
    const channel = detectVirtualChannel(operation.method);
    if (!channel) continue;
    const currency = (operation.currency ?? "USD").toUpperCase();
    if (currency === "USD") {
      initialVirtualStats[channel].openingUsd += operation.direction === "INFLOW" ? operation.amount : -operation.amount;
    } else if (currency === "CDF") {
      initialVirtualStats[channel].openingCdf += operation.direction === "INFLOW" ? operation.amount : -operation.amount;
    }
  }

  for (const payment of cashPayments as Array<{ amount: number; method?: string; currency?: string }>) {
    const channel = detectVirtualChannel(payment.method);
    if (!channel) continue;
    const currency = normalizeMoneyCurrency(payment.currency);
    if (currency === "USD") {
      initialVirtualStats[channel].inUsd += payment.amount;
    } else {
      initialVirtualStats[channel].inCdf += payment.amount;
    }
  }

  for (const operation of cashOperations as Array<{ direction: string; amount: number; method?: string; currency?: string }>) {
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

  const paymentTickets = ticketsWithComputedStatus
    .filter((ticket) => ticket.computedStatus !== PaymentStatus.PAID)
    .map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      customerName: ticket.customerName,
      amount: ticket.amount,
      paidAmount: ticket.paidAmount,
      paymentStatus: ticket.computedStatus,
      currency: ticket.currency,
      invoiceNumber: ticket.invoiceNumber,
    }));

  const pendingNeedTotals = pendingNeeds.reduce(
    (sum, need) => {
      const amount = typeof need.estimatedAmount === "number" ? need.estimatedAmount : 0;
      const currency = normalizeMoneyCurrency(need.currency);
      if (currency === "USD") sum.usd += amount;
      else sum.cdf += amount;
      return sum;
    },
    { usd: 0, cdf: 0 },
  );
  const pendingPaymentOrderTotals = paymentOrders.reduce(
    (sum, order) => {
      const currency = normalizeMoneyCurrency(order.currency);
      if (currency === "USD") sum.usd += order.amount;
      else sum.cdf += order.amount;
      return sum;
    },
    { usd: 0, cdf: 0 },
  );

  return (
    <AppShell
      role={role}
      accessNote="Vue financière: suivi des encaissements, des soldes clients et des créances à recouvrer."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Paiements</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Pilotage financier des billets vendus et des paiements reçus (USD / CDF).</p>
      </section>

      <PaymentsWritingWorkspace
        closedSummary={(
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
              <KpiCard label="Taux d'encaissement" value={`${collectionRate.toFixed(1)}%`} hint={`Partiels couverts à ${partialCoverageRate.toFixed(1)}%`} />
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
                Profil en lecture seule sur les écritures billets. Vous pouvez consulter les indicateurs et l'historique.
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
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-4 py-3">{new Date(payment.paidAt).toLocaleDateString("fr-FR")}</td>
                        <td className="px-4 py-3 font-medium">{payment.ticket.ticketNumber}</td>
                        <td className="px-4 py-3">{payment.ticket.customerName}</td>
                        <td className="px-4 py-3">{payment.amount.toFixed(2)} {normalizeMoneyCurrency(payment.currency ?? payment.ticket.currency)}</td>
                        <td className="px-4 py-3">{payment.method}</td>
                        <td className="px-4 py-3">{payment.reference ?? "-"}</td>
                        <td className="px-4 py-3">{payment.ticket.paymentStatus}</td>
                      </tr>
                    ))}
                    {payments.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
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
              <CashOperationForm />
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
                      <th className="px-4 py-3 text-left font-semibold">Type d'opération</th>
                      <th className="px-4 py-3 text-left font-semibold">Libellé</th>
                      <th className="px-4 py-3 text-left font-semibold">USD Entrées</th>
                      <th className="px-4 py-3 text-left font-semibold">USD Sorties</th>
                      <th className="px-4 py-3 text-left font-semibold">USD Solde</th>
                      <th className="px-4 py-3 text-left font-semibold">CDF Entrées</th>
                      <th className="px-4 py-3 text-left font-semibold">CDF Sorties</th>
                      <th className="px-4 py-3 text-left font-semibold">CDF Solde</th>
                      <th className="px-4 py-3 text-left font-semibold">Référence</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-black/5 bg-black/2 dark:border-white/10 dark:bg-white/3">
                      <td className="px-4 py-3 font-semibold">{cashRange.startRaw}</td>
                      <td className="px-4 py-3 font-semibold">Report à nouveau</td>
                      <td className="px-4 py-3 text-black/60 dark:text-white/60">Solde d'ouverture période</td>
                      <td className="px-4 py-3">-</td>
                      <td className="px-4 py-3">-</td>
                      <td className="px-4 py-3 font-semibold">{openingUsd.toFixed(2)} USD</td>
                      <td className="px-4 py-3">-</td>
                      <td className="px-4 py-3">-</td>
                      <td className="px-4 py-3 font-semibold">{openingCdf.toFixed(2)} CDF</td>
                      <td className="px-4 py-3">-</td>
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
                      </tr>
                    ))}
                    {caisseLedger.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
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
                Conformément à la feuille VIRTUEL, suivi des canaux Airtel Money, Orange Money, M-Pesa et Equity avec soldes par devise.
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
        billetageWorkspace={(
          <CashBilletageWorkspace expectedUsd={closingUsd} expectedCdf={closingCdf} />
        )}
        needsPendingWorkspace={(
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Besoins en attente" value={`${pendingNeeds.length}`} />
              <KpiCard label="Montant estimé CDF" value={`${pendingNeedTotals.cdf.toFixed(2)} CDF`} hint={`USD ${pendingNeedTotals.usd.toFixed(2)}`} />
            </div>

            <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
                <h2 className="text-sm font-semibold">Etat des besoins en attente de validation</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/5 dark:bg-white/10">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Date</th>
                      <th className="px-4 py-3 text-left font-semibold">Code</th>
                      <th className="px-4 py-3 text-left font-semibold">Besoin</th>
                      <th className="px-4 py-3 text-left font-semibold">Demandeur</th>
                      <th className="px-4 py-3 text-left font-semibold">Montant estimé</th>
                      <th className="px-4 py-3 text-left font-semibold">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingNeeds.map((need: any) => (
                      <tr key={need.id} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-4 py-3">{new Date(need.submittedAt ?? need.createdAt).toLocaleDateString("fr-FR")}</td>
                        <td className="px-4 py-3 font-medium">{need.code ?? "-"}</td>
                        <td className="px-4 py-3">{need.title}</td>
                        <td className="px-4 py-3">{need.requester?.name ?? "-"}</td>
                        <td className="px-4 py-3">{typeof need.estimatedAmount === "number" ? `${need.estimatedAmount.toFixed(2)} ${normalizeMoneyCurrency(need.currency)}` : "-"}</td>
                        <td className="px-4 py-3">{need.status}</td>
                      </tr>
                    ))}
                    {pendingNeeds.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                          Aucun besoin en attente de validation.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
        ordersPendingWorkspace={(
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="OP en attente" value={`${paymentOrders.length}`} />
              <KpiCard label="Montant OP CDF" value={`${pendingPaymentOrderTotals.cdf.toFixed(2)} CDF`} hint={`USD ${pendingPaymentOrderTotals.usd.toFixed(2)}`} />
            </div>

            {role === "DIRECTEUR_GENERAL" ? (
              <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <h2 className="text-sm font-semibold">Ordres de paiement DG</h2>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60">La création d'OP se fait dans votre espace dédié.</p>
                <a
                  href="/dg/ordres-paiement"
                  className="mt-3 inline-flex rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Ouvrir l'espace DG OP
                </a>
              </section>
            ) : null}

            <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
                <h2 className="text-sm font-semibold">Ordres de paiement en attente de validation</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/5 dark:bg-white/10">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Créé le</th>
                      <th className="px-4 py-3 text-left font-semibold">Description</th>
                      <th className="px-4 py-3 text-left font-semibold">Montant</th>
                      <th className="px-4 py-3 text-left font-semibold">DG</th>
                      <th className="px-4 py-3 text-left font-semibold">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentOrders.map((order: any) => (
                      <tr key={order.id} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-4 py-3">{new Date(order.createdAt).toLocaleDateString("fr-FR")}</td>
                        <td className="px-4 py-3">{order.description}</td>
                        <td className="px-4 py-3">{order.amount.toFixed(2)} {normalizeMoneyCurrency(order.currency)}</td>
                        <td className="px-4 py-3">{order.issuedBy?.name ?? "-"}</td>
                        <td className="px-4 py-3">{order.status}</td>
                      </tr>
                    ))}
                    {paymentOrders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                          Aucun ordre de paiement en attente de validation.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      />
    </AppShell>
  );
}
