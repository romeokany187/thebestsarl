const KINSHASA_TZ = "Africa/Kinshasa";

/** Date métier YYYY-MM-DD (fuseau Kinshasa), identique SSR et client. */
export function kinshasaDateKey(reference = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KINSHASA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);
}

/** Valeur pour input type="datetime-local" (heure Kinshasa). */
export function kinshasaDateTimeInputValue(reference = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KINSHASA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(reference);

  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}`;
}

/** Format décimal stable (évite les écarts toLocaleString Node vs navigateur). */
export function formatFrDecimal(value: number, fractionDigits = 2) {
  if (!Number.isFinite(value)) return "0";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const fixed = absolute.toFixed(fractionDigits);
  const [integerPart, decimalPart] = fixed.split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
  if (fractionDigits <= 0 || decimalPart === undefined) return `${sign}${grouped}`;
  return `${sign}${grouped},${decimalPart}`;
}
