import { PaymentStatus } from "@prisma/client";
import { getTicketTotalAmount } from "@/lib/ticket-pricing";

export type TicketPaymentRowLike = {
  amount: number;
  currency?: string | null;
  amountUsd?: number | null;
  amountCdf?: number | null;
  fxRateUsdToCdf?: number | null;
  fxRateToUsd?: number | null;
};

export type TicketSaleForBalance = {
  id: string;
  ticketNumber: string;
  customerName: string;
  payerName?: string | null;
  soldAt: Date;
  currency?: string | null;
  amount: number;
  baseFareAmount?: number | null;
  commissionAmount?: number | null;
  commissionRateUsed?: number | null;
  agencyMarkupAmount?: number | null;
  commissionBaseAmount?: number | null;
  commissionCalculationStatus?: string | null;
  commissionModeApplied?: string | null;
  payments: TicketPaymentRowLike[];
  seller?: { name?: string | null; team?: { name?: string | null } | null } | null;
  sellerName?: string | null;
};

export function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  return normalized === "CDF" || normalized === "XAF" || normalized === "FC" ? "CDF" : "USD";
}

export function normalizeAmountUsd(entry: TicketPaymentRowLike): number {
  if (typeof entry.amountUsd === "number") return entry.amountUsd;
  const currency = normalizeMoneyCurrency(entry.currency);
  if (currency === "USD") return entry.amount;
  const rate = entry.fxRateUsdToCdf ?? (entry.fxRateToUsd && entry.fxRateToUsd > 0 ? 1 / entry.fxRateToUsd : 2800);
  return entry.amount / rate;
}

function normalizeAmountCdf(entry: TicketPaymentRowLike): number {
  if (typeof entry.amountCdf === "number") return entry.amountCdf;
  const currency = normalizeMoneyCurrency(entry.currency);
  if (currency === "CDF") return entry.amount;
  const rate = entry.fxRateUsdToCdf ?? (entry.fxRateToUsd && entry.fxRateToUsd > 0 ? 1 / entry.fxRateToUsd : 2800);
  return entry.amount * rate;
}

/** Montant encaissé converti dans la devise du billet (source : lignes Payment saisies en caisse). */
export function normalizePaymentAmountForTicket(
  payment: TicketPaymentRowLike,
  ticketCurrencyRaw: string | null | undefined,
): number {
  const ticketCurrency = normalizeMoneyCurrency(ticketCurrencyRaw);
  const paymentCurrency = normalizeMoneyCurrency(payment.currency ?? ticketCurrencyRaw);
  if (ticketCurrency === paymentCurrency) return payment.amount;
  return ticketCurrency === "USD" ? normalizeAmountUsd(payment) : normalizeAmountCdf(payment);
}

export function computeTicketPaymentStatus(totalDue: number, totalPaid: number): PaymentStatus {
  if (totalPaid <= 0) return PaymentStatus.UNPAID;
  if (totalPaid + 0.0001 >= totalDue) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}

export type TicketReceivableBalance = {
  id: string;
  ticketNumber: string;
  customerName: string;
  payerName: string | null;
  soldAt: Date;
  currency: string;
  totalTicketAmount: number;
  paidAmount: number;
  paidAmountUsd: number;
  amountUsd: number;
  remainingAmount: number;
  remainingUsd: number;
  computedStatus: PaymentStatus;
  sellerName: string | null;
};

/** Statut payé / impayé / partiel dérivé uniquement des encaissements caisse (table Payment). */
export function buildTicketReceivableBalance(ticket: TicketSaleForBalance): TicketReceivableBalance {
  const paidAmount = ticket.payments.reduce(
    (sum, payment) => sum + normalizePaymentAmountForTicket(payment, ticket.currency),
    0,
  );
  const paidAmountUsd = ticket.payments.reduce((sum, payment) => sum + normalizeAmountUsd(payment), 0);
  const totalTicketAmount = getTicketTotalAmount(ticket);
  const amountUsd = normalizeAmountUsd({ amount: totalTicketAmount, currency: ticket.currency });
  const computedStatus = computeTicketPaymentStatus(totalTicketAmount, paidAmount);
  const remainingAmount = Math.max(0, totalTicketAmount - paidAmount);
  const remainingUsd = Math.max(0, amountUsd - paidAmountUsd);

  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    customerName: ticket.customerName,
    payerName: ticket.payerName ?? null,
    soldAt: ticket.soldAt,
    currency: normalizeMoneyCurrency(ticket.currency),
    totalTicketAmount,
    paidAmount,
    paidAmountUsd,
    amountUsd,
    remainingAmount,
    remainingUsd,
    computedStatus,
    sellerName: ticket.sellerName ?? ticket.seller?.name ?? null,
  };
}
