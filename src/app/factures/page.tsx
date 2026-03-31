import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { invoiceNumberFromTicket } from "@/lib/invoice";

export const dynamic = "force-dynamic";

type SearchParams = {
  startDate?: string;
  endDate?: string;
  q?: string;
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

export default async function FacturesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role } = await requirePageModuleAccess("invoices", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const resolvedSearchParams = (await searchParams) ?? {};
  const { start, end, startRaw, endRaw } = dateRangeFromParams(resolvedSearchParams);
  const query = resolvedSearchParams.q?.trim() ?? "";

  const tickets = await prisma.ticketSale.findMany({
    where: {
      soldAt: { gte: start, lt: end },
      ...(query
        ? {
          OR: [
            { ticketNumber: { contains: query, mode: "insensitive" } },
            { customerName: { contains: query, mode: "insensitive" } },
            { airline: { name: { contains: query, mode: "insensitive" } } },
            { airline: { code: { contains: query, mode: "insensitive" } } },
          ],
        }
        : {}),
    },
    include: {
      airline: { select: { code: true, name: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { soldAt: "desc" },
    take: 800,
  });

  const invoices = tickets.map((ticket) => {
    const invoiceNumber = invoiceNumberFromTicket(ticket.ticketNumber, ticket.soldAt);
    const paidAmount = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balance = Math.max(0, ticket.amount - paidAmount);
    return {
      ticketId: ticket.id,
      invoiceNumber,
      soldAt: ticket.soldAt,
      ticketNumber: ticket.ticketNumber,
      customerName: ticket.customerName,
      airlineCode: ticket.airline.code,
      airlineName: ticket.airline.name,
      amount: ticket.amount,
      paidAmount,
      balance,
    };
  });

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
        <form method="GET" className="grid gap-3 md:grid-cols-[1fr,1fr,2fr,auto] md:items-end">
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
          <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Filtrer</button>
        </form>
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
                <th className="px-4 py-3 text-left font-semibold">Total</th>
                <th className="px-4 py-3 text-left font-semibold">Payé</th>
                <th className="px-4 py-3 text-left font-semibold">Reste</th>
                <th className="px-4 py-3 text-left font-semibold">Document</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.ticketId} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3 font-semibold">{invoice.invoiceNumber}</td>
                  <td className="px-4 py-3">{invoice.soldAt.toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-3">{invoice.ticketNumber}</td>
                  <td className="px-4 py-3">{invoice.customerName}</td>
                  <td className="px-4 py-3">{invoice.airlineCode} - {invoice.airlineName}</td>
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
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
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
