import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { TicketForm } from "@/components/ticket-form";
import { TicketRowActions } from "@/components/ticket-row-actions";
import { calculateTicketMetrics } from "@/lib/kpi";
import { prisma } from "@/lib/prisma";
import { requirePageRoles } from "@/lib/rbac";
import { ensureAirlineCatalog } from "@/lib/airline-catalog";

export const dynamic = "force-dynamic";

function paymentLabel(status: string) {
  if (status === "PAID") return "Payé";
  if (status === "UNPAID") return "Non payé";
  return "Partiel";
}

function saleNatureLabel(value: string) {
  return value === "CREDIT" ? "Crédit" : "Cash";
}

export default async function SalesPage() {
  const { session, role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const canCreateTicket = role === "ADMIN" || role === "MANAGER" || role === "EMPLOYEE";
  const canManageTickets = role === "ADMIN" || role === "EMPLOYEE";
  const accessNote = canCreateTicket
    ? role === "EMPLOYEE"
      ? "Accès commercial personnel: création et suivi de vos ventes."
      : "Accès commercial étendu: création et suivi des ventes de l'agence."
    : "Accès financier lecture seule: consultation des ventes et commissions.";

  await ensureAirlineCatalog(prisma);

  const [users, airlines, tickets] = await Promise.all([
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
    prisma.ticketSale.findMany({
      where: role === "EMPLOYEE" ? { sellerId: session.user.id } : undefined,
      include: { airline: true, seller: { select: { name: true } }, payments: true },
      orderBy: { soldAt: "desc" },
      take: 50,
    }),
  ]);

  const metrics = calculateTicketMetrics(tickets);
  const caaAirline = airlines.find((airline) => airline.code === "CAA");
  const caaRule = caaAirline?.commissionRules.find((rule) => rule.commissionMode === "AFTER_DEPOSIT");
  const caaTargetAmount = caaRule?.depositStockTargetAmount ?? 0;
  const caaBatchCommission = caaRule?.batchCommissionAmount ?? 0;
  const caaConsumed = caaRule?.depositStockConsumedAmount ?? 0;
  const caaLotsReached = caaTargetAmount > 0 ? Math.floor(caaConsumed / caaTargetAmount) : 0;
  const caaCommissionEarned = caaLotsReached * caaBatchCommission;
  const caaRemainder = caaTargetAmount > 0 ? caaConsumed % caaTargetAmount : 0;
  const caaRemainingToNextLot = caaTargetAmount > 0 ? Math.max(0, caaTargetAmount - caaRemainder) : 0;

  return (
    <AppShell role={role} accessNote={accessNote}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold">Rapport de vente</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Suivi des billets avec commission calculée par compagnie, itinéraire et classe.
        </p>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Ventes totales" value={`${metrics.totalSales.toFixed(2)} USD`} />
        <KpiCard label="Commission brute" value={`${metrics.grossCommission.toFixed(2)} USD`} />
        <KpiCard label="Commission nette" value={`${metrics.netCommission.toFixed(2)} USD`} />
        <KpiCard label="Taux encaissement" value={`${(metrics.paidRatio * 100).toFixed(1)}%`} />
      </div>

      {caaRule ? (
        <section className="mb-6 rounded-xl border border-black/10 bg-white p-4 text-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-base font-semibold">Suivi CAA - paliers commission</h2>
          <p className="mt-1 text-black/60 dark:text-white/60">
            Chaque lot de {caaTargetAmount.toFixed(2)} USD vendus déclenche {caaBatchCommission.toFixed(2)} USD de commission.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
              <p className="text-xs text-black/60 dark:text-white/60">Cumul ventes CAA</p>
              <p className="font-semibold">{caaConsumed.toFixed(2)} USD</p>
            </div>
            <div className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
              <p className="text-xs text-black/60 dark:text-white/60">Lots atteints</p>
              <p className="font-semibold">{caaLotsReached}</p>
            </div>
            <div className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
              <p className="text-xs text-black/60 dark:text-white/60">Commission cumulée</p>
              <p className="font-semibold">{caaCommissionEarned.toFixed(2)} USD</p>
            </div>
            <div className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
              <p className="text-xs text-black/60 dark:text-white/60">Reste vers prochain lot</p>
              <p className="font-semibold">{caaRemainingToNextLot.toFixed(2)} USD</p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[400px,1fr]">
        {canCreateTicket ? (
          <TicketForm
            users={users}
            airlines={airlines.map((airline) => ({
              id: airline.id,
              name: airline.name,
              code: airline.code,
            }))}
          />
        ) : (
          <section className="rounded-xl border border-black/10 bg-white p-4 text-sm text-black/70 dark:border-white/10 dark:bg-zinc-900 dark:text-white/70">
            Accès en lecture seule: vous pouvez consulter les ventes mais pas enregistrer de nouveaux billets.
          </section>
        )}

        <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
          <div className="tickets-scroll h-[70vh] w-full overflow-scroll overscroll-contain">
          <table className="min-w-[1200px] text-sm">
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
                const commissionAmount = ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
                const agencyMarkupAmount = ticket.agencyMarkupAmount ?? 0;
                const netAfterCommission = ticket.amount + agencyMarkupAmount;

                return (
                  <tr key={ticket.id} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-3 py-2">{ticket.seller.name}</td>
                    <td className="px-3 py-2">{ticket.airline.code}</td>
                    <td className="px-3 py-2">{ticket.ticketNumber}</td>
                    <td className="px-3 py-2">{ticket.route}</td>
                    <td className="px-3 py-2">{ticket.amount.toFixed(2)} {ticket.currency}</td>
                    <td className="px-3 py-2">{(ticket.baseFareAmount ?? ticket.commissionBaseAmount).toFixed(2)} {ticket.currency}</td>
                    <td className="px-3 py-2">
                      {commissionAmount.toFixed(2)} {ticket.currency}
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
