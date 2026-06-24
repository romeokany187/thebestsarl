import { AppShell } from "@/components/app-shell";
import { PaymentOrderDeleteButton } from "@/components/payment-order-delete-button";
import { PaymentOrderForm } from "@/components/payment-order-form";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { workflowAssignmentLabel } from "@/lib/workflow-assignment";
import { hasNeedExecutionMarker } from "@/lib/inbox-workflow";
import { parseNeedQuote } from "@/lib/need-lines";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

function needStatusLabel(need: {
  status: string;
  reviewComment?: string | null;
  approvedAt?: Date | null;
}) {
  if (hasNeedExecutionMarker(need.reviewComment)) return "Exécuté";
  if (need.status === "REJECTED") return "Rejeté";
  if (need.status === "APPROVED") return "Approuvé";
  if (need.status === "SUBMITTED") return "En attente";
  return "Brouillon";
}

function needStatusSortKey(need: {
  status: string;
  reviewComment?: string | null;
  approvedAt?: Date | null;
}) {
  const label = needStatusLabel(need);
  if (label === "En attente") return 1;
  if (label === "Approuvé") return 2;
  if (label === "Exécuté") return 3;
  if (label === "Rejeté") return 4;
  return 5;
}

function needBadgeClass(label: string) {
  if (label === "Approuvé" || label === "Exécuté") {
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300";
  }
  if (label === "Rejeté") {
    return "border-red-300 bg-red-50 text-red-700 dark:border-red-700/50 dark:bg-red-950/30 dark:text-red-300";
  }
  if (label === "En attente") {
    return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300";
  }
  return "border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700/50 dark:bg-gray-950/30 dark:text-gray-300";
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export const dynamic = "force-dynamic";

export default async function AdminPaymentOrdersPage() {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN"]);

  const [orders, needs] = await Promise.all([
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
    brouillons: needs.filter((n) => n.status === "DRAFT").length,
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
      accessNote="Espace admin: création des ordres de paiement et suivi de tous les états de besoin."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Espace Admin — Ordres de paiement & États de besoin</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Vue d'ensemble des OP émis par l'admin et de tous les EDB avec leur statut.
        </p>
      </section>

      {/* ---------- NEED STATUS DASHBOARD ---------- */}
      <section className="mb-8 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-3 text-base font-semibold">États des besoins — Synthèse</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <article className="rounded-lg border border-black/10 bg-black/3 p-3 dark:border-white/10 dark:bg-white/3">
            <p className="text-[11px] uppercase tracking-wide text-black/60 dark:text-white/60">Total EDB</p>
            <p className="mt-1 text-2xl font-semibold">{needStats.total}</p>
          </article>
          <article className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800/40 dark:bg-amber-950/20">
            <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-400">En attente</p>
            <p className="mt-1 text-2xl font-semibold text-amber-800 dark:text-amber-300">{needStats.enAttente}</p>
          </article>
          <article className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-800/40 dark:bg-emerald-950/20">
            <p className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Approuvés</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-800 dark:text-emerald-300">{needStats.approuves}</p>
          </article>
          <article className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-800/40 dark:bg-sky-950/20">
            <p className="text-[11px] uppercase tracking-wide text-sky-700 dark:text-sky-400">Exécutés caisse</p>
            <p className="mt-1 text-2xl font-semibold text-sky-800 dark:text-sky-300">{needStats.executes}</p>
          </article>
          <article className="rounded-lg border border-red-200 bg-red-50/50 p-3 dark:border-red-800/40 dark:bg-red-950/20">
            <p className="text-[11px] uppercase tracking-wide text-red-700 dark:text-red-400">Rejetés</p>
            <p className="mt-1 text-2xl font-semibold text-red-800 dark:text-red-300">{needStats.rejetes}</p>
          </article>
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
              {sortedNeeds.slice(0, 50).map((need) => {
                const quote = parseNeedQuote(need.details ?? null);
                const label = needStatusLabel(need);
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
      </section>

      {/* ---------- PAYMENT ORDER FORM ---------- */}
      <PaymentOrderForm issuerRole="ADMIN" />

      {/* ---------- PAYMENT ORDERS TABLE ---------- */}
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
