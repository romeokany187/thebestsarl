import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WorkflowStatusBoard } from "@/components/workflow-status-board";
import { canAccessHistoryPage, getHistoryWorkflowData } from "@/lib/inbox-workflow";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function InboxHistoryPage() {
  const { role, session } = await requirePageModuleAccess("profile", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const currentJobTitle = session.user.jobTitle ?? "AGENT_TERRAIN";

  if (!canAccessHistoryPage(role, currentJobTitle)) {
    redirect("/inbox");
  }

  const { paymentOrders, needs } = await getHistoryWorkflowData(role, currentJobTitle);

  return (
    <AppShell
      role={role}
      accessNote="Route dédiée à l'historique des OP / EDB validés et exécutés."
    >
      <section className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <Link href="/inbox" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">Notifications</Link>
          <Link href="/inbox/validate" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">À approuver</Link>
          <Link href="/inbox/execute" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">À exécuter</Link>
          <span className="rounded-full border border-black bg-black px-3 py-1 text-white dark:border-white dark:bg-white dark:text-black">Historique</span>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">OP & EDB validés et exécutés</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Espace de suivi pour les dossiers déjà validés, rejetés ou exécutés. Les notifications terminées redirigent ici automatiquement.
          </p>
        </div>
      </section>

      <WorkflowStatusBoard
        mode="history"
        paymentOrders={paymentOrders}
        needs={needs}
      />
    </AppShell>
  );
}