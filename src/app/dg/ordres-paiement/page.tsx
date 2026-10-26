import { AppShell } from "@/components/app-shell";
import { PaymentOrderForm } from "@/components/payment-order-form";
import { OpSearchableTable } from "@/components/op-edb-searchable-lists";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { toOpTableRow } from "@/lib/op-edb-list-rows";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

export const dynamic = "force-dynamic";

export default async function DgPaymentOrdersPage() {
  const { role, session } = await requirePageRoles(["DIRECTEUR_GENERAL"]);

  const orders = await paymentOrderClient.findMany({
    where: { issuedById: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const rows = orders.map(toOpTableRow);

  return (
    <AppShell role={role}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Espace DG — Ordres de paiement</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Recherche par bénéficiaire, motif ou libellé dans la liste ci-dessous.
        </p>
      </section>

      <PaymentOrderForm issuerRole="DIRECTEUR_GENERAL" />

      <section className="mt-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-semibold">Mes ordres de paiement</h2>
        <OpSearchableTable
          rows={rows}
          emptyMessage="Aucun ordre de paiement créé pour le moment."
          showAdminActions={false}
        />
      </section>
    </AppShell>
  );
}
