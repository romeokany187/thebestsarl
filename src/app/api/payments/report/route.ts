import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { getTicketTotalAmount } from "@/lib/ticket-pricing";
import { ALL_CASH_DESKS, buildDeskScopedCashOperationWhere, normalizeCashDeskValue } from "@/lib/payments-desk";

type ReportMode = "date" | "month" | "year";
type ReportType = "payments" | "cash-journal" | "cash-summary";
type VirtualChannel = "AIRTEL_MONEY" | "ORANGE_MONEY" | "MPESA" | "EQUITY" | "RAWBANK_ILLICOCASH";

const paymentClient = (prisma as unknown as { payment: any }).payment;
const cashOperationClient = (prisma as unknown as { cashOperation: any }).cashOperation;
const virtualChannels: Array<{ key: VirtualChannel; label: string }> = [
  { key: "AIRTEL_MONEY", label: "Airtel Money" },
  { key: "ORANGE_MONEY", label: "Orange Money" },
  { key: "MPESA", label: "M-Pesa" },
  { key: "EQUITY", label: "Equity" },
  { key: "RAWBANK_ILLICOCASH", label: "Rawbank & Illicocash" },
];

function parseYear(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return null;
  return parsed;
}

function dateRangeFromParams(params: URLSearchParams, defaultMode: ReportMode = "date") {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");

  if (startDate || endDate) {
    const startRaw = startDate ?? defaultDay;
    const endRaw = endDate ?? startRaw;
    const start = new Date(`${startRaw}T00:00:00.000Z`);
    const end = new Date(`${endRaw}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end, label: `Rapport du ${startRaw} au ${endRaw}` };
  }

  if (params.get("mode") === "week") {
    const nowDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayIndex = nowDay.getUTCDay();
    const diffToMonday = (dayIndex + 6) % 7;
    const defaultMonday = new Date(nowDay);
    defaultMonday.setUTCDate(defaultMonday.getUTCDate() - diffToMonday);
    const rawWeekStart = params.get("weekStart");
    const monday = rawWeekStart ? new Date(`${rawWeekStart}T00:00:00.000Z`) : defaultMonday;
    const start = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return {
      start,
      end,
      label: `Rapport hebdomadaire du ${start.toISOString().slice(0, 10)} au ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`,
    };
  }

  const mode = (["date", "month", "year"].includes(params.get("mode") ?? "")
    ? params.get("mode")
    : defaultMode) as ReportMode;

  if (mode === "year") {
    const year = parseYear(params.get("year")) ?? now.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    return { start, end, label: `Rapport annuel ${year}` };
  }

  if (mode === "month") {
    const rawMonth = params.get("month");
    const monthMatch = rawMonth?.match(/^(\d{4})-(\d{2})$/);
    const year = monthMatch ? Number.parseInt(monthMatch[1], 10) : now.getUTCFullYear();
    const month = monthMatch ? Number.parseInt(monthMatch[2], 10) - 1 : now.getUTCMonth();
    const safeMonth = Math.min(11, Math.max(0, month));
    const start = new Date(Date.UTC(year, safeMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, safeMonth + 1, 1, 0, 0, 0, 0));
    return { start, end, label: `Rapport mensuel ${start.toISOString().slice(0, 7)}` };
  }

  const rawDate = params.get("date");
  const date = rawDate ? new Date(`${rawDate}T00:00:00.000Z`) : now;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0));
  return { start, end, label: `Rapport du ${start.toISOString().slice(0, 10)}` };
}

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  return normalized === "CDF" || normalized === "XAF" || normalized === "FC" ? "CDF" : "USD";
}

function normalizeAmountUsd(entry: {
  amount: number;
  currency?: string | null;
  amountUsd?: number | null;
  fxRateUsdToCdf?: number | null;
  fxRateToUsd?: number | null;
}): number {
  if (typeof entry.amountUsd === "number") return entry.amountUsd;
  const currency = normalizeMoneyCurrency(entry.currency);
  if (currency === "USD") return entry.amount;
  const rate = entry.fxRateUsdToCdf ?? (entry.fxRateToUsd && entry.fxRateToUsd > 0 ? 1 / entry.fxRateToUsd : 2800);
  return entry.amount / rate;
}

function normalizeAmountCdf(entry: {
  amount: number;
  currency?: string | null;
  amountCdf?: number | null;
  fxRateUsdToCdf?: number | null;
  fxRateToUsd?: number | null;
}): number {
  if (typeof entry.amountCdf === "number") return entry.amountCdf;
  const currency = normalizeMoneyCurrency(entry.currency);
  if (currency === "CDF") return entry.amount;
  const rate = entry.fxRateUsdToCdf ?? (entry.fxRateToUsd && entry.fxRateToUsd > 0 ? 1 / entry.fxRateToUsd : 2800);
  return entry.amount * rate;
}

function normalizePaymentAmountForTicket(payment: {
  amount: number;
  currency?: string | null;
  amountUsd?: number | null;
  amountCdf?: number | null;
  fxRateUsdToCdf?: number | null;
  fxRateToUsd?: number | null;
}, ticketCurrencyRaw: string | null | undefined): number {
  const ticketCurrency = normalizeMoneyCurrency(ticketCurrencyRaw);
  const paymentCurrency = normalizeMoneyCurrency(payment.currency ?? ticketCurrencyRaw);
  if (ticketCurrency === paymentCurrency) return payment.amount;
  return ticketCurrency === "USD" ? normalizeAmountUsd(payment) : normalizeAmountCdf(payment);
}

function detectVirtualChannel(methodRaw: string | null | undefined): VirtualChannel | null {
  const method = (methodRaw ?? "").trim().toUpperCase();
  if (!method) return null;
  if (method.includes("AIRTEL")) return "AIRTEL_MONEY";
  if (method.includes("ORANGE")) return "ORANGE_MONEY";
  if (method.includes("M-PESA") || method.includes("MPESA") || method.includes("M PESA")) return "MPESA";
  if (method.includes("EQUITY")) return "EQUITY";
  if (
    method.includes("RAWBANK")
    || method.includes("ROWBANK")
    || method.includes("ROW BANK")
    || method.includes("ILLICOCASH")
    || method.includes("ILLICO CASH")
    || method.includes("ILLICO")
  ) return "RAWBANK_ILLICOCASH";
  return null;
}

type BalanceBucket = "CASH" | VirtualChannel;
type BalanceSnapshot = {
  usd: number;
  cdf: number;
  initializedUsd: boolean;
  initializedCdf: boolean;
};

function buildEmptyOpeningBuckets(): Record<BalanceBucket, BalanceSnapshot> {
  return {
    CASH: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
    AIRTEL_MONEY: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
    ORANGE_MONEY: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
    MPESA: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
    EQUITY: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
    RAWBANK_ILLICOCASH: { usd: 0, cdf: 0, initializedUsd: false, initializedCdf: false },
  };
}

function bucketFromMethod(methodRaw: string | null | undefined): BalanceBucket {
  return detectVirtualChannel(methodRaw) ?? "CASH";
}

function computeOpeningBuckets(
  ticketPayments: Array<{ amount: number; currency?: string | null; method?: string | null; paidAt?: Date | string | null }>,
  cashOperations: Array<{ amount: number; currency?: string | null; method?: string | null; direction: string; category?: string | null; occurredAt?: Date | string | null }>,
): Record<BalanceBucket, BalanceSnapshot> {
  const buckets = buildEmptyOpeningBuckets();
  const openingApplied = new Map<BalanceBucket, { usd: boolean; cdf: boolean }>();
  const events = [
    ...ticketPayments.map((payment) => ({
      at: new Date(payment.paidAt ?? new Date(0)),
      bucket: bucketFromMethod(payment.method),
      currency: normalizeMoneyCurrency(payment.currency),
      amount: payment.amount,
      direction: "INFLOW" as const,
      category: null,
    })),
    ...cashOperations.map((operation) => ({
      at: new Date(operation.occurredAt ?? new Date(0)),
      bucket: bucketFromMethod(operation.method),
      currency: normalizeMoneyCurrency(operation.currency),
      amount: operation.amount,
      direction: operation.direction === "OUTFLOW" ? "OUTFLOW" as const : "INFLOW" as const,
      category: operation.category ?? null,
    })),
  ].sort((a, b) => {
    const diff = a.at.getTime() - b.at.getTime();
    if (diff !== 0) return diff;
    if (a.category === "OPENING_BALANCE") return -1;
    if (b.category === "OPENING_BALANCE") return 1;
    return 0;
  });

  for (const event of events) {
    const snapshot = buckets[event.bucket];
    const flags = openingApplied.get(event.bucket) ?? { usd: false, cdf: false };

    if (event.category === "OPENING_BALANCE") {
      if (event.currency === "USD") {
        if (flags.usd) continue;
        snapshot.usd = event.amount;
        snapshot.initializedUsd = true;
        flags.usd = true;
      } else {
        if (flags.cdf) continue;
        snapshot.cdf = event.amount;
        snapshot.initializedCdf = true;
        flags.cdf = true;
      }
      openingApplied.set(event.bucket, flags);
      continue;
    }

    if (event.currency === "USD") {
      snapshot.usd += event.direction === "INFLOW" ? event.amount : -event.amount;
      snapshot.initializedUsd = true;
    } else {
      snapshot.cdf += event.direction === "INFLOW" ? event.amount : -event.amount;
      snapshot.initializedCdf = true;
    }
  }

  return buckets;
}

function applyOpeningFallbackFromCurrentPeriod(
  baseBuckets: Record<BalanceBucket, BalanceSnapshot>,
  cashOperations: Array<{ amount: number; currency?: string | null; method?: string | null; category?: string | null; occurredAt?: Date | string | null }>,
): Record<BalanceBucket, BalanceSnapshot> {
  const buckets = Object.fromEntries(
    Object.entries(baseBuckets).map(([key, value]) => [key, { ...value }]),
  ) as Record<BalanceBucket, BalanceSnapshot>;

  const openingOperations = cashOperations
    .filter((operation) => operation.category === "OPENING_BALANCE")
    .sort((a, b) => new Date(a.occurredAt ?? new Date(0)).getTime() - new Date(b.occurredAt ?? new Date(0)).getTime());

  for (const operation of openingOperations) {
    const bucket = bucketFromMethod(operation.method);
    const snapshot = buckets[bucket];
    const currency = normalizeMoneyCurrency(operation.currency);

    if (currency === "USD" && !snapshot.initializedUsd) {
      snapshot.usd = operation.amount;
      snapshot.initializedUsd = true;
    }

    if (currency === "CDF" && !snapshot.initializedCdf) {
      snapshot.cdf = operation.amount;
      snapshot.initializedCdf = true;
    }
  }

  return buckets;
}

function bucketUsdEquivalent(snapshot: Pick<BalanceSnapshot, "usd" | "cdf">, fxRateUsdToCdf = 2800) {
  return snapshot.usd + (snapshot.cdf / fxRateUsdToCdf);
}

function short(value: string, max: number) {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function wrapTextToWidth(value: string, font: any, fontSize: number, maxWidth: number) {
  const clean = value.trim();
  if (!clean) return ["-"];

  const lines: string[] = [];
  let currentLine = "";

  const pushWord = (word: string) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
      return;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = "";
    }

    if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
      currentLine = word;
      return;
    }

    let chunk = "";
    for (const char of word) {
      const nextChunk = `${chunk}${char}`;
      if (font.widthOfTextAtSize(nextChunk, fontSize) <= maxWidth) {
        chunk = nextChunk;
      } else {
        if (chunk) lines.push(chunk);
        chunk = char;
      }
    }
    currentLine = chunk;
  };

  clean.split(/\s+/).forEach(pushWord);
  if (currentLine) lines.push(currentLine);
  return lines;
}

async function readFirstExistingFile(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      return await readFile(path.join(process.cwd(), candidate));
    } catch {
      continue;
    }
  }
  return null;
}

async function loadPaymentReportFonts(pdf: PDFDocument) {
  pdf.registerFontkit(fontkit);
  const bodyBytes = await readFirstExistingFile([
    "public/fonts/MAIAN.TTF",
    "public/fonts/Montserrat-Regular.ttf",
    "public/branding/fonts/Montserrat-Regular.ttf",
  ]);

  const body = bodyBytes ? await pdf.embedFont(bodyBytes) : await pdf.embedFont(StandardFonts.Helvetica);
  const bold = bodyBytes ? await pdf.embedFont(bodyBytes) : await pdf.embedFont(StandardFonts.HelveticaBold);
  return { body, bold };
}

function drawFooter(pdf: PDFDocument, font: any, generatedBy: string, textBlack: any, lineGray: any) {
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    const pageWidth = page.getWidth();
    page.drawLine({ start: { x: 24, y: 20 }, end: { x: pageWidth - 24, y: 20 }, thickness: 0.6, color: lineGray });
    page.drawText(`Page ${index + 1}/${pages.length}`, { x: 24, y: 10, size: 8, font, color: textBlack });
    const rightText = `Par ${generatedBy}`;
    const rightWidth = font.widthOfTextAtSize(rightText, 8);
    page.drawText(rightText, { x: pageWidth - 24 - rightWidth, y: 10, size: 8, font, color: textBlack });
  });
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const reportType = (["payments", "cash-journal", "cash-summary"].includes(request.nextUrl.searchParams.get("reportType") ?? "")
    ? request.nextUrl.searchParams.get("reportType")
    : "payments") as ReportType;
  const requestedDesk = normalizeCashDeskValue(request.nextUrl.searchParams.get("desk"));
  const selectedDesk = requestedDesk ?? "THE_BEST";
  const mainDesk = selectedDesk === "THE_BEST";
  const scopedCashOperationsWhere = buildDeskScopedCashOperationWhere(selectedDesk, { strict: true });
  const range = dateRangeFromParams(
    request.nextUrl.searchParams,
    reportType === "cash-journal" || reportType === "cash-summary" ? "month" : "date",
  );
  const airlineId = request.nextUrl.searchParams.get("airlineId")?.trim() || undefined;

  const [rows, tickets, airline, cashOperationsInRange, cashOperationsBeforeRange, ticketPaymentsBeforeRange] = await Promise.all([
    paymentClient.findMany({
      where: {
        ...(mainDesk ? { paidAt: { gte: range.start, lt: range.end } } : { id: "__NO_TICKET_PAYMENTS_FOR_DESK__" }),
        ...(airlineId ? { ticket: { airlineId } } : {}),
      },
      include: {
        ticket: {
          include: {
            airline: { select: { code: true, name: true } },
            seller: { select: { name: true } },
          },
        },
      },
      orderBy: { paidAt: "asc" },
      take: 4000,
    }),
    prisma.ticketSale.findMany({
      where: {
        soldAt: { gte: range.start, lt: range.end },
        ...(airlineId ? { airlineId } : {}),
      },
      include: {
        payments: true,
        airline: { select: { code: true } },
      },
      orderBy: { soldAt: "asc" },
      take: 4000,
    }),
    airlineId
      ? prisma.airline.findUnique({ where: { id: airlineId }, select: { code: true, name: true } })
      : Promise.resolve(null),
    cashOperationClient.findMany({
      where: { occurredAt: { gte: range.start, lt: range.end }, ...scopedCashOperationsWhere },
      select: {
        occurredAt: true,
        direction: true,
        category: true,
        amount: true,
        currency: true,
        amountUsd: true,
        amountCdf: true,
        fxRateToUsd: true,
        fxRateUsdToCdf: true,
        method: true,
        reference: true,
        description: true,
      },
      orderBy: { occurredAt: "asc" },
      take: 5000,
    }),
    cashOperationClient.findMany({
      where: { occurredAt: { lt: range.start }, ...scopedCashOperationsWhere },
      select: {
        occurredAt: true,
        direction: true,
        category: true,
        amount: true,
        currency: true,
        amountUsd: true,
        amountCdf: true,
        fxRateToUsd: true,
        fxRateUsdToCdf: true,
        method: true,
        reference: true,
        description: true,
      },
      orderBy: { occurredAt: "asc" },
      take: 5000,
    }),
    paymentClient.findMany({
      where: mainDesk ? { paidAt: { lt: range.start } } : { id: "__NO_TICKET_PAYMENTS_FOR_DESK__" },
      select: {
        paidAt: true,
        amount: true,
        currency: true,
        amountUsd: true,
        amountCdf: true,
        fxRateUsdToCdf: true,
        method: true,
      },
      take: 5000,
    }),
  ]);

  const ticketsWithStatus = tickets.map((ticket) => {
    const paidAmount = ticket.payments.reduce(
      (
        sum: number,
        payment: { amount: number; currency?: string | null; amountUsd?: number | null; amountCdf?: number | null; fxRateUsdToCdf?: number | null; fxRateToUsd?: number | null },
      ) => sum + normalizePaymentAmountForTicket(payment, ticket.currency),
      0,
    );
    const paidAmountUsd = ticket.payments.reduce(
      (
        sum: number,
        payment: { amount: number; currency?: string | null; amountUsd?: number | null; amountCdf?: number | null; fxRateUsdToCdf?: number | null; fxRateToUsd?: number | null },
      ) => sum + normalizeAmountUsd(payment),
      0,
    );
    const totalTicketAmount = getTicketTotalAmount(ticket);
    const amountUsd = normalizeAmountUsd({ amount: totalTicketAmount, currency: ticket.currency });
    const computedStatus = paidAmount <= 0
      ? "UNPAID"
      : paidAmount + 0.0001 >= totalTicketAmount
        ? "PAID"
        : "PARTIAL";

    return {
      ...ticket,
      paidAmount,
      paidAmountUsd,
      amountUsd,
      totalTicketAmount,
      computedStatus,
    };
  });

  const totalBilled = ticketsWithStatus.reduce((sum, ticket) => sum + ticket.amountUsd, 0);
  const totalPaidOnTickets = ticketsWithStatus.reduce((sum, ticket) => sum + ticket.paidAmountUsd, 0);
  const totalOutstanding = Math.max(0, totalBilled - totalPaidOnTickets);
  const paidTickets = ticketsWithStatus.filter((ticket) => ticket.computedStatus === "PAID");
  const unpaidTickets = ticketsWithStatus.filter((ticket) => ticket.computedStatus === "UNPAID");
  const partialTickets = ticketsWithStatus.filter((ticket) => ticket.computedStatus === "PARTIAL");
  const partialBilled = partialTickets.reduce((sum, ticket) => sum + ticket.amountUsd, 0);
  const partialPaid = partialTickets.reduce((sum, ticket) => sum + ticket.paidAmountUsd, 0);
  const partialCoverage = partialBilled > 0 ? (partialPaid / partialBilled) * 100 : 0;

  const byMethod = (rows as Array<any>).reduce<Map<string, number>>((map, row) => {
    const key = row.method.trim() || "AUTRE";
    map.set(key, (map.get(key) ?? 0) + normalizeAmountUsd(row));
    return map;
  }, new Map<string, number>());
  const topMethods = Array.from(byMethod.entries())
    .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
    .slice(0, 4);

  const openingBuckets = computeOpeningBuckets(ticketPaymentsBeforeRange, cashOperationsBeforeRange);
  const displayOpeningBuckets = applyOpeningFallbackFromCurrentPeriod(openingBuckets, cashOperationsInRange);
  const cashOperationsWithoutOpeningBalance = cashOperationsInRange.filter((operation: any) => operation.category !== "OPENING_BALANCE");
  const openingBalance = (Object.values(displayOpeningBuckets) as Array<BalanceSnapshot>).reduce(
    (sum, snapshot) => sum + bucketUsdEquivalent(snapshot),
    0,
  );
  const openingUsd = displayOpeningBuckets.CASH.usd;
  const openingCdf = displayOpeningBuckets.CASH.cdf;

  const ticketPaymentInflowsUsdEq = rows.reduce((sum: number, payment: any) => sum + normalizeAmountUsd(payment), 0);
  const ticketPaymentInflowUsd = rows.filter((payment: any) => normalizeMoneyCurrency(payment.currency ?? payment.ticket.currency) === "USD").reduce((sum: number, payment: any) => sum + payment.amount, 0);
  const ticketPaymentInflowCdf = rows.filter((payment: any) => normalizeMoneyCurrency(payment.currency ?? payment.ticket.currency) === "CDF").reduce((sum: number, payment: any) => sum + payment.amount, 0);

  const otherInflowsUsdEq = cashOperationsWithoutOpeningBalance.filter((op: any) => op.direction === "INFLOW").reduce((sum: number, op: any) => sum + normalizeAmountUsd(op), 0);
  const cashOutflowsUsdEq = cashOperationsWithoutOpeningBalance.filter((op: any) => op.direction === "OUTFLOW").reduce((sum: number, op: any) => sum + normalizeAmountUsd(op), 0);
  const grossInflows = ticketPaymentInflowsUsdEq + otherInflowsUsdEq;
  const netCashVariation = grossInflows - cashOutflowsUsdEq;
  const closingBalance = openingBalance + netCashVariation;

  const cashInflowUsd = cashOperationsWithoutOpeningBalance.filter((op: any) => op.direction === "INFLOW" && normalizeMoneyCurrency(op.currency) === "USD").reduce((sum: number, op: any) => sum + op.amount, 0);
  const cashOutflowUsd = cashOperationsWithoutOpeningBalance.filter((op: any) => op.direction === "OUTFLOW" && normalizeMoneyCurrency(op.currency) === "USD").reduce((sum: number, op: any) => sum + op.amount, 0);
  const cashInflowCdf = cashOperationsWithoutOpeningBalance.filter((op: any) => op.direction === "INFLOW" && normalizeMoneyCurrency(op.currency) === "CDF").reduce((sum: number, op: any) => sum + op.amount, 0);
  const cashOutflowCdf = cashOperationsWithoutOpeningBalance.filter((op: any) => op.direction === "OUTFLOW" && normalizeMoneyCurrency(op.currency) === "CDF").reduce((sum: number, op: any) => sum + op.amount, 0);

  const closingUsd = openingUsd + ticketPaymentInflowUsd + cashInflowUsd - cashOutflowUsd;
  const closingCdf = openingCdf + ticketPaymentInflowCdf + cashInflowCdf - cashOutflowCdf;
  const accountingConsistency = Math.abs((openingBalance + grossInflows - cashOutflowsUsdEq) - closingBalance) <= 0.0001;

  const caisseRows = [
    ...rows.map((payment: any) => {
      const currency = normalizeMoneyCurrency(payment.currency ?? payment.ticket.currency);
      return {
        occurredAt: new Date(payment.paidAt),
        typeOperation: "Entrée en caisse",
        libelle: `Paiement billet ${payment.ticket.ticketNumber} - ${payment.ticket.customerName}`,
        reference: payment.reference ?? "-",
        usdIn: currency === "USD" ? payment.amount : 0,
        usdOut: 0,
        cdfIn: currency === "CDF" ? payment.amount : 0,
        cdfOut: 0,
      };
    }),
    ...cashOperationsWithoutOpeningBalance.map((operation: any) => {
      const currency = normalizeMoneyCurrency(operation.currency);
      const isInflow = operation.direction === "INFLOW";
      return {
        occurredAt: new Date(operation.occurredAt),
        typeOperation: isInflow ? "Entrée en caisse" : "Sortie en caisse",
        libelle: operation.description,
        reference: operation.reference ?? "-",
        usdIn: isInflow && currency === "USD" ? operation.amount : 0,
        usdOut: !isInflow && currency === "USD" ? operation.amount : 0,
        cdfIn: isInflow && currency === "CDF" ? operation.amount : 0,
        cdfOut: !isInflow && currency === "CDF" ? operation.amount : 0,
      };
    }),
  ].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  let runningUsd = openingUsd;
  let runningCdf = openingCdf;
  const caisseLedger = caisseRows.map((row) => {
    runningUsd += row.usdIn - row.usdOut;
    runningCdf += row.cdfIn - row.cdfOut;
    return {
      ...row,
      usdBalance: runningUsd,
      cdfBalance: runningCdf,
    };
  });

  const initialVirtualStats = Object.fromEntries(
    virtualChannels.map(({ key }) => [
      key,
      {
        openingUsd: displayOpeningBuckets[key].usd,
        openingCdf: displayOpeningBuckets[key].cdf,
        inUsd: 0,
        outUsd: 0,
        inCdf: 0,
        outCdf: 0,
      },
    ]),
  ) as Record<VirtualChannel, { openingUsd: number; openingCdf: number; inUsd: number; outUsd: number; inCdf: number; outCdf: number }>;
  const cashBilletageStats = {
    openingUsd: displayOpeningBuckets.CASH.usd,
    openingCdf: displayOpeningBuckets.CASH.cdf,
    inUsd: 0,
    outUsd: 0,
    inCdf: 0,
    outCdf: 0,
  };

  for (const payment of rows as Array<any>) {
    const channel = detectVirtualChannel(payment.method);
    const currency = normalizeMoneyCurrency(payment.currency);
    if (!channel) {
      if (currency === "USD") cashBilletageStats.inUsd += payment.amount;
      else cashBilletageStats.inCdf += payment.amount;
      continue;
    }
    if (currency === "USD") initialVirtualStats[channel].inUsd += payment.amount;
    else initialVirtualStats[channel].inCdf += payment.amount;
  }

  for (const operation of cashOperationsWithoutOpeningBalance as Array<any>) {
    const channel = detectVirtualChannel(operation.method);
    const currency = normalizeMoneyCurrency(operation.currency);
    const target = !channel ? cashBilletageStats : initialVirtualStats[channel];
    if (currency === "USD") {
      if (operation.direction === "INFLOW") target.inUsd += operation.amount;
      else target.outUsd += operation.amount;
    } else {
      if (operation.direction === "INFLOW") target.inCdf += operation.amount;
      else target.outCdf += operation.amount;
    }
  }

  const virtualRows = virtualChannels.map(({ key, label }) => {
    const stats = initialVirtualStats[key];
    return {
      key,
      label,
      ...stats,
      closingUsd: stats.openingUsd + stats.inUsd - stats.outUsd,
      closingCdf: stats.openingCdf + stats.inCdf - stats.outCdf,
    };
  });
  const channelRows = [
    ...virtualRows,
    {
      key: "CASH",
      label: "Cash / Billetage",
      ...cashBilletageStats,
      closingUsd: cashBilletageStats.openingUsd + cashBilletageStats.inUsd - cashBilletageStats.outUsd,
      closingCdf: cashBilletageStats.openingCdf + cashBilletageStats.inCdf - cashBilletageStats.outCdf,
    },
  ];
  const channelTotals = channelRows.reduce(
    (sum, row) => {
      sum.openingUsd += row.openingUsd;
      sum.openingCdf += row.openingCdf;
      sum.inUsd += row.inUsd;
      sum.outUsd += row.outUsd;
      sum.inCdf += row.inCdf;
      sum.outCdf += row.outCdf;
      sum.closingUsd += row.closingUsd;
      sum.closingCdf += row.closingCdf;
      return sum;
    },
    {
      openingUsd: 0,
      openingCdf: 0,
      inUsd: 0,
      outUsd: 0,
      inCdf: 0,
      outCdf: 0,
      closingUsd: 0,
      closingCdf: 0,
    },
  );

  const pdf = await PDFDocument.create();
  const { body: font, bold: fontBold } = await loadPaymentReportFonts(pdf);
  const textBlack = rgb(0, 0, 0);
  const lineGray = rgb(0.84, 0.84, 0.84);
  const generatedBy = access.session.user.name ?? access.session.user.email ?? "Utilisateur";
  const periodStart = range.start.toISOString().slice(0, 10);
  const periodEnd = new Date(range.end.getTime() - 1).toISOString().slice(0, 10);
  const selectedDeskLabel = ALL_CASH_DESKS.find((desk) => desk.value === selectedDesk)?.label ?? selectedDesk;
  const subtitle = airline
    ? `${range.label} • ${airline.code} - ${airline.name} • ${selectedDeskLabel}`
    : `${range.label} • Toutes compagnies • ${selectedDeskLabel}`;
  let filenameBase = "rapport-paiements";

  if (reportType === "cash-journal") {
    filenameBase = "journal-caisse";
    const pageWidth = 1191;
    const pageHeight = 842;
    const margin = 28;
    let page = pdf.addPage([pageWidth, pageHeight]);

    const columns = [
      { key: "date", label: "Date", width: 72 },
      { key: "type", label: "Type d'opération", width: 128 },
      { key: "libelle", label: "Libellé", width: 352 },
      { key: "usdIn", label: "USD +", width: 74 },
      { key: "usdOut", label: "USD -", width: 74 },
      { key: "usdBalance", label: "USD solde", width: 88 },
      { key: "cdfIn", label: "CDF +", width: 84 },
      { key: "cdfOut", label: "CDF -", width: 84 },
      { key: "cdfBalance", label: "CDF solde", width: 96 },
      { key: "reference", label: "Référence", width: 80 },
    ] as const;
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const tableX = margin;
    const lineHeight = 11;
    const bodySize = 9.2;

    const drawHeader = (continuation = false) => {
      page.drawRectangle({ x: 0, y: pageHeight - 108, width: pageWidth, height: 108, color: rgb(0.09, 0.1, 0.14) });
      page.drawText(`THEBEST SARL - Journal de caisse${continuation ? " (suite)" : ""}`, {
        x: margin,
        y: pageHeight - 34,
        size: 21,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
      page.drawText(subtitle, { x: margin, y: pageHeight - 58, size: 11, font, color: rgb(0.87, 0.89, 0.93) });
      page.drawText(`Période du ${periodStart} au ${periodEnd}`, { x: margin, y: pageHeight - 76, size: 10, font, color: rgb(0.76, 0.8, 0.87) });

      const cards = [
        `Ouverture USD\n${openingUsd.toFixed(2)} USD`,
        `Clôture USD\n${closingUsd.toFixed(2)} USD`,
        `Ouverture CDF\n${openingCdf.toFixed(2)} CDF`,
        `Clôture CDF\n${closingCdf.toFixed(2)} CDF`,
      ];
      const cardWidth = 172;
      const cardY = pageHeight - 146;
      cards.forEach((text, index) => {
        const x = margin + index * (cardWidth + 14);
        page.drawRectangle({ x, y: cardY, width: cardWidth, height: 46, borderWidth: 0.7, borderColor: rgb(0.82, 0.84, 0.9), color: rgb(0.98, 0.98, 0.99) });
        const [title, value] = text.split("\n");
        page.drawText(title, { x: x + 10, y: cardY + 28, size: 8.8, font: fontBold, color: rgb(0.22, 0.24, 0.28) });
        page.drawText(value, { x: x + 10, y: cardY + 12, size: 10.5, font, color: textBlack });
      });
    };

    const drawTableHeader = (topY: number) => {
      page.drawRectangle({ x: tableX, y: topY - 28, width: tableWidth, height: 28, color: rgb(0.9, 0.92, 0.96), borderWidth: 0.8, borderColor: rgb(0.63, 0.67, 0.76) });
      let cursorX = tableX;
      columns.forEach((column) => {
        page.drawText(column.label, { x: cursorX + 6, y: topY - 18, size: 9.2, font: fontBold, color: rgb(0.12, 0.14, 0.18) });
        cursorX += column.width;
      });
    };

    drawHeader();
    drawTableHeader(pageHeight - 184);
    let y = pageHeight - 224;

    const openingRowHeight = 28;
    page.drawRectangle({ x: tableX, y: y - openingRowHeight + 6, width: tableWidth, height: openingRowHeight, color: rgb(0.97, 0.97, 0.98), borderWidth: 0.5, borderColor: rgb(0.88, 0.89, 0.92) });
    let openingX = tableX;
    const openingValues = [
      periodStart,
      "Solde d'ouverture",
      "Report à nouveau automatique de la caisse active",
      "-",
      "-",
      openingUsd.toFixed(2),
      "-",
      "-",
      openingCdf.toFixed(2),
      "-",
    ];
    openingValues.forEach((value, index) => {
      page.drawText(value, { x: openingX + 6, y: y - 10, size: 9.1, font: index === 1 ? fontBold : font, color: textBlack });
      openingX += columns[index].width;
    });
    y -= 36;

    for (const [rowIndex, row] of caisseLedger.entries()) {
      const cellMap = {
        date: [row.occurredAt.toISOString().slice(0, 10)],
        type: wrapTextToWidth(row.typeOperation, font, bodySize, columns[1].width - 10),
        libelle: wrapTextToWidth(row.libelle, font, bodySize, columns[2].width - 10),
        usdIn: [row.usdIn > 0 ? row.usdIn.toFixed(2) : "-"],
        usdOut: [row.usdOut > 0 ? row.usdOut.toFixed(2) : "-"],
        usdBalance: [row.usdBalance.toFixed(2)],
        cdfIn: [row.cdfIn > 0 ? row.cdfIn.toFixed(2) : "-"],
        cdfOut: [row.cdfOut > 0 ? row.cdfOut.toFixed(2) : "-"],
        cdfBalance: [row.cdfBalance.toFixed(2)],
        reference: wrapTextToWidth(row.reference, font, bodySize, columns[9].width - 10),
      } as const;
      const maxLines = Math.max(...Object.values(cellMap).map((lines) => lines.length));
      const rowHeight = Math.max(30, maxLines * lineHeight + 10);

      if (y - rowHeight < 42) {
        page = pdf.addPage([pageWidth, pageHeight]);
        drawHeader(true);
        drawTableHeader(pageHeight - 184);
        y = pageHeight - 224;
      }

      page.drawRectangle({
        x: tableX,
        y: y - rowHeight + 6,
        width: tableWidth,
        height: rowHeight,
        color: rowIndex % 2 === 0 ? rgb(1, 1, 1) : rgb(0.985, 0.987, 0.992),
        borderWidth: 0.35,
        borderColor: rgb(0.9, 0.91, 0.94),
      });

      let cursorX = tableX;
      columns.forEach((column) => {
        const lines = cellMap[column.key];
        const startY = y - 11;
        lines.forEach((line, index) => {
          page.drawText(line, { x: cursorX + 6, y: startY - index * lineHeight, size: bodySize, font, color: textBlack });
        });
        cursorX += column.width;
      });

      y -= rowHeight + 6;
    }
  } else if (reportType === "cash-summary") {
    filenameBase = "recap-caisse";
    const page = pdf.addPage([1000, 700]);
    const margin = 30;

    page.drawRectangle({ x: 0, y: 610, width: 1000, height: 90, color: rgb(0.09, 0.1, 0.14) });
    page.drawText("THEBEST SARL - Récapitulatif de caisse", { x: margin, y: 656, size: 21, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText(subtitle, { x: margin, y: 634, size: 11, font, color: rgb(0.87, 0.89, 0.93) });
    page.drawText(`Période du ${periodStart} au ${periodEnd}`, { x: margin, y: 618, size: 10, font, color: rgb(0.76, 0.8, 0.87) });

    const cards = [
      { title: "Ouverture USD", value: `${openingUsd.toFixed(2)} USD` },
      { title: "Clôture USD", value: `${closingUsd.toFixed(2)} USD` },
      { title: "Ouverture CDF", value: `${openingCdf.toFixed(2)} CDF` },
      { title: "Clôture CDF", value: `${closingCdf.toFixed(2)} CDF` },
    ];
    cards.forEach((card, index) => {
      const x = margin + index * 235;
      page.drawRectangle({ x, y: 540, width: 205, height: 54, borderWidth: 0.7, borderColor: rgb(0.82, 0.84, 0.9), color: rgb(0.985, 0.986, 0.99) });
      page.drawText(card.title, { x: x + 12, y: 572, size: 9.2, font: fontBold, color: rgb(0.22, 0.24, 0.28) });
      page.drawText(card.value, { x: x + 12, y: 550, size: 13, font, color: textBlack });
    });

    page.drawText("Situation de la caisse active", { x: margin, y: 510, size: 14, font: fontBold, color: textBlack });
    const summaryLines = [
      `USD: ouverture ${openingUsd.toFixed(2)} • paiements billets ${ticketPaymentInflowUsd.toFixed(2)} • autres entrées ${cashInflowUsd.toFixed(2)} • sorties ${cashOutflowUsd.toFixed(2)} • clôture ${closingUsd.toFixed(2)}.`,
      `CDF: ouverture ${openingCdf.toFixed(2)} • paiements billets ${ticketPaymentInflowCdf.toFixed(2)} • autres entrées ${cashInflowCdf.toFixed(2)} • sorties ${cashOutflowCdf.toFixed(2)} • clôture ${closingCdf.toFixed(2)}.`,
      `Contrôle global USD équivalent: ouverture ${openingBalance.toFixed(2)} • entrées ${grossInflows.toFixed(2)} • sorties ${cashOutflowsUsdEq.toFixed(2)} • variation ${netCashVariation.toFixed(2)} • clôture ${closingBalance.toFixed(2)} (${accountingConsistency ? "OK" : "Écart"}).`,
    ];
    summaryLines.forEach((line, index) => {
      page.drawText(line, { x: margin, y: 488 - index * 18, size: 10.4, font, color: textBlack, maxWidth: 940 });
    });

    page.drawText("Soldes par canal de la caisse", { x: margin, y: 425, size: 14, font: fontBold, color: textBlack });
    const headers = ["Canal", "Ouv USD", "Entrées USD", "Sorties USD", "Clôture USD", "Ouv CDF", "Entrées CDF", "Sorties CDF", "Clôture CDF"];
    const x = [30, 180, 280, 395, 515, 640, 740, 845, 935];
    page.drawRectangle({ x: margin, y: 392, width: 940, height: 28, color: rgb(0.9, 0.92, 0.96), borderWidth: 0.8, borderColor: rgb(0.63, 0.67, 0.76) });
    headers.forEach((header, index) => {
      page.drawText(header, { x: x[index], y: 402, size: 9.1, font: fontBold, color: rgb(0.12, 0.14, 0.18) });
    });

    let y = 382;
    for (const [rowIndex, row] of channelRows.entries()) {
      page.drawRectangle({ x: margin, y: y - 22, width: 940, height: 26, color: rowIndex % 2 === 0 ? rgb(1, 1, 1) : rgb(0.985, 0.987, 0.992), borderWidth: 0.35, borderColor: rgb(0.9, 0.91, 0.94) });
      const values = [
        row.label,
        row.openingUsd.toFixed(2),
        row.inUsd.toFixed(2),
        row.outUsd.toFixed(2),
        row.closingUsd.toFixed(2),
        row.openingCdf.toFixed(2),
        row.inCdf.toFixed(2),
        row.outCdf.toFixed(2),
        row.closingCdf.toFixed(2),
      ];
      values.forEach((value, index) => {
        page.drawText(value, { x: x[index], y: y - 12, size: 9.3, font: index === 0 ? fontBold : font, color: textBlack });
      });
      y -= 30;
    }

    page.drawRectangle({ x: margin, y: y - 24, width: 940, height: 28, color: rgb(0.95, 0.96, 0.98), borderWidth: 0.5, borderColor: rgb(0.86, 0.88, 0.92) });
    const totalValues = [
      "TOTAL",
      channelTotals.openingUsd.toFixed(2),
      channelTotals.inUsd.toFixed(2),
      channelTotals.outUsd.toFixed(2),
      channelTotals.closingUsd.toFixed(2),
      channelTotals.openingCdf.toFixed(2),
      channelTotals.inCdf.toFixed(2),
      channelTotals.outCdf.toFixed(2),
      channelTotals.closingCdf.toFixed(2),
    ];
    totalValues.forEach((value, index) => {
      page.drawText(value, { x: x[index], y: y - 13, size: 9.5, font: fontBold, color: textBlack });
    });

    page.drawText("Situation billets de cette caisse", { x: margin, y: 118, size: 13.5, font: fontBold, color: textBlack });
    if (mainDesk) {
      page.drawText(`Billets facturés: ${totalBilled.toFixed(2)} USD eq • encaissés: ${totalPaidOnTickets.toFixed(2)} USD eq • reste: ${totalOutstanding.toFixed(2)} USD eq.`, { x: margin, y: 96, size: 10.5, font, color: textBlack });
      page.drawText(`Billets payés: ${paidTickets.length} • impayés: ${unpaidTickets.length} • partiels: ${partialTickets.length} • couverture des partiels: ${partialCoverage.toFixed(1)}%.`, { x: margin, y: 78, size: 10.5, font, color: textBlack });
    } else {
      page.drawText("Cette caisse ne porte pas les paiements billets. Le récapitulatif reste donc limité à ses propres opérations de caisse et canaux associés.", { x: margin, y: 90, size: 10.5, font, color: textBlack, maxWidth: 920 });
    }
  } else {
    const mode = request.nextUrl.searchParams.get("mode") ?? "date";
    const detailLabel = mode === "month"
      ? "Synthèse mensuelle"
      : mode === "week"
        ? "Synthèse hebdomadaire"
        : "Synthèse journalière";

    let page = pdf.addPage([842, 595]);
    const drawHeader = (continuation = false) => {
      page.drawText(`THEBEST SARL - Rapport des paiements${continuation ? " (suite)" : ""}`, {
        x: 24,
        y: 566,
        size: 13,
        font: fontBold,
        color: textBlack,
      });
      page.drawText(subtitle, { x: 24, y: 550, size: 9, font, color: textBlack });
      page.drawText(`Période exacte: ${periodStart} au ${periodEnd}`, { x: 24, y: 538, size: 8.2, font, color: textBlack });
      page.drawLine({ start: { x: 24, y: 532 }, end: { x: 818, y: 532 }, thickness: 0.8, color: lineGray });
    };

    const drawSummary = () => {
      page.drawText(detailLabel, { x: 24, y: 518, size: 8.8, font: fontBold, color: textBlack });
      page.drawText(`Billets: ${ticketsWithStatus.length} • Transactions: ${rows.length}`, { x: 180, y: 518, size: 8.4, font, color: textBlack });
      page.drawText(`Facturé: ${totalBilled.toFixed(2)} USD eq`, { x: 24, y: 505, size: 8.4, font: fontBold, color: textBlack });
      page.drawText(`Encaissé: ${totalPaidOnTickets.toFixed(2)} USD eq`, { x: 190, y: 505, size: 8.4, font: fontBold, color: textBlack });
      page.drawText(`Créance: ${totalOutstanding.toFixed(2)} USD eq`, { x: 360, y: 505, size: 8.4, font: fontBold, color: textBlack });
      page.drawText(`Payés: ${paidTickets.length} • Impayés: ${unpaidTickets.length} • Partiels: ${partialTickets.length}`, { x: 24, y: 492, size: 8.2, font, color: textBlack });
      page.drawText(`Partiels encaissés: ${partialPaid.toFixed(2)} / ${partialBilled.toFixed(2)} USD eq (${partialCoverage.toFixed(1)}%)`, { x: 350, y: 492, size: 8.2, font, color: textBlack });
      page.drawText(`Caisse USD: ouverture ${openingUsd.toFixed(2)} • entrées ${ticketPaymentInflowUsd.toFixed(2) + cashInflowUsd.toFixed(2)} • sorties ${cashOutflowUsd.toFixed(2)} • solde ${closingUsd.toFixed(2)}`, { x: 24, y: 480, size: 7.9, font, color: textBlack });
      page.drawText(`Caisse CDF: ouverture ${openingCdf.toFixed(2)} • entrées ${ticketPaymentInflowCdf.toFixed(2) + cashInflowCdf.toFixed(2)} • sorties ${cashOutflowCdf.toFixed(2)} • solde ${closingCdf.toFixed(2)}`, { x: 24, y: 468, size: 7.9, font, color: textBlack });
      const methodsLabel = topMethods.length > 0
        ? `Méthodes: ${topMethods.map(([method, amount]) => `${method} ${amount.toFixed(2)} USD eq`).join(" | ")}`
        : "Méthodes: -";
      page.drawText(short(methodsLabel, 150), { x: 24, y: 456, size: 7.6, font, color: textBlack });
      page.drawLine({ start: { x: 24, y: 451 }, end: { x: 818, y: 451 }, thickness: 0.7, color: lineGray });
    };

    const headers = ["Date", "PNR", "Client", "Compagnie", "Vendeur", "Montant payé", "Méthode", "Référence"];
    const x = [24, 92, 170, 325, 430, 530, 620, 700];
    const drawTableHeader = (topY: number) => {
      headers.forEach((header, index) => {
        page.drawText(header, { x: x[index], y: topY, size: 8, font: fontBold, color: textBlack });
      });
      page.drawLine({ start: { x: 24, y: topY - 4 }, end: { x: 818, y: topY - 4 }, thickness: 0.6, color: lineGray });
    };

    drawHeader();
    drawSummary();
    drawTableHeader(436);
    let y = 420;

    for (const row of rows) {
      if (y < 38) {
        page = pdf.addPage([842, 595]);
        drawHeader(true);
        drawTableHeader(516);
        y = 500;
      }

      const amountLabel = `${row.amount.toFixed(2)} ${normalizeMoneyCurrency(row.currency ?? row.ticket.currency)}`;
      const values = [
        new Date(row.paidAt).toISOString().slice(0, 10),
        row.ticket.ticketNumber.slice(0, 10),
        short(row.ticket.customerName, 26),
        row.ticket.airline.code,
        short(row.ticket.sellerName ?? row.ticket.seller?.name ?? "-", 14),
        amountLabel,
        short(row.method, 12),
        short(row.reference ?? "-", 16),
      ];

      values.forEach((value, index) => {
        page.drawText(value, { x: x[index], y, size: 7.7, font, color: textBlack });
      });

      page.drawLine({ start: { x: 24, y: y - 3 }, end: { x: 818, y: y - 3 }, thickness: 0.25, color: lineGray });
      y -= 11.5;
    }
  }

  drawFooter(pdf, font, generatedBy, textBlack, lineGray);

  const bytes = await pdf.save();
  return new NextResponse(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${filenameBase}-${new Date().toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
