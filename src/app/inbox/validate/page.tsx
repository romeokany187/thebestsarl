import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WorkflowStatusBoard } from "@/components/workflow-status-board";
import { canAccessApprovalPage, getApprovalWorkflowData } from "@/lib/inbox-workflow";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function InboxValidatePage() {
  const { role } = await requirePageModuleAccess("profile", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  if (!canAccessApprovalPage(role)) {
    redirect("/inbox");
  }

  const { paymentOrders, needs } = await getApprovalWorkflowData(role);

  return (
    <AppShell
      role={role}
      accessNote="Route dédiée aux OP / EDB à approuver pour l'admin et la DG."
    >
      <section className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <Link href="/inbox" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">Notifications</Link>
          <span className="rounded-full border border-black bg-black px-3 py-1 text-white dark:border-white dark:bg-white dark:text-black">À approuver</span>
          <Link href="/inbox/execute" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">À exécuter</Link>
          <Link href="/inbox/history" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">Historique</Link>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">OP & EDB à approuver</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Espace réservé aux validations admin / DG. Un clic depuis une notification vous amène directement sur le dossier concerné.
          </p>
        </div>
      </section>

      <WorkflowStatusBoard
        mode="validate"
        paymentOrders={paymentOrders}
        needs={needs}
      />
    </AppShell>
  );
}