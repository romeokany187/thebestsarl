import { PaymentStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTicketTotalAmount } from "@/lib/ticket-pricing";
import { buildTicketReceivableBalance, type TicketSaleForBalance } from "@/lib/ticket-payment-balance";
import { extractTicketItinerary } from "@/lib/ticket-itinerary";

/** Colonnes du tableau « statut paiement billets » (export comptabilité / direction). */
export const TICKET_PAYMENT_STATUS_COLUMN_HEADERS = [
  "DATE DE PAIEMENT",
  "DATE D'ÉMISSION",
  "NOM DU PASSAGER",
  "ITINÉRAIRE",
  "PNR",
  "EMETTEUR",
  "PAYANT",
  "MONTANT",
  "PAIEMENT",
  "STATUT",
] as const;

export type TicketPaymentStatusLabel = "PAYÉ" | "PARTIEL" | "NON PAYÉ";

export type TicketPaymentStatusRow = {
  ticketId: string;
  /** Dernière date d'encaissement caisse (vide si non payé). */
  paymentDate: string | null;
  issuedDate: string;
  passengerName: string;
  itinerary: string;
  pnr: string;
  issuer: string;
  payer: string;
  amount: number;
  amountPaid: number;
  currency: string;
  status: TicketPaymentStatusLabel;
  statusCode: PaymentStatus;
};

export type TicketPaymentStatusScope = "issued" | "paid";

const ticketInclude = {
  payments: { orderBy: { paidAt: "asc" as const } },
  airline: { select: { code: true, name: true } },
  seller: { select: { name: true, team: { select: { name: true } } } },
} satisfies Prisma.TicketSaleInclude;

type TicketWithRelations = Prisma.TicketSaleGetPayload<{ include: typeof ticketInclude }>;

function formatExportDate(value: Date): string {
  return value.toLocaleDateString("fr-FR", { timeZone: "UTC" });
}

export function paymentStatusLabel(status: PaymentStatus): TicketPaymentStatusLabel {
  if (status === PaymentStatus.PAID) return "PAYÉ";
  if (status === PaymentStatus.PARTIAL) return "PARTIEL";
  return "NON PAYÉ";
}

export function resolveTicketItineraryLabel(ticket: { route: string; notes?: string | null }): string {
  const route = ticket.route?.trim();
  if (route) return route;

  const itinerary = extractTicketItinerary(ticket.notes ?? null);
  if (!itinerary) return "-";

  const from = itinerary.departureAirport?.trim();
  const to = itinerary.arrivalAirport?.trim();
  if (from && to) return `${from} → ${to}`;
  if (from) return from;
  if (to) return to;
  return "-";
}

export function resolveTicketIssuerName(ticket: TicketWithRelations): string {
  const sellerName = ticket.sellerName?.trim() || ticket.seller?.name?.trim();
  if (sellerName) return sellerName;
  const team = ticket.seller?.team?.name?.trim();
  if (team) return team;
  return "-";
}

function resolveLatestPaymentDate(payments: Array<{ paidAt: Date }>): string | null {
  if (payments.length === 0) return null;
  const latest = payments.reduce((max, payment) => (
    payment.paidAt.getTime() > max.getTime() ? payment.paidAt : max
  ), payments[0].paidAt);
  return formatExportDate(latest);
}

export function buildTicketPaymentStatusRow(ticket: TicketWithRelations): TicketPaymentStatusRow {
  const balance = buildTicketReceivableBalance(ticket as TicketSaleForBalance);

  return {
    ticketId: ticket.id,
    paymentDate: resolveLatestPaymentDate(ticket.payments),
    issuedDate: formatExportDate(ticket.soldAt),
    passengerName: ticket.customerName.trim(),
    itinerary: resolveTicketItineraryLabel(ticket),
    pnr: ticket.ticketNumber.trim(),
    issuer: resolveTicketIssuerName(ticket),
    payer: (ticket.payerName?.trim() || ticket.customerName.trim()) || "-",
    amount: Number(getTicketTotalAmount(ticket).toFixed(2)),
    amountPaid: Number(balance.paidAmount.toFixed(2)),
    currency: balance.currency,
    status: paymentStatusLabel(balance.computedStatus),
    statusCode: balance.computedStatus,
  };
}

export function ticketPaymentStatusRowToCells(row: TicketPaymentStatusRow): string[] {
  const amountLabel = `${row.amount.toFixed(2)} ${row.currency}`;
  const paidLabel = `${row.amountPaid.toFixed(2)} ${row.currency}`;
  return [
    row.paymentDate ?? "",
    row.issuedDate,
    row.passengerName,
    row.itinerary,
    row.pnr,
    row.issuer,
    row.payer,
    amountLabel,
    paidLabel,
    row.status,
  ];
}

export async function loadTicketPaymentStatusRows(options: {
  start: Date;
  end: Date;
  scope?: TicketPaymentStatusScope;
  ticketStatus?: PaymentStatus | "ALL";
  airlineId?: string | null;
  take?: number;
}): Promise<TicketPaymentStatusRow[]> {
  const scope = options.scope ?? "issued";
  const take = options.take ?? 8000;

  const airlineFilter = options.airlineId ? { airlineId: options.airlineId } : {};

  let tickets: TicketWithRelations[];

  if (scope === "paid") {
    const paymentsInRange = await prisma.payment.findMany({
      where: {
        paidAt: { gte: options.start, lt: options.end },
        ticket: airlineFilter,
      },
      select: { ticketId: true },
      distinct: ["ticketId"],
      take,
    });
    const ticketIds = paymentsInRange.map((row) => row.ticketId);
    if (ticketIds.length === 0) return [];

    tickets = await prisma.ticketSale.findMany({
      where: { id: { in: ticketIds } },
      include: ticketInclude,
      orderBy: { soldAt: "asc" },
      take,
    });
  } else {
    tickets = await prisma.ticketSale.findMany({
      where: {
        soldAt: { gte: options.start, lt: options.end },
        ...airlineFilter,
      },
      include: ticketInclude,
      orderBy: { soldAt: "asc" },
      take,
    });
  }

  const rows = tickets.map(buildTicketPaymentStatusRow);

  if (options.ticketStatus && options.ticketStatus !== "ALL") {
    return rows.filter((row) => row.statusCode === options.ticketStatus);
  }

  return rows;
}
