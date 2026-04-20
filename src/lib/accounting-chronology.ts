type AccountingChronologyEntry = {
  id: string;
  entryDate: string | Date;
  createdAt?: string | Date | null;
};

function toTimestamp(value: string | Date | null | undefined) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function compareAccountingChronology(
  left: AccountingChronologyEntry,
  right: AccountingChronologyEntry,
) {
  const byEntryDate = toTimestamp(left.entryDate) - toTimestamp(right.entryDate);
  if (byEntryDate !== 0) return byEntryDate;

  const byCreatedAt = toTimestamp(left.createdAt) - toTimestamp(right.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;

  return left.id.localeCompare(right.id);
}

export function buildAccountingChronologySequenceMap(entries: AccountingChronologyEntry[]) {
  const sorted = [...entries].sort(compareAccountingChronology);
  return new Map(sorted.map((entry, index) => [entry.id, index + 1]));
}

export function applyAccountingChronologySequence<T extends { id: string; sequence: number }>(
  entries: T[],
  sequenceById: Map<string, number>,
) {
  return entries.map((entry) => ({
    ...entry,
    sequence: sequenceById.get(entry.id) ?? entry.sequence,
  }));
}