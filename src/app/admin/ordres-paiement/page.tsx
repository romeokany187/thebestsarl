import { AppShell } from "@/components/app-shell";
import { PaymentOrderDeleteButton } from "@/components/payment-order-delete-button";
import { PaymentOrderForm } from "@/components/payment-order-form";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { workflowAssignmentLabel } from "@/lib/workflow-assignment";
import { hasNeedExecutionMarker } from "@/lib/inbox-workflow";
import { parseNeedQuote } from "@/lib/need-lines";
import {
  needStatusLabel,
  needBadgeClass,
  NEED_FILTER_LABELS,
} from "@/lib/need-filters";
import {
  opStatusLabel,
  opBadgeClass,
  OP_FILTER_LABELS,
} from "@/lib/op-filters";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

function needStatusSortKey(need: {
  status: string;
  reviewComment?: string | null;
  approvedAt?: Date | null;
}) {
  const label = needStatusLabel(need.status, need.reviewComment);
  if (label === "En attente") return 1;
  if (label === "Approuvé") return 2;
  if (label === "Exécuté") return 3;
  if (label === "Rejeté") return 4;
  return 5;
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export const dynamic = "force-dynamic";

export default async function AdminPaymentOrdersPage() {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN"]);

  const [orders, allOrdersAll, needs] = await Promise.all([
    // Admin-issued orders (for the form section)
    paymentOrderClient.findMany({
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
    }),
    // All orders (for the OP dashboard stats)
    paymentOrderClient.findMany({
      include: {
        issuedBy: { select: { name: true, jobTitle: true } },
        approvedBy: { select: { name: true } },
        executedBy: { select: { name: true } },
      },
      orderBy: [{ executedAt: "desc" }, { approvedAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    }),
    prisma.needRequest.findMany({
      include: {
        requester: { select: { id: true, name: true, jobTitle: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  // Compute need summary stats
  const needStats = {
    total: needs.length,
    enAttente: needs.filter((n) => n.status === "SUBMITTED").length,
    approuves: needs.filter((n) => n.status === "APPROVED" && !hasNeedExecutionMarker(n.reviewComment)).length,
    executes: needs.filter((n) => hasNeedExecutionMarker(n.reviewComment)).length,
    rejetes: needs.filter((n) => n.status === "REJECTED").length,
  };

  // Compute OP summary stats (all orders)
  const opStats = {
    total: allOrdersAll.length,
    enAttente: allOrdersAll.filter((o: { status: string }) => o.status === "SUBMITTED").length,
    approuves: allOrdersAll.filter((o: { status: string }) => o.status === "APPROVED").length,
    executes: allOrdersAll.filter((o: { status: string }) => o.status === "EXECUTED").length,
    rejetes: allOrdersAll.filter((o: { status: string }) => o.status === "REJECTED").length,
  };

  // Pre-sort needs: pending first, then approved, executed, rejected
  const sortedNeeds = [...needs].sort((a, b) => {
    const ka = needStatusSortKey(a);
    const kb = needStatusSortKey(b);
    if (ka !== kb) return ka - kb;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return (
    <AppShell
      role={role}
      accessNote="Espace admin: création des ordres de paiement et suivi de tous les OP et EDB."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Espace Admin — Ordres de paiement & États de besoin</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Tableau de bord, création d'OP et suivi détaillé. Cliquez sur une carte pour voir la liste complète par catégorie.
        </p>
      </section>

      {/* ---------- EDB STATUS DASHBOARD ---------- */}
      <section className="mb-8 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-3 text-base font-semibold">États des besoins — Synthèse</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <DashboardCard href="/admin/ordres-paiement/edb/total" count={needStats.total} label={NEED_FILTER_LABELS.total} className="border-black/10 bg-black/3 dark:border-white/10 dark:bg-white/3" />
          <DashboardCard href="/admin/ordres-paiement/edb/en-attente" count={needStats.enAttente} label={NEED_FILTER_LABELS["en-attente"]} className="border-amber-200 bg-amber-50/50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300" />
          <DashboardCard href="/admin/ordres-paiement/edb/approuves" count={needStats.approuves} label={NEED_FILTER_LABELS.approuves} className="border-emerald-200 bg-emerald-50/50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300" />
          <DashboardCard href="/admin/ordres-paiement/edb/executes" count={needStats.executes} label={NEED_FILTER_LABELS.executes} className="border-sky-200 bg-sky-50/50 text-sky-800 dark:border-sky-800/40 dark:bg-sky-950/20 dark:text-sky-300" />
          <DashboardCard href="/admin/ordres-paiement/edb/rejetes" count={needStats.rejetes} label={NEED_FILTER_LABELS.rejetes} className="border-red-200 bg-red-50/50 text-red-800 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300" />
        </div>

        {/* Needs table */}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-left font-semibold">Code</th>
                <th className="px-3 py-2 text-left font-semibold">Objet</th>
                <th className="px-3 py-2 text-left font-semibold">Demandeur</th>
                <th className="px-3 py-2 text-left font-semibold">Affectation</th>
                <th className="px-3 py-2 text-left font-semibold">Montant</th>
                <th className="px-3 py-2 text-left font-semibold">Statut</th>
                <th className="px-3 py-2 text-left font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedNeeds.slice(0, 20).map((need) => {
                const quote = parseNeedQuote(need.details ?? null);
                const label = needStatusLabel(need.status, need.reviewComment);
                return (
                  <tr key={need.id} className="border-t border-black/5 dark:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-black/65 dark:text-white/65">
                      {formatDate(need.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-blue-700 dark:text-blue-400 whitespace-nowrap">
                      {need.code ?? need.id.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="px-3 py-2 font-medium max-w-[200px] truncate">{need.title}</td>
                    <td className="px-3 py-2 text-xs">{need.requester.name}</td>
                    <td className="px-3 py-2 text-xs">{workflowAssignmentLabel(quote?.assignment)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {typeof need.estimatedAmount === "number"
                        ? `${need.estimatedAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${normalizeMoneyCurrency(need.currency)}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${needBadgeClass(label)}`}>
                        {label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`/approvisionnement/${need.id}`}
                          className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        >
                          Ouvrir
                        </a>
                        <a
                          href={`/api/procurement/needs/${need.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        >
                          PDF
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedNeeds.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Aucun état de besoin émis pour le moment.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {sortedNeeds.length > 20 ? (
          <div className="mt-2 text-right">
            <a
              href="/admin/ordres-paiement/edb/total"
              className="text-xs font-semibold text-blue-700 hover:underline dark:text-blue-400"
            >
              Voir tous les EDB ({sortedNeeds.length}) →
            </a>
          </div>
        ) : null}
      </section>

      {/* ---------- OP STATUS DASHBOARD ---------- */}
      <section className="mb-8 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-3 text-base font-semibold">Ordres de paiement — Synthèse</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <DashboardCard href="/admin/ordres-paiement/op/total" count={opStats.total} label={OP_FILTER_LABELS.total} className="border-black/10 bg-black/3 dark:border-white/10 dark:bg-white/3" />
          <DashboardCard href="/admin/ordres-paiement/op/en-attente" count={opStats.enAttente} label={OP_FILTER_LABELS["en-attente"]} className="border-amber-200 bg-amber-50/50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300" />
          <DashboardCard href="/admin/ordres-paiement/op/approuves" count={opStats.approuves} label={OP_FILTER_LABELS.approuves} className="border-emerald-200 bg-emerald-50/50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300" />
          <DashboardCard href="/admin/ordres-paiement/op/executes" count={opStats.executes} label={OP_FILTER_LABELS.executes} className="border-sky-200 bg-sky-50/50 text-sky-800 dark:border-sky-800/40 dark:bg-sky-950/20 dark:text-sky-300" />
          <DashboardCard href="/admin/ordres-paiement/op/rejetes" count={opStats.rejetes} label={OP_FILTER_LABELS.rejetes} className="border-red-200 bg-red-50/50 text-red-800 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300" />
        </div>
      </section>

      {/* ---------- PAYMENT ORDER FORM ---------- */}
      <PaymentOrderForm issuerRole="ADMIN" />

      {/* ---------- PAYMENT ORDERS TABLE (Admin only) ---------- */}
      <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h2 className="text-sm font-semibold">Ordres de paiement émis par l'admin</h2>
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
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${opBadgeClass(order.status)}`}>
                      {opStatusLabel(order.status)}
                    </span>
                  </td>
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

/** Small card component that links to the filtered list page. */
function DashboardCard({
  href,
  count,
  label,
  className,
}: {
  href: string;
  count: number;
  label: string;
  className: string;
}) {
  return (
    <a
      href={href}
      className={`rounded-lg border p-3 transition hover:scale-[1.02] hover:shadow-md ${className}`}
    >
      <p className="text-[11px] uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{count}</p>
    </a>
  );
}
