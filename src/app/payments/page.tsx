import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);

  const [tickets, payments] = await Promise.all([
    prisma.ticketSale.findMany({ include: { airline: true }, take: 120 }),
    prisma.payment.findMany({
      include: { ticket: { select: { ticketNumber: true, customerName: true, currency: true } } },
      orderBy: { paidAt: "desc" },
      take: 80,
    }),
  ]);

  const totalTicketAmount = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const receivables = Math.max(0, totalTicketAmount - totalPaid);
  const collectionRate = totalTicketAmount === 0 ? 0 : (totalPaid / totalTicketAmount) * 100;

  return (
    <AppShell
      role={role}
      accessNote="Vue financière: suivi des encaissements, des soldes clients et des créances à recouvrer."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Paiements</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Pilotage financier des billets vendus et des paiements reçus.</p>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total facturé" value={`${totalTicketAmount.toFixed(2)} EUR`} />
        <KpiCard label="Total encaissé" value={`${totalPaid.toFixed(2)} EUR`} />
        <KpiCard label="Créances" value={`${receivables.toFixed(2)} EUR`} />
        <KpiCard label="Taux de collecte" value={`${collectionRate.toFixed(1)}%`} />
      </div>

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
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3">{new Date(payment.paidAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-medium">{payment.ticket.ticketNumber}</td>
                  <td className="px-4 py-3">{payment.ticket.customerName}</td>
                  <td className="px-4 py-3">{payment.amount.toFixed(2)} {payment.ticket.currency}</td>
                  <td className="px-4 py-3">{payment.method}</td>
                  <td className="px-4 py-3">{payment.reference ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
