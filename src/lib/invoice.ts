function normalizeTeamCode(teamName: string | null | undefined) {
  const normalized = (teamName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!normalized) return "GEN";
  return normalized.slice(0, 3).padEnd(3, "X");
}

export type InvoiceChronologyTicket = {
  id: string;
  createdAt: Date | string;
};

export function buildInvoiceSequenceByTicketId(tickets: InvoiceChronologyTicket[]) {
  const sorted = tickets
    .slice()
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.id.localeCompare(right.id);
    });

  const sequenceByTicketId = new Map<string, number>();
  const countersByYear = new Map<number, number>();

  for (const ticket of sorted) {
    const year = new Date(ticket.createdAt).getUTCFullYear();
    const nextSequence = (countersByYear.get(year) ?? 0) + 1;
    countersByYear.set(year, nextSequence);
    sequenceByTicketId.set(ticket.id, nextSequence);
  }

  return sequenceByTicketId;
}

export function invoiceNumberFromChronology(params: {
  soldAt: Date;
  sellerTeamName?: string | null;
  sequence: number;
}) {
  const year = params.soldAt.getUTCFullYear();
  const teamCode = normalizeTeamCode(params.sellerTeamName);
  const sequencePart = String(Math.max(1, params.sequence)).padStart(4, "0");
  return `FAC-TB-${teamCode}-${sequencePart}-${year}`;
}

export function invoiceFileName(invoiceNumber: string) {
  return `${invoiceNumber}.pdf`;
}
