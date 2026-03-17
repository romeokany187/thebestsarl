export type CaaTicketInput = {
  id: string;
  amount: number;
  soldAt: Date;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeCaaCommissionMap(params: {
  periodTicketIds: string[];
  orderedCaaTicketsUntilPeriodEnd: CaaTicketInput[];
  targetAmount: number;
  batchCommissionAmount: number;
}) {
  const map = new Map<string, number>();
  const periodIds = new Set(params.periodTicketIds);

  if (params.targetAmount <= 0 || params.batchCommissionAmount <= 0 || periodIds.size === 0) {
    return map;
  }

  let consumed = 0;
  const ordered = [...params.orderedCaaTicketsUntilPeriodEnd].sort((a, b) => {
    const soldAtDiff = a.soldAt.getTime() - b.soldAt.getTime();
    if (soldAtDiff !== 0) return soldAtDiff;
    return a.id.localeCompare(b.id);
  });

  for (const ticket of ordered) {
    const before = consumed;
    consumed += ticket.amount;

    if (!periodIds.has(ticket.id)) {
      continue;
    }

    const batchesBefore = Math.floor(before / params.targetAmount);
    const batchesAfter = Math.floor(consumed / params.targetAmount);
    const newBatches = Math.max(0, batchesAfter - batchesBefore);
    map.set(ticket.id, round2(newBatches * params.batchCommissionAmount));
  }

  return map;
}