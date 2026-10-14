import { PaymentStatus } from "@prisma/client";
import type { TicketReceivableBalance } from "@/lib/ticket-payment-balance";

export type PayerRecoveryGroup = {
  payerKey: string;
  payerLabel: string;
  tickets: TicketReceivableBalance[];
  ticketCount: number;
  unpaidCount: number;
  partialCount: number;
  remainingUsd: number;
  oldestSoldAt: Date;
  sellerNames: string[];
};

const MISSING_PAYER_LABEL = "Payant non renseigné";

export function payerRecoveryKey(payerName: string | null | undefined) {
  const trimmed = (payerName ?? "").trim();
  return trimmed ? trimmed.toLowerCase() : "__missing_payer__";
}

export function payerRecoveryLabel(payerName: string | null | undefined) {
  const trimmed = (payerName ?? "").trim();
  return trimmed || MISSING_PAYER_LABEL;
}

export function groupOpenReceivablesByPayer(tickets: TicketReceivableBalance[]): PayerRecoveryGroup[] {
  const open = tickets.filter(
    (ticket) => ticket.computedStatus === PaymentStatus.UNPAID || ticket.computedStatus === PaymentStatus.PARTIAL,
  );

  const map = new Map<string, PayerRecoveryGroup>();

  for (const ticket of open) {
    const payerKey = payerRecoveryKey(ticket.payerName);
    const payerLabel = payerRecoveryLabel(ticket.payerName);
    const existing = map.get(payerKey) ?? {
      payerKey,
      payerLabel,
      tickets: [],
      ticketCount: 0,
      unpaidCount: 0,
      partialCount: 0,
      remainingUsd: 0,
      oldestSoldAt: ticket.soldAt,
      sellerNames: [],
    };

    existing.tickets.push(ticket);
    existing.ticketCount += 1;
    if (ticket.computedStatus === PaymentStatus.UNPAID) existing.unpaidCount += 1;
    if (ticket.computedStatus === PaymentStatus.PARTIAL) existing.partialCount += 1;
    existing.remainingUsd += ticket.remainingUsd;
    if (ticket.soldAt.getTime() < existing.oldestSoldAt.getTime()) {
      existing.oldestSoldAt = ticket.soldAt;
    }
    if (ticket.sellerName && !existing.sellerNames.includes(ticket.sellerName)) {
      existing.sellerNames.push(ticket.sellerName);
    }

    map.set(payerKey, existing);
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      tickets: group.tickets.sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime()),
    }))
    .sort((a, b) => b.remainingUsd - a.remainingUsd || a.oldestSoldAt.getTime() - b.oldestSoldAt.getTime());
}
