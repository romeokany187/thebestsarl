import { PaymentStatus } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { PaymentEntryForm } from "@/components/payment-entry-form";
import { PaymentOrderForm } from "@/components/payment-order-form";
import { requirePageModuleAccess } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

type SearchParams = {
  startDate?: string;
  endDate?: string;
  airlineId?: string;
};

function dateRangeFromParams(params: SearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startRaw = params.startDate ?? defaultDay;
  const endRaw = params.endDate ?? startRaw;
  
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    start,
    end,
    startRaw,
    endRaw,
    label: `Du ${startRaw} au ${endRaw}`,
  };
}

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role, session } = await requirePageModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  const canWrite = session.user.jobTitle === "CAISSIERE";
  const canIssuePaymentOrder = role === "DIRECTEUR_GENERAL";
  const resolvedSearchParams = (await searchParams) ?? {};
  const range = dateRangeFromParams(resolvedSearchParams);

  const now = new Date();
  const currentDate = now.toISOString().slice(0, 10);
  const selectedAirlineId = resolvedSearchParams.airlineId && resolvedSearchParams.airlineId !== "ALL"
    ? resolvedSearchParams.airlineId
    : undefined;
  const reportQuery = new URLSearchParams({
    startDate: range.startRaw,
    endDate: range.endRaw,
    ...(selectedAirlineId ? { airlineId: selectedAirlineId } : {}),
  }).toString();

  const [airlines, tickets, payments, paymentOrders] = (await Promise.all([
    prisma.airline.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.ticketSale.findMany({
      where: {
        soldAt: { gte: range.start, lt: range.end },
        ...(selectedAirlineId ? { airlineId: selectedAirlineId } : {}),
      },
      include: { airline: true, payments: true },
      orderBy: { soldAt: "desc" },
      take: 800,
    }),
    prisma.payment.findMany({
      where: {
        ticket: {
          soldAt: { gte: range.start, lt: range.end },
          ...(selectedAirlineId ? { airlineId: selectedAirlineId } : {}),
        },
      },
      include: {
        ticket: {
          select: {
            ticketNumber: true,
            customerName: true,
            amount: true,
            paymentStatus: true,
            currency: true,
          },
        },
      },
      orderBy: { paidAt: "desc" },
      take: 250,
    }),
    paymentOrderClient.findMany({
      include: {
        issuedBy: { select: { name: true, jobTitle: true } },
        approvedBy: { select: { name: true, jobTitle: true } },
        executedBy: { select: { name: true, jobTitle: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
  ])) as [any[], any[], any[], any[]];

  const ticketsWithComputedStatus = tickets.map((ticket) => {
    const paidAmount = ticket.payments.reduce((sum: number, payment: { amount: number }) => sum + payment.amount, 0);
    const computedStatus = paidAmount <= 0
      ? PaymentStatus.UNPAID
      : paidAmount + 0.0001 >= ticket.amount
        ? PaymentStatus.PAID
        : PaymentStatus.PARTIAL;

    return {
      ...ticket,
      paidAmount,
      computedStatus,
    };
  });

  const totalTicketAmount = ticketsWithComputedStatus.reduce((sum, ticket) => sum + ticket.amount, 0);
  const totalPaid = ticketsWithComputedStatus.reduce((sum, ticket) => sum + ticket.paidAmount, 0);
  const receivables = Math.max(0, totalTicketAmount - totalPaid);
  const paidTickets = ticketsWithComputedStatus.filter((ticket) => ticket.computedStatus === PaymentStatus.PAID);
  const unpaidTickets = ticketsWithComputedStatus.filter((ticket) => ticket.computedStatus === PaymentStatus.UNPAID);
  const partialTickets = ticketsWithComputedStatus.filter((ticket) => ticket.computedStatus === PaymentStatus.PARTIAL);

  const collectedTotal = paidTickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const partialBilled = partialTickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const partialCollected = partialTickets.reduce((sum, ticket) => sum + ticket.paidAmount, 0);
  const partialOutstanding = Math.max(0, partialBilled - partialCollected);
  const unpaidTotal = unpaidTickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const collectionRate = totalTicketAmount > 0 ? (totalPaid / totalTicketAmount) * 100 : 0;
  const partialCoverageRate = partialBilled > 0 ? (partialCollected / partialBilled) * 100 : 0;

  const paymentTickets = ticketsWithComputedStatus
    .filter((ticket) => ticket.computedStatus !== PaymentStatus.PAID)
    .map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      customerName: ticket.customerName,
      amount: ticket.amount,
      paidAmount: ticket.paidAmount,
      paymentStatus: ticket.computedStatus,
    }));

  return (
    <AppShell
      role={role}
      accessNote="Vue financière: suivi des encaissements, des soldes clients et des créances à recouvrer."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Paiements</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Pilotage financier des billets vendus et des paiements reçus (USD).</p>
      </section>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <form method="GET" className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Du</label>
            <input type="date" name="startDate" defaultValue={range.startRaw} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Au</label>
            <input type="date" name="endDate" defaultValue={range.endRaw} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Compagnie</label>
            <select name="airlineId" defaultValue={resolvedSearchParams.airlineId ?? "ALL"} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
              <option value="ALL">Toutes compagnies</option>
              {airlines.map((airline) => (
                <option key={airline.id} value={airline.id}>{airline.code} - {airline.name}</option>
              ))}
            </select>
          </div>

          <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Filtrer</button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <a
            href={`/api/payments/report?${reportQuery}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-md border border-black/20 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Lire PDF paiements
          </a>
          <a
            href={`/api/payments/report?${reportQuery}&download=1`}
            className="inline-flex rounded-md border border-black/20 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Télécharger PDF paiements
          </a>
        </div>
        <p className="mt-3 text-xs text-black/60 dark:text-white/60">
          {range.label}
        </p>
      </section>

      {canWrite ? <PaymentEntryForm tickets={paymentTickets} /> : null}
      {canIssuePaymentOrder ? <PaymentOrderForm /> : null}

      <section className="mb-6 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h2 className="text-sm font-semibold">Ordres de paiement (flux notifications)</h2>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">DG émet, Admin valide, Caissière exécute, Comptable reçoit la notification finale.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Créé le</th>
                <th className="px-4 py-3 text-left font-semibold">Description</th>
                <th className="px-4 py-3 text-left font-semibold">Montant</th>
                <th className="px-4 py-3 text-left font-semibold">DG</th>
                <th className="px-4 py-3 text-left font-semibold">Admin</th>
                <th className="px-4 py-3 text-left font-semibold">Caissière</th>
                <th className="px-4 py-3 text-left font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {paymentOrders.map((order) => (
                <tr key={order.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3">{new Date(order.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-3">{order.description}</td>
                  <td className="px-4 py-3">{order.amount.toFixed(2)} {order.currency}</td>
                  <td className="px-4 py-3">{order.issuedBy?.name ?? "-"}</td>
                  <td className="px-4 py-3">{order.approvedBy?.name ?? "-"}</td>
                  <td className="px-4 py-3">{order.executedBy?.name ?? "-"}</td>
                  <td className="px-4 py-3">{order.status}</td>
                </tr>
              ))}
              {paymentOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Aucun ordre de paiement pour le moment.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total facturé" value={`${totalTicketAmount.toFixed(2)} USD`} />
        <KpiCard label="Total encaissé" value={`${totalPaid.toFixed(2)} USD`} />
        <KpiCard label="Total créance" value={`${receivables.toFixed(2)} USD`} />
        <KpiCard label="Tickets totalement payés" value={`${collectedTotal.toFixed(2)} USD`} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Billets payés" value={`${paidTickets.length}`} hint={`${paidTickets.reduce((sum, t) => sum + t.amount, 0).toFixed(2)} USD`} />
        <KpiCard label="Billets impayés" value={`${unpaidTickets.length}`} hint={`${unpaidTotal.toFixed(2)} USD non encaissés`} />
        <KpiCard label="Billets partiels" value={`${partialTickets.length}`} hint={`${partialCollected.toFixed(2)} / ${partialBilled.toFixed(2)} USD`} />
        <KpiCard label="Taux d'encaissement" value={`${collectionRate.toFixed(1)}%`} hint={`Partiels couverts à ${partialCoverageRate.toFixed(1)}%`} />
      </div>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Synthèse intelligente</h2>
        <p className="mt-2 text-xs text-black/60 dark:text-white/60">
          Total facturé: {totalTicketAmount.toFixed(2)} USD • Paiements reçus: {totalPaid.toFixed(2)} USD • Créances restantes: {receivables.toFixed(2)} USD.
          Partiels: encaissé {partialCollected.toFixed(2)} USD sur {partialBilled.toFixed(2)} USD ({partialCoverageRate.toFixed(1)}%), reste {partialOutstanding.toFixed(2)} USD.
        </p>
      </section>

      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Date</th>
                <th className="px-4 py-3 text-left font-semibold">Billet</th>
                <th className="px-4 py-3 text-left font-semibold">Client</th>
                <th className="px-4 py-3 text-left font-semibold">Montant</th>
                <th className="px-4 py-3 text-left font-semibold">Méthode</th>
                <th className="px-4 py-3 text-left font-semibold">Référence</th>
                <th className="px-4 py-3 text-left font-semibold">Statut billet</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3">{new Date(payment.paidAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-medium">{payment.ticket.ticketNumber}</td>
                  <td className="px-4 py-3">{payment.ticket.customerName}</td>
                  <td className="px-4 py-3">{payment.amount.toFixed(2)} USD</td>
                  <td className="px-4 py-3">{payment.method}</td>
                  <td className="px-4 py-3">{payment.reference ?? "-"}</td>
                  <td className="px-4 py-3">{payment.ticket.paymentStatus}</td>
                </tr>
              ))}
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Aucun paiement trouvé pour ce filtre.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
