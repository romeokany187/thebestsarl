import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { workflowAssignmentLabel } from "@/lib/workflow-assignment";
import { parseNeedQuote } from "@/lib/need-lines";
import {
  type NeedFilter,
  NEED_FILTER_LABELS,
  needMatchesFilter,
  needStatusLabel,
  needBadgeClass,
} from "@/lib/need-filters";

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const VALID_FILTERS: NeedFilter[] = ["total", "en-attente", "approuves", "executes", "rejetes"];

export const dynamic = "force-dynamic";

export default async function EdbListPage({
  params,
}: {
  params: Promise<{ filter: string }>;
}) {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT"]);
  const { filter } = await params;

  if (!VALID_FILTERS.includes(filter as NeedFilter)) {
    notFound();
  }

  const needFilter = filter as NeedFilter;
  const label = NEED_FILTER_LABELS[needFilter];

  const allNeeds = await prisma.needRequest.findMany({
    include: {
      requester: { select: { id: true, name: true, jobTitle: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const filteredNeeds = allNeeds.filter((n) =>
    needMatchesFilter(n.status, n.reviewComment, needFilter),
  );

  return (
    <AppShell
      role={role}
      accessNote={`Liste filtrée des EDB : ${label}`}
    >
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">États de besoin — {label}</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              {filteredNeeds.length} EDB trouvé{filteredNeeds.length > 1 ? "s" : ""}
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

      <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Date</th>
                <th className="px-4 py-3 text-left font-semibold">Code</th>
                <th className="px-4 py-3 text-left font-semibold">Objet</th>
                <th className="px-4 py-3 text-left font-semibold">Demandeur</th>
                <th className="px-4 py-3 text-left font-semibold">Affectation</th>
                <th className="px-4 py-3 text-left font-semibold">Montant</th>
                <th className="px-4 py-3 text-left font-semibold">Statut</th>
                <th className="px-4 py-3 text-left font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredNeeds.map((need) => {
                const quote = parseNeedQuote(need.details ?? null);
                const statusLabel = needStatusLabel(need.status, need.reviewComment);
                return (
                  <tr key={need.id} className="border-t border-black/5 dark:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-black/65 dark:text-white/65">
                      {formatDate(need.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-700 dark:text-blue-400 whitespace-nowrap">
                      {need.code ?? need.id.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="px-4 py-3 font-medium max-w-[250px] truncate">{need.title}</td>
                    <td className="px-4 py-3 text-xs">{need.requester.name}</td>
                    <td className="px-4 py-3 text-xs">{workflowAssignmentLabel(quote?.assignment)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {typeof need.estimatedAmount === "number"
                        ? `${need.estimatedAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${normalizeMoneyCurrency(need.currency)}`
                        : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${needBadgeClass(statusLabel)}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
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
              {filteredNeeds.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Aucun EDB dans cette catégorie.
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
