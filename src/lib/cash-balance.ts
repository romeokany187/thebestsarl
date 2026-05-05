import { buildDeskScopedCashOperationWhere, normalizeCashDeskValue, type CashDeskValue } from "@/lib/payments-desk";

function normalizeCashCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  if (normalized === "USD") return "USD";
  if (normalized === "CDF" || normalized === "XAF" || normalized === "FC") return "CDF";
  return "USD";
}

function amountToUsd(amount: number, currency: string, fxRateUsdToCdf: number) {
  if (normalizeCashCurrency(currency) === "USD") return amount;
  return amount / fxRateUsdToCdf;
}

export async function getCashDeskAvailableBalances(params: {
  client: any;
  occurredAt: Date;
  cashDesk: string;
  fxRateUsdToCdf: number;
}) {
  const normalizedCashDesk = normalizeCashDeskValue(params.cashDesk) ?? "THE_BEST";
  const scopedCashOperationsWhere = buildDeskScopedCashOperationWhere(normalizedCashDesk as CashDeskValue, { strict: true });

  const ticketInflows = await params.client.payment.aggregate({
    where: {
      paidAt: { lte: params.occurredAt },
      ...(normalizedCashDesk === "THE_BEST" ? {} : { id: "__NO_TICKET_PAYMENTS_FOR_DESK__" }),
    },
    _sum: { amount: true },
  });

  const previousCashOperations = await (params.client as unknown as { cashOperation: any }).cashOperation.findMany({
    where: {
      occurredAt: { lte: params.occurredAt },
      ...scopedCashOperationsWhere,
    },
    select: {
      direction: true,
      amount: true,
      currency: true,
      amountUsd: true,
      fxRateUsdToCdf: true,
    },
    take: 100000,
  });

  const cashSignedUsd = previousCashOperations.reduce(
    (sum: number, op: { direction: string; amount: number; currency?: string; amountUsd?: number | null; fxRateUsdToCdf?: number | null }) => {
      const opCurrency = normalizeCashCurrency(op.currency);
      const opAmountUsd = typeof op.amountUsd === "number"
        ? op.amountUsd
        : amountToUsd(op.amount, opCurrency, op.fxRateUsdToCdf ?? params.fxRateUsdToCdf);
      return sum + (op.direction === "INFLOW" ? opAmountUsd : -opAmountUsd);
    },
    0,
  );

  const signedUsdFromOps = previousCashOperations.reduce(
    (sum: number, op: { direction: string; amount: number; currency?: string }) => {
      if (normalizeCashCurrency(op.currency) !== "USD") return sum;
      return sum + (op.direction === "INFLOW" ? op.amount : -op.amount);
    },
    0,
  );

  const signedCdfFromOps = previousCashOperations.reduce(
    (sum: number, op: { direction: string; amount: number; currency?: string }) => {
      if (normalizeCashCurrency(op.currency) !== "CDF") return sum;
      return sum + (op.direction === "INFLOW" ? op.amount : -op.amount);
    },
    0,
  );

  const ticketUsd = ticketInflows._sum.amount ?? 0;

  return {
    cashDesk: normalizedCashDesk,
    availableBalanceUsd: ticketUsd + cashSignedUsd,
    availableUsd: ticketUsd + signedUsdFromOps,
    availableCdf: signedCdfFromOps,
  };
}
