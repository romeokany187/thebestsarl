import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { TicketForm } from "@/components/ticket-form";
import { TicketRowActions } from "@/components/ticket-row-actions";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { ensureAirlineCatalog } from "@/lib/airline-catalog";
import { computeCaaCommissionMap } from "@/lib/caa-commission";

export const dynamic = "force-dynamic";

type SearchParams = {
  startDate?: string;
  endDate?: string;
};

function rangeFromSearch(params: SearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startRaw = params.startDate ?? defaultDay;
  const endRaw = params.endDate ?? startRaw;

  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const endInclusive = new Date(`${endRaw}T00:00:00.000Z`);
  const endExclusive = new Date(endInclusive);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  return {
    start,
    endExclusive,
    startRaw,
    endRaw,
  };
}

function paymentLabel(status: string) {
  if (status === "PAID") return "Payé";
  if (status === "UNPAID") return "Non payé";
  return "Partiel";
}

function saleNatureLabel(value: string) {
  return value === "CREDIT" ? "Crédit" : "Cash";
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const dateRange = rangeFromSearch(resolvedSearchParams);
  const { session, role } = await requirePageModuleAccess("sales", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const roleTicketFilter = role === "EMPLOYEE" ? { sellerId: session.user.id } : {};
  const canCreateTicket = role === "ADMIN" || role === "MANAGER" || role === "EMPLOYEE";
  const canManageTickets = role === "ADMIN" || role === "EMPLOYEE";
  const accessNote = canCreateTicket
    ? role === "EMPLOYEE"
      ? "Accès commercial personnel: création et suivi de vos ventes."
      : "Accès commercial étendu: création et suivi des ventes de l'agence."
    : "Accès financier lecture seule: consultation des ventes et commissions.";

  await ensureAirlineCatalog(prisma);

  const [users, airlines, teams, tickets] = await Promise.all([
    prisma.user.findMany({
      where:
        role === "EMPLOYEE"
          ? { id: session.user.id }
          : { role: { in: ["EMPLOYEE", "MANAGER", "ADMIN"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.airline.findMany({
      include: { commissionRules: { where: { isActive: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.team.findMany({
      select: { id: true, name: true, kind: true },
      orderBy: { name: "asc" },
    }),
    prisma.ticketSale.findMany({
      where: {
        ...(role === "EMPLOYEE" ? { sellerId: session.user.id } : {}),
        soldAt: {
          gte: dateRange.start,
          lt: dateRange.endExclusive,
        },
      },
      include: { airline: true, seller: { select: { name: true } }, payments: true, },

      orderBy: { soldAt: "desc" },
      take: 200,
    }),
  ]);

  const caaAirline = airlines.find((airline) => airline.code === "CAA");
  const caaRule = caaAirline?.commissionRules
    .filter((rule) => rule.isActive && rule.commissionMode === "AFTER_DEPOSIT")
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  const airFastAirline = airlines.find((airline) => airline.code === "FST");
  const caaTargetAmount = caaRule?.depositStockTargetAmount ?? 0;
  const caaBatchCommission = caaRule?.batchCommissionAmount ?? 0;
  const orderedCaaTicketsUntilPeriodEnd = caaAirline
    ? await prisma.ticketSale.findMany({
      where: {
        ...roleTicketFilter,
        airlineId: caaAirline.id,
        soldAt: { lt: dateRange.endExclusive },
      },
      select: { id: true, soldAt: true, amount: true },
      orderBy: [{ soldAt: "asc" }, { id: "asc" }],
    })
    : [];

  const caaTicketsInPeriod = caaAirline
    ? tickets.filter((ticket) => ticket.airlineId === caaAirline.id)
    : [];

  const caaCommissionMap = caaAirline
    ? computeCaaCommissionMap({
      periodTicketIds: caaTicketsInPeriod.map((ticket) => ticket.id),
      orderedCaaTicketsUntilPeriodEnd,
      targetAmount: caaTargetAmount,
      batchCommissionAmount: caaBatchCommission,
    })
    : new Map<string, number>();

  const commissionOf = (ticket: { id: string; airline: { code: string }; amount: number; commissionAmount: number | null; commissionRateUsed: number }) => {
    if (ticket.airline.code === "CAA" && caaCommissionMap.has(ticket.id)) {
      return caaCommissionMap.get(ticket.id) ?? 0;
    }
    return ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
  };

  const caaConsumedInPeriod = caaTicketsInPeriod.reduce((sum, ticket) => sum + ticket.amount, 0);
  const caaCommissionEarned = caaTicketsInPeriod.reduce((sum, ticket) => sum + commissionOf(ticket), 0);
  const caaLotsReached = caaBatchCommission > 0 ? Math.round(caaCommissionEarned / caaBatchCommission) : 0;

  const caaConsumedUntilEnd = caaAirline
    ? orderedCaaTicketsUntilPeriodEnd.reduce((sum, ticket) => sum + ticket.amount, 0)
    : 0;
  const caaRemainder = caaTargetAmount > 0 ? caaConsumedUntilEnd % caaTargetAmount : 0;
  const caaRemainingToNextLot = caaTargetAmount > 0
    ? caaConsumedUntilEnd === 0
      ? caaTargetAmount
      : caaRemainder === 0
        ? 0
        : Math.max(0, caaTargetAmount - caaRemainder)
    : 0;
  const airFastTicketCount = airFastAirline
    ? await prisma.ticketSale.count({
      where: {
        airlineId: airFastAirline.id,
        ...(role === "EMPLOYEE" ? { sellerId: session.user.id } : {}),
      },
    })
    : 0;
  const airFastNextBonusIn = airFastAirline
    ? (13 - (airFastTicketCount % 13 || 13))
    : 0;
  const airFastBonusReached = airFastAirline ? Math.floor(airFastTicketCount / 13) : 0;

  const totalBillets = tickets.length;
  const totalCA = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const totalCommission = tickets.reduce((sum, ticket) => sum + commissionOf(ticket), 0);
  const totalNet = tickets.reduce((sum, ticket) => sum + ticket.amount + (ticket.agencyMarkupAmount ?? 0), 0);
  const totalNonPaye = tickets
    .filter((ticket) => ticket.paymentStatus === "UNPAID" || ticket.paymentStatus === "PARTIAL")
    .reduce((sum, ticket) => sum + ticket.amount, 0);
  const periodLabel = dateRange.startRaw === dateRange.endRaw
    ? dateRange.startRaw
    : `${dateRange.startRaw} → ${dateRange.endRaw}`;

  return (
    <AppShell role={role} accessNote={accessNote}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold">Rapport de vente</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Suivi des billets avec commission calculée par compagnie, itinéraire et classe.
        </p>
      </section>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Billets" value={String(totalBillets)} hint={`Période: ${periodLabel}`} />
        <KpiCard label="Chiffre d'affaires" value={`${totalCA.toFixed(2)} USD`} hint="Total billets vendus" />
        <KpiCard label="Commission" value={`${totalCommission.toFixed(2)} USD`} hint="Commission totale générée" />
        <KpiCard label="Net agence" value={`${totalNet.toFixed(2)} USD`} hint="CA + majorations" />
        <KpiCard label="À encaisser" value={`${totalNonPaye.toFixed(2)} USD`} hint="Non payés + partiels" />
      </section>

      <section className="mb-6 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <form method="GET" className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Du</label>
            <input
              type="date"
              name="startDate"
              defaultValue={dateRange.startRaw}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Au</label>
            <input
              type="date"
              name="endDate"
              defaultValue={dateRange.endRaw}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Rechercher</button>
        </form>
      </section>

      <div className="grid gap-6 lg:grid-cols-[400px,1fr]">
        {canCreateTicket ? (
          <TicketForm
            users={users}
            airlines={airlines.map((airline) => ({
              id: airline.id,
              name: airline.name,
              code: airline.code,
            }))}
            teams={teams.map((team) => ({
              id: team.id,
              name: team.name,
              kind: team.kind,
            }))}
          />
        ) : (
          <section className="rounded-xl border border-black/10 bg-white p-4 text-sm text-black/70 dark:border-white/10 dark:bg-zinc-900 dark:text-white/70">
            Accès en lecture seule: vous pouvez consulter les ventes mais pas enregistrer de nouveaux billets.
          </section>
        )}

        <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
          {(caaRule || airFastAirline) ? (
            <div className="border-b border-black/10 p-3 text-xs dark:border-white/10">
              <div className="grid gap-2 sm:grid-cols-2">
                {caaRule ? (
                  <div className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                    <p className="font-semibold">Suivi CAA</p>
                    <p className="text-black/60 dark:text-white/60">
                      Cumul période: {caaConsumedInPeriod.toFixed(2)} USD • Lots: {caaLotsReached} • Commission: {caaCommissionEarned.toFixed(2)} USD • Reste prochain lot: {caaRemainingToNextLot.toFixed(2)} USD
                    </p>
                  </div>
                ) : null}
                {airFastAirline ? (
                  <div className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                    <p className="font-semibold">Suivi Air Fast</p>
                    <p className="text-black/60 dark:text-white/60">
                      Billets vendus: {airFastTicketCount} • Bonus gagnés: {airFastBonusReached} • Prochain bonus dans: {airFastNextBonusIn} billet(s)
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="tickets-scroll h-[70vh] w-full overflow-scroll overscroll-contain">
          <table className="min-w-300 text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Émetteur</th>
                <th className="px-3 py-2 text-left">Compagnie</th>
                <th className="px-3 py-2 text-left">Code billet (PNR)</th>
                <th className="px-3 py-2 text-left">Itinéraire</th>
                <th className="px-3 py-2 text-left">Prix</th>
                <th className="px-3 py-2 text-left">BaseFare</th>
                <th className="px-3 py-2 text-left">Commission</th>
                <th className="px-3 py-2 text-left">Net après déduction</th>
                <th className="px-3 py-2 text-left">Nature vente</th>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-left">Payant</th>
                {canManageTickets ? <th className="px-3 py-2 text-left">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => {
                const commissionAmount = commissionOf(ticket);
                const agencyMarkupAmount = ticket.agencyMarkupAmount ?? 0;
                const companyCommissionAmount = Math.max(0, commissionAmount - agencyMarkupAmount);
                const netAfterCommission = ticket.amount + agencyMarkupAmount;

                return (
                  <tr key={ticket.id} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-3 py-2">{ticket.sellerName ?? ticket.seller?.name ?? "—"}</td>
                    <td className="px-3 py-2">{ticket.airline.code}</td>
                    <td className="px-3 py-2">{ticket.ticketNumber}</td>
                    <td className="px-3 py-2">{ticket.route}</td>
                    <td className="px-3 py-2">{ticket.amount.toFixed(2)} {ticket.currency}</td>
                    <td className="px-3 py-2">{(ticket.baseFareAmount ?? ticket.commissionBaseAmount).toFixed(2)} {ticket.currency}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium">Total: {commissionAmount.toFixed(2)} {ticket.currency}</span>
                      <span className="ml-1 text-xs text-black/60 dark:text-white/60">
                        (Compagnie: {companyCommissionAmount.toFixed(2)} • Majoration: {agencyMarkupAmount.toFixed(2)})
                      </span>
                      <span className="ml-1 text-xs text-black/60 dark:text-white/60">
                        {ticket.commissionCalculationStatus === "ESTIMATED" ? "(estimée)" : "(définitive)"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{netAfterCommission.toFixed(2)} {ticket.currency}</td>
                    <td className="px-3 py-2">{saleNatureLabel(ticket.saleNature)}</td>
                    <td className="px-3 py-2">{paymentLabel(ticket.paymentStatus)}</td>
                    <td className="px-3 py-2">{ticket.payerName ?? "-"}</td>
                    {canManageTickets ? (
                      <td className="px-3 py-2">
                        <TicketRowActions
                          ticket={{
                            id: ticket.id,
                            ticketNumber: ticket.ticketNumber,
                            airlineId: ticket.airlineId,
                            sellerId: ticket.sellerId,
                            customerName: ticket.customerName,
                            route: ticket.route,
                            travelClass: ticket.travelClass,
                            travelDate: new Date(ticket.travelDate).toISOString().slice(0, 10),
                            amount: ticket.amount,
                            baseFareAmount: ticket.baseFareAmount,
                            currency: ticket.currency,
                            saleNature: ticket.saleNature,
                            agencyMarkupPercent: ticket.agencyMarkupPercent,
                            agencyMarkupAmount: ticket.agencyMarkupAmount,
                            paymentStatus: ticket.paymentStatus,
                            payerName: ticket.payerName,
                            notes: ticket.notes,
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
