import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { TicketForm } from "@/components/ticket-form";
import { calculateTicketMetrics } from "@/lib/kpi";
import { prisma } from "@/lib/prisma";
import { requirePageRoles } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const { session, role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const canCreateTicket = role === "ADMIN" || role === "MANAGER" || role === "EMPLOYEE";
  const accessNote = canCreateTicket
    ? role === "EMPLOYEE"
      ? "Accès commercial personnel: création et suivi de vos ventes."
      : "Accès commercial étendu: création et suivi des ventes de l'agence."
    : "Accès financier lecture seule: consultation des ventes et commissions.";

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

  return (
    <AppShell role={role} accessNote={accessNote}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold">Rapport des ventes billets</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Suivi des ventes, statuts de paiement et commissions nettes par compagnie.
        </p>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Ventes totales" value={`${metrics.totalSales.toFixed(2)} EUR`} />
        <KpiCard label="Commission brute" value={`${metrics.grossCommission.toFixed(2)} EUR`} />
        <KpiCard label="Commission nette" value={`${metrics.netCommission.toFixed(2)} EUR`} />
        <KpiCard label="Taux encaissement" value={`${(metrics.paidRatio * 100).toFixed(1)}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[400px,1fr]">
        {canCreateTicket ? (
          <TicketForm
            users={users}
            airlines={airlines.map((airline) => ({
              id: airline.id,
              name: airline.name,
              code: airline.code,
              defaultRate: airline.commissionRules[0]?.ratePercent ?? 5,
            }))}
          />
        ) : (
          <section className="rounded-xl border border-black/10 bg-white p-4 text-sm text-black/70 dark:border-white/10 dark:bg-zinc-900 dark:text-white/70">
            Accès en lecture seule: vous pouvez consulter les ventes mais pas enregistrer de nouveaux billets.
          </section>
        )}

        <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Billet</th>
                <th className="px-3 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-left">Compagnie</th>
                <th className="px-3 py-2 text-left">Montant</th>
                <th className="px-3 py-2 text-left">Commission nette</th>
                <th className="px-3 py-2 text-left">Paiement</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => {
                const received = ticket.payments.reduce((acc, payment) => acc + payment.amount, 0);
                const ratio = ticket.amount > 0 ? Math.min(1, received / ticket.amount) : 0;
                const net = ticket.amount * (ticket.commissionRateUsed / 100) * ratio;

                return (
                  <tr key={ticket.id} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-3 py-2">{ticket.ticketNumber}</td>
                    <td className="px-3 py-2">{ticket.customerName}</td>
                    <td className="px-3 py-2">{ticket.airline.code}</td>
                    <td className="px-3 py-2">{ticket.amount.toFixed(2)} {ticket.currency}</td>
                    <td className="px-3 py-2">{net.toFixed(2)} {ticket.currency}</td>
                    <td className="px-3 py-2">{ticket.paymentStatus}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
