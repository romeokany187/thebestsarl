import { CommissionCalculationStatus, CommissionMode, PaymentStatus, Prisma, SaleNature, TravelClass } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import {
  buildAirlineDepositAccountSummaries,
  getAirlineDepositAccountByAirlineCode,
  recordAirlineDepositMovement,
} from "@/lib/airline-deposit";

type Row = Record<string, unknown>;

export type ImportPeriodMode = "DAY" | "MONTH" | "YEAR" | "CUSTOM";

export type TicketWorkbookImportOptions = {
  fileBuffer: Buffer;
  sheetName?: string;
  dryRun?: boolean;
  defaultSellerEmail?: string;
  year: number;
  month?: number;
  periodMode?: ImportPeriodMode;
  date?: string;
  startDate?: string;
  endDate?: string;
  replaceExistingPeriod?: boolean;
  includePreview?: boolean;
  maxPreviewRows?: number;
};

export type TicketWorkbookImportSummary = {
  sheetsProcessed: number;
  totalRows: number;
  skippedEmpty: number;
  skippedOutsideRange: number;
  created: number;
  updated: number;
  failed: number;
};

export type TicketWorkbookImportResult = {
  summary: TicketWorkbookImportSummary;
  errors: string[];
  range: { start: string; end: string };
  sheetNames: string[];
  previewRows: TicketWorkbookImportPreviewRow[];
  previewTruncated: boolean;
};

export type TicketWorkbookImportPreviewRow = {
  sheet: string;
  line: number;
  sourceTicketNumber: string | null;
  finalTicketNumber: string | null;
  customerName: string | null;
  sellerName: string | null;
  airlineName: string | null;
  route: string | null;
  amount: number | null;
  currency: string | null;
  soldAt: string | null;
  status: "READY" | "SKIPPED_EMPTY" | "SKIPPED_OUTSIDE_RANGE" | "ERROR";
  message: string | null;
};

export type TicketImportHistoryEntry = {
  id: string;
  createdAt: string;
  actorName: string;
  actorEmail: string;
  fileName: string | null;
  mode: "PREVIEW" | "IMPORT";
  periodMode: ImportPeriodMode | null;
  year: number | null;
  month: number | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  sheetName: string | null;
  replaceExistingPeriod: boolean;
  dryRun: boolean;
  createdCount: number;
  failedCount: number;
  totalRows: number;
};

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSheetLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function monthFromSheetLabel(value: string) {
  const normalized = normalizeSheetLabel(value);
  const entries: Array<{ month: number; tokens: string[] }> = [
    { month: 1, tokens: ["janvier", "janv", "january"] },
    { month: 2, tokens: ["fevrier", "fevr", "fev", "february", "feb"] },
    { month: 3, tokens: ["mars", "march"] },
    { month: 4, tokens: ["avril", "avr", "april", "apr"] },
    { month: 5, tokens: ["mai", "may"] },
    { month: 6, tokens: ["juin", "june", "jun"] },
    { month: 7, tokens: ["juillet", "juil", "july", "jul"] },
    { month: 8, tokens: ["aout", "august", "aug"] },
    { month: 9, tokens: ["septembre", "sept", "september", "sep"] },
    { month: 10, tokens: ["octobre", "oct", "october"] },
    { month: 11, tokens: ["novembre", "nov", "november"] },
    { month: 12, tokens: ["decembre", "dec", "december"] },
  ];

  for (const entry of entries) {
    if (entry.tokens.some((token) => normalized.includes(token))) {
      return entry.month;
    }
  }

  return null;
}

function isLikelyDailySheet(name: string) {
  const clean = name.trim();
  const normalized = normalizeSheetLabel(clean);

  if (/^\d{1,2}\s*[.,\/-]\s*\d{1,2}(?:\s*[.,\/-]\s*\d{2,4})?$/.test(clean)) return true;
  if (/^\d{4}$/.test(clean)) return true;
  if (monthFromSheetLabel(clean) !== null) return true;

  return /(journal|journalier|quotidien|daily|hebdo|hebdomadaire|semaine|weekly|rapport|report|vente|billet)/.test(normalized);
}

function parseSheetDateFromName(sheetName: string, year: number) {
  const clean = sheetName.trim();

  const dotted = clean.match(/^(\d{1,2})\s*[.,\/-]\s*(\d{1,2})(?:\s*[.,\/-]\s*(\d{2,4}))?$/);
  if (dotted) {
    const day = Number.parseInt(dotted[1], 10);
    const month = Number.parseInt(dotted[2], 10);
    const yearRaw = dotted[3] ? Number.parseInt(dotted[3], 10) : year;
    const resolvedYear = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(Date.UTC(resolvedYear, month - 1, day, 12, 0, 0, 0));
    }
  }

  const compact = clean.match(/^(\d{2})(\d{2})$/);
  if (compact) {
    const day = Number.parseInt(compact[1], 10);
    const month = Number.parseInt(compact[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    }
  }

  const textualMonth = monthFromSheetLabel(clean);
  if (textualMonth !== null) {
    const dayMatch = normalizeSheetLabel(clean).match(/(?:^|\D)([12]?\d|3[01])(?:er)?(?=\D|$)/);
    const yearMatch = clean.match(/\b(20\d{2})\b/);
    const resolvedDay = dayMatch ? Number.parseInt(dayMatch[1], 10) : 1;
    const resolvedYear = yearMatch ? Number.parseInt(yearMatch[1], 10) : year;
    return new Date(Date.UTC(resolvedYear, textualMonth - 1, resolvedDay, 12, 0, 0, 0));
  }

  const yearOnly = clean.match(/^\d{4}$/);
  if (yearOnly) {
    return new Date(Date.UTC(Number.parseInt(yearOnly[0], 10), 0, 1, 12, 0, 0, 0));
  }

  return null;
}

function pickValue(row: Row, headers: string[]) {
  const normalizedKeys = new Map<string, unknown>();
  Object.entries(row).forEach(([key, value]) => {
    normalizedKeys.set(normalizeHeader(key), value);
  });

  for (const header of headers) {
    const normalizedHeader = normalizeHeader(header);
    const found = normalizedKeys.get(normalizedHeader);
    if (found !== undefined && found !== null && String(found).trim() !== "") {
      return found;
    }

    if (normalizedHeader.length >= 3) {
      for (const [key, value] of normalizedKeys.entries()) {
        if (key.length < 3) continue;
        if ((key.includes(normalizedHeader) || normalizedHeader.includes(key)) && value !== undefined && value !== null && String(value).trim() !== "") {
          return value;
        }
      }
    }
  }

  return null;
}

function asString(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function isHeaderOrSummaryTicketValue(value: string | null) {
  const normalized = normalizeHeader(value ?? "");
  if (!normalized) return true;

  const blockedTokens = [
    "pnr",
    "codebillet",
    "codebilletpnr",
    "ticketnumber",
    "numerobillet",
    "numeroticket",
    "total",
    "soustotal",
    "rapport",
    "report",
    "resume",
    "recap",
    "grandtotal",
  ];

  if (!/\d/.test(normalized) && blockedTokens.some((token) => normalized === token || normalized.includes(token))) {
    return true;
  }

  const compact = value?.trim().toUpperCase() ?? "";
  if (compact.length < 4) return true;

  return false;
}

function findMonthLabelInRow(row: Row) {
  for (const value of Object.values(row)) {
    const text = asString(value);
    if (text && monthFromSheetLabel(text) !== null) {
      return text;
    }
  }
  return null;
}

function distributeWholeUnits(total: number, weights: number[]) {
  if (total <= 0 || weights.length === 0) return weights.map(() => 0);
  const positiveWeights = weights.map((weight) => (weight > 0 ? weight : 0));
  const sum = positiveWeights.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return positiveWeights.map((_value, index) => (index === 0 ? total : 0));

  const raw = positiveWeights.map((weight) => (weight / sum) * total);
  const base = raw.map((value) => Math.floor(value));
  let remaining = total - base.reduce((acc, value) => acc + value, 0);

  const ranked = raw
    .map((value, index) => ({ index, remainder: value - base[index] }))
    .sort((a, b) => b.remainder - a.remainder);

  for (const item of ranked) {
    if (remaining <= 0) break;
    base[item.index] += 1;
    remaining -= 1;
  }

  return base;
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.-]/g, "");
  const num = Number.parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

function excelSerialToDate(serial: number) {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) return null;
  return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
}

function asDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    return excelSerialToDate(value);
  }

  const text = String(value).trim();
  if (!text) return null;

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;

  const slash = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (slash) {
    const d = Number.parseInt(slash[1], 10);
    const m = Number.parseInt(slash[2], 10);
    const yRaw = Number.parseInt(slash[3], 10);
    const y = yRaw < 100 ? 2000 + yRaw : yRaw;
    return new Date(Date.UTC(y, m - 1, d));
  }

  return null;
}

function parseTravelClass(value: unknown): TravelClass {
  const text = (asString(value) ?? "ECONOMY").toUpperCase();
  if (["ECONOMY", "ECO", "Y"].includes(text)) return TravelClass.ECONOMY;
  if (["PREMIUM_ECONOMY", "PREMIUM", "PREMIUMECONOMY"].includes(text)) return TravelClass.PREMIUM_ECONOMY;
  if (["BUSINESS", "C", "J"].includes(text)) return TravelClass.BUSINESS;
  if (["FIRST", "F"].includes(text)) return TravelClass.FIRST;
  return TravelClass.ECONOMY;
}

function parseSaleNature(value: unknown): SaleNature {
  const text = (asString(value) ?? "CASH")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (["CREDIT", "A CREDIT", "CREDI", "CRED"].includes(text)) return SaleNature.CREDIT;
  return SaleNature.CASH;
}

function parsePaymentStatus(value: unknown): PaymentStatus {
  const text = (asString(value) ?? "UNPAID")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (["PAID", "PAYE", "PAYER", "PAYE(E)", "PAIE", "1"].includes(text)) return PaymentStatus.PAID;
  if (["PARTIAL", "PARTIEL", "PARTIELLEMENT PAYE", "PARTIALLY PAID"].includes(text)) return PaymentStatus.PARTIAL;
  if (["0", "NON PAYE", "IMPAYE", "UNPAID", "-"].includes(text)) return PaymentStatus.UNPAID;
  return PaymentStatus.UNPAID;
}

function looksLikeRouteValue(value: string | null) {
  const text = (value ?? "").trim().toUpperCase();
  return /[A-Z]{3}\s*[-~/]\s*[A-Z]{3}/.test(text);
}

function looksLikePnrValue(value: string | null) {
  const text = (value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{5,8}$/.test(text) && !looksLikeRouteValue(text);
}

function parseIsoDate(value: string) {
  const parsed = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parsed) {
    throw new Error("Date invalide. Format attendu: AAAA-MM-JJ.");
  }

  const year = Number.parseInt(parsed[1], 10);
  const month = Number.parseInt(parsed[2], 10);
  const day = Number.parseInt(parsed[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error("Date invalide. Format attendu: AAAA-MM-JJ.");
  }

  return date;
}

function withUtcDayEnd(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function capRangeEnd(end: Date) {
  const now = new Date();
  const todayEnd = withUtcDayEnd(now);
  return end < todayEnd ? end : todayEnd;
}

function finalizeRange(periodMode: ImportPeriodMode, start: Date, end: Date, anchorYear: number) {
  const cappedEnd = capRangeEnd(end);
  if (cappedEnd < start) {
    throw new Error("La période cible ne peut pas être entièrement dans le futur.");
  }

  return {
    periodMode,
    start,
    end: cappedEnd,
    anchorYear,
  };
}

function buildRange(options: Pick<TicketWorkbookImportOptions, "periodMode" | "year" | "month" | "date" | "startDate" | "endDate">) {
  const periodMode = options.periodMode ?? "MONTH";

  if (periodMode === "DAY") {
    if (!options.date) {
      throw new Error("Date requise pour une importation journalière.");
    }

    const start = parseIsoDate(options.date);
    return finalizeRange(periodMode, start, withUtcDayEnd(start), start.getUTCFullYear());
  }

  if (periodMode === "YEAR") {
    if (!options.year || options.year < 2000 || options.year > 2100) {
      throw new Error("Année invalide.");
    }

    const start = new Date(Date.UTC(options.year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(options.year, 11, 31, 23, 59, 59, 999));
    return finalizeRange(periodMode, start, end, options.year);
  }

  if (periodMode === "CUSTOM") {
    if (!options.startDate || !options.endDate) {
      throw new Error("Dates de début et de fin requises pour une plage personnalisée.");
    }

    const start = parseIsoDate(options.startDate);
    const end = withUtcDayEnd(parseIsoDate(options.endDate));
    if (end < start) {
      throw new Error("La date de fin doit être supérieure ou égale à la date de début.");
    }

    return finalizeRange(periodMode, start, end, start.getUTCFullYear());
  }

  if (!options.year || options.year < 2000 || options.year > 2100) {
    throw new Error("Année invalide.");
  }

  if (!options.month || options.month < 1 || options.month > 12) {
    throw new Error("Mois invalide.");
  }

  const start = new Date(Date.UTC(options.year, options.month - 1, 1, 0, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(options.year, options.month, 0, 23, 59, 59, 999));

  return finalizeRange(periodMode, start, endOfMonth, options.year);
}

function normalizePersonKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function isAirFastLike(airline: { code: string; name: string }) {
  const code = airline.code.trim().toUpperCase();
  const name = normalizeHeader(airline.name);
  return code === "FST" || name.includes("airfast") || name.includes("airfastcongo");
}

function makeAirlineCode(name: string, usedCodes: Set<string>) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 3) || "AIR";

  let code = base;
  let i = 1;
  while (usedCodes.has(code)) {
    code = `${base.slice(0, 2)}${i}`.slice(0, 3);
    i += 1;
  }
  usedCodes.add(code);
  return code;
}

const airlineAliases = [
  { canonicalCode: "ACG", canonicalName: "Air Congo", codeAliases: ["ACG", "AIR"], nameAliases: ["aircongo", "aircongosa", "aircingo", "airconggo", "aircinggo"] },
  { canonicalCode: "CAA", canonicalName: "CAA", codeAliases: ["CAA"], nameAliases: ["caa"] },
  { canonicalCode: "FST", canonicalName: "Air Fast", codeAliases: ["FST"], nameAliases: ["airfast", "airfastcongo"] },
  { canonicalCode: "ET", canonicalName: "Ethiopian Airlines", codeAliases: ["ET", "ETH", "ETI"], nameAliases: ["ethiopian", "ethiopianairlines", "ethipian"] },
  { canonicalCode: "KQ", canonicalName: "Kenya Airways", codeAliases: ["KQ", "KEN"], nameAliases: ["kenya", "kenyaairways", "kenyta"] },
  { canonicalCode: "MGB", canonicalName: "Mont Gabaon", codeAliases: ["MGB", "MG"], nameAliases: ["montgabaon", "montgabon"] },
  { canonicalCode: "WB", canonicalName: "RwandAir", codeAliases: ["WB"], nameAliases: ["rwandair", "rwandaair"] },
  { canonicalCode: "UR", canonicalName: "Uganda Airlines", codeAliases: ["UR", "UGA"], nameAliases: ["ugandaair", "ugandaairlines", "ugandair"] },
  { canonicalCode: "TC", canonicalName: "Air Tanzania", codeAliases: ["TC", "TAN"], nameAliases: ["airtanzania", "tanzania", "tanzanie"] },
  { canonicalCode: "DKT", canonicalName: "Dakota", codeAliases: ["DKT", "DAK"], nameAliases: ["dakota"] },
] as const;

function normalizeAirlineCode(value: string | null | undefined) {
  const cleaned = (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return null;
  const alias = airlineAliases.find((candidate) => candidate.codeAliases.includes(cleaned as never));
  return alias?.canonicalCode ?? cleaned;
}

function normalizeLookupKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactLookupKey(value: string) {
  return normalizeLookupKey(value).replace(/\s+/g, "");
}

function scoreApproximateLookup(input: string, candidate: string) {
  if (!input || !candidate) return 0;
  if (input === candidate) return 100;

  const compactInput = compactLookupKey(input);
  const compactCandidate = compactLookupKey(candidate);
  if (compactInput && compactCandidate && compactInput === compactCandidate) return 96;
  if (compactInput && compactCandidate && (compactCandidate.includes(compactInput) || compactInput.includes(compactCandidate))) return 84;

  const inputTokens = Array.from(new Set(normalizeLookupKey(input).split(" ").filter(Boolean)));
  const candidateTokens = Array.from(new Set(normalizeLookupKey(candidate).split(" ").filter(Boolean)));
  if (inputTokens.length === 0 || candidateTokens.length === 0) return 0;

  const shared = inputTokens.filter((token) => candidateTokens.includes(token)).length;
  const maxLen = Math.max(inputTokens.length, candidateTokens.length);
  if (shared === 0) return 0;

  return Math.round((shared / maxLen) * 80);
}

function findClosestMapValue<T>(raw: string | null | undefined, entries: Iterable<[string, T]>, minScore = 70) {
  const source = raw?.trim();
  if (!source) return null;

  let bestScore = 0;
  let bestValue: T | null = null;
  let ambiguous = false;

  for (const [key, value] of entries) {
    const score = scoreApproximateLookup(source, key);
    if (score > bestScore) {
      bestScore = score;
      bestValue = value;
      ambiguous = false;
    } else if (score === bestScore && score >= minScore && bestValue !== value) {
      ambiguous = true;
    }
  }

  if (!bestValue || bestScore < minScore || ambiguous) {
    return null;
  }

  return bestValue;
}

function resolveAirlineIdentity(codeRaw: string | null | undefined, nameRaw: string | null | undefined) {
  const normalizedName = compactLookupKey(nameRaw ?? "");
  const normalizedCode = normalizeAirlineCode(codeRaw);
  const alias = airlineAliases.find((candidate) => {
    if (normalizedCode && candidate.codeAliases.includes(normalizedCode as never)) {
      return true;
    }
    return normalizedName
      ? candidate.nameAliases.some((entry) => normalizedName.includes(entry) || entry.includes(normalizedName))
      : false;
  });

  const canonicalCode = alias?.canonicalCode ?? normalizedCode;
  const canonicalName = alias?.canonicalName ?? (nameRaw?.trim().replace(/\s+/g, " ") || "Compagnie inconnue");
  const lookupKeys = new Set<string>([
    normalizeLookupKey(canonicalName),
    compactLookupKey(canonicalName),
    normalizeLookupKey(nameRaw ?? ""),
    compactLookupKey(nameRaw ?? ""),
    canonicalCode?.toLowerCase() ?? "",
  ]);

  alias?.nameAliases.forEach((entry) => lookupKeys.add(entry));

  return {
    canonicalCode,
    canonicalName,
    lookupKeys: Array.from(lookupKeys).filter(Boolean),
  };
}

function registerAirlineLookups<T extends { code: string; name: string }>(
  airlineByCode: Map<string, T>,
  airlineByName: Map<string, T>,
  airline: T,
) {
  const normalizedCode = normalizeAirlineCode(airline.code);
  if (normalizedCode) {
    airlineByCode.set(normalizedCode, airline);
  }
  const rawCode = airline.code.trim().toUpperCase();
  if (rawCode) {
    airlineByCode.set(rawCode, airline);
  }

  const identity = resolveAirlineIdentity(airline.code, airline.name);
  identity.lookupKeys.forEach((key) => {
    airlineByName.set(key, airline);
  });
}

function addLookupCandidate(candidates: Set<string>, value: string) {
  const normalized = normalizeLookupKey(value);
  if (normalized) {
    candidates.add(normalized);
  }
}

function buildTeamLookupCandidates(teamName: string) {
  const candidates = new Set<string>();
  addLookupCandidate(candidates, teamName);
  addLookupCandidate(candidates, teamName.replace(/^agence\s+de\s+/i, ""));
  addLookupCandidate(candidates, teamName.replace(/^equipe\s*[-:]?\s*/i, ""));

  const compact = compactLookupKey(teamName);
  if (compact.includes("kinshasa")) addLookupCandidate(candidates, "Kinshasa");
  if (compact.includes("lubumbashi")) addLookupCandidate(candidates, "Lubumbashi");
  if (compact.includes("mbujimayi") || compact.includes("mbujimai")) addLookupCandidate(candidates, "Mbujimayi");
  if (compact.includes("hkservice")) addLookupCandidate(candidates, "HKSERVICE");

  return Array.from(candidates);
}

function resolveImportedPayerName(
  value: string | null,
  lookups: {
    usersByKey: Map<string, string>;
    teamsByKey: Map<string, string>;
    userKeys: string[];
    teamKeys: string[];
  },
) {
  const raw = value?.trim();
  if (!raw) return null;

  const normalized = normalizeLookupKey(raw);
  const compact = compactLookupKey(raw);
  const stripped = normalizeLookupKey(raw.replace(/^(agent|employe|employe e|employe\(e\)|equipe|team|agence|client)\s*[-:]?\s*/i, ""));
  const lookupKeys = Array.from(new Set([normalized, compact, stripped, compactLookupKey(stripped)]).values()).filter(Boolean);

  for (const key of lookupKeys) {
    const matchedTeam = lookups.teamsByKey.get(key);
    if (matchedTeam) {
      return `Équipe - ${matchedTeam}`;
    }
    const matchedUser = lookups.usersByKey.get(key);
    if (matchedUser) {
      return `Agent - ${matchedUser}`;
    }
  }

  const partialTeamMatches = lookups.teamKeys.filter((key) => key.includes(compact) || compact.includes(key));
  if (partialTeamMatches.length === 1) {
    const matchedTeam = lookups.teamsByKey.get(partialTeamMatches[0]);
    if (matchedTeam) return `Équipe - ${matchedTeam}`;
  }

  const partialUserMatches = lookups.userKeys.filter((key) => key.includes(compact) || compact.includes(key));
  if (partialUserMatches.length === 1) {
    const matchedUser = lookups.usersByKey.get(partialUserMatches[0]);
    if (matchedUser) return `Agent - ${matchedUser}`;
  }

  const fuzzyTeam = findClosestMapValue(raw, lookups.teamsByKey.entries(), 72);
  if (fuzzyTeam) {
    return `Équipe - ${fuzzyTeam}`;
  }

  const fuzzyUser = findClosestMapValue(raw, lookups.usersByKey.entries(), 72);
  if (fuzzyUser) {
    return `Agent - ${fuzzyUser}`;
  }

  return raw;
}

function sheetContainsDetailedTicketHeader(sheet: XLSX.WorkSheet) {
  const matrix = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, { header: 1, raw: true, defval: null });
  for (let i = 0; i < Math.min(matrix.length, 250); i += 1) {
    const row = matrix[i] ?? [];
    const normalized = row.map((cell) => normalizeHeader(String(cell ?? "")));
    const hasTicketHeader = normalized.some((value) => value.includes("pnr") || value.includes("codebillet") || value.includes("numerobillet") || value.includes("ticketnumber"));
    const hasSellerHeader = normalized.some((value) => value.includes("emeteur") || value.includes("emetteur") || value.includes("vendeur") || value.includes("agent") || value.includes("commercial"));
    const hasAmountHeader = normalized.some((value) => value.includes("montant") || value.includes("prix") || value.includes("amount"));

    if (hasTicketHeader && hasSellerHeader && hasAmountHeader) {
      return true;
    }
  }

  return false;
}

function toRowsFromMatrix(sheet: XLSX.WorkSheet): Row[] {
  const matrix = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, { header: 1, raw: true, defval: null });
  if (!matrix.length) return [];

  let headerRowIndex = -1;
  let headerMode: "detail" | "summary" | null = null;
  for (let i = 0; i < Math.min(matrix.length, 250); i += 1) {
    const row = matrix[i] ?? [];
    const normalized = row.map((cell) => normalizeHeader(String(cell ?? "")));
    const hasTicketHeader = normalized.some((value) => value.includes("pnr") || value.includes("codebillet") || value.includes("numerobillet") || value.includes("ticketnumber"));
    const hasSellerHeader = normalized.some((value) => value.includes("emeteur") || value.includes("emetteur") || value.includes("vendeur") || value.includes("agent") || value.includes("commercial"));
    const hasAmountHeader = normalized.some((value) => value.includes("montant") || value.includes("prix") || value.includes("amount"));
    const hasSummaryTicketHeader = normalized.some((value) => value.includes("billets") || value.includes("ticket"));
    const hasSummaryTotalHeader = normalized.some((value) => value.includes("totaux") || value === "total" || value.includes("commission"));
    const hasSummaryMonthHeader = normalized.some((value) => value === "mois" || value === "month" || monthFromSheetLabel(value) !== null);

    if (hasTicketHeader && hasSellerHeader && hasAmountHeader) {
      headerRowIndex = i;
      headerMode = "detail";
      break;
    }

    if (hasSummaryTicketHeader && hasSummaryTotalHeader && hasSummaryMonthHeader) {
      headerRowIndex = i;
      headerMode = "summary";
      break;
    }
  }

  if (headerRowIndex === -1) {
    return XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: true });
  }

  const headerRow = matrix[headerRowIndex] ?? [];
  const headers = headerRow.map((cell, index) => {
    const rawHeader = asString(cell) ?? `col_${index}`;
    const normalized = normalizeHeader(rawHeader);

    if (headerMode === "summary") {
      if (index === 0 && (normalized === "n" || normalized === "no" || normalized === "numero")) return "orderNumber";
      if (normalized.includes("billets")) return "ticketCount";
      if (normalized.includes("tota")) return "totalAmount";
      if (normalized.includes("commiss")) return "commissionAmount";
      if (normalized === "mois" || normalized === "month" || monthFromSheetLabel(rawHeader) !== null) return "monthLabel";
    }

    return rawHeader;
  });

  const out: Row[] = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const obj: Row = {};
    let hasAny = false;

    headers.forEach((header, index) => {
      const value = row[index] ?? null;
      obj[header] = value;
      if (!hasAny && asString(value)) {
        hasAny = true;
      }
    });

    if (hasAny) {
      out.push(obj);
    }
  }

  return out;
}

function pushPreviewRow(
  list: TicketWorkbookImportPreviewRow[],
  row: TicketWorkbookImportPreviewRow,
  maxPreviewRows: number,
) {
  if (list.length >= maxPreviewRows) {
    return false;
  }
  list.push(row);
  return true;
}

function asHistoryEntry(log: {
  id: string;
  createdAt: Date;
  actor: { name: string; email: string };
  payload: Prisma.JsonValue;
}): TicketImportHistoryEntry {
  const payload = (log.payload && typeof log.payload === "object" && !Array.isArray(log.payload) ? log.payload : {}) as Record<string, unknown>;
  const summary = (payload.summary && typeof payload.summary === "object" && !Array.isArray(payload.summary)
    ? payload.summary
    : {}) as Record<string, unknown>;

  return {
    id: log.id,
    createdAt: log.createdAt.toISOString(),
    actorName: log.actor.name,
    actorEmail: log.actor.email,
    fileName: typeof payload.fileName === "string" ? payload.fileName : null,
    mode: payload.mode === "IMPORT" ? "IMPORT" : "PREVIEW",
    periodMode: payload.periodMode === "DAY" || payload.periodMode === "YEAR" || payload.periodMode === "CUSTOM" || payload.periodMode === "MONTH"
      ? payload.periodMode
      : null,
    year: typeof payload.year === "number" ? payload.year : null,
    month: typeof payload.month === "number" ? payload.month : null,
    rangeStart: typeof payload.rangeStart === "string" ? payload.rangeStart : null,
    rangeEnd: typeof payload.rangeEnd === "string" ? payload.rangeEnd : null,
    sheetName: typeof payload.sheetName === "string" ? payload.sheetName : null,
    replaceExistingPeriod: Boolean(payload.replaceExistingPeriod ?? payload.replaceMonth),
    dryRun: Boolean(payload.dryRun),
    createdCount: typeof summary.created === "number" ? summary.created : 0,
    failedCount: typeof summary.failed === "number" ? summary.failed : 0,
    totalRows: typeof summary.totalRows === "number" ? summary.totalRows : 0,
  };
}

export async function recordTicketWorkbookImportLog(input: {
  actorId: string;
  actorName: string;
  fileName: string | null;
  periodMode: ImportPeriodMode;
  year: number;
  month?: number;
  rangeStart: string;
  rangeEnd: string;
  sheetName?: string;
  dryRun: boolean;
  replaceExistingPeriod: boolean;
  result: TicketWorkbookImportResult;
}) {
  const created = await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.dryRun ? "TICKET_IMPORT_PREVIEW" : "TICKET_IMPORT_EXECUTED",
      entityType: "TICKET_IMPORT",
      entityId: "GLOBAL",
      payload: {
        summary: `${input.dryRun ? "Prévisualisation" : "Import"} Excel billets ${input.fileName ?? "sans nom"} sur ${input.rangeStart} -> ${input.rangeEnd}.`,
        actorName: input.actorName,
        fileName: input.fileName,
        periodMode: input.periodMode,
        year: input.year,
        month: input.month ?? null,
        rangeStart: input.rangeStart,
        rangeEnd: input.rangeEnd,
        sheetName: input.sheetName ?? null,
        dryRun: input.dryRun,
        replaceExistingPeriod: input.replaceExistingPeriod,
        mode: input.dryRun ? "PREVIEW" : "IMPORT",
        resultSummary: input.result.summary,
        range: input.result.range,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      createdAt: true,
      payload: true,
      actor: { select: { name: true, email: true } },
    },
  });

  return asHistoryEntry(created);
}

export async function listTicketWorkbookImportHistory(
  limit = 20,
  filters?: { year?: number; month?: number; actorEmail?: string },
) {
  let actorId: string | undefined;
  if (filters?.actorEmail) {
    const actorEmail = filters.actorEmail.trim().toLowerCase();
    const actor = await prisma.user.findFirst({
      where: { email: { equals: actorEmail } },
      select: { id: true },
    });
    if (!actor) return [];
    actorId = actor.id;
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      action: { in: ["TICKET_IMPORT_PREVIEW", "TICKET_IMPORT_EXECUTED"] },
      entityType: "TICKET_IMPORT",
      ...(actorId ? { actorId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      payload: true,
      actor: { select: { name: true, email: true } },
    },
  });

  const entries = logs.map(asHistoryEntry);

  if (filters?.year !== undefined || filters?.month !== undefined) {
    return entries.filter((entry) => {
      if (filters.year !== undefined && entry.year !== filters.year) return false;
      if (filters.month !== undefined && entry.month !== filters.month) return false;
      return true;
    });
  }

  return entries;
}

export async function importTicketWorkbookFromBuffer(options: TicketWorkbookImportOptions): Promise<TicketWorkbookImportResult> {
  const dryRun = options.dryRun ?? false;
  const replaceExistingPeriod = options.replaceExistingPeriod ?? false;
  const includePreview = options.includePreview ?? dryRun;
  const maxPreviewRows = options.maxPreviewRows ?? 120;
  const range = buildRange(options);
  const workbook = XLSX.read(options.fileBuffer, { type: "buffer", cellDates: true });
  const sheetNames = options.sheetName
    ? [options.sheetName]
    : workbook.SheetNames.filter((name) => name.trim().length > 0);
  const hasDetailedTicketSheets = workbook.SheetNames.some((name) => {
    const sheet = workbook.Sheets[name];
    return sheet ? sheetContainsDetailedTicketHeader(sheet) : false;
  });

  if (!sheetNames.length) {
    throw new Error("Aucune feuille exploitable détectée dans ce fichier Excel.");
  }

  const [users, teams, airlines] = await Promise.all([
    prisma.user.findMany({ select: { id: true, email: true, name: true } }),
    prisma.team.findMany({ select: { id: true, name: true } }),
    prisma.airline.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        commissionRules: {
          where: { isActive: true, commissionMode: CommissionMode.AFTER_DEPOSIT },
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            depositStockTargetAmount: true,
            batchCommissionAmount: true,
          },
        },
      },
    }),
  ]);

  const userByEmail = new Map(users.map((user) => [user.email.trim().toLowerCase(), user]));
  const userByName = new Map(users.map((user) => [normalizePersonKey(user.name), user]));
  const usersByPayerKey = new Map<string, string>();
  users.forEach((user) => {
    addLookupCandidate(new Set<string>([normalizeLookupKey(user.name)]), user.name);
    const keys = new Set<string>([
      normalizeLookupKey(user.name),
      compactLookupKey(user.name),
      normalizeLookupKey(`Agent ${user.name}`),
      compactLookupKey(`Agent ${user.name}`),
    ]);
    keys.forEach((key) => {
      if (key) usersByPayerKey.set(key, user.name);
    });
  });
  const teamsByPayerKey = new Map<string, string>();
  teams.forEach((team) => {
    buildTeamLookupCandidates(team.name).forEach((candidate) => {
      const normalizedCandidate = normalizeLookupKey(candidate);
      const compactCandidate = compactLookupKey(candidate);
      if (normalizedCandidate) teamsByPayerKey.set(normalizedCandidate, team.name);
      if (compactCandidate) teamsByPayerKey.set(compactCandidate, team.name);
    });
  });
  const airlineByCode = new Map<string, (typeof airlines)[number]>();
  const airlineByName = new Map<string, (typeof airlines)[number]>();
  airlines.forEach((airline) => {
    registerAirlineLookups(airlineByCode, airlineByName, airline);
  });
  const usedAirlineCodes = new Set(airlines.map((airline) => airline.code.trim().toUpperCase()));
  const now = new Date();
  const afterDepositRuleByAirlineId = new Map(
    airlines.map((airline) => {
      const rule = airline.commissionRules
        .filter((candidate) => candidate.startsAt <= now && (!candidate.endsAt || candidate.endsAt >= now))
        .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0] ?? null;
      return [airline.id, rule] as const;
    }),
  );

  const summary: TicketWorkbookImportSummary = {
    sheetsProcessed: 0,
    totalRows: 0,
    skippedEmpty: 0,
    skippedOutsideRange: 0,
    created: 0,
    updated: 0,
    failed: 0,
  };

  const errors: string[] = [];
  const pnrSequence = new Map<string, number>();
  const pnrFingerprints = new Map<string, Set<string>>();
  const previewRows: TicketWorkbookImportPreviewRow[] = [];
  let previewTruncated = false;

  if (replaceExistingPeriod && !dryRun) {
    const existingPeriodTickets = await prisma.ticketSale.findMany({
      where: { soldAt: { gte: range.start, lte: range.end } },
      select: {
        id: true,
        amount: true,
        ticketNumber: true,
        airlineId: true,
        airline: {
          select: {
            code: true,
            name: true,
          },
        },
      },
    });
    const ticketIds = existingPeriodTickets.map((ticket) => ticket.id);

    if (ticketIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const ticket of existingPeriodTickets) {
          const depositAccount = getAirlineDepositAccountByAirlineCode(ticket.airline.code);
          if (!depositAccount) {
            continue;
          }

          await recordAirlineDepositMovement(tx, {
            accountKey: depositAccount.key,
            movementType: "CREDIT",
            amount: ticket.amount,
            reference: `REMIMPORT ${ticket.ticketNumber}`,
            description: `Restitution suite remplacement import - ${ticket.airline.name}`,
            airlineId: ticket.airlineId,
            ticketSaleId: ticket.id,
          });
        }

        await tx.payment.deleteMany({ where: { ticketId: { in: ticketIds } } });
        await tx.ticketSale.deleteMany({ where: { id: { in: ticketIds } } });
      });
    }
  }

  const [ticketCounts, existingTickets, consumedByAirline, depositAccountSummaries] = await Promise.all([
    prisma.ticketSale.groupBy({ by: ["airlineId"], _count: { _all: true } }),
    prisma.ticketSale.findMany({ select: { ticketNumber: true } }),
    prisma.ticketSale.groupBy({ by: ["airlineId"], _sum: { amount: true } }),
    buildAirlineDepositAccountSummaries(prisma),
  ]);

  const ticketCountByAirlineId = new Map(ticketCounts.map((entry) => [entry.airlineId, entry._count._all]));
  const existingTicketNumbers = new Set(existingTickets.map((ticket) => ticket.ticketNumber));
  const consumedAmountByAirlineId = new Map(consumedByAirline.map((entry) => [entry.airlineId, entry._sum.amount ?? 0]));
  const depositBalanceByAccountKey = new Map(depositAccountSummaries.map((account) => [account.key, account.balance]));
  const touchedAfterDepositRuleIds = new Set<string>();

  async function resolveSeller(input: { sellerEmail: string | null; sellerName: string | null }) {
    const sellerEmail = input.sellerEmail?.trim().toLowerCase() ?? null;
    const sellerName = input.sellerName?.trim() ?? null;

    if (!sellerEmail && !sellerName) {
      const fallbackEmail = options.defaultSellerEmail?.trim().toLowerCase();
      if (fallbackEmail && userByEmail.has(fallbackEmail)) {
        return userByEmail.get(fallbackEmail)!;
      }
      return { id: null, email: null, name: null };
    }

    if (sellerEmail && userByEmail.has(sellerEmail)) {
      return userByEmail.get(sellerEmail)!;
    }

    if (sellerName) {
      const key = normalizePersonKey(sellerName);
      if (userByName.has(key)) {
        return userByName.get(key)!;
      }

      const fuzzyUser = findClosestMapValue(sellerName, userByName.entries(), 72);
      if (fuzzyUser) {
        return fuzzyUser;
      }
    }

    return { id: null, email: sellerEmail, name: sellerName ?? sellerEmail };
  }

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = toRowsFromMatrix(sheet);
    const sheetDate = parseSheetDateFromName(sheetName, range.anchorYear);
    summary.sheetsProcessed += 1;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      summary.totalRows += 1;
      const line = index + 2;

      const ticketNumber = asString(pickValue(row, ["ticketNumber", "ticket_number", "pnr", "code billet", "code billet (pnr)", "numero billet", "num billet", "n° billet", "ticket code", "ticket", "PNR"]));
      const customerNamePreview = asString(pickValue(row, ["customerName", "customer", "passenger", "nom client", "client", "nom passager", "beneficiare", "beneficiaire"]));
      const sellerNamePreview = asString(pickValue(row, ["sellerName", "commercial", "vendeur", "agent", "emeteur", "emetteur", "emeteur/bureau", "emetteur/bureau"]));
      const routePreview = asString(pickValue(row, ["route", "itineraire", "trajet", "from-to", "itineriaire", "itinerare"]));
      const amountPreview = asNumber(pickValue(row, ["amount", "prix", "montant", "ticket amount"]));
      const summaryMonthLabel = asString(pickValue(row, ["monthLabel", "mois", "month"])) ?? findMonthLabelInRow(row);
      const summaryMonthNumber = summaryMonthLabel ? monthFromSheetLabel(summaryMonthLabel) : null;
      const summaryTicketCount = asNumber(pickValue(row, ["ticketCount", "billets", "tickets", "nombre billets", "nb billets"]));
      const summaryTotalAmount = asNumber(pickValue(row, ["totalAmount", "totaux", "total", "montant total"]));
      const summaryCommissionAmount = asNumber(pickValue(row, ["commissionAmount", "commission", "commission totale", "commission total"]));
      const isSummaryRow = summaryMonthNumber !== null && summaryTicketCount !== null && summaryTicketCount > 0 && summaryTotalAmount !== null && summaryTotalAmount > 0;

      if (isSummaryRow) {
        if (hasDetailedTicketSheets) {
          summary.skippedEmpty += 1;
          continue;
        }

        const soldAt = new Date(Date.UTC(range.anchorYear, summaryMonthNumber - 1, 1, 12, 0, 0, 0));

        if (soldAt < range.start || soldAt > range.end) {
          summary.skippedOutsideRange += 1;
          continue;
        }

        const summaryAirlines = [
          { headers: ["CAA"], fallbackName: "CAA" },
          { headers: ["AIRCONGO", "AIR CONGO", "ACG"], fallbackName: "Air Congo" },
          { headers: ["ET", "ETH", "ETHIOPIAN"], fallbackName: "Ethiopian Airlines" },
          { headers: ["KENYA", "KQ"], fallbackName: "Kenya Airways" },
          { headers: ["MG", "MGB", "MONT GABAON"], fallbackName: "Mont Gabaon" },
          { headers: ["DAKOTA", "DKT"], fallbackName: "Dakota" },
          { headers: ["UR", "UGANDA"], fallbackName: "Uganda Airlines" },
          { headers: ["TC", "TANZANIA"], fallbackName: "Air Tanzania" },
          { headers: ["AF", "AIR FRANCE"], fallbackName: "Air France" },
          { headers: ["WB", "RWANDAIR"], fallbackName: "RwandAir" },
        ];

        const breakdown = summaryAirlines
          .map((entry) => ({
            amount: asNumber(pickValue(row, entry.headers)),
            fallbackName: entry.fallbackName,
          }))
          .filter((entry): entry is { amount: number; fallbackName: string } => typeof entry.amount === "number" && entry.amount > 0);

        if (breakdown.length === 0) {
          summary.skippedEmpty += 1;
          continue;
        }

        const allocatedCounts = distributeWholeUnits(Math.round(summaryTicketCount), breakdown.map((entry) => entry.amount));
        let remainingCommission = Number((summaryCommissionAmount ?? 0).toFixed(2));

        for (let breakdownIndex = 0; breakdownIndex < breakdown.length; breakdownIndex += 1) {
          const item = breakdown[breakdownIndex];
          const airline = findClosestMapValue(item.fallbackName, airlineByName.entries(), 68)
            ?? findClosestMapValue(item.fallbackName, airlineByCode.entries(), 80);

          if (!airline) {
            errors.push(`[${sheetName}] ${summaryMonthLabel}: compagnie introuvable dans la base pour la synthèse (${item.fallbackName}).`);
            summary.failed += 1;
            continue;
          }

          const commissionShare = breakdownIndex === breakdown.length - 1
            ? Number(remainingCommission.toFixed(2))
            : Number((((summaryCommissionAmount ?? 0) * item.amount) / summaryTotalAmount).toFixed(2));
          remainingCommission = Number((remainingCommission - commissionShare).toFixed(2));

          const syntheticTicketNumber = `RPT-${range.anchorYear}${String(summaryMonthNumber).padStart(2, "0")}-${airline.code}-${String(breakdownIndex + 1).padStart(2, "0")}`;

          if (pnrSequence.has(syntheticTicketNumber) || existingTicketNumbers.has(syntheticTicketNumber)) {
            errors.push(`[${sheetName}] ${summaryMonthLabel}: le résumé ${syntheticTicketNumber} existe déjà. Utilisez le remplacement de période si nécessaire.`);
            summary.failed += 1;
            continue;
          }

          pnrSequence.set(syntheticTicketNumber, 1);
          const syntheticNotes = [
            `SOURCE_REPORT:GLOBAL_SUMMARY`,
            `SOURCE_TICKET_COUNT:${allocatedCounts[breakdownIndex] ?? 0}`,
            `SOURCE_MONTH:${summaryMonthLabel}`,
            `SOURCE_TOTAL_MONTH_TICKETS:${Math.round(summaryTicketCount)}`,
            `SOURCE_TOTAL_MONTH_AMOUNT:${summaryTotalAmount.toFixed(2)}`,
          ].join(" | ");

          const data: Prisma.TicketSaleUncheckedCreateInput = {
            ticketNumber: syntheticTicketNumber,
            customerName: `Synthèse ${summaryMonthLabel} ${range.anchorYear}`,
            route: `RAPPORT GLOBAL ${summaryMonthLabel}`,
            travelClass: TravelClass.ECONOMY,
            travelDate: soldAt,
            soldAt,
            amount: item.amount,
            baseFareAmount: item.amount,
            currency: "USD",
            airlineId: airline.id,
            sellerName: "Import rapport global",
            saleNature: SaleNature.CASH,
            paymentStatus: PaymentStatus.PAID,
            payerName: null,
            agencyMarkupPercent: 0,
            agencyMarkupAmount: 0,
            commissionBaseAmount: item.amount,
            commissionCalculationStatus: CommissionCalculationStatus.FINAL,
            commissionRateUsed: item.amount > 0 ? (commissionShare / item.amount) * 100 : 0,
            commissionAmount: commissionShare,
            commissionModeApplied: CommissionMode.IMMEDIATE,
            notes: syntheticNotes,
          };

          if (dryRun) {
            summary.created += 1;
          } else {
            await prisma.$transaction(async (tx) => {
              const createdTicket = await tx.ticketSale.create({ data });
              const depositAccount = getAirlineDepositAccountByAirlineCode(airline.code);
              if (depositAccount) {
                await recordAirlineDepositMovement(tx, {
                  accountKey: depositAccount.key,
                  movementType: "DEBIT",
                  amount: item.amount,
                  reference: `RAPPORT ${syntheticTicketNumber}`,
                  description: `Import synthèse ${summaryMonthLabel} - ${airline.name}`,
                  airlineId: airline.id,
                  ticketSaleId: createdTicket.id,
                  createdAt: soldAt,
                });
              }
            });
            existingTicketNumbers.add(syntheticTicketNumber);
            summary.created += 1;
          }

          if (includePreview) {
            const stored = pushPreviewRow(previewRows, {
              sheet: sheetName,
              line,
              sourceTicketNumber: syntheticTicketNumber,
              finalTicketNumber: syntheticTicketNumber,
              customerName: `Synthèse ${summaryMonthLabel}`,
              sellerName: "Import rapport global",
              airlineName: airline.name,
              route: `RAPPORT GLOBAL ${summaryMonthLabel}`,
              amount: item.amount,
              currency: "USD",
              soldAt: soldAt.toISOString().slice(0, 10),
              status: "READY",
              message: `${allocatedCounts[breakdownIndex] ?? 0} billet(s) • Commission ${commissionShare.toFixed(2)}`,
            }, maxPreviewRows);
            if (!stored) previewTruncated = true;
          }
        }

        continue;
      }

      if (isHeaderOrSummaryTicketValue(ticketNumber) || (!customerNamePreview && !sellerNamePreview && !routePreview && !amountPreview)) {
        summary.skippedEmpty += 1;
        if (includePreview) {
          const stored = pushPreviewRow(previewRows, {
            sheet: sheetName,
            line,
            sourceTicketNumber: ticketNumber,
            finalTicketNumber: null,
            customerName: customerNamePreview,
            sellerName: sellerNamePreview,
            airlineName: asString(pickValue(row, ["airlineName", "compagnie", "airline"])),
            route: routePreview,
            amount: amountPreview,
            currency: asString(pickValue(row, ["currency", "devise"])) ?? "USD",
            soldAt: sheetDate?.toISOString().slice(0, 10) ?? null,
            status: "SKIPPED_EMPTY",
            message: "Ticket vide ou ligne d'en-tête.",
          }, maxPreviewRows);
          if (!stored) previewTruncated = true;
        }
        continue;
      }

      try {
        const soldAtRaw = pickValue(row, ["soldAt", "date vente", "sale date", "date"]);
        const travelDateRaw = pickValue(row, ["travelDate", "date voyage", "departure date", "date depart"]);
        const soldAt = sheetDate ?? asDate(soldAtRaw) ?? asDate(travelDateRaw) ?? new Date();
        const travelDate = asDate(travelDateRaw) ?? soldAt;

        if (!soldAt || !travelDate) {
          throw new Error("Date de vente ou de voyage invalide.");
        }

        if (soldAt < range.start || soldAt > range.end) {
          summary.skippedOutsideRange += 1;
          if (includePreview) {
            const stored = pushPreviewRow(previewRows, {
              sheet: sheetName,
              line,
              sourceTicketNumber: ticketNumber,
              finalTicketNumber: ticketNumber,
              customerName: asString(pickValue(row, ["customerName", "customer", "passenger", "nom client", "client", "nom passager", "beneficiare", "beneficiaire"])),
              sellerName: asString(pickValue(row, ["sellerName", "commercial", "vendeur", "agent", "emeteur", "emetteur", "emeteur/bureau", "emetteur/bureau"])),
              airlineName: asString(pickValue(row, ["airlineName", "compagnie", "airline"])),
              route: asString(pickValue(row, ["route", "itineraire", "trajet", "from-to", "itineriaire", "itinerare"])),
              amount: asNumber(pickValue(row, ["amount", "prix", "montant", "ticket amount"])),
              currency: (asString(pickValue(row, ["currency", "devise"])) ?? "USD").toUpperCase(),
              soldAt: soldAt.toISOString().slice(0, 10),
              status: "SKIPPED_OUTSIDE_RANGE",
              message: "Date hors période cible.",
            }, maxPreviewRows);
            if (!stored) previewTruncated = true;
          }
          continue;
        }

        const customerName = asString(pickValue(row, ["customerName", "customer", "passenger", "nom client", "client", "nom passager", "beneficiare", "beneficiaire"])) ?? "Client non renseigné";
        let route = asString(pickValue(row, ["route", "itineraire", "trajet", "from-to", "itineriaire", "itinerare"])) ?? "ROUTE-NR";
        const amount = asNumber(pickValue(row, ["amount", "prix", "montant", "ticket amount"]));
        if (!amount || amount <= 0) {
          throw new Error("Montant billet invalide.");
        }

        let resolvedTicketNumber = ticketNumber as string;
        if (looksLikeRouteValue(resolvedTicketNumber) && looksLikePnrValue(route)) {
          const swapped = route;
          route = resolvedTicketNumber;
          resolvedTicketNumber = swapped;
        }

        const currency = (asString(pickValue(row, ["currency", "devise"])) ?? "USD").toUpperCase();
        const baseFareAmount = asNumber(pickValue(row, ["baseFareAmount", "base fare", "basefare", "tarif de base"]));
        const agencyMarkupAmount = asNumber(pickValue(row, ["agencyMarkupAmount", "majoration", "markup", "majoration agence"])) ?? 0;
        const commissionAmountFromFile = asNumber(pickValue(row, ["commissionAmount", "commission", "commission brute", "com", "comission", "commission mensuelle", "commission hebdo"])) ?? 0;
        const commissionRateFromFile = asNumber(pickValue(row, ["commissionRateUsed", "commissionRate", "taux commission"])) ?? null;
        const commissionBaseAmount = baseFareAmount && baseFareAmount > 0 ? baseFareAmount : 0;

        const sellerEmail = asString(pickValue(row, ["sellerEmail", "commercialEmail", "agentEmail", "email vendeur", "email agent"]));
        const sellerName = asString(pickValue(row, ["sellerName", "commercial", "vendeur", "agent", "emeteur", "emetteur", "emetteur/emitteur", "emitteur", "emeteur/bureau", "emetteur/bureau"]));
        const seller = await resolveSeller({ sellerEmail, sellerName });

        const airlineCodeRaw = asString(pickValue(row, ["airlineCode", "compagnieCode", "code compagnie", "code"]));
        const airlineNameRaw = asString(pickValue(row, ["airlineName", "compagnie", "airline"])) ?? "Compagnie inconnue";
        const airlineIdentity = resolveAirlineIdentity(airlineCodeRaw, airlineNameRaw);

        let airline = airlineIdentity.canonicalCode ? airlineByCode.get(airlineIdentity.canonicalCode) : null;
        if (!airline) {
          for (const lookupKey of airlineIdentity.lookupKeys) {
            airline = airlineByName.get(lookupKey) ?? null;
            if (airline) break;
          }
        }

        if (!airline) {
          airline = findClosestMapValue(`${airlineCodeRaw ?? ""} ${airlineNameRaw}`.trim(), airlineByName.entries(), 68)
            ?? findClosestMapValue(airlineNameRaw, airlineByName.entries(), 68)
            ?? findClosestMapValue(airlineCodeRaw, airlineByCode.entries(), 80);
        }

        if (!airline) {
          throw new Error(`Compagnie introuvable dans la base: ${airlineNameRaw}${airlineCodeRaw ? ` (${airlineCodeRaw})` : ""}. L'import ne crée pas de nouvelle compagnie automatiquement.`);
        }

        const fingerprint = [
          normalizeLookupKey(customerName),
          normalizeLookupKey(route),
          amount.toFixed(2),
          airline.id,
          soldAt.toISOString().slice(0, 10),
        ].join("|");
        const knownFingerprints = pnrFingerprints.get(resolvedTicketNumber) ?? new Set<string>();
        if (knownFingerprints.has(fingerprint)) {
          throw new Error(`Doublon détecté dans le fichier importé pour le PNR ${resolvedTicketNumber}.`);
        }
        knownFingerprints.add(fingerprint);
        pnrFingerprints.set(resolvedTicketNumber, knownFingerprints);

        if (existingTicketNumbers.has(resolvedTicketNumber)) {
          throw new Error(`Le billet ${resolvedTicketNumber} existe déjà dans la base. Utilisez le remplacement de période si vous voulez le réimporter.`);
        }

        let normalizedTicketNumber = resolvedTicketNumber;
        let duplicateIndex = 1;
        while (pnrSequence.has(normalizedTicketNumber) || existingTicketNumbers.has(normalizedTicketNumber)) {
          duplicateIndex += 1;
          normalizedTicketNumber = `${resolvedTicketNumber}-R${duplicateIndex}`;
        }
        pnrSequence.set(normalizedTicketNumber, duplicateIndex);

        const afterDepositRule = afterDepositRuleByAirlineId.get(airline.id) ?? null;
        const isAirFast = isAirFastLike(airline);
        const depositAccount = getAirlineDepositAccountByAirlineCode(airline.code);

        if (depositAccount) {
          const availableDepositBalance = depositBalanceByAccountKey.get(depositAccount.key) ?? 0;
          depositBalanceByAccountKey.set(depositAccount.key, availableDepositBalance);
        }

        // Pour CAA (règle afterDeposit) et AirFast, la commission est calculée
        // exclusivement par la logique métier — la valeur du fichier est ignorée.
        // Pour toutes les autres compagnies, on utilise directement la valeur du fichier.
        let commissionAmount = (afterDepositRule || isAirFast) ? 0 : Math.max(0, commissionAmountFromFile);

        if (afterDepositRule) {
          const targetAmount = afterDepositRule.depositStockTargetAmount ?? 0;
          const batchAmount = afterDepositRule.batchCommissionAmount ?? 0;
          if (targetAmount > 0 && batchAmount > 0) {
            const consumedBefore = consumedAmountByAirlineId.get(airline.id) ?? 0;
            const consumedAfter = consumedBefore + amount;
            const batchesBefore = Math.floor(consumedBefore / targetAmount);
            const batchesAfter = Math.floor(consumedAfter / targetAmount);
            const newBatches = Math.max(0, batchesAfter - batchesBefore);
            commissionAmount += newBatches * batchAmount;
            consumedAmountByAirlineId.set(airline.id, consumedAfter);
            if (newBatches > 0) {
              touchedAfterDepositRuleIds.add(afterDepositRule.id);
            }
          }
        }

        if (isAirFast) {
          const nextAirfastTicketNumber = (ticketCountByAirlineId.get(airline.id) ?? 0) + 1;
          ticketCountByAirlineId.set(airline.id, nextAirfastTicketNumber);
          if (nextAirfastTicketNumber % 13 === 0) {
            commissionAmount += amount;
          }
        }

        const commissionRateUsed = commissionRateFromFile
          ?? (commissionBaseAmount > 0 ? (commissionAmount / commissionBaseAmount) * 100 : 0);

        const data: Prisma.TicketSaleUncheckedCreateInput = {
          ticketNumber: normalizedTicketNumber,
          customerName,
          route,
          travelClass: parseTravelClass(pickValue(row, ["travelClass", "classe", "class"])),
          travelDate,
          soldAt,
          amount,
          baseFareAmount,
          currency,
          airlineId: airline.id,
          ...(seller.id ? { sellerId: seller.id } : {}),
          sellerName: seller.name ?? undefined,
          saleNature: parseSaleNature(pickValue(row, ["saleNature", "nature vente", "nature"])),
          paymentStatus: parsePaymentStatus(pickValue(row, ["paymentStatus", "statut paiement", "statut", "etat paiement"])),
          payerName: resolveImportedPayerName(asString(pickValue(row, ["payerName", "payant", "nom payeur"])), {
            usersByKey: usersByPayerKey,
            teamsByKey: teamsByPayerKey,
            userKeys: Array.from(usersByPayerKey.keys()),
            teamKeys: Array.from(teamsByPayerKey.keys()),
          }),
          agencyMarkupPercent: 0,
          agencyMarkupAmount,
          commissionBaseAmount,
          commissionCalculationStatus: CommissionCalculationStatus.FINAL,
          commissionRateUsed,
          commissionAmount,
          commissionModeApplied: CommissionMode.IMMEDIATE,
          notes: [
            asString(pickValue(row, ["notes", "observation", "commentaire"])),
            normalizedTicketNumber !== resolvedTicketNumber ? `PNR source: ${resolvedTicketNumber}` : null,
          ].filter(Boolean).join(" | ") || null,
        };

        if (dryRun) {
          if (depositAccount) {
            depositBalanceByAccountKey.set(depositAccount.key, (depositBalanceByAccountKey.get(depositAccount.key) ?? 0) - amount);
          }
          summary.created += 1;
        } else {
          await prisma.$transaction(async (tx) => {
            const createdTicket = await tx.ticketSale.create({ data });

            if (depositAccount) {
              await recordAirlineDepositMovement(tx, {
                accountKey: depositAccount.key,
                movementType: "DEBIT",
                amount,
                reference: `PNR ${normalizedTicketNumber}`,
                description: `Débit automatique import billet ${normalizedTicketNumber} - ${airline.name}`,
                airlineId: airline.id,
                ticketSaleId: createdTicket.id,
                createdAt: soldAt,
              });
              depositBalanceByAccountKey.set(depositAccount.key, (depositBalanceByAccountKey.get(depositAccount.key) ?? 0) - amount);
            }
          });
          existingTicketNumbers.add(normalizedTicketNumber);
          summary.created += 1;
        }

        if (includePreview) {
          const stored = pushPreviewRow(previewRows, {
            sheet: sheetName,
            line,
            sourceTicketNumber: ticketNumber,
            finalTicketNumber: normalizedTicketNumber,
            customerName,
            sellerName: seller.name ?? sellerName,
            airlineName: airline.name,
            route,
            amount,
            currency,
            soldAt: soldAt.toISOString().slice(0, 10),
            status: "READY",
            message: dryRun ? "Prêt à importer." : "Importé.",
          }, maxPreviewRows);
          if (!stored) previewTruncated = true;
        }
      } catch (error) {
        summary.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`[${sheetName}] Ligne ${line} (${ticketNumber}): ${message}`);
        if (includePreview) {
          const stored = pushPreviewRow(previewRows, {
            sheet: sheetName,
            line,
            sourceTicketNumber: ticketNumber,
            finalTicketNumber: ticketNumber,
            customerName: asString(pickValue(row, ["customerName", "customer", "passenger", "nom client", "client", "nom passager", "beneficiare", "beneficiaire"])),
            sellerName: asString(pickValue(row, ["sellerName", "commercial", "vendeur", "agent", "emeteur", "emetteur"])),
            airlineName: asString(pickValue(row, ["airlineName", "compagnie", "airline"])),
            route: asString(pickValue(row, ["route", "itineraire", "trajet", "from-to", "itineriaire", "itinerare"])),
            amount: asNumber(pickValue(row, ["amount", "prix", "montant", "ticket amount"])),
            currency: (asString(pickValue(row, ["currency", "devise"])) ?? "USD").toUpperCase(),
            soldAt: null,
            status: "ERROR",
            message,
          }, maxPreviewRows);
          if (!stored) previewTruncated = true;
        }
      }
    }
  }

  if (!dryRun && touchedAfterDepositRuleIds.size > 0) {
    const updates = [...touchedAfterDepositRuleIds].map(async (ruleId) => {
      const rule = airlines
        .flatMap((airline) => airline.commissionRules)
        .find((candidate) => candidate.id === ruleId);
      if (!rule) return;

      const ownerAirline = airlines.find((airline) => airline.commissionRules.some((candidate) => candidate.id === ruleId));
      if (!ownerAirline) return;

      const consumedAmount = consumedAmountByAirlineId.get(ownerAirline.id);
      if (consumedAmount === undefined) return;

      await prisma.commissionRule.update({
        where: { id: ruleId },
        data: { depositStockConsumedAmount: consumedAmount },
      });
    });

    await Promise.all(updates);
  }

  return {
    summary,
    errors,
    range: {
      start: range.start.toISOString().slice(0, 10),
      end: range.end.toISOString().slice(0, 10),
    },
    sheetNames,
    previewRows,
    previewTruncated,
  };
}