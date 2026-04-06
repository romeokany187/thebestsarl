import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { invoiceNumberFromChronology } from "@/lib/invoice";
import { getTicketTotalAmount } from "@/lib/ticket-pricing";

export const dynamic = "force-dynamic";

type SearchParams = {
  month?: string;
  airlineId?: string;
  status?: string;
};

function dateRangeFromParams(params: SearchParams) {
  const now = new Date();
  const defaultMonth = now.toISOString().slice(0, 7);
  const rawMonth = params.month?.match(/^(\d{4})-(\d{2})$/) ? params.month : defaultMonth;
  const monthMatch = rawMonth.match(/^(\d{4})-(\d{2})$/);

  if (monthMatch) {
    const year = Number.parseInt(monthMatch[1], 10);
    const month = Number.parseInt(monthMatch[2], 10) - 1;
    const safeMonth = Math.max(0, Math.min(11, month));
    const start = new Date(Date.UTC(year, safeMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, safeMonth + 1, 1, 0, 0, 0, 0));
    return {
      monthRaw: rawMonth,
      start,
      end,
    };
  }

  // Fallback: current month
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return {
    monthRaw: defaultMonth,
    start,
    end,
  };
}

type InvoiceStatus = "PAID" | "PARTIAL" | "UNPAID";

function statusFromAmounts(amount: number, paidAmount: number): InvoiceStatus {
  if (paidAmount <= 0) return "UNPAID";
  if (paidAmount + 0.0001 >= amount) return "PAID";
  return "PARTIAL";
}

function statusLabel(status: InvoiceStatus) {
  if (status === "PAID") return "Payée";
  if (status === "PARTIAL") return "Partielle";
  return "Impayée";
}

export default async function FacturesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role } = await requirePageModuleAccess("invoices", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const resolvedSearchParams = (await searchParams) ?? {};
  const { monthRaw, start, end } = dateRangeFromParams(resolvedSearchParams);
  const selectedAirlineId = resolvedSearchParams.airlineId && resolvedSearchParams.airlineId !== "ALL"
    ? resolvedSearchParams.airlineId
    : "ALL";
  const selectedStatus = (resolvedSearchParams.status === "PAID"
    || resolvedSearchParams.status === "PARTIAL"
    || resolvedSearchParams.status === "UNPAID")
    ? resolvedSearchParams.status
    : "ALL";

  const selectedYear = start.getUTCFullYear();
  const yearStart = new Date(Date.UTC(selectedYear, 0, 1, 0, 0, 0, 0));
  const yearEnd = new Date(Date.UTC(selectedYear + 1, 0, 1, 0, 0, 0, 0));

  const [airlines, tickets, yearTickets] = await Promise.all([
    prisma.airline.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.ticketSale.findMany({
    where: {
      soldAt: { gte: start, lt: end },
      ...(selectedAirlineId !== "ALL" ? { airlineId: selectedAirlineId } : {}),
    },
    include: {
      airline: { select: { code: true, name: true } },
      seller: { select: { name: true, team: { select: { name: true } } } },
      payments: { select: { amount: true } },
    },
    orderBy: { soldAt: "desc" },
    take: 2000,
  }),
    prisma.ticketSale.findMany({
      where: {
        soldAt: { gte: yearStart, lt: yearEnd },
      },
      select: {
        id: true,
        soldAt: true,
      },
      orderBy: [{ soldAt: "asc" }, { id: "asc" }],
      take: 10000,
    }),
  ]);

  const sequenceByTicketId = new Map<string, number>();
  yearTickets.forEach((ticket, index) => {
    sequenceByTicketId.set(ticket.id, index + 1);
  });

  const invoices = tickets.map((ticket) => {
    const sequence = sequenceByTicketId.get(ticket.id) ?? 1;
    const invoiceNumber = invoiceNumberFromChronology({
      soldAt: ticket.soldAt,
      sellerTeamName: ticket.seller?.team?.name ?? null,
      sequence,
    });
    const billedAmount = getTicketTotalAmount(ticket);
    const paidAmount = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balance = Math.max(0, billedAmount - paidAmount);
    const status = statusFromAmounts(billedAmount, paidAmount);
    const sellerName = ticket.seller?.name ?? ticket.sellerName ?? "-";
    return {
      ticketId: ticket.id,
      invoiceNumber,
      soldAt: ticket.soldAt,
      ticketNumber: ticket.ticketNumber,
      customerName: ticket.customerName,
      airlineCode: ticket.airline.code,
      airlineName: ticket.airline.name,
      sellerName,
      amount: billedAmount,
      paidAmount,
      balance,
      status,
    };
  });

  const filteredInvoices = invoices.filter((invoice) => {
    if (selectedStatus !== "ALL" && invoice.status !== selectedStatus) return false;
    return true;
  });

  const sortedInvoices = filteredInvoices.slice().sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime());

  const totalBilled = sortedInvoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const totalPaid = sortedInvoices.reduce((sum, invoice) => sum + invoice.paidAmount, 0);
  const totalBalance = sortedInvoices.reduce((sum, invoice) => sum + invoice.balance, 0);

  return (
    <AppShell
      role={role}
      accessNote="Factures et itinérances: chaque billet encodé peut générer une facture et une fiche d’itinérance téléchargeables."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Factures</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Factures générées automatiquement à partir des billets vendus.
        </p>
      </section>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <form method="GET" className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Mois</label>
            <input type="month" name="month" defaultValue={monthRaw} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Compagnie</label>
            <select name="airlineId" defaultValue={selectedAirlineId} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
              <option value="ALL">Toutes compagnies</option>
              {airlines.map((airline) => (
                <option key={airline.id} value={airline.id}>{airline.code} - {airline.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Statut</label>
            <select name="status" defaultValue={selectedStatus} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
              <option value="ALL">Tous statuts</option>
              <option value="PAID">Payée</option>
              <option value="PARTIAL">Partielle</option>
              <option value="UNPAID">Impayée</option>
            </select>
          </div>

          <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Filtrer</button>
        </form>

        <p className="mt-3 text-xs text-black/60 dark:text-white/60">
          {sortedInvoices.length} facture(s) • Total: {totalBilled.toFixed(2)} USD • Encaissé: {totalPaid.toFixed(2)} USD • Solde: {totalBalance.toFixed(2)} USD
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Facture</th>
                <th className="px-4 py-3 text-left font-semibold">Date</th>
                <th className="px-4 py-3 text-left font-semibold">PNR</th>
                <th className="px-4 py-3 text-left font-semibold">Client</th>
                <th className="px-4 py-3 text-left font-semibold">Compagnie</th>
                <th className="px-4 py-3 text-left font-semibold">Vendeur</th>
                <th className="px-4 py-3 text-left font-semibold">Statut</th>
                <th className="px-4 py-3 text-left font-semibold">Total</th>
                <th className="px-4 py-3 text-left font-semibold">Payé</th>
                <th className="px-4 py-3 text-left font-semibold">Reste</th>
                <th className="px-4 py-3 text-left font-semibold">Document</th>
              </tr>
            </thead>
            <tbody>
              {sortedInvoices.map((invoice) => (
                <tr key={invoice.ticketId} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3 font-semibold">{invoice.invoiceNumber}</td>
                  <td className="px-4 py-3">{invoice.soldAt.toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-3">{invoice.ticketNumber}</td>
                  <td className="px-4 py-3">{invoice.customerName}</td>
                  <td className="px-4 py-3">{invoice.airlineCode} - {invoice.airlineName}</td>
                  <td className="px-4 py-3">{invoice.sellerName}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-black/15 px-2 py-0.5 text-[11px] font-semibold dark:border-white/20">
                      {statusLabel(invoice.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">{invoice.amount.toFixed(2)} USD</td>
                  <td className="px-4 py-3">{invoice.paidAmount.toFixed(2)} USD</td>
                  <td className="px-4 py-3">{invoice.balance.toFixed(2)} USD</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`/api/invoices/${invoice.ticketId}/pdf?download=1`}
                        className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        Télécharger facture
                      </a>
                      <a
                        href={`/api/tickets/${invoice.ticketId}/itinerary?download=1`}
                        className="inline-flex rounded-md border border-sky-300 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-700/60 dark:text-sky-300 dark:hover:bg-sky-950/40"
                      >
                        Télécharger itinérance
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedInvoices.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Aucune facture trouvée pour ce filtre.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
