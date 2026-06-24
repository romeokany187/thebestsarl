import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PaymentOrderDeleteButton } from "@/components/payment-order-delete-button";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { workflowAssignmentLabel } from "@/lib/workflow-assignment";
import {
  type OpFilter,
  OP_FILTER_LABELS,
  opMatchesFilter,
  opStatusLabel,
  opBadgeClass,
} from "@/lib/op-filters";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const VALID_FILTERS: OpFilter[] = ["total", "en-attente", "approuves", "executes", "rejetes"];

export const dynamic = "force-dynamic";

export default async function OpListPage({
  params,
}: {
  params: Promise<{ filter: string }>;
}) {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT"]);
  const { filter } = await params;

  if (!VALID_FILTERS.includes(filter as OpFilter)) {
    notFound();
  }

  const opFilter = filter as OpFilter;
  const label = OP_FILTER_LABELS[opFilter];

  const allOrders = await paymentOrderClient.findMany({
    include: {
      issuedBy: { select: { name: true, jobTitle: true } },
      approvedBy: { select: { name: true } },
      executedBy: { select: { name: true } },
    },
    orderBy: [{ executedAt: "desc" }, { approvedAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });

  const filteredOrders = allOrders.filter((o: { status: string }) =>
    opMatchesFilter(o.status, opFilter),
  );

  return (
    <AppShell
      role={role}
      accessNote={`Liste filtrée des OP : ${label}`}
    >
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Ordres de paiement — {label}</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              {filteredOrders.length} OP trouvé{filteredOrders.length > 1 ? "s" : ""}
            </p>
          </div>
          <a
            href="/admin/ordres-paiement"
            className="rounded-md border border-black/20 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            ← Retour au tableau de bord
          </a>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
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
              {filteredOrders.map((order: any) => (
                <tr key={order.id} className="border-t border-black/5 dark:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-black/65 dark:text-white/65">
                    {formatDate(order.createdAt)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-700 dark:text-blue-400 whitespace-nowrap">
                    {order.code ?? order.id.slice(0, 8).toUpperCase()}
                  </td>
                  <td className="px-4 py-3">{order.beneficiary || "-"}</td>
                  <td className="px-4 py-3 max-w-[200px] truncate">{order.purpose || "-"}</td>
                  <td className="px-4 py-3 text-xs">{workflowAssignmentLabel(order.assignment)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {order.amount.toFixed(2)} {normalizeMoneyCurrency(order.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${opBadgeClass(order.status)}`}>
                      {opStatusLabel(order.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
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
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Aucun OP dans cette catégorie.
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
