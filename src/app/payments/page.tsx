import { NeedRequestStatus, PaymentStatus } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { CashOperationForm } from "@/components/cash-operation-form";
import { KpiCard } from "@/components/kpi-card";
import { PaymentEntryForm } from "@/components/payment-entry-form";
import { PaymentsWritingWorkspace } from "@/components/payments-writing-workspace";
import { requirePageModuleAccess } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;
const cashOperationClient = (prisma as unknown as { cashOperation: any }).cashOperation;

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

function normalizeCashAmountUsd(operation: {
  amount: number;
  currency?: string | null;
  amountUsd?: number | null;
  fxRateToUsd?: number | null;
  fxRateUsdToCdf?: number | null;
}): number {
  if (typeof operation.amountUsd === "number") {
    return operation.amountUsd;
  }
  const currency = (operation.currency ?? "USD").toUpperCase();
  if (currency === "USD") {
    return operation.amount;
  }
  const rate = operation.fxRateUsdToCdf ?? (operation.fxRateToUsd && operation.fxRateToUsd > 0 ? 1 / operation.fxRateToUsd : 2800);
  return operation.amount / rate;
}

function normalizeCashAmountCdf(operation: {
  amount: number;
  currency?: string | null;
  amountCdf?: number | null;
  fxRateToUsd?: number | null;
  fxRateUsdToCdf?: number | null;
}): number {
  if (typeof operation.amountCdf === "number") {
    return operation.amountCdf;
  }
  const currency = (operation.currency ?? "USD").toUpperCase();
  if (currency === "CDF") {
    return operation.amount;
  }
  const rate = operation.fxRateUsdToCdf ?? (operation.fxRateToUsd && operation.fxRateToUsd > 0 ? 1 / operation.fxRateToUsd : 2800);
  return operation.amount * rate;
}

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role, session } = await requirePageModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  const canWrite = session.user.jobTitle === "CAISSIERE" && role !== "ADMIN" && role !== "DIRECTEUR_GENERAL";
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

  const paymentsData = await Promise.all([
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
      where: {
        status: "SUBMITTED",
      },
      include: {
        issuedBy: { select: { name: true, jobTitle: true } },
        approvedBy: { select: { name: true, jobTitle: true } },
        executedBy: { select: { name: true, jobTitle: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    prisma.needRequest.findMany({
      where: {
        status: NeedRequestStatus.SUBMITTED,
      },
      include: {
        requester: { select: { name: true, jobTitle: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 120,
    }),
    cashOperationClient.findMany({
      where: {
        occurredAt: { gte: range.start, lt: range.end },
      },
      include: {
        createdBy: { select: { name: true, jobTitle: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 250,
    }),
    prisma.payment.findMany({
      where: {
        paidAt: { lt: range.start },
      },
      select: {
        amount: true,
      },
      take: 5000,
    }),
    cashOperationClient.findMany({
      where: {
        occurredAt: { lt: range.start },
      },
      select: {
        amount: true,
        direction: true,
        currency: true,
        amountUsd: true,
        fxRateToUsd: true,
        fxRateUsdToCdf: true,
      },
      take: 5000,
    }),
  ]);

  const [
    airlines,
    tickets,
    payments,
    paymentOrders,
    pendingNeeds,
    cashOperations,
    ticketPaymentsBeforeStart,
    cashOperationsBeforeStart,
  ] = paymentsData as [any[], any[], any[], any[], any[], any[], any[], any[]];

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

  const ticketInflowsBefore = ticketPaymentsBeforeStart.reduce((sum, payment) => sum + payment.amount, 0);
  const cashOpsSignedBefore = cashOperationsBeforeStart.reduce(
    (sum: number, operation: { direction: string; amount: number; currency?: string; amountUsd?: number; fxRateToUsd?: number; fxRateUsdToCdf?: number }) => {
      const normalized = normalizeCashAmountUsd(operation);
      return sum + (operation.direction === "INFLOW" ? normalized : -normalized);
    },
    0,
  );
  const openingBalance = ticketInflowsBefore + cashOpsSignedBefore;

  const openingUsdFromOps = cashOperationsBeforeStart.reduce(
    (sum: number, operation: { direction: string; amount: number; currency?: string }) => {
      const currency = (operation.currency ?? "USD").toUpperCase();
      if (currency !== "USD") return sum;
      return sum + (operation.direction === "INFLOW" ? operation.amount : -operation.amount);
    },
    0,
  );
  const openingCdf = cashOperationsBeforeStart.reduce(
    (sum: number, operation: { direction: string; amount: number; currency?: string }) => {
      const currency = (operation.currency ?? "USD").toUpperCase();
      if (currency !== "CDF") return sum;
      return sum + (operation.direction === "INFLOW" ? operation.amount : -operation.amount);
    },
    0,
  );
  const openingUsd = ticketInflowsBefore + openingUsdFromOps;

  const otherInflows = cashOperations
    .filter((operation: { direction: string }) => operation.direction === "INFLOW")
    .reduce((sum: number, operation: { amount: number; currency?: string; amountUsd?: number; fxRateToUsd?: number; fxRateUsdToCdf?: number }) => sum + normalizeCashAmountUsd(operation), 0);
  const cashOutflows = cashOperations
    .filter((operation: { direction: string }) => operation.direction === "OUTFLOW")
    .reduce((sum: number, operation: { amount: number; currency?: string; amountUsd?: number; fxRateToUsd?: number; fxRateUsdToCdf?: number }) => sum + normalizeCashAmountUsd(operation), 0);

  const grossInflows = totalPaid + otherInflows;
  const netCashVariation = grossInflows - cashOutflows;
  const closingBalance = openingBalance + netCashVariation;
  const expensePressure = grossInflows > 0 ? (cashOutflows / grossInflows) * 100 : cashOutflows > 0 ? 100 : 0;
  const riskLevel = cashOutflows > grossInflows
    ? "Critique"
    : expensePressure >= 85
      ? "Alerte"
      : expensePressure >= 65
        ? "Sous surveillance"
        : "Sain";
  const riskHint = `Sorties ${cashOutflows.toFixed(2)} / Entrées ${grossInflows.toFixed(2)} (${expensePressure.toFixed(1)}%)`;

  const accountingConsistency = Math.abs((openingBalance + grossInflows - cashOutflows) - closingBalance) <= 0.0001;

  const cashInflowUsd = cashOperations
    .filter((operation: { direction: string; currency?: string }) => operation.direction === "INFLOW" && (operation.currency ?? "USD").toUpperCase() === "USD")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);
  const cashOutflowUsd = cashOperations
    .filter((operation: { direction: string; currency?: string }) => operation.direction === "OUTFLOW" && (operation.currency ?? "USD").toUpperCase() === "USD")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);
  const cashInflowCdf = cashOperations
    .filter((operation: { direction: string; currency?: string }) => operation.direction === "INFLOW" && (operation.currency ?? "USD").toUpperCase() === "CDF")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);
  const cashOutflowCdf = cashOperations
    .filter((operation: { direction: string; currency?: string }) => operation.direction === "OUTFLOW" && (operation.currency ?? "USD").toUpperCase() === "CDF")
    .reduce((sum: number, operation: { amount: number }) => sum + operation.amount, 0);

  const closingUsd = openingUsd + totalPaid + cashInflowUsd - cashOutflowUsd;
  const closingCdf = openingCdf + cashInflowCdf - cashOutflowCdf;

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

  const pendingNeedsAmount = pendingNeeds.reduce(
    (sum, need) => sum + (typeof need.estimatedAmount === "number" ? need.estimatedAmount : 0),
    0,
  );
  const pendingPaymentOrdersAmount = paymentOrders.reduce((sum, order) => sum + order.amount, 0);

  return (
    <AppShell
      role={role}
      accessNote="Vue financière: suivi des encaissements, des soldes clients et des créances à recouvrer."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Paiements</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Pilotage financier des billets vendus et des paiements reçus (USD).</p>
      </section>

      <PaymentsWritingWorkspace
        closedSummary={(
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total encaissé" value={`${grossInflows.toFixed(2)} USD`} hint={`Billets ${totalPaid.toFixed(2)} + autres ${otherInflows.toFixed(2)}`} />
            <KpiCard label="Total dépensé" value={`${cashOutflows.toFixed(2)} USD`} />
            <KpiCard label="Solde caisse USD" value={`${closingUsd.toFixed(2)} USD`} />
            <KpiCard label="Total caisse CDF" value={`${closingCdf.toFixed(2)} CDF`} />
            <KpiCard label="Niveau de risque" value={riskLevel} hint={riskHint} />
          </div>
        )}
        ticketWorkspace={(
          <div className="space-y-4">
            <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
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

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Total facturé" value={`${totalTicketAmount.toFixed(2)} USD`} />
              <KpiCard label="Total encaissé" value={`${totalPaid.toFixed(2)} USD`} />
              <KpiCard label="Total créance" value={`${receivables.toFixed(2)} USD`} />
              <KpiCard label="Taux d'encaissement" value={`${collectionRate.toFixed(1)}%`} hint={`Partiels couverts à ${partialCoverageRate.toFixed(1)}%`} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Billets payés" value={`${paidTickets.length}`} hint={`${paidTickets.reduce((sum, t) => sum + t.amount, 0).toFixed(2)} USD`} />
              <KpiCard label="Billets impayés" value={`${unpaidTickets.length}`} hint={`${unpaidTotal.toFixed(2)} USD non encaissés`} />
              <KpiCard label="Billets partiels" value={`${partialTickets.length}`} hint={`${partialCollected.toFixed(2)} / ${partialBilled.toFixed(2)} USD`} />
              <KpiCard label="Tickets totalement payés" value={`${collectedTotal.toFixed(2)} USD`} />
            </div>

            {canWrite ? (
              <PaymentEntryForm tickets={paymentTickets} />
            ) : (
              <section className="rounded-2xl border border-dashed border-black/20 bg-white/80 p-4 text-xs text-black/65 dark:border-white/20 dark:bg-zinc-900/70 dark:text-white/65">
                Profil en lecture seule sur les écritures billets. Vous pouvez consulter les indicateurs et l'historique.
              </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
                <h2 className="text-sm font-semibold">Historique journalier paiements billets</h2>
              </div>
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
                        <td className="px-4 py-3">{new Date(payment.paidAt).toLocaleDateString("fr-FR")}</td>
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
            </section>
          </div>
        )}
        cashWorkspace={(
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Solde ouverture USD" value={`${openingUsd.toFixed(2)} USD`} />
              <KpiCard label="Solde clôture USD" value={`${closingUsd.toFixed(2)} USD`} hint={`Billets ${totalPaid.toFixed(2)} + autres USD ${cashInflowUsd.toFixed(2)} - sorties USD ${cashOutflowUsd.toFixed(2)}`} />
              <KpiCard label="Solde ouverture CDF" value={`${openingCdf.toFixed(2)} CDF`} />
              <KpiCard label="Solde clôture CDF" value={`${closingCdf.toFixed(2)} CDF`} hint={`Entrées CDF ${cashInflowCdf.toFixed(2)} - sorties CDF ${cashOutflowCdf.toFixed(2)}`} />
            </div>

            <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <h2 className="text-sm font-semibold">Synthèse caisse</h2>
              <p className="mt-2 text-xs text-black/60 dark:text-white/60">
                Solde USD: ouverture {openingUsd.toFixed(2)} USD, clôture {closingUsd.toFixed(2)} USD. Solde CDF: ouverture {openingCdf.toFixed(2)} CDF, clôture {closingCdf.toFixed(2)} CDF.
                Contrôle global (équivalent USD): ouverture {openingBalance.toFixed(2)} USD, entrées {grossInflows.toFixed(2)} USD, sorties {cashOutflows.toFixed(2)} USD, variation nette {netCashVariation.toFixed(2)} USD, clôture {closingBalance.toFixed(2)} USD ({accountingConsistency ? "OK" : "écart"}).
              </p>
            </section>

            {canWrite ? (
              <CashOperationForm />
            ) : (
              <section className="rounded-2xl border border-dashed border-black/20 bg-white/80 p-4 text-xs text-black/65 dark:border-white/20 dark:bg-zinc-900/70 dark:text-white/65">
                Profil en lecture seule sur les autres écritures de caisse. Les encodages restent réservés aux profils autorisés.
              </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
                <h2 className="text-sm font-semibold">Journal des autres opérations de caisse</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/5 dark:bg-white/10">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Date</th>
                      <th className="px-4 py-3 text-left font-semibold">Sens</th>
                      <th className="px-4 py-3 text-left font-semibold">Catégorie</th>
                      <th className="px-4 py-3 text-left font-semibold">Montant</th>
                      <th className="px-4 py-3 text-left font-semibold">Taux du jour</th>
                      <th className="px-4 py-3 text-left font-semibold">Eq. USD</th>
                      <th className="px-4 py-3 text-left font-semibold">Méthode</th>
                      <th className="px-4 py-3 text-left font-semibold">Référence</th>
                      <th className="px-4 py-3 text-left font-semibold">Libellé</th>
                      <th className="px-4 py-3 text-left font-semibold">Saisi par</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashOperations.map((operation: any) => (
                      <tr key={operation.id} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-4 py-3">{new Date(operation.occurredAt).toLocaleString("fr-FR")}</td>
                        <td className="px-4 py-3">{operation.direction === "INFLOW" ? "Entrée" : "Sortie"}</td>
                        <td className="px-4 py-3">{operation.category}</td>
                        <td className="px-4 py-3">{operation.amount.toFixed(2)} {operation.currency}</td>
                        <td className="px-4 py-3">{(operation.fxRateUsdToCdf ?? (operation.fxRateToUsd && operation.fxRateToUsd > 0 ? 1 / operation.fxRateToUsd : 2800)).toFixed(2)}</td>
                        <td className="px-4 py-3">{normalizeCashAmountUsd(operation).toFixed(2)} USD</td>
                        <td className="px-4 py-3">{operation.method}</td>
                        <td className="px-4 py-3">{operation.reference ?? "-"}</td>
                        <td className="px-4 py-3">{operation.description}</td>
                        <td className="px-4 py-3">{operation.createdBy?.name ?? "-"}</td>
                      </tr>
                    ))}
                    {cashOperations.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                          Aucune opération de caisse (hors billets) sur cette période.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
        needsPendingWorkspace={(
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Besoins en attente" value={`${pendingNeeds.length}`} />
              <KpiCard label="Montant estimé" value={`${pendingNeedsAmount.toFixed(2)} XAF`} />
            </div>

            <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
                <h2 className="text-sm font-semibold">Etat des besoins en attente de validation</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/5 dark:bg-white/10">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Date</th>
                      <th className="px-4 py-3 text-left font-semibold">Code</th>
                      <th className="px-4 py-3 text-left font-semibold">Besoin</th>
                      <th className="px-4 py-3 text-left font-semibold">Demandeur</th>
                      <th className="px-4 py-3 text-left font-semibold">Montant estimé</th>
                      <th className="px-4 py-3 text-left font-semibold">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingNeeds.map((need: any) => (
                      <tr key={need.id} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-4 py-3">{new Date(need.submittedAt ?? need.createdAt).toLocaleDateString("fr-FR")}</td>
                        <td className="px-4 py-3 font-medium">{need.code ?? "-"}</td>
                        <td className="px-4 py-3">{need.title}</td>
                        <td className="px-4 py-3">{need.requester?.name ?? "-"}</td>
                        <td className="px-4 py-3">{typeof need.estimatedAmount === "number" ? `${need.estimatedAmount.toFixed(2)} ${need.currency ?? "XAF"}` : "-"}</td>
                        <td className="px-4 py-3">{need.status}</td>
                      </tr>
                    ))}
                    {pendingNeeds.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                          Aucun besoin en attente de validation.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
        ordersPendingWorkspace={(
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="OP en attente" value={`${paymentOrders.length}`} />
              <KpiCard label="Montant total en attente" value={`${pendingPaymentOrdersAmount.toFixed(2)} XAF`} />
            </div>

            {role === "DIRECTEUR_GENERAL" ? (
              <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <h2 className="text-sm font-semibold">Ordres de paiement DG</h2>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60">La création d'OP se fait dans votre espace dédié.</p>
                <a
                  href="/dg/ordres-paiement"
                  className="mt-3 inline-flex rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Ouvrir l'espace DG OP
                </a>
              </section>
            ) : null}

            <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
                <h2 className="text-sm font-semibold">Ordres de paiement en attente de validation</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/5 dark:bg-white/10">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Créé le</th>
                      <th className="px-4 py-3 text-left font-semibold">Description</th>
                      <th className="px-4 py-3 text-left font-semibold">Montant</th>
                      <th className="px-4 py-3 text-left font-semibold">DG</th>
                      <th className="px-4 py-3 text-left font-semibold">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentOrders.map((order: any) => (
                      <tr key={order.id} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-4 py-3">{new Date(order.createdAt).toLocaleDateString("fr-FR")}</td>
                        <td className="px-4 py-3">{order.description}</td>
                        <td className="px-4 py-3">{order.amount.toFixed(2)} {order.currency}</td>
                        <td className="px-4 py-3">{order.issuedBy?.name ?? "-"}</td>
                        <td className="px-4 py-3">{order.status}</td>
                      </tr>
                    ))}
                    {paymentOrders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                          Aucun ordre de paiement en attente de validation.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      />
    </AppShell>
  );
}
