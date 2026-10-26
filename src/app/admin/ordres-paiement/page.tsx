import { AppShell } from "@/components/app-shell";
import { AdminOpEdbWorkspace } from "@/components/admin-op-edb-workspace";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { hasNeedExecutionMarker } from "@/lib/inbox-workflow";
import { toEdbTableRow, toOpTableRow } from "@/lib/op-edb-list-rows";

const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

export const dynamic = "force-dynamic";

export default async function AdminPaymentOrdersPage() {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN"]);

  const [orders, allOrdersAll, needs] = await Promise.all([
    paymentOrderClient.findMany({
      where: {
        issuedBy: { role: "ADMIN" },
      },
      orderBy: [{ executedAt: "desc" }, { approvedAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
    paymentOrderClient.findMany({
      orderBy: [{ executedAt: "desc" }, { approvedAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    }),
    prisma.needRequest.findMany({
      include: {
        requester: { select: { id: true, name: true, jobTitle: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  const needStats = {
    total: needs.length,
    enAttente: needs.filter((n) => n.status === "SUBMITTED").length,
    approuves: needs.filter((n) => n.status === "APPROVED" && !hasNeedExecutionMarker(n.reviewComment)).length,
    executes: needs.filter((n) => hasNeedExecutionMarker(n.reviewComment)).length,
    rejetes: needs.filter((n) => n.status === "REJECTED").length,
  };

  const opStats = {
    total: allOrdersAll.length,
    enAttente: allOrdersAll.filter((o: { status: string }) => o.status === "SUBMITTED").length,
    approuves: allOrdersAll.filter((o: { status: string }) => o.status === "APPROVED").length,
    executes: allOrdersAll.filter((o: { status: string }) => o.status === "EXECUTED").length,
    rejetes: allOrdersAll.filter((o: { status: string }) => o.status === "REJECTED").length,
  };

  const edbRows = needs.map(toEdbTableRow);
  const opAdminRows = orders.map(toOpTableRow);

  return (
    <AppShell role={role}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ordres de paiement &amp; états de besoin</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Onglets EDB / OP, filtres par statut et recherche texte sur les champs métier.
        </p>
      </section>

      <AdminOpEdbWorkspace
        edbRows={edbRows}
        opAdminRows={opAdminRows}
        needStats={needStats}
        opStats={opStats}
      />
    </AppShell>
  );
}
