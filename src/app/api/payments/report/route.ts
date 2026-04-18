import { NeedRequestStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { getTicketTotalAmount } from "@/lib/ticket-pricing";
import { buildDeskScopedCashOperationWhere, isMainCashDesk, normalizeCashDeskValue } from "@/lib/payments-desk";

type ReportMode = "date" | "month" | "year";
type ReportType = "payments" | "cash-journal" | "cash-summary";
type VirtualChannel = "AIRTEL_MONEY" | "ORANGE_MONEY" | "MPESA" | "EQUITY" | "RAWBANK_ILLICOCASH";

const paymentClient = (prisma as unknown as { payment: any }).payment;
const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;
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

function drawFooter(pdf: PDFDocument, font: any, generatedBy: string, textBlack: any, lineGray: any) {
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    page.drawLine({ start: { x: 24, y: 20 }, end: { x: 818, y: 20 }, thickness: 0.6, color: lineGray });
    page.drawText(`Page ${index + 1}/${pages.length}`, { x: 24, y: 10, size: 8, font, color: textBlack });
    const rightText = `Par ${generatedBy}`;
    const rightWidth = font.widthOfTextAtSize(rightText, 8);
    page.drawText(rightText, { x: 818 - rightWidth, y: 10, size: 8, font, color: textBlack });
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
  const mainDesk = isMainCashDesk(selectedDesk);
  const scopedCashOperationsWhere = buildDeskScopedCashOperationWhere(selectedDesk);
  const range = dateRangeFromParams(
    request.nextUrl.searchParams,
    reportType === "cash-journal" || reportType === "cash-summary" ? "month" : "date",
  );
  const airlineId = request.nextUrl.searchParams.get("airlineId")?.trim() || undefined;

  const [rows, tickets, airline, cashOperationsInRange, cashOperationsBeforeRange, ticketPaymentsBeforeRange, pendingNeeds, paymentOrders] = await Promise.all([
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
    prisma.needRequest.findMany({
      where: { status: NeedRequestStatus.SUBMITTED },
      select: { estimatedAmount: true, currency: true },
      take: 1000,
    }),
    paymentOrderClient.findMany({
      where: { status: "SUBMITTED" },
      select: { amount: true, currency: true },
      take: 1000,
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

  const pendingNeedTotals = pendingNeeds.reduce((sum: { usd: number; cdf: number }, need: any) => {
    const amount = typeof need.estimatedAmount === "number" ? need.estimatedAmount : 0;
    const currency = normalizeMoneyCurrency(need.currency);
    if (currency === "USD") sum.usd += amount;
    else sum.cdf += amount;
    return sum;
  }, { usd: 0, cdf: 0 });

  const pendingPaymentOrderTotals = paymentOrders.reduce((sum: { usd: number; cdf: number }, order: any) => {
    const currency = normalizeMoneyCurrency(order.currency);
    if (currency === "USD") sum.usd += order.amount;
    else sum.cdf += order.amount;
    return sum;
  }, { usd: 0, cdf: 0 });

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const montserratRegular = await readFirstExistingFile([
    "public/fonts/Montserrat-Regular.ttf",
    "public/branding/fonts/Montserrat-Regular.ttf",
  ]);

  if (!montserratRegular) {
    return NextResponse.json({ error: "Police Montserrat Regular introuvable sur le serveur." }, { status: 500 });
  }

  const font = await pdf.embedFont(montserratRegular);
  const fontBold = font;
  const textBlack = rgb(0, 0, 0);
  const lineGray = rgb(0.84, 0.84, 0.84);
  const generatedBy = access.session.user.name ?? access.session.user.email ?? "Utilisateur";
  const periodStart = range.start.toISOString().slice(0, 10);
  const periodEnd = new Date(range.end.getTime() - 1).toISOString().slice(0, 10);
  const subtitle = airline
    ? `${range.label} • ${airline.code} - ${airline.name} • ${selectedDesk}`
    : `${range.label} • Toutes compagnies • ${selectedDesk}`;
  let filenameBase = "rapport-paiements";

  if (reportType === "cash-journal") {
    filenameBase = "journal-caisse";
    let page = pdf.addPage([842, 595]);

    const drawHeader = (continuation = false) => {
      page.drawText(`THEBEST SARL - Journal de caisse${continuation ? " (suite)" : ""}`, {
        x: 24,
        y: 566,
        size: 13,
        font: fontBold,
        color: textBlack,
      });
      page.drawText(subtitle, { x: 24, y: 550, size: 9, font, color: textBlack });
      page.drawText(`Période: ${periodStart} au ${periodEnd}`, { x: 24, y: 538, size: 8.2, font, color: textBlack });
      page.drawText(`Ouverture USD ${openingUsd.toFixed(2)} • Clôture USD ${closingUsd.toFixed(2)} • Ouverture CDF ${openingCdf.toFixed(2)} • Clôture CDF ${closingCdf.toFixed(2)}`, { x: 24, y: 526, size: 7.7, font, color: textBlack });
      page.drawLine({ start: { x: 24, y: 520 }, end: { x: 818, y: 520 }, thickness: 0.8, color: lineGray });
    };

    const headers = ["Date", "Type", "Libellé", "USD +", "USD -", "USD solde", "CDF +", "CDF -", "CDF solde", "Réf"];
    const x = [24, 72, 140, 338, 402, 466, 545, 610, 676, 752];
    const drawTableHeader = (topY: number) => {
      headers.forEach((header, index) => {
        page.drawText(header, { x: x[index], y: topY, size: 7.8, font: fontBold, color: textBlack });
      });
      page.drawLine({ start: { x: 24, y: topY - 4 }, end: { x: 818, y: topY - 4 }, thickness: 0.6, color: lineGray });
    };

    drawHeader();
    drawTableHeader(504);
    let y = 488;

    page.drawText(periodStart, { x: 24, y, size: 7.4, font, color: textBlack });
    page.drawText("Report à nouveau / solde d'ouverture", { x: 72, y, size: 7.4, font, color: textBlack });
    page.drawText("Solde reporté automatiquement", { x: 140, y, size: 7.4, font, color: textBlack });
    page.drawText(`${openingUsd.toFixed(2)}`, { x: 466, y, size: 7.4, font, color: textBlack });
    page.drawText(`${openingCdf.toFixed(2)}`, { x: 676, y, size: 7.4, font, color: textBlack });
    y -= 12;

    for (const row of caisseLedger) {
      const libelleLines = wrapTextToWidth(row.libelle, font, 7.1, x[3] - x[2] - 8);
      const rowHeight = Math.max(12, libelleLines.length * 8 + 2);

      if (y - rowHeight < 38) {
        page = pdf.addPage([842, 595]);
        drawHeader(true);
        drawTableHeader(504);
        y = 488;
      }

      const values = [
        row.occurredAt.toISOString().slice(0, 10),
        short(row.typeOperation, 12),
        "",
        row.usdIn > 0 ? row.usdIn.toFixed(2) : "-",
        row.usdOut > 0 ? row.usdOut.toFixed(2) : "-",
        row.usdBalance.toFixed(2),
        row.cdfIn > 0 ? row.cdfIn.toFixed(2) : "-",
        row.cdfOut > 0 ? row.cdfOut.toFixed(2) : "-",
        row.cdfBalance.toFixed(2),
        short(row.reference, 12),
      ];

      values.forEach((value, index) => {
        if (index === 2) return;
        page.drawText(value, { x: x[index], y, size: 7.1, font, color: textBlack });
      });

      libelleLines.forEach((line, index) => {
        page.drawText(line, { x: x[2], y: y - index * 7.5, size: 7.1, font, color: textBlack });
      });

      page.drawLine({ start: { x: 24, y: y - rowHeight + 2 }, end: { x: 818, y: y - rowHeight + 2 }, thickness: 0.25, color: lineGray });
      y -= rowHeight;
    }
  } else if (reportType === "cash-summary") {
    filenameBase = "recap-caisse";
    const page = pdf.addPage([842, 595]);

    page.drawText("THEBEST SARL - Récapitulatif de caisse", { x: 24, y: 566, size: 13, font: fontBold, color: textBlack });
    page.drawText(subtitle, { x: 24, y: 550, size: 9, font, color: textBlack });
    page.drawText(`Période: ${periodStart} au ${periodEnd}`, { x: 24, y: 538, size: 8.2, font, color: textBlack });
    page.drawLine({ start: { x: 24, y: 532 }, end: { x: 818, y: 532 }, thickness: 0.8, color: lineGray });

    page.drawText("1. Soldes physiques de caisse", { x: 24, y: 514, size: 9.4, font: fontBold, color: textBlack });
    page.drawText(`USD: ouverture ${openingUsd.toFixed(2)} • encaissements billets ${ticketPaymentInflowUsd.toFixed(2)} • autres entrées ${cashInflowUsd.toFixed(2)} • sorties ${cashOutflowUsd.toFixed(2)} • clôture ${closingUsd.toFixed(2)}`, { x: 24, y: 500, size: 8.1, font, color: textBlack });
    page.drawText(`CDF: ouverture ${openingCdf.toFixed(2)} • encaissements billets ${ticketPaymentInflowCdf.toFixed(2)} • autres entrées ${cashInflowCdf.toFixed(2)} • sorties ${cashOutflowCdf.toFixed(2)} • clôture ${closingCdf.toFixed(2)}`, { x: 24, y: 488, size: 8.1, font, color: textBlack });
    page.drawText(`Contrôle global (USD eq): ouverture ${openingBalance.toFixed(2)} • entrées ${grossInflows.toFixed(2)} • sorties ${cashOutflowsUsdEq.toFixed(2)} • variation ${netCashVariation.toFixed(2)} • clôture ${closingBalance.toFixed(2)} (${accountingConsistency ? "OK" : "Écart"})`, { x: 24, y: 476, size: 8.1, font, color: textBlack });
    page.drawText(`Créances billets: facturé ${totalBilled.toFixed(2)} USD eq • encaissé ${totalPaidOnTickets.toFixed(2)} USD eq • reste ${totalOutstanding.toFixed(2)} USD eq`, { x: 24, y: 464, size: 8.1, font, color: textBlack });

    const methodsLabel = topMethods.length > 0
      ? `Méthodes dominantes: ${topMethods.map(([method, amount]) => `${method} ${amount.toFixed(2)} USD eq`).join(" | ")}`
      : "Méthodes dominantes: -";
    page.drawText(short(methodsLabel, 160), { x: 24, y: 452, size: 7.8, font, color: textBlack });

    page.drawText("2. Soldes par canal + cash (billetage)", { x: 24, y: 432, size: 9.4, font: fontBold, color: textBlack });
    const headers = ["Canal", "Ouv USD", "Ent USD", "Sort USD", "Clôt USD", "Ouv CDF", "Ent CDF", "Sort CDF", "Clôt CDF"];
    const x = [24, 118, 205, 285, 365, 450, 540, 620, 705];
    headers.forEach((header, index) => {
      page.drawText(header, { x: x[index], y: 418, size: 7.7, font: fontBold, color: textBlack });
    });
    page.drawLine({ start: { x: 24, y: 414 }, end: { x: 818, y: 414 }, thickness: 0.6, color: lineGray });

    let y = 399;
    for (const row of channelRows) {
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
        page.drawText(short(value, index === 0 ? 18 : 10), { x: x[index], y, size: 7.1, font, color: textBlack });
      });
      page.drawLine({ start: { x: 24, y: y - 3 }, end: { x: 818, y: y - 3 }, thickness: 0.25, color: lineGray });
      y -= 12;
    }

    page.drawLine({ start: { x: 24, y: y - 1 }, end: { x: 818, y: y - 1 }, thickness: 0.6, color: lineGray });
    y -= 10;
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
      page.drawText(short(value, index === 0 ? 18 : 10), { x: x[index], y, size: 7.2, font: fontBold, color: textBlack });
    });

    page.drawText("3. Engagements en attente", { x: 24, y: 205, size: 9.4, font: fontBold, color: textBlack });
    page.drawText(`États de besoin en attente: ${pendingNeedTotals.cdf.toFixed(2)} CDF • ${pendingNeedTotals.usd.toFixed(2)} USD`, { x: 24, y: 191, size: 8.2, font, color: textBlack });
    page.drawText(`Ordres de paiement en attente: ${pendingPaymentOrderTotals.cdf.toFixed(2)} CDF • ${pendingPaymentOrderTotals.usd.toFixed(2)} USD`, { x: 24, y: 179, size: 8.2, font, color: textBlack });
    page.drawText(`Billets payés ${paidTickets.length} • Billets impayés ${unpaidTickets.length} • Billets partiels ${partialTickets.length} (couverture ${partialCoverage.toFixed(1)}%)`, { x: 24, y: 167, size: 8.2, font, color: textBlack });
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
