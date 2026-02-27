import { PaymentStatus } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { PaymentEntryForm } from "@/components/payment-entry-form";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);

  const [tickets, payments] = await Promise.all([
    prisma.ticketSale.findMany({
      include: { airline: true, payments: true },
      orderBy: { soldAt: "desc" },
      take: 300,
    }),
    prisma.payment.findMany({
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
      take: 150,
    }),
  ]);

  const ticketsWithComputedStatus = tickets.map((ticket) => {
    const paidAmount = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
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
  const collectedTotal = ticketsWithComputedStatus
    .filter((ticket) => ticket.computedStatus === PaymentStatus.PAID)
    .reduce((sum, ticket) => sum + ticket.amount, 0);

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

      <PaymentEntryForm tickets={paymentTickets} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total facturé" value={`${totalTicketAmount.toFixed(2)} USD`} />
        <KpiCard label="Total encaissé" value={`${totalPaid.toFixed(2)} USD`} />
        <KpiCard label="Total créance" value={`${receivables.toFixed(2)} USD`} />
        <KpiCard label="Total collecté" value={`${collectedTotal.toFixed(2)} USD`} />
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Billet</th>
                <th className="px-4 py-3 text-left font-semibold">Client</th>
                <th className="px-4 py-3 text-left font-semibold">Facturé</th>
                <th className="px-4 py-3 text-left font-semibold">Encaissé</th>
                <th className="px-4 py-3 text-left font-semibold">Reste</th>
                <th className="px-4 py-3 text-left font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {ticketsWithComputedStatus.slice(0, 120).map((ticket) => (
                <tr key={ticket.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3 font-medium">{ticket.ticketNumber}</td>
                  <td className="px-4 py-3">{ticket.customerName}</td>
                  <td className="px-4 py-3">{ticket.amount.toFixed(2)} USD</td>
                  <td className="px-4 py-3">{ticket.paidAmount.toFixed(2)} USD</td>
                  <td className="px-4 py-3">{Math.max(0, ticket.amount - ticket.paidAmount).toFixed(2)} USD</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold dark:bg-white/10">
                      {ticket.computedStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
