import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OpSearchableTable } from "@/components/op-edb-searchable-lists";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { toOpTableRow } from "@/lib/op-edb-list-rows";
import {
  type OpFilter,
  OP_FILTER_LABELS,
  opMatchesFilter,
} from "@/lib/op-filters";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

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
    orderBy: [{ executedAt: "desc" }, { approvedAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });

  const rows = allOrders
    .filter((order: { status: string }) => opMatchesFilter(order.status, opFilter))
    .map(toOpTableRow);

  return (
    <AppShell role={role}>
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Ordres de paiement — {label}</h1>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">{rows.length} OP dans cette catégorie</p>
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
        <OpSearchableTable rows={rows} emptyMessage="Aucun OP dans cette catégorie." />
      </section>
    </AppShell>
  );
}
