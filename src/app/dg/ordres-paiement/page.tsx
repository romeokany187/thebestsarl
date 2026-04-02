import { AppShell } from "@/components/app-shell";
import { PaymentOrderForm } from "@/components/payment-order-form";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

export const dynamic = "force-dynamic";

export default async function DgPaymentOrdersPage() {
  const { role, session } = await requirePageRoles(["DIRECTEUR_GENERAL"]);

  const orders = await paymentOrderClient.findMany({
    where: { issuedById: session.user.id },
    include: {
      approvedBy: { select: { name: true } },
      executedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 120,
  });

  return (
    <AppShell
      role={role}
      accessNote="Espace DG: création des ordres de paiement et suivi du circuit de validation."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Espace DG - Ordres de paiement</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Vous créez les OP ici. Ensuite: notification Admin, validation, exécution caisse, notification comptable.
        </p>
      </section>

      <PaymentOrderForm />

      <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h2 className="text-sm font-semibold">Mes ordres de paiement</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Créé le</th>
                <th className="px-4 py-3 text-left font-semibold">Description</th>
                <th className="px-4 py-3 text-left font-semibold">Montant</th>
                <th className="px-4 py-3 text-left font-semibold">Admin</th>
                <th className="px-4 py-3 text-left font-semibold">Caissière</th>
                <th className="px-4 py-3 text-left font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any) => (
                <tr key={order.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3">{new Date(order.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-3">{order.description}</td>
                  <td className="px-4 py-3">{order.amount.toFixed(2)} {normalizeMoneyCurrency(order.currency)}</td>
                  <td className="px-4 py-3">{order.approvedBy?.name ?? "-"}</td>
                  <td className="px-4 py-3">{order.executedBy?.name ?? "-"}</td>
                  <td className="px-4 py-3">{order.status}</td>
                </tr>
              ))}
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Aucun ordre de paiement créé pour le moment.
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
