import { prisma } from "@/lib/prisma";
import { monthUtcRange } from "@/lib/cash-report-month-constat";
import {
  filterMbujimayiReportRowsForMonth,
  parseMbujimayiReportSalesFromBuffer,
  type MbujimayiReportSaleRow,
} from "@/lib/mbujimayi-report-parse";

export type MbujimayiSystemTicket = {
  id: string;
  ticketNumber: string;
  customerName: string;
  amount: number;
  currency: string;
  soldAt: string;
  payerName: string | null;
  sellerName: string | null;
  teamName: string | null;
};

export type MbujimayiMatchStatus =
  | "matched"
  | "date_mismatch"
  | "price_mismatch"
  | "price_and_date_mismatch"
  | "missing_in_system"
  | "missing_in_report"
  | "ambiguous";

export type MbujimayiReconcilePair = {
  status: MbujimayiMatchStatus;
  report: MbujimayiReportSaleRow | null;
  ticket: MbujimayiSystemTicket | null;
  nameScore: number;
  notes: string[];
};

const TITLE_TOKENS = new Set([
  "mr",
  "mrs",
  "mme",
  "mlle",
  "mlle",
  "miss",
  "ms",
  "dr",
  "pr",
  "monsieur",
  "madame",
  "mademoiselle",
  "sir",
  "dame",
]);

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Jetons du nom : ordre ignoré ; civilités ignorées. */
export function nameTokens(value: string) {
  const cleaned = stripDiacritics(value)
    .toLowerCase()
    .replace(/[\/|,;_+]+/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [] as string[];

  const rawTokens = cleaned
    .split(/[\s-]+/)
    .map((token) => token.replace(/^(mr|mrs|mme|mlle|mlle|miss|ms|dr|pr)+$/g, ""))
    .map((token) => token.replace(/(mr|mrs|mme|mlle)$/g, ""))
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !TITLE_TOKENS.has(token));

  return rawTokens;
}

export function nameSignature(value: string) {
  return [...nameTokens(value)].sort().join("|");
}

/** Empreinte lettres (ignore espaces / ordre des parties collées). */
export function nameLetterFingerprint(value: string) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .split("")
    .sort()
    .join("");
}

function jaccard(a: string[], b: string[]) {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Score de similarité nom (0..1) : ordre des parties sans importance.
 * 1.0 = mêmes jetons ; ~0.92 = mêmes lettres (parties collées) ; Jaccard sinon.
 */
export function scoreNameSimilarity(left: string, right: string) {
  const leftTokens = nameTokens(left);
  const rightTokens = nameTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const leftSig = [...leftTokens].sort().join("|");
  const rightSig = [...rightTokens].sort().join("|");
  if (leftSig === rightSig) return 1;

  const leftFp = nameLetterFingerprint(left);
  const rightFp = nameLetterFingerprint(right);
  if (leftFp && leftFp === rightFp && leftFp.length >= 8) return 0.94;

  const tokenScore = jaccard(leftTokens, rightTokens);
  if (tokenScore >= 0.8) return tokenScore;

  // Une partie collée côté rapport vs découpée côté système
  const leftJoined = leftTokens.join("");
  const rightJoined = rightTokens.join("");
  if (leftJoined === rightJoined && leftJoined.length >= 8) return 0.9;

  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const longerJoined = leftTokens.length <= rightTokens.length ? rightJoined : leftJoined;
  if (shorter.length >= 2 && shorter.every((token) => token.length >= 3 && longerJoined.includes(token))) {
    return 0.86;
  }

  return tokenScore;
}

function amountsClose(a: number, b: number) {
  return Math.abs(a - b) <= 0.5;
}

function dayDiff(isoA: string | null, isoB: string | null) {
  if (!isoA || !isoB) return null;
  const a = Date.parse(`${isoA}T00:00:00.000Z`);
  const b = Date.parse(`${isoB}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function isMbujimayiTicket(ticket: {
  payerName?: string | null;
  sellerName?: string | null;
  seller?: { name?: string | null; team?: { name?: string | null } | null } | null;
}) {
  const haystack = [
    ticket.payerName ?? "",
    ticket.sellerName ?? "",
    ticket.seller?.name ?? "",
    ticket.seller?.team?.name ?? "",
  ]
    .join(" ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  return /mbuji|mjm/.test(haystack);
}

export async function loadMbujimayiSystemTicketsForMonth(month: string): Promise<MbujimayiSystemTicket[]> {
  const { start, end } = monthUtcRange(month);
  const tickets = await prisma.ticketSale.findMany({
    where: {
      soldAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      ticketNumber: true,
      customerName: true,
      amount: true,
      currency: true,
      soldAt: true,
      payerName: true,
      sellerName: true,
      seller: { select: { name: true, team: { select: { name: true } } } },
    },
    orderBy: { soldAt: "asc" },
  });

  return tickets
    .filter(isMbujimayiTicket)
    .map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      customerName: ticket.customerName,
      amount: ticket.amount,
      currency: ticket.currency,
      soldAt: ticket.soldAt.toISOString().slice(0, 10),
      payerName: ticket.payerName,
      sellerName: ticket.sellerName ?? ticket.seller?.name ?? null,
      teamName: ticket.seller?.team?.name ?? null,
    }));
}

type ScoredCandidate = {
  reportIndex: number;
  ticketIndex: number;
  score: number;
};

function classifyPair(report: MbujimayiReportSaleRow, ticket: MbujimayiSystemTicket, nameScore: number): MbujimayiReconcilePair {
  const priceOk = amountsClose(report.amountUsd, ticket.amount);
  const diff = dayDiff(report.businessDate, ticket.soldAt);
  const dateOk = diff == null ? true : Math.abs(diff) <= 1;
  const notes: string[] = [];

  if (!priceOk) {
    notes.push(`Prix différent : rapport ${report.amountUsd.toFixed(2)} USD vs système ${ticket.amount.toFixed(2)} USD`);
  }
  if (diff != null && Math.abs(diff) > 1) {
    notes.push(`Date différente : rapport ${report.businessDate ?? "—"} vs système ${ticket.soldAt} (${diff > 0 ? "+" : ""}${diff} j)`);
  } else if (report.businessDate == null) {
    notes.push("Date absente ou invalide côté rapport");
  }
  if (nameScore < 1) {
    notes.push(`Nom rapproché (score ${(nameScore * 100).toFixed(0)} %) : « ${report.clientName} » ↔ « ${ticket.customerName} »`);
  }

  let status: MbujimayiMatchStatus = "matched";
  if (!priceOk && !dateOk) status = "price_and_date_mismatch";
  else if (!priceOk) status = "price_mismatch";
  else if (!dateOk) status = "date_mismatch";

  return { status, report, ticket, nameScore, notes };
}

export function reconcileMbujimayiSales(
  reportRows: MbujimayiReportSaleRow[],
  tickets: MbujimayiSystemTicket[],
): MbujimayiReconcilePair[] {
  const pairs: MbujimayiReconcilePair[] = [];
  const usedReports = new Set<number>();
  const usedTickets = new Set<number>();

  const candidates: ScoredCandidate[] = [];
  for (let reportIndex = 0; reportIndex < reportRows.length; reportIndex += 1) {
    for (let ticketIndex = 0; ticketIndex < tickets.length; ticketIndex += 1) {
      const score = scoreNameSimilarity(reportRows[reportIndex].clientName, tickets[ticketIndex].customerName);
      if (score < 0.8) continue;
      candidates.push({ reportIndex, ticketIndex, score });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const reportA = reportRows[a.reportIndex];
    const reportB = reportRows[b.reportIndex];
    const ticketA = tickets[a.ticketIndex];
    const ticketB = tickets[b.ticketIndex];
    const priceA = amountsClose(reportA.amountUsd, ticketA.amount) ? 1 : 0;
    const priceB = amountsClose(reportB.amountUsd, ticketB.amount) ? 1 : 0;
    if (priceB !== priceA) return priceB - priceA;
    const dateA = Math.abs(dayDiff(reportA.businessDate, ticketA.soldAt) ?? 99);
    const dateB = Math.abs(dayDiff(reportB.businessDate, ticketB.soldAt) ?? 99);
    return dateA - dateB;
  });

  for (const candidate of candidates) {
    if (usedReports.has(candidate.reportIndex) || usedTickets.has(candidate.ticketIndex)) continue;

    const sameReportOthers = candidates.filter(
      (other) =>
        other.reportIndex === candidate.reportIndex
        && other.ticketIndex !== candidate.ticketIndex
        && !usedTickets.has(other.ticketIndex)
        && Math.abs(other.score - candidate.score) < 0.02
        && amountsClose(reportRows[other.reportIndex].amountUsd, tickets[other.ticketIndex].amount)
          === amountsClose(reportRows[candidate.reportIndex].amountUsd, tickets[candidate.ticketIndex].amount),
    );

    if (sameReportOthers.length > 0 && candidate.score < 0.99) {
      // Ambiguïté nette : plusieurs billets système pour la même ligne rapport
      const ambiguousTickets = [candidate, ...sameReportOthers].slice(0, 3);
      usedReports.add(candidate.reportIndex);
      pairs.push({
        status: "ambiguous",
        report: reportRows[candidate.reportIndex],
        ticket: tickets[candidate.ticketIndex],
        nameScore: candidate.score,
        notes: [
          `Plusieurs billets système possibles : ${ambiguousTickets
            .map((item) => tickets[item.ticketIndex].ticketNumber)
            .join(", ")}`,
        ],
      });
      continue;
    }

    usedReports.add(candidate.reportIndex);
    usedTickets.add(candidate.ticketIndex);
    pairs.push(classifyPair(reportRows[candidate.reportIndex], tickets[candidate.ticketIndex], candidate.score));
  }

  for (let reportIndex = 0; reportIndex < reportRows.length; reportIndex += 1) {
    if (usedReports.has(reportIndex)) continue;
    pairs.push({
      status: "missing_in_system",
      report: reportRows[reportIndex],
      ticket: null,
      nameScore: 0,
      notes: ["Présent dans le rapport Mbujimayi, introuvable parmi les billets payant/agence Mbujimayi du mois."],
    });
  }

  for (let ticketIndex = 0; ticketIndex < tickets.length; ticketIndex += 1) {
    if (usedTickets.has(ticketIndex)) continue;
    pairs.push({
      status: "missing_in_report",
      report: null,
      ticket: tickets[ticketIndex],
      nameScore: 0,
      notes: ["Présent dans le système (Mbujimayi), absent du rapport importé pour ce mois."],
    });
  }

  const statusOrder: Record<MbujimayiMatchStatus, number> = {
    missing_in_system: 0,
    missing_in_report: 1,
    price_and_date_mismatch: 2,
    price_mismatch: 3,
    date_mismatch: 4,
    ambiguous: 5,
    matched: 6,
  };

  return pairs.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
}

export async function analyzeMbujimayiReportBuffer(buffer: Buffer, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Mois invalide: ${month}`);
  }

  const parsed = await parseMbujimayiReportSalesFromBuffer(buffer, {
    defaultYear: Number(month.slice(0, 4)),
  });
  const reportRows = filterMbujimayiReportRowsForMonth(parsed.rows, month);
  const tickets = await loadMbujimayiSystemTicketsForMonth(month);
  const pairs = reconcileMbujimayiSales(reportRows, tickets);

  const summary = {
    reportSalesCount: reportRows.length,
    systemTicketsCount: tickets.length,
    matched: pairs.filter((pair) => pair.status === "matched").length,
    dateMismatch: pairs.filter((pair) => pair.status === "date_mismatch").length,
    priceMismatch: pairs.filter((pair) => pair.status === "price_mismatch").length,
    priceAndDateMismatch: pairs.filter((pair) => pair.status === "price_and_date_mismatch").length,
    missingInSystem: pairs.filter((pair) => pair.status === "missing_in_system").length,
    missingInReport: pairs.filter((pair) => pair.status === "missing_in_report").length,
    ambiguous: pairs.filter((pair) => pair.status === "ambiguous").length,
    reportTotalUsd: Math.round(reportRows.reduce((sum, row) => sum + row.amountUsd, 0) * 100) / 100,
    systemTotalUsd: Math.round(tickets.reduce((sum, ticket) => sum + ticket.amount, 0) * 100) / 100,
  };

  return {
    month,
    sheetName: parsed.sheetName,
    monthsDetected: parsed.monthsDetected,
    summary,
    pairs,
  };
}
