type TicketPricingInput = {
  amount: number;
  commissionAmount?: number | null;
  commissionRateUsed?: number | null;
  agencyMarkupAmount?: number | null;
  commissionModeApplied?: string | null;
  commissionCalculationStatus?: string | null;
  baseFareAmount?: number | null;
  commissionBaseAmount?: number | null;
  airline?: { code?: string | null } | null;
};

function round2(value: number) {
  return Number(value.toFixed(2));
}

function commissionAlreadyIncludesMarkup(ticket: TicketPricingInput) {
  const mode = (ticket.commissionModeApplied ?? "").trim().toUpperCase();
  if (mode === "AFTER_DEPOSIT") {
    return false;
  }

  if (mode === "SYSTEM_PLUS_MARKUP" || mode === "MARKUP_ONLY") {
    return true;
  }

  const airlineCode = (ticket.airline?.code ?? "").trim().toUpperCase();
  if (["ACG", "MGB", "FST"].includes(airlineCode)) {
    return false;
  }

  return true;
}

function shouldUseMarkupOnly(ticket: TicketPricingInput) {
  const status = (ticket.commissionCalculationStatus ?? "").trim().toUpperCase();
  const hasRealBaseFare = typeof ticket.baseFareAmount === "number"
    ? ticket.baseFareAmount > 0
    : null;
  const hasCommissionBase = typeof ticket.commissionBaseAmount === "number"
    ? ticket.commissionBaseAmount > 0
    : null;
  const mode = (ticket.commissionModeApplied ?? "").trim().toUpperCase();

  if (status === "ESTIMATED") {
    return true;
  }

  if (hasRealBaseFare === false && hasCommissionBase === false && mode !== "AFTER_DEPOSIT") {
    return true;
  }

  return false;
}

export function getTicketCommissionAmount(ticket: TicketPricingInput, overrideCommissionAmount?: number | null) {
  if (shouldUseMarkupOnly(ticket)) {
    return getTicketMarkupAmount(ticket);
  }

  if (typeof overrideCommissionAmount === "number") {
    return round2(Math.max(0, overrideCommissionAmount));
  }

  if (typeof ticket.commissionAmount === "number") {
    return round2(Math.max(0, ticket.commissionAmount));
  }

  const ratePercent = Math.max(0, ticket.commissionRateUsed ?? 0);
  return round2(Math.max(0, ticket.amount) * (ratePercent / 100));
}

export function getTicketMarkupAmount(ticket: TicketPricingInput) {
  return round2(Math.max(0, ticket.agencyMarkupAmount ?? 0));
}

export function getTicketBaseCommissionAmount(ticket: TicketPricingInput, overrideCommissionAmount?: number | null) {
  if (shouldUseMarkupOnly(ticket)) {
    return 0;
  }

  const totalCommission = getTicketCommissionAmount(ticket, overrideCommissionAmount);
  if (!commissionAlreadyIncludesMarkup(ticket)) {
    return totalCommission;
  }

  const markupAmount = getTicketMarkupAmount(ticket);
  return round2(Math.max(0, totalCommission - markupAmount));
}

export function getTicketTotalAmount(ticket: TicketPricingInput, overrideCommissionAmount?: number | null) {
  const markupAmount = getTicketMarkupAmount(ticket);
  const baseCommissionAmount = getTicketBaseCommissionAmount(ticket, overrideCommissionAmount);
  return round2(Math.max(0, ticket.amount) + baseCommissionAmount + markupAmount);
}
