import { CommissionCalculationStatus, CommissionMode } from "@prisma/client";
import { computeCommissionAmount } from "@/lib/commission";

type CommissionRuleInput = Parameters<typeof computeCommissionAmount>[1];

export function airlineRequiresBaseFareForCommission(airlineCode: string) {
  const code = airlineCode.trim().toUpperCase();
  return code === "ACG" || code === "ET";
}

export function airlineUsesBaseFarePercentCommission(airlineCode: string) {
  const code = airlineCode.trim().toUpperCase();
  return code === "ACG" || code === "ET";
}

export type ResolveTicketCommissionInput = {
  airlineCode: string;
  ticketAmount: number;
  baseFareAmount?: number | null;
  agencyMarkupAmount: number;
  rule: CommissionRuleInput | null;
  consumedBeforeForAfterDeposit?: number;
  airFastSaleOrder?: number;
  /** Import Excel : commission déjà lue dans le fichier (hors ACG/ET). */
  commissionAmountFromFile?: number | null;
  commissionRateFromFile?: number | null;
};

export type ResolvedTicketCommission = {
  baseFareAmount: number | null;
  commissionBaseAmount: number;
  commissionAmount: number;
  commissionRateUsed: number;
  commissionModeApplied: CommissionMode;
  commissionCalculationStatus: CommissionCalculationStatus;
};

function normalizedBaseFare(value?: number | null) {
  return typeof value === "number" && value > 0 ? value : null;
}

export function resolveTicketCommissionOnSale(input: ResolveTicketCommissionInput): ResolvedTicketCommission {
  const code = input.airlineCode.trim().toUpperCase();
  const markup = Math.max(0, input.agencyMarkupAmount ?? 0);
  const baseFare = normalizedBaseFare(input.baseFareAmount);
  const rule = input.rule;
  const isAfterDeposit = rule?.commissionMode === CommissionMode.AFTER_DEPOSIT;
  const isCaa = code === "CAA";
  const isAirCongo = code === "ACG";
  const isEthiopian = code === "ET";
  const isAirFast = code === "FST";

  if (isCaa && isAfterDeposit) {
    return {
      baseFareAmount: baseFare,
      commissionBaseAmount: input.ticketAmount,
      commissionAmount: 0,
      commissionRateUsed: 0,
      commissionModeApplied: CommissionMode.AFTER_DEPOSIT,
      commissionCalculationStatus: CommissionCalculationStatus.FINAL,
    };
  }

  if (isAfterDeposit && rule) {
    const consumedBefore = input.consumedBeforeForAfterDeposit ?? 0;
    const computed = computeCommissionAmount(input.ticketAmount, { ...rule, depositStockConsumedAmount: consumedBefore }, 0);
    return {
      baseFareAmount: baseFare,
      commissionBaseAmount: input.ticketAmount,
      commissionAmount: computed.amount + markup,
      commissionRateUsed: computed.ratePercent,
      commissionModeApplied: CommissionMode.AFTER_DEPOSIT,
      commissionCalculationStatus: CommissionCalculationStatus.FINAL,
    };
  }

  if (isAirFast) {
    const order = input.airFastSaleOrder ?? 1;
    const freeTicket = order % 13 === 0;
    const baseAmount = freeTicket ? input.ticketAmount : 0;
    return {
      baseFareAmount: baseFare,
      commissionBaseAmount: 0,
      commissionAmount: baseAmount + markup,
      commissionRateUsed: freeTicket ? 100 : 0,
      commissionModeApplied: CommissionMode.IMMEDIATE,
      commissionCalculationStatus: CommissionCalculationStatus.FINAL,
    };
  }

  if (isAirCongo) {
    const commissionBase = baseFare ?? 0;
    const baseCommission = commissionBase * 0.05;
    return {
      baseFareAmount: baseFare,
      commissionBaseAmount: commissionBase,
      commissionAmount: baseCommission + markup,
      commissionRateUsed: 5,
      commissionModeApplied: CommissionMode.IMMEDIATE,
      commissionCalculationStatus: CommissionCalculationStatus.FINAL,
    };
  }

  if (isEthiopian && rule) {
    const commissionBase = baseFare ?? 0;
    const computed = computeCommissionAmount(commissionBase, rule, 0);
    return {
      baseFareAmount: baseFare,
      commissionBaseAmount: commissionBase,
      commissionAmount: computed.amount + markup,
      commissionRateUsed: computed.ratePercent,
      commissionModeApplied: computed.modeApplied,
      commissionCalculationStatus: CommissionCalculationStatus.FINAL,
    };
  }

  const fromFile = typeof input.commissionAmountFromFile === "number" && input.commissionAmountFromFile > 0
    ? input.commissionAmountFromFile
    : null;
  const commissionAmount = fromFile ?? markup;
  const commissionRateUsed = input.commissionRateFromFile
    ?? (fromFile && input.ticketAmount > 0 ? (fromFile / input.ticketAmount) * 100 : 0);

  return {
    baseFareAmount: baseFare,
    commissionBaseAmount: 0,
    commissionAmount,
    commissionRateUsed,
    commissionModeApplied: rule?.commissionMode ?? CommissionMode.MARKUP_ONLY,
    commissionCalculationStatus: CommissionCalculationStatus.FINAL,
  };
}
