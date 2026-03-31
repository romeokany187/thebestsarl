import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { invoiceNumberFromTicket } from "@/lib/invoice";

export const dynamic = "force-dynamic";

type SearchParams = {
  startDate?: string;
  endDate?: string;
  q?: string;
  airlineId?: string;
  status?: string;
  seller?: string;
  minAmount?: string;
  maxAmount?: string;
  sort?: string;
};

function dateRangeFromParams(params: SearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startRaw = params.startDate ?? defaultDay;
  const endRaw = params.endDate ?? startRaw;
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, startRaw, endRaw };
}

function parseOptionalAmount(value?: string) {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
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
  const { start, end, startRaw, endRaw } = dateRangeFromParams(resolvedSearchParams);
  const query = resolvedSearchParams.q?.trim() ?? "";
  const selectedAirlineId = resolvedSearchParams.airlineId && resolvedSearchParams.airlineId !== "ALL"
    ? resolvedSearchParams.airlineId
    : "ALL";
  const selectedStatus = (resolvedSearchParams.status === "PAID"
    || resolvedSearchParams.status === "PARTIAL"
    || resolvedSearchParams.status === "UNPAID")
    ? resolvedSearchParams.status
    : "ALL";
  const sellerQuery = resolvedSearchParams.seller?.trim() ?? "";
  const minAmount = parseOptionalAmount(resolvedSearchParams.minAmount);
  const maxAmount = parseOptionalAmount(resolvedSearchParams.maxAmount);
  const sort = (resolvedSearchParams.sort === "date_asc"
    || resolvedSearchParams.sort === "amount_desc"
    || resolvedSearchParams.sort === "amount_asc"
    || resolvedSearchParams.sort === "balance_desc")
    ? resolvedSearchParams.sort
    : "date_desc";

  const [airlines, tickets] = await Promise.all([
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
      seller: { select: { name: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { soldAt: "desc" },
    take: 2000,
  }),
  ]);

  const invoices = tickets.map((ticket) => {
    const invoiceNumber = invoiceNumberFromTicket(ticket.ticketNumber, ticket.soldAt);
    const paidAmount = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balance = Math.max(0, ticket.amount - paidAmount);
    const status = statusFromAmounts(ticket.amount, paidAmount);
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
      amount: ticket.amount,
      paidAmount,
      balance,
      status,
    };
  });

  const lowerQuery = query.toLowerCase();
  const lowerSellerQuery = sellerQuery.toLowerCase();

  const filteredInvoices = invoices.filter((invoice) => {
    if (selectedStatus !== "ALL" && invoice.status !== selectedStatus) return false;
    if (minAmount !== null && invoice.amount < minAmount) return false;
    if (maxAmount !== null && invoice.amount > maxAmount) return false;

    if (lowerSellerQuery) {
      const sellerOk = invoice.sellerName.toLowerCase().includes(lowerSellerQuery);
      if (!sellerOk) return false;
    }

    if (lowerQuery) {
      const haystack = [
        invoice.invoiceNumber,
        invoice.ticketNumber,
        invoice.customerName,
        invoice.airlineCode,
        invoice.airlineName,
        invoice.sellerName,
      ].join(" ").toLowerCase();

      if (!haystack.includes(lowerQuery)) return false;
    }

    return true;
  });

  const sortedInvoices = filteredInvoices.slice().sort((a, b) => {
    if (sort === "date_asc") return a.soldAt.getTime() - b.soldAt.getTime();
    if (sort === "amount_desc") return b.amount - a.amount;
    if (sort === "amount_asc") return a.amount - b.amount;
    if (sort === "balance_desc") return b.balance - a.balance;
    return b.soldAt.getTime() - a.soldAt.getTime();
  });

  const totalBilled = sortedInvoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const totalPaid = sortedInvoices.reduce((sum, invoice) => sum + invoice.paidAmount, 0);
  const totalBalance = sortedInvoices.reduce((sum, invoice) => sum + invoice.balance, 0);

  return (
    <AppShell
      role={role}
      accessNote="Factures automatiques: chaque billet encodé génère sa facture PDF immédiatement."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Factures</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Factures générées automatiquement à partir des billets vendus.
        </p>
      </section>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <form method="GET" className="grid gap-3 lg:grid-cols-4 lg:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Du</label>
            <input type="date" name="startDate" defaultValue={startRaw} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Au</label>
            <input type="date" name="endDate" defaultValue={endRaw} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Recherche</label>
            <input type="search" name="q" defaultValue={query} placeholder="PNR, client, compagnie..." className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Statut facture</label>
            <select name="status" defaultValue={selectedStatus} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
              <option value="ALL">Tous statuts</option>
              <option value="PAID">Payée</option>
              <option value="PARTIAL">Partielle</option>
              <option value="UNPAID">Impayée</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Vendeur</label>
            <input type="search" name="seller" defaultValue={sellerQuery} placeholder="Nom du vendeur..." className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Montant min</label>
            <input type="number" min="0" step="0.01" name="minAmount" defaultValue={resolvedSearchParams.minAmount ?? ""} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Montant max</label>
            <input type="number" min="0" step="0.01" name="maxAmount" defaultValue={resolvedSearchParams.maxAmount ?? ""} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Tri</label>
            <select name="sort" defaultValue={sort} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
              <option value="date_desc">Date décroissante</option>
              <option value="date_asc">Date croissante</option>
              <option value="amount_desc">Montant décroissant</option>
              <option value="amount_asc">Montant croissant</option>
              <option value="balance_desc">Solde restant décroissant</option>
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
                        href={`/api/invoices/${invoice.ticketId}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        Lire PDF
                      </a>
                      <a
                        href={`/api/invoices/${invoice.ticketId}/pdf?download=1`}
                        className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        Télécharger
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
