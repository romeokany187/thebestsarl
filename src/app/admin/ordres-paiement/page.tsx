import { AppShell } from "@/components/app-shell";
import { PaymentOrderDeleteButton } from "@/components/payment-order-delete-button";
import { PaymentOrderForm } from "@/components/payment-order-form";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { workflowAssignmentLabel } from "@/lib/workflow-assignment";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

export const dynamic = "force-dynamic";

export default async function AdminPaymentOrdersPage() {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN"]);

  const orders = await paymentOrderClient.findMany({
    where: {
      issuedBy: { role: "ADMIN" },
    },
    include: {
      issuedBy: { select: { name: true, jobTitle: true } },
      approvedBy: { select: { name: true } },
      executedBy: { select: { name: true } },
    },
    orderBy: [{ executedAt: "desc" }, { approvedAt: "desc" }, { createdAt: "desc" }],
    take: 120,
  });

  return (
    <AppShell
      role={role}
      accessNote="Espace admin: création des ordres de paiement avec passage direct en exécution caisse."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Espace Admin - Ordres de paiement</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Les OP émis par l&apos;admin sont validés automatiquement et vont directement à l&apos;exécution caisse.
        </p>
      </section>

      <PaymentOrderForm issuerRole="ADMIN" />

      <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h2 className="text-sm font-semibold">Ordres de paiement émis par l&apos;admin</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Créé le</th>
                <th className="px-4 py-3 text-left font-semibold">Code OP</th>
                <th className="px-4 py-3 text-left font-semibold">Bénéficiaire</th>
                <th className="px-4 py-3 text-left font-semibold">Motif</th>
                <th className="px-4 py-3 text-left font-semibold">Affectation</th>
                <th className="px-4 py-3 text-left font-semibold">Montant</th>
                <th className="px-4 py-3 text-left font-semibold">Statut</th>
                <th className="px-4 py-3 text-left font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any) => (
                <tr key={order.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3">{new Date(order.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold">{order.code ?? "-"}</td>
                  <td className="px-4 py-3">{order.beneficiary || "-"}</td>
                  <td className="px-4 py-3">{order.purpose || "-"}</td>
                  <td className="px-4 py-3">{workflowAssignmentLabel(order.assignment)}</td>
                  <td className="px-4 py-3">{order.amount.toFixed(2)} {normalizeMoneyCurrency(order.currency)}</td>
                  <td className="px-4 py-3">{order.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`/api/payment-orders/${order.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        PDF
                      </a>
                      <PaymentOrderDeleteButton paymentOrderId={order.id} status={order.status} compact />
                    </div>
                  </td>
                </tr>
              ))}
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Aucun ordre de paiement admin créé pour le moment.
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
