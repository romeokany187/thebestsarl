export function monthRangeFromValue(rawMonth?: string) {
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
  };
}

export function monthLabelFromKey(monthKey: string) {
  const [yearPart, monthPart] = monthKey.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(yearPart, monthPart - 1, 1));
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}
