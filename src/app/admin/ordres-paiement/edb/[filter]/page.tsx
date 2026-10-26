import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { EdbSearchableTable } from "@/components/op-edb-searchable-lists";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { toEdbTableRow } from "@/lib/op-edb-list-rows";
import {
  type NeedFilter,
  NEED_FILTER_LABELS,
  needMatchesFilter,
} from "@/lib/need-filters";

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
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const rows = allNeeds
    .filter((need) => needMatchesFilter(need.status, need.reviewComment, needFilter))
    .map(toEdbTableRow);

  return (
    <AppShell role={role}>
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">États de besoin — {label}</h1>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">{rows.length} EDB dans cette catégorie</p>
          </div>
          <a
            href="/admin/ordres-paiement"
            className="rounded-md border border-black/20 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            ← Retour
          </a>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <EdbSearchableTable rows={rows} emptyMessage="Aucun EDB dans cette catégorie." />
      </section>
    </AppShell>
  );
}
