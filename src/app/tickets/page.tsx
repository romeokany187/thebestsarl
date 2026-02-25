import { AppShell } from "@/components/app-shell";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const { session, role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  const tickets = await prisma.ticketSale.findMany({
    where: role === "EMPLOYEE" ? { sellerId: session.user.id } : undefined,
    include: {
      airline: true,
      seller: { select: { name: true } },
      payments: true,
    },
    orderBy: { soldAt: "desc" },
    take: 80,
  });

  const accessNote =
    role === "EMPLOYEE"
      ? "Accès personnel: visualisation de vos billets vendus."
      : "Accès opérationnel: visualisation complète des billets de l'agence.";

  return (
    <AppShell role={role} accessNote={accessNote}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Billets</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Suivi détaillé des ventes et des statuts d&apos;encaissement.</p>
      </section>

      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Billet</th>
                <th className="px-4 py-3 text-left font-semibold">Client</th>
                <th className="px-4 py-3 text-left font-semibold">Vendeur</th>
                <th className="px-4 py-3 text-left font-semibold">Compagnie</th>
                <th className="px-4 py-3 text-left font-semibold">Montant</th>
                <th className="px-4 py-3 text-left font-semibold">Reçu</th>
                <th className="px-4 py-3 text-left font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => {
                const paidAmount = ticket.payments.reduce((sum, item) => sum + item.amount, 0);

                return (
                  <tr key={ticket.id} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-4 py-3 font-medium">{ticket.ticketNumber}</td>
                    <td className="px-4 py-3">{ticket.customerName}</td>
                    <td className="px-4 py-3">{ticket.seller.name}</td>
                    <td className="px-4 py-3">{ticket.airline.code}</td>
                    <td className="px-4 py-3">{ticket.amount.toFixed(2)} {ticket.currency}</td>
                    <td className="px-4 py-3">{paidAmount.toFixed(2)} {ticket.currency}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold dark:bg-white/10">
                        {ticket.paymentStatus}
                      </span>
                    </td>
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
